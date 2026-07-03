import { app, BrowserWindow, ipcMain } from 'electron'
import pkg from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

// electron-updater ships as CJS; grab the singleton off the default export.
const { autoUpdater } = pkg

// Re-check this often while the app stays open (it lives in the tray).
const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000 // 3 hours

let getWindow: () => BrowserWindow | null = () => null

function push(status: UpdateStatus): void {
  getWindow()?.webContents.send('update:status', status)
}

/**
 * Wire up auto-update against the generic feed baked in at build time
 * (electron-builder `publish` → app-update.yml). Downloads happen in the
 * background; the renderer decides when to prompt a restart. No-ops in dev
 * (unpackaged) where there is no feed to talk to.
 */
export function initUpdater(window: () => BrowserWindow | null): void {
  getWindow = window

  // IPC the renderer uses to apply a downloaded update.
  ipcMain.handle('update:install', () => {
    // `isSilent` false so the one-click installer's progress UI shows.
    autoUpdater.quitAndInstall(false, true)
  })
  ipcMain.handle('update:check', () => {
    if (app.isPackaged) void autoUpdater.checkForUpdates()
  })

  if (!app.isPackaged) return // dev: nothing to update against

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => push({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => push({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => push({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => push({ state: 'progress', percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) =>
    push({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) => push({ state: 'error', message: err?.message ?? String(err) }))

  // Check shortly after launch (let the window paint first), then periodically.
  setTimeout(() => void autoUpdater.checkForUpdates(), 4000)
  setInterval(() => void autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS)
}
