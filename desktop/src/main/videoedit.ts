import { spawn, ChildProcess } from 'child_process'
import ffmpegStatic from 'ffmpeg-static'
import type { VideoExportOpts } from '../shared/types'

function ffmpegPath(): string {
  let p = (ffmpegStatic as unknown as string) || 'ffmpeg'
  if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    p = p.replace('app.asar', 'app.asar.unpacked')
  }
  return p
}

function parseTimeToSec(s: string): number | null {
  const m = s.match(/(\d+):(\d+):(\d+\.\d+)/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/**
 * Export an edited clip. Trim-only uses stream copy (fast, no re-encode); any
 * blur forces a re-encode (crop + boxblur + overlay). Reports progress 0..1.
 */
export function exportVideo(
  opts: VideoExportOpts,
  outFile: string,
  onProgress: (frac: number) => void,
  onDone: (ok: boolean) => void
): ChildProcess {
  const hasTrim = opts.inSec != null && opts.outSec != null && opts.outSec > opts.inSec
  const inSec = hasTrim ? (opts.inSec as number) : 0
  const dur = hasTrim ? (opts.outSec as number) - (opts.inSec as number) : undefined

  const args: string[] = ['-y']

  if (opts.blur) {
    // Blur forces a re-encode. We trim INSIDE the filter graph (trim+setpts) so
    // the timeline is 0-based and deterministic — that lets the blur's
    // enable='between(t,..)' segment line up exactly, independent of -ss quirks.
    const { x, y, width, height, start, end } = opts.blur
    const base = hasTrim
      ? `[0:v]trim=${inSec}:${opts.outSec},setpts=PTS-STARTPTS[base]`
      : ''
    const baseLabel = hasTrim ? '[base]' : '[0:v]'

    // Segment times relative to the (trimmed) output, clamped to >= 0.
    let enable = ''
    if (start != null && end != null) {
      const s = Math.max(0, start - inSec)
      const e = Math.max(s, end - inSec)
      enable = `:enable='between(t,${s.toFixed(3)},${e.toFixed(3)})'`
    }

    const graph =
      (base ? base + ';' : '') +
      `${baseLabel}split[a][b];` +
      `[b]crop=${width}:${height}:${x}:${y},boxblur=12[bl];` +
      `[a][bl]overlay=${x}:${y}${enable}[v]`

    args.push(
      '-i',
      opts.path,
      '-filter_complex',
      graph,
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p'
    )
  } else {
    // Trim-only: fast stream copy.
    if (opts.inSec != null) args.push('-ss', String(opts.inSec))
    args.push('-i', opts.path)
    if (dur != null) args.push('-t', String(dur))
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero')
  }
  args.push('-movflags', '+faststart', outFile)

  const proc = spawn(ffmpegPath(), args, { windowsHide: true })
  let err = ''
  proc.stderr.on('data', (d) => {
    const s = d.toString()
    err += s
    const t = s.match(/time=(\d+:\d+:\d+\.\d+)/)
    if (t && dur) {
      const sec = parseTimeToSec(t[1])
      if (sec != null) onProgress(Math.max(0, Math.min(1, sec / dur)))
    }
  })
  proc.on('error', () => onDone(false))
  proc.on('close', (code) => {
    if (code !== 0) console.error('ffmpeg export exit', code, err.split('\n').slice(-6).join('\n'))
    onDone(code === 0)
  })
  return proc
}
