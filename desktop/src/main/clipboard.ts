import { clipboard, nativeImage } from 'electron'
import { spawn } from 'child_process'

/** Copy a PNG (given as a data URL or buffer) to the clipboard as an image. */
export function copyImageToClipboard(png: Buffer): void {
  const img = nativeImage.createFromBuffer(png)
  if (!img.isEmpty()) clipboard.writeImage(img)
}

/**
 * Put a file on the Windows clipboard as a CF_HDROP file-drop so it pastes as an
 * attachment into Slack/Telegram/etc. Electron's clipboard can't do this, so we
 * shell out to PowerShell's Set-Clipboard -LiteralPath. Used by recording/video
 * phases. Returns a promise that resolves when the clipboard write completes.
 */
export function copyFileToClipboard(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard', '-LiteralPath', filePath],
      { windowsHide: true }
    )
    let err = ''
    ps.stderr.on('data', (d) => (err += d.toString()))
    ps.on('error', reject)
    ps.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Set-Clipboard exited ${code}: ${err}`))
    })
  })
}
