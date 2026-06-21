import { app } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'

function ffmpegPath(): string {
  let p = (ffmpegStatic as unknown as string) || 'ffmpeg'
  if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    p = p.replace('app.asar', 'app.asar.unpacked')
  }
  return p
}

function cacheDir(): string {
  const d = join(app.getPath('userData'), 'thumb-cache')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** Extract (and cache) a poster-frame thumbnail for a video as a data URL. */
export function videoThumbnail(path: string, mtime: number): string | null {
  const cacheFile = join(cacheDir(), `${basename(path)}-${Math.round(mtime)}.jpg`)
  if (!existsSync(cacheFile)) {
    const r = spawnSync(
      ffmpegPath(),
      ['-y', '-ss', '0.5', '-i', path, '-frames:v', '1', '-vf', 'scale=320:-2', cacheFile],
      { windowsHide: true }
    )
    if (r.status !== 0 || !existsSync(cacheFile)) return null
  }
  try {
    return 'data:image/jpeg;base64,' + readFileSync(cacheFile).toString('base64')
  } catch {
    return null
  }
}
