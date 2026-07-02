import { app, nativeImage } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { execFile } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
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

/** Cache key: file name + mtime, so edits/replacements invalidate naturally. */
function cacheFileFor(path: string, mtime: number): string {
  return join(cacheDir(), `${basename(path)}-${Math.round(mtime)}.jpg`)
}

async function readCached(cacheFile: string): Promise<string | null> {
  try {
    const buf = await readFile(cacheFile)
    return 'data:image/jpeg;base64,' + buf.toString('base64')
  } catch {
    return null
  }
}

/** Extract (and cache) a poster-frame thumbnail for a video as a data URL. */
export async function videoThumbnail(path: string, mtime: number): Promise<string | null> {
  const cacheFile = cacheFileFor(path, mtime)
  const hit = await readCached(cacheFile)
  if (hit) return hit
  const ok = await new Promise<boolean>((resolve) => {
    execFile(
      ffmpegPath(),
      ['-y', '-ss', '0.5', '-i', path, '-frames:v', '1', '-vf', 'scale=320:-2', cacheFile],
      { windowsHide: true },
      (err) => resolve(!err)
    )
  })
  if (!ok) return null
  return readCached(cacheFile)
}

/**
 * Resized (and cached) thumbnail for an image as a data URL. The decode+resize
 * happens once per file; later history refreshes just read the small cache file
 * instead of re-decoding a full-resolution (possibly 4K) PNG each time.
 */
export async function imageThumbnail(path: string, mtime: number): Promise<string | null> {
  const cacheFile = cacheFileFor(path, mtime)
  const hit = await readCached(cacheFile)
  if (hit) return hit
  const img = nativeImage.createFromPath(path)
  if (img.isEmpty()) return null
  const jpg = img.resize({ width: 320 }).toJPEG(82)
  try {
    await writeFile(cacheFile, jpg)
  } catch {
    // Cache write failed (disk full, permissions) — still return the thumb.
  }
  return 'data:image/jpeg;base64,' + jpg.toString('base64')
}
