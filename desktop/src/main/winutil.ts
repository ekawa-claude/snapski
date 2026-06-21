import { screen } from 'electron'
import { spawn } from 'child_process'
import type { Rect } from '../shared/types'

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
$h = [Fg]::GetForegroundWindow()
$r = New-Object Fg+R
[void][Fg]::GetWindowRect($h, [ref]$r)
Write-Output ("{0},{1},{2},{3}" -f $r.L, $r.T, ($r.Rr - $r.L), ($r.B - $r.T))
`

/**
 * Returns the foreground window's bounds in DIP screen coordinates, or null on
 * failure. Must be called BEFORE showing our overlay, otherwise the overlay
 * itself is the foreground window.
 */
export function getForegroundWindowRectDip(): Promise<Rect | null> {
  return new Promise((resolve) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
      { windowsHide: true }
    )
    let out = ''
    ps.stdout.on('data', (d) => (out += d.toString()))
    ps.on('error', () => resolve(null))
    ps.on('close', () => {
      const parts = out.trim().split(',').map((n) => parseInt(n, 10))
      if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return resolve(null)
      const [x, y, width, height] = parts
      if (width <= 0 || height <= 0) return resolve(null)
      try {
        // GetWindowRect returns physical pixels; convert to DIP for our capture path.
        const dip = screen.screenToDipRect(null as never, { x, y, width, height })
        resolve(dip)
      } catch {
        resolve({ x, y, width, height })
      }
    })
  })
}
