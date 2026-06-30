import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Tray,
  Menu,
  dialog,
  screen,
  nativeImage,
  protocol
} from 'electron'
import { join } from 'path'
import { writeFile, readdir, stat } from 'fs/promises'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { loadSettings, saveSettings, ensureOutputFolder } from './settings'
import { captureRegion, captureFullscreen, captureRectFast } from './capture'
import { copyNativeImageToClipboard, copyFileToClipboard } from './clipboard'
import { getForegroundWindowRectDip } from './winutil'
import { videoThumbnail } from './thumbs'
import { exportVideo } from './videoedit'
import * as recorder from './recorder'
import type { CaptureResult, CaptureKind, Rect, VideoExportOpts } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null
let pendingWindowRect: Rect | null = null

/** True when launched by the OS auto-start entry — boot straight into the tray. */
const startedHidden = process.argv.includes('--hidden')

/** Branding icon (monster mascot) bundled in build/. */
function brandIcon(name: 'icon.png' | 'tray.png'): Electron.NativeImage {
  // Packaged: build/ is copied next to the app via electron-builder buildResources.
  // Dev: resolve relative to the project root.
  const candidates = is.dev
    ? [join(__dirname, '../../build', name)]
    : [join(process.resourcesPath, name), join(process.resourcesPath, 'build', name)]
  for (const p of candidates) {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return img
  }
  return nativeImage.createEmpty()
}

/** Mirror the auto-launch setting into the Windows login-items registry entry. */
function applyAutoLaunch(enabled: boolean): void {
  // Portable builds extract to a fresh temp dir each run, so an auto-start path
  // would be stale on next boot — only register a stable executable path.
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: ['--hidden']
  })
}

// Custom scheme so the renderer can stream local mp4 files into a <video>.
protocol.registerSchemesAsPrivileged([
  { scheme: 'snap', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function contentType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop()
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'webm') return 'video/webm'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

function registerSnapProtocol(): void {
  protocol.handle('snap', async (request) => {
    // snap://media/<encodeURIComponent(absolutePath)>
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname).replace(/^\//, '')
    const allowed = [loadSettings().outputFolder, app.getPath('temp'), app.getPath('pictures')]
    const ok = allowed.some((dir) => filePath.toLowerCase().startsWith(dir.toLowerCase()))
    if (!ok) return new Response('forbidden', { status: 403 })

    // Serve with byte-range support so <video> can seek. Without 206/Content-Range
    // the element treats the stream as non-seekable and resets to the start on any seek.
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      return new Response('not found', { status: 404 })
    }

    const type = contentType(filePath)
    const range = request.headers.get('Range')
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : 0
        let end = m[2] ? parseInt(m[2], 10) : size - 1
        if (Number.isNaN(start)) start = 0
        if (Number.isNaN(end) || end >= size) end = size - 1
        if (start > end || start >= size) {
          return new Response('range not satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` }
          })
        }
        const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
        return new Response(stream, {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes'
          }
        })
      }
    }

    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes'
      }
    })
  })
}

