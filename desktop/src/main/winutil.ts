import { screen } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import type { Rect } from '../shared/types'

// One long-lived PowerShell that compiles the P/Invoke type ONCE and then answers
// a line per request. Spawning powershell + Add-Type on every hotkey cost ~1s on
// an idle machine and several seconds under a game — the capture hotkey felt dead
// for that long, and every repeated press queued another overlay.
const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rr, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
}
"@
[Console]::Out.WriteLine("ready")
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $h = [Fg]::GetForegroundWindow()
  $r = New-Object Fg+R
  [void][Fg]::GetWindowRect($h, [ref]$r)
  [Console]::Out.WriteLine(("{0},{1},{2},{3}" -f $r.L, $r.T, ($r.Rr - $r.L), ($r.B - $r.T)))
}
`

let helper: ChildProcessWithoutNullStreams | null = null
let helperReady = false
let buf = ''
const waiters: Array<(line: string | null) => void> = []

function startHelper(): void {
  if (helper || process.platform !== 'win32') return
  helperReady = false
  buf = ''
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], {
    windowsHide: true
  })
  helper = p
  p.stdout.on('data', (d: Buffer) => {
    buf += d.toString()
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      if (line === 'ready') {
        helperReady = true
        continue
      }
      waiters.shift()?.(line)
    }
  })
  p.on('error', () => undefined)
  p.on('exit', () => {
    if (helper === p) helper = null
    helperReady = false
    while (waiters.length) waiters.shift()?.(null)
  })
}

/** Warm the helper up front so the first hotkey press doesn't pay for Add-Type. */
export function initWinUtil(): void {
  startHelper()
}

export function disposeWinUtil(): void {
  helper?.kill()
  helper = null
}

function physToDip(x: number, y: number, width: number, height: number): Rect | null {
  if (width <= 0 || height <= 0) return null
  try {
    return screen.screenToDipRect(null as never, { x, y, width, height })
  } catch {
    return { x, y, width, height }
  }
}

/**
 * Returns the foreground window's bounds in DIP screen coordinates, or null on
 * failure. Must be called BEFORE showing our overlay, otherwise the overlay
 * itself is the foreground window. Never waits longer than `timeoutMs`.
 */
export function getForegroundWindowRectDip(timeoutMs = 700): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      const p = spawn('xdotool', ['getactivewindow', 'getwindowgeometry'])
      let out = ''
      p.stdout.on('data', (d) => (out += d.toString()))
      p.on('error', () => resolve(null))
      p.on('close', () => {
        const posMatch = out.match(/Position:\s*(-?\d+),\s*(-?\d+)/)
        const geoMatch = out.match(/Geometry:\s*(\d+)x(\d+)/)
        if (!posMatch || !geoMatch) return resolve(null)
        resolve(
          physToDip(
            parseInt(posMatch[1], 10),
            parseInt(posMatch[2], 10),
            parseInt(geoMatch[1], 10),
            parseInt(geoMatch[2], 10)
          )
        )
      })
      return
    }

    startHelper()
    // Still compiling (first press right after launch): don't make the user wait
    // for it — window capture falls back to the display under the cursor.
    if (!helper || !helperReady) return resolve(null)

    let settled = false
    const waiter = (line: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!line) return resolve(null)
      const parts = line.split(',').map((n) => parseInt(n, 10))
      if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return resolve(null)
      // GetWindowRect returns physical pixels; convert to DIP for our capture path.
      resolve(physToDip(parts[0], parts[1], parts[2], parts[3]))
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      // Leave a no-op in the queue slot so the late answer isn't handed to the
      // next request.
      const idx = waiters.indexOf(waiter)
      if (idx >= 0) waiters[idx] = () => undefined
      resolve(null)
    }, timeoutMs)
    waiters.push(waiter)
    helper.stdin.write('q\n')
  })
}
