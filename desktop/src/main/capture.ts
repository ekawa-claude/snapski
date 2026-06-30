import { desktopCapturer, screen, nativeImage, NativeImage, Display } from 'electron'
import { spawn } from 'child_process'
import type { Rect } from '../shared/types'
import { ffmpegPath } from './recorder'

/**
 * Capture every screen at native resolution. Passing an oversized thumbnail
 * means Electron returns each display at its real pixel size (it never
 * upscales), which is exactly what we want for crisp screenshots.
 */
async function captureScreens(): Promise<Map<string, NativeImage>> {
  const displays = screen.getAllDisplays()
  let maxW = 0
  let maxH = 0
  for (const d of displays) {
    maxW = Math.max(maxW, Math.round(d.size.width * d.scaleFactor))
    maxH = Math.max(maxH, Math.round(d.size.height * d.scaleFactor))
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW || 1920, height: maxH || 1080 }
  })
  const map = new Map<string, NativeImage>()
  for (const s of sources) {
    if (s.display_id) map.set(s.display_id, s.thumbnail)
  }
  return map
}

function displayUnderPoint(pt: { x: number; y: number }): Display {
  return screen.getDisplayNearestPoint(pt)
}

/** Capture a single full display. Defaults to the display under the cursor. */
export async function captureFullscreen(displayId?: number): Promise<NativeImage> {
  const screens = await captureScreens()
  const display = displayId
    ? screen.getAllDisplays().find((d) => d.id === displayId) ?? displayUnderPoint(screen.getCursorScreenPoint())
    : displayUnderPoint(screen.getCursorScreenPoint())
  const img = screens.get(String(display.id))
  if (img && !img.isEmpty()) return img
  // Fallback: first available screen.
  const first = [...screens.values()][0]
  if (!first) throw new Error('No screen sources available')
  return first
}

/**
 * Capture a region given in DIP screen coordinates. The region is clamped to
 * the display that contains its center, then cropped at native pixel scale.
 */
export async function captureRegion(rectDip: Rect): Promise<NativeImage> {
  const screens = await captureScreens()
  const center = {
    x: Math.round(rectDip.x + rectDip.width / 2),
    y: Math.round(rectDip.y + rectDip.height / 2)
  }
  const display = displayUnderPoint(center)
  const img = screens.get(String(display.id))
  if (!img || img.isEmpty()) throw new Error('No screen source for region')

  const sf = display.scaleFactor
  // Clamp the region to the chosen display (in DIP).
  const b = display.bounds
  const x0 = Math.max(rectDip.x, b.x)
  const y0 = Math.max(rectDip.y, b.y)
  const x1 = Math.min(rectDip.x + rectDip.width, b.x + b.width)
  const y1 = Math.min(rectDip.y + rectDip.height, b.y + b.height)

  const crop = {
    x: Math.round((x0 - b.x) * sf),
    y: Math.round((y0 - b.y) * sf),
    width: Math.max(1, Math.round((x1 - x0) * sf)),
    height: Math.max(1, Math.round((y1 - y0) * sf))
  }
  return img.crop(crop)
}

/**
 * Fast single-frame grab via ffmpeg's gdigrab — runs in a CHILD process, so the
 * Electron main thread never blocks. `desktopCapturer.getSources` initializes the
 * whole capture stack on the main thread and stalls the app (and the foreground
 * game) for seconds; gdigrab does a cheap out-of-process BitBlt instead. This is
 * the same engine the recorder uses, so capture coverage matches recording.
 *
 * @param rectPhysical capture rect in PHYSICAL screen pixels (relative to the
 *   primary monitor's top-left), e.g. from `screen.dipToScreenRect`.
 */
export function captureRectFast(rectPhysical: Rect): Promise<NativeImage> {
  const w = Math.max(1, Math.round(rectPhysical.width))
  const h = Math.max(1, Math.round(rectPhysical.height))
  
  const isWin = process.platform === 'win32'
  const display = process.env.DISPLAY || ':0.0'
  const x = Math.round(rectPhysical.x)
  const y = Math.round(rectPhysical.y)

  const inputArgs = isWin
    ? [
        '-f', 'gdigrab',
        '-offset_x', String(x),
        '-offset_y', String(y),
        '-video_size', `${w}x${h}`,
        '-i', 'desktop'
      ]
    : [
        '-f', 'x11grab',
        '-video_size', `${w}x${h}`,
        '-i', `${display}+${x},${y}`
      ]

  const args = [
    '-loglevel', 'error',
    '-probesize', '32',
    '-analyzeduration', '0',
    '-draw_mouse', '0',
    '-framerate', '30',
    ...inputArgs,
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    'pipe:1'
  ]
  return new Promise((resolve, reject) => {
    let p: ReturnType<typeof spawn>
    try {
      p = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) {
      reject(e)
      return
    }
    const chunks: Buffer[] = []
    let err = ''
    p.stdout?.on('data', (d: Buffer) => chunks.push(d))
    p.stderr?.on('data', (d: Buffer) => {
      err += d.toString()
      if (err.length > 4000) err = err.slice(-4000)
    })
    p.on('error', reject)
    p.on('close', (code) => {
      if (chunks.length === 0) {
        reject(new Error(`gdigrab produced no frame (code ${code}): ${err.split('\n').slice(-4).join(' ')}`))
        return
      }
      const img = nativeImage.createFromBuffer(Buffer.concat(chunks))
      if (img.isEmpty()) {
        reject(new Error('gdigrab frame decoded empty'))
        return
      }
      resolve(img)
    })
  })
}

export function emptyImage(): NativeImage {
  return nativeImage.createEmpty()
}