const trayIcon = (): Electron.NativeImage => {
  // A small embedded camera-dot glyph so we don't depend on a file at runtime.
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAlElEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUAACQ0wEBxGZ4DwAAAABJRU5ErkJggg=='
  return nativeImage.createFromBuffer(Buffer.from(png, 'base64'))
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0c',
    title: 'SnapSki',
    icon: brandIcon('icon.png'),
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // When auto-started at login we boot silently into the tray; the user opens
  // the window from the tray. Any later open shows normally.
  mainWindow.on('ready-to-show', () => {
    if (!startedHidden) mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** Bounds of the whole virtual desktop in DIP. */
function virtualBounds(): Rect {
  const displays = screen.getAllDisplays()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x)
    minY = Math.min(minY, d.bounds.y)
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width)
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

async function showOverlay(): Promise<void> {
  if (overlayWindow) {
    overlayWindow.focus()
    return
  }
  // Snapshot the foreground window BEFORE the overlay steals focus.
  pendingWindowRect = await getForegroundWindowRectDip()

  const vb = virtualBounds()
  overlayWindow = new BrowserWindow({
    x: vb.x,
    y: vb.y,
    width: vb.width,
    height: vb.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true)

  const mode = loadSettings().captureMode
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html?mode=${mode}`)
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay.html'), { query: { mode } })
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function closeOverlay(): void {
  if (overlayWindow) {
    overlayWindow.close()
    overlayWindow = null
  }
}

function timestampName(prefix: string, ext: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${prefix}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.${ext}`
}

async function finishCapture(image: Electron.NativeImage, notify = true): Promise<CaptureResult> {
  const settings = loadSettings()
  const size = image.getSize()

  // Hand the bitmap straight to the clipboard — no PNG encode/decode round-trip.
  if (settings.copyToClipboard) copyNativeImageToClipboard(image)

  // Encode PNG at most once, and only when something actually needs it: the file
  // on disk, or the data URL the renderer shows. Each encode of a 4K frame costs
  // hundreds of ms on the main thread, so we skip the ones we don't need.
  let png: Buffer | null = null
  let savedPath: string | null = null
  if (settings.saveToFolder) {
    png = image.toPNG()
    ensureOutputFolder(settings.outputFolder)
    savedPath = join(settings.outputFolder, timestampName('Snap', 'png'))
    await writeFile(savedPath, png)
  }

  // The data URL is only consumed by the renderer (editor/preview). Silent
  // captures (instant fullscreen) never use it — skip the costliest step.
  let dataUrl = ''
  if (notify) {
    if (!png) png = image.toPNG()
    dataUrl = `data:image/png;base64,${png.toString('base64')}`
  }

  const result: CaptureResult = {
    dataUrl,
    savedPath,
    width: size.width,
    height: size.height
  }
  if (notify) {
    mainWindow?.webContents.send('capture:done', result)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  }
  return result
}

// ---------- recording HUD (border + stop bar) ----------
let recBorderWin: BrowserWindow | null = null
let recBarWin: BrowserWindow | null = null

function loadHud(win: BrowserWindow, type: 'border' | 'bar'): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/rec-hud.html?type=${type}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/rec-hud.html'), { query: { type } })
  }
}

function showRecHud(rectDip: Rect | null): void {
  const preload = join(__dirname, '../preload/index.js')
  const T = 3

  // Red ring drawn just outside the recorded region (so it isn't captured).
  if (rectDip) {
    recBorderWin = new BrowserWindow({
      x: Math.round(rectDip.x - T),
      y: Math.round(rectDip.y - T),
      width: Math.round(rectDip.width + T * 2),
      height: Math.round(rectDip.height + T * 2),
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      fullscreenable: false,
      backgroundColor: '#00000000',
      webPreferences: { preload, sandbox: false }
    })
    recBorderWin.setAlwaysOnTop(true, 'screen-saver')
    recBorderWin.setIgnoreMouseEvents(true, { forward: true })
    // Exclude from screen capture so the border never lands in the recording.
    recBorderWin.setContentProtection(true)
    loadHud(recBorderWin, 'border')
    recBorderWin.showInactive()
  }

  // Floating stop bar — placed just below the region (outside it) or, for
  // fullscreen, at the bottom-centre of the active display. The window is a bit
  // larger than the pill so its soft shadow has room and isn't clipped.
  const barW = 220
  const barH = 64
  let bx: number
  let by: number
  if (rectDip) {
    const disp = screen.getDisplayMatching(rectDip)
    bx = Math.round(rectDip.x + rectDip.width / 2 - barW / 2)
    by = Math.round(rectDip.y + rectDip.height + 12)
    if (by + barH > disp.bounds.y + disp.bounds.height) {
      by = Math.round(rectDip.y - barH - 12)
    }
    bx = Math.max(disp.bounds.x + 8, Math.min(bx, disp.bounds.x + disp.bounds.width - barW - 8))
  } else {
    const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    bx = Math.round(disp.bounds.x + disp.bounds.width / 2 - barW / 2)
    by = Math.round(disp.bounds.y + disp.bounds.height - barH - 24)
  }
  recBarWin = new BrowserWindow({
    x: bx,
    y: by,
    width: barW,
    height: barH,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: { preload, sandbox: false }
  })
  recBarWin.setAlwaysOnTop(true, 'screen-saver')
  // Exclude from screen capture so the stop bar never lands in the recording,
  // even for fullscreen captures.
  recBarWin.setContentProtection(true)
  loadHud(recBarWin, 'bar')
  recBarWin.showInactive()
}

function destroyRecHud(): void {
  recBorderWin?.close()
  recBorderWin = null
  recBarWin?.close()
  recBarWin = null
}

/**
 * Grab a DIP rect via gdigrab (child process — no main-thread/game freeze),
 * falling back to desktopCapturer's cropping path only if ffmpeg can't deliver.
 */
async function grabRegionDip(rectDip: Rect): Promise<Electron.NativeImage> {
  const rectPhys = screen.dipToScreenRect(null as never, rectDip)
  try {
    return await captureRectFast(rectPhys)
  } catch (e) {
    console.error('fast region grab failed, falling back to desktopCapturer', e)
    return captureRegion(rectDip)
  }
}

/** Grab the full display under the cursor, fast path with fallback. */
async function grabFullscreen(): Promise<Electron.NativeImage> {
  const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const rectPhys = screen.dipToScreenRect(null as never, disp.bounds)
  try {
    return await captureRectFast(rectPhys)
  } catch (e) {
    console.error('fast fullscreen grab failed, falling back to desktopCapturer', e)
    return captureFullscreen()
  }
}

/**
 * Instant fullscreen screenshot: no overlay, no focus steal, no window raise.
 * Captures the display under the cursor, saves/copies per settings. Built for
 * grabbing shots mid-game without being yanked out.
 */
async function instantFullscreen(): Promise<void> {
  try {
    const img = await grabFullscreen()
    await finishCapture(img, false)
    // Refresh the in-app history without raising/focusing the window.
    mainWindow?.webContents.send('history:changed')
  } catch (err) {
    console.error('instant fullscreen failed', err)
  }
}

// ---------- recording ----------
function notifyRecordState(): void {
  const active = recorder.isRecording()
  mainWindow?.webContents.send('record:state', { active })
  updateTray()
}

/** Resolve a physical-pixel capture rect for the given kind. */
function physicalRectFor(kind: CaptureKind, rectDip?: Rect): Rect | null {
  if (kind === 'region' && rectDip) {
    return screen.dipToScreenRect(null as never, rectDip)
  }
  if (kind === 'window' && pendingWindowRect) {
    return screen.dipToScreenRect(null as never, pendingWindowRect)
  }
  // fullscreen (or fallback): the display under the cursor
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return screen.dipToScreenRect(null as never, display.bounds)
}

function startRecording(kind: CaptureKind, rectDip?: Rect): void {
  if (recorder.isRecording()) return
  const rect = physicalRectFor(kind, rectDip)
  if (!rect) return
  // DIP rect used to draw the on-screen border (none for fullscreen).
  const hudRectDip = kind === 'region' ? (rectDip ?? null) : kind === 'window' ? pendingWindowRect : null
  const settings = loadSettings()
  ensureOutputFolder(settings.outputFolder)
  const outFile = join(settings.outputFolder, timestampName('Rec', 'mp4'))

  // Get the app out of the shot, then start once the window is actually gone.
  if (mainWindow && !mainWindow.isMinimized()) mainWindow.minimize()

  setTimeout(() => {
    const ok = recorder.startRecording({ kind, rect, outFile }, (file, success) => {
      destroyRecHud()
      notifyRecordState()
      if (mainWindow) {
        mainWindow.restore()
        mainWindow.show()
      }
      mainWindow?.webContents.send('record:done', { path: file, ok: success })
      if (success) {
        copyFileToClipboard(file).catch((e) => console.error('file-drop copy failed', e))
      }
    })
    if (ok) {
      showRecHud(hudRectDip)
      notifyRecordState()
    } else {
      mainWindow?.restore()
      notifyRecordState()
    }
  }, 350)
}

function stopRecording(): void {
  recorder.stopRecording()
}

function registerHotkeys(): void {
  globalShortcut.unregisterAll()
  const { hotkeys } = loadSettings()
  if (hotkeys.capture) {
    const ok = globalShortcut.register(hotkeys.capture, () => {
      // While recording, the hotkey stops it; otherwise it opens the overlay.
      if (recorder.isRecording()) stopRecording()
      else showOverlay()
    })
    if (!ok) console.error(`Failed to register hotkey: ${hotkeys.capture}`)
  }
  // Dedicated instant-fullscreen hotkey (skip if it collides with the overlay key).
  if (hotkeys.fullscreen && hotkeys.fullscreen !== hotkeys.capture) {
    const ok = globalShortcut.register(hotkeys.fullscreen, () => {
      void instantFullscreen()
    })
    if (!ok) console.error(`Failed to register hotkey: ${hotkeys.fullscreen}`)
  }
}

function updateTray(): void {
  if (!tray) return
  const rec = recorder.isRecording()
  const menu = Menu.buildFromTemplate([
    rec
      ? { label: '⏹  Stop recording', click: () => stopRecording() }
      : { label: 'Capture (region / fullscreen)', click: () => showOverlay() },
    { type: 'separator' },
    {
      label: 'Show SnapSki',
      click: () => {
        if (!mainWindow) createMainWindow()
        else {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.setToolTip(rec ? 'SnapSki — recording…' : 'SnapSki')
  tray.setContextMenu(menu)
}

function createTray(): void {
  const icon = brandIcon('tray.png')
  tray = new Tray(icon.isEmpty() ? trayIcon() : icon)
  tray.on('double-click', () => mainWindow?.show())
  updateTray()
}

// ---------- IPC ----------
function registerIpc(): void {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, patch) => {
    const next = saveSettings(patch)
    if (patch?.hotkeys) registerHotkeys()
    if (typeof patch?.autoLaunch === 'boolean') applyAutoLaunch(patch.autoLaunch)
    return next
  })
  ipcMain.handle('settings:chooseFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const next = saveSettings({ outputFolder: res.filePaths[0] })
    return next.outputFolder
  })
  ipcMain.handle('settings:openFolder', () => {
    shell.openPath(loadSettings().outputFolder)
  })

  ipcMain.handle('capture:trigger', () => showOverlay())

  // History: list saved PNGs in the output folder (newest first) as thumbnails
  ipcMain.handle('history:list', async () => {
    const folder = loadSettings().outputFolder
    try {
      const names = await readdir(folder)
      const media = names.filter((n) => /\.(png|mp4)$/i.test(n))
      const stated = await Promise.all(
        media.map(async (name) => {
          const full = join(folder, name)
          try {
            const s = await stat(full)
            const type = name.toLowerCase().endsWith('.mp4') ? 'video' : 'image'
            return { path: full, name, mtime: s.mtimeMs, type: type as 'image' | 'video' }
          } catch {
            return null
          }
        })
      )
      const items = stated.filter((x): x is NonNullable<typeof x> => x !== null)
      items.sort((a, b) => b.mtime - a.mtime)
      return items.slice(0, 40).map((it) => {
        let thumb: string | null = null
        if (it.type === 'image') {
          const img = nativeImage.createFromPath(it.path)
          thumb = img.isEmpty() ? null : img.resize({ width: 320 }).toDataURL()
        } else {
          thumb = videoThumbnail(it.path, it.mtime)
        }
        return { ...it, thumb }
      })
    } catch {
      return []
    }
  })

  // Video editing: trim and/or static region blur → re-save + file-drop copy
  ipcMain.handle('video:export', async (_e, opts: VideoExportOpts) => {
    const settings = loadSettings()
    ensureOutputFolder(settings.outputFolder)
    const outFile = join(settings.outputFolder, timestampName('Clip', 'mp4'))
    return new Promise((resolve) => {
      exportVideo(
        opts,
        outFile,
        (frac) => mainWindow?.webContents.send('video:progress', frac),
        (ok) => {
          if (ok) copyFileToClipboard(outFile).catch((e) => console.error('file-drop failed', e))
          resolve({ ok, path: outFile })
        }
      )
    })
  })

  // History: open a saved file at full resolution for editing
  ipcMain.handle('history:open', async (_e, p: string) => {
    const img = nativeImage.createFromPath(p)
    const size = img.getSize()
    return { dataUrl: img.toDataURL(), savedPath: p, width: size.width, height: size.height }
  })

  // Editor → re-export edited image (re-copy to clipboard + re-save to folder)
  ipcMain.handle('image:export', async (_e, dataUrl: string) => {
    const image = nativeImage.createFromDataURL(dataUrl)
    return finishCapture(image, false)
  })

  // Window controls (frameless main window)
  ipcMain.handle('win:minimize', () => mainWindow?.minimize())
  ipcMain.handle('win:toggleMaximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('win:close', () => mainWindow?.close())

  // Overlay → main
  ipcMain.handle('overlay:region', async (_e, rectCss: Rect) => {
    closeOverlay()
    const vb = virtualBounds()
    const rectDip: Rect = {
      x: vb.x + rectCss.x,
      y: vb.y + rectCss.y,
      width: rectCss.width,
      height: rectCss.height
    }
    if (loadSettings().captureMode === 'video') {
      startRecording('region', rectDip)
      return null
    }
    const img = await grabRegionDip(rectDip)
    return finishCapture(img)
  })
  ipcMain.handle('overlay:fullscreen', async () => {
    closeOverlay()
    if (loadSettings().captureMode === 'video') {
      startRecording('fullscreen')
      return null
    }
    const img = await grabFullscreen()
    return finishCapture(img)
  })
  ipcMain.handle('overlay:window', async () => {
    closeOverlay()
    if (loadSettings().captureMode === 'video') {
      startRecording('window')
      return null
    }
    if (pendingWindowRect) {
      const img = await grabRegionDip(pendingWindowRect)
      return finishCapture(img)
    }
    const img = await captureFullscreen()
    return finishCapture(img)
  })
  ipcMain.handle('overlay:cancel', () => {
    closeOverlay()
  })

  // Recording control from the renderer
  ipcMain.handle('record:stop', () => stopRecording())
  ipcMain.handle('record:state', () => ({ active: recorder.isRecording() }))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.artur.snapski')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const settings = loadSettings()
  // Keep the OS login-item entry in sync with the saved setting (covers a moved
  // install folder, manual registry edits, or a fresh profile).
  applyAutoLaunch(settings.autoLaunch)
  registerSnapProtocol()
  registerIpc()
  createMainWindow()
  createTray()
  registerHotkeys()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  recorder.stopRecording()
  destroyRecHud()
})

// Keep running in the tray when all windows are closed.
app.on('window-all-closed', () => {
  // Stay alive for the tray + global hotkey.
})
