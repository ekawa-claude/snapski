import { spawn, ChildProcess } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import type { Rect, CaptureKind } from '../shared/types'

/** Resolve the bundled ffmpeg path, accounting for asar packaging. */
export function ffmpegPath(): string {
  let p = (ffmpegStatic as unknown as string) || 'ffmpeg'
  if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    p = p.replace('app.asar', 'app.asar.unpacked')
  }
  return p
}

let proc: ChildProcess | null = null
let currentFile: string | null = null

export function isRecording(): boolean {
  return proc !== null
}

export interface StartOpts {
  kind: CaptureKind
  /** Capture rectangle in PHYSICAL screen pixels (relative to primary top-left). */
  rect: Rect
  outFile: string
  fps?: number
}

/**
 * Start an mp4 screen recording with gdigrab. Records the given physical-pixel
 * rectangle of the desktop. Returns false if a recording is already running.
 */
export function startRecording(opts: StartOpts, onExit: (file: string, ok: boolean) => void): boolean {
  if (proc) return false

  // libx264 + yuv420p requires even dimensions.
  const w = Math.max(2, Math.floor(opts.rect.width / 2) * 2)
  const h = Math.max(2, Math.floor(opts.rect.height / 2) * 2)

  const isWin = process.platform === 'win32'
  const display = process.env.DISPLAY || ':0.0'
  const x = Math.round(opts.rect.x)
  const y = Math.round(opts.rect.y)

  const inputArgs = isWin
    ? [
        '-f', 'gdigrab',
        '-framerate', String(opts.fps ?? 30),
        '-offset_x', String(x),
        '-offset_y', String(y),
        '-video_size', `${w}x${h}`,
        '-i', 'desktop'
      ]
    : [
        '-f', 'x11grab',
        '-framerate', String(opts.fps ?? 30),
        '-video_size', `${w}x${h}`,
        '-i', `${display}+${x},${y}`
      ]

  const args = [
    '-y',
    ...inputArgs,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    opts.outFile
  ]

  try {
    proc = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  } catch {
    proc = null
    return false
  }
  currentFile = opts.outFile

  let stderr = ''
  proc.stderr?.on('data', (d) => {
    stderr += d.toString()
    if (stderr.length > 8000) stderr = stderr.slice(-8000)
  })
  proc.on('error', () => {
    const f = currentFile ?? opts.outFile
    proc = null
    currentFile = null
    onExit(f, false)
  })
  proc.on('close', (code) => {
    const f = currentFile ?? opts.outFile
    proc = null
    currentFile = null
    if (code !== 0) console.error('ffmpeg exited', code, stderr.split('\n').slice(-6).join('\n'))
    onExit(f, code === 0)
  })
  return true
}

/** Gracefully stop recording so the mp4 is finalized (moov atom written). */
export function stopRecording(): void {
  const p = proc
  if (!p) return
  try {
    p.stdin?.write('q')
    p.stdin?.end()
  } catch {
    p.kill()
    return
  }
  // ffmpeg normally finishes within a second. If it hangs (gdigrab stuck on a
  // mode switch), the app would think it's recording forever and the hotkey
  // would only ever try to stop it again — kill it so the user gets unstuck.
  setTimeout(() => {
    if (proc === p) p.kill()
  }, 8000)
}
