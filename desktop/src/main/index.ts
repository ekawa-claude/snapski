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
  clipboard,
  protocol
} from 'electron'
import { join, resolve, sep, basename } from 'path'
import { writeFile, stat, copyFile } from 'fs/promises'
import QRCode from 'qrcode'
import { SyncManager } from './sync'
import { createReadStream, existsSync } from 'fs'
import { Readable } from 'stream'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { loadSettings, saveSettings, ensureOutputFolder } from './settings'
import { dayDir, listLibrary } from './library'
import { captureRegion, captureFullscreen, captureRectFast, captureRectFastPng } from './capture'
import { copyNativeImageToClipboard, copyFileToClipboard } from './clipboard'
import { getForegroundWindowRectDip, initWinUtil, disposeWinUtil } from './winutil'
import { videoThumbnail, imageThumbnail } from './thumbs'
import { isFavorite, setFavorite } from './favorites'
import { exportVideo } from './videoedit'
import { initUpdater } from './updater'
import * as recorder from './recorder'
import type {
  CaptureResult,
  CaptureKind,
  HistoryItem,
  Rect,
  VideoExportOpts
} from '../shared/types'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null
let pendingWindowRect: Rect | null = null
let syncMgr: SyncManager | null = null

/** Default hub for a device that creates a new group. */
const DEFAULT_HUB = 'https://chat.wishly.wtf/snapski-hub'

/** True when launched by the OS auto-start entry — boot straight into the tray. */
const startedHidden = process.argv.includes('--hidden')

// One SnapSki at a time. A second copy (autostart + a click on the shortcut)
// couldn't register PrintScreen, added a second tray icon and ran its own sync
// against the same state file. Launching again now just brings the window up.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}
app.on('second-instance', (_e, argv) => {
  if (!argv.includes('--hidden')) showMainWindow()
})

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
    // snap://frame/<id> — the frozen screen behind the capture overlay (memory only).
    if (url.host === 'frame') {
      const id = Number(url.pathname.replace(/^\//, ''))
      if (!frozen || frozen.id !== id) return new Response('gone', { status: 404 })
      return new Response(new Uint8Array(frozen.png), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }
      })
    }
    // Normalize before checking so `..` segments can't escape the allowed roots,
    // and compare with a trailing separator so `...\SnapSkiEvil` doesn't pass.
    const filePath = resolve(decodeURIComponent(url.pathname).replace(/^\//, ''))
    const allowed = [loadSettings().outputFolder, app.getPath('temp'), app.getPath('pictures')]
    const ok = allowed.some((dir) => {
      const root = resolve(dir).toLowerCase()
      const p = filePath.toLowerCase()
      return p === root || p.startsWith(root.endsWith(sep) ? root : root + sep)
    })
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

function createMainWindow(show = !startedHidden): void {
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
    if (show) {
      mainWindow?.show()
      // Reopened for a capture result: come to the front, not behind the app
      // that got focus back when the overlay closed.
      mainWindow?.focus()
    }
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

/**
 * Show the main window, recreating it if the user closed it (X destroys it —
 * the app lives on in the tray). The renderer lists the gallery on load, so a
 * fresh window already shows the latest capture.
 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(true)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
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

/** True while the main window is minimized for a capture we started. */
let minimizedForCapture = false

/**
 * Get SnapSki out of the shot before capturing.
 *
 * Recording already did this; screenshots didn't, so starting one from the app
 * left the window sitting in the picture. Minimizing also fixes window capture:
 * showOverlay reads the foreground window to know what to grab, and with SnapSki
 * in front that was SnapSki itself.
 *
 * Waits for the window to actually go, so the foreground reading below lands
 * after the change and nothing catches the minimize animation.
 */
function minimizeForCapture(): Promise<void> {
  const win = mainWindow
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return Promise.resolve()
  minimizedForCapture = true
  return new Promise((resolve) => {
    const done = (): void => resolve()
    win.once('minimize', () => setTimeout(done, 120))
    setTimeout(done, 500) // don't hang the capture if the event never lands
    win.minimize()
  })
}

/** Bring the window back when a capture ends without a result (Esc, cancel). */
function restoreAfterCapture(): void {
  if (!minimizedForCapture) return
  minimizedForCapture = false
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
}

/**
 * The screen as it was when the hotkey was pressed. The overlay shows this still
 * frame instead of sitting transparent over the live desktop, and region /
 * window / fullscreen are cropped from it.
 *
 * Why: over a fullscreen game (Skyrim) a transparent always-on-top window made
 * the game keep rendering underneath while losing focus — both froze. With a
 * still frame the overlay is an ordinary opaque window, nothing is grabbed
 * after it closes, and you get the moment you pressed the key.
 */
interface FrozenFrame {
  id: number
  png: Buffer
  /** Top-left of the frame in physical screen pixels. */
  origin: { x: number; y: number }
  image: Electron.NativeImage | null
}
let frozen: FrozenFrame | null = null
let frozenSeq = 0

/** A display's bounds in physical pixels. */
function physicalBounds(d: Electron.Display): Rect {
  return screen.dipToScreenRect(null as never, d.bounds)
}

async function grabFrozenFrame(): Promise<FrozenFrame> {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const d of screen.getAllDisplays()) {
    const p = physicalBounds(d)
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + p.width)
    maxY = Math.max(maxY, p.y + p.height)
  }
  const png = await captureRectFastPng({ x: minX, y: minY, width: maxX - minX, height: maxY - minY })
  return { id: ++frozenSeq, png, origin: { x: minX, y: minY }, image: null }
}

/** Crop a DIP rect out of the frozen frame, or null if there's no frame / no overlap. */
function cropFrozen(rectDip: Rect): Electron.NativeImage | null {
  if (!frozen) return null
  if (!frozen.image) frozen.image = nativeImage.createFromBuffer(frozen.png)
  const img = frozen.image
  if (img.isEmpty()) return null
  const size = img.getSize()
  const p = screen.dipToScreenRect(null as never, rectDip)
  const x0 = Math.max(0, Math.round(p.x - frozen.origin.x))
  const y0 = Math.max(0, Math.round(p.y - frozen.origin.y))
  const x1 = Math.min(size.width, Math.round(p.x + p.width - frozen.origin.x))
  const y1 = Math.min(size.height, Math.round(p.y + p.height - frozen.origin.y))
  if (x1 - x0 < 1 || y1 - y0 < 1) return null
  return img.crop({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
}

/**
 * True from the hotkey press until the capture it started is finished. The
 * overlay window only exists after a few awaits (minimize, foreground lookup,
 * frame grab); every press in that gap used to open one more overlay.
 */
let overlayBusy = false
/** An overlay:* handler owns the teardown — the 'closed' event must not do it. */
let overlayCapturing = false

function endOverlaySession(): void {
  overlayBusy = false
  overlayCapturing = false
  frozen = null
}

async function showOverlay(): Promise<void> {
  if (overlayWindow) {
    if (overlayWindow.isVisible()) overlayWindow.focus()
    return
  }
  if (overlayBusy) return
  overlayBusy = true
  try {
    await openOverlay()
  } catch (e) {
    console.error('overlay failed to open', e)
    closeOverlay()
    endOverlaySession()
    restoreAfterCapture()
  }
}

async function openOverlay(): Promise<void> {
  await minimizeForCapture()
  const mode = loadSettings().captureMode
  // Both BEFORE the overlay exists: the foreground window must be the user's,
  // and the frame must not contain the overlay. Video needs the live screen.
  const [windowRect, frame] = await Promise.all([
    getForegroundWindowRectDip(),
    mode === 'video'
      ? Promise.resolve(null)
      : grabFrozenFrame().catch((e) => {
          console.error('frozen frame grab failed, using the live overlay', e)
          return null
        })
  ])
  pendingWindowRect = windowRect
  frozen = frame

  const vb = virtualBounds()
  const win = new BrowserWindow({
    x: vb.x,
    y: vb.y,
    width: vb.width,
    height: vb.height,
    show: !frame, // a frozen overlay shows once its picture is painted (overlay:ready)
    frame: false,
    transparent: !frame,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: frame ? '#000000' : '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  overlayWindow = win
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true)

  win.on('closed', () => {
    if (overlayWindow === win) overlayWindow = null
    if (!overlayCapturing) endOverlaySession()
  })

  const query: Record<string, string> = { mode }
  if (frame) {
    query.frame = String(frame.id)
    // Where each display's slice of the frame sits: DIP inside the overlay vs.
    // physical pixels inside the frame (they differ with display scaling).
    query.layout = JSON.stringify(
      screen.getAllDisplays().map((d) => {
        const p = physicalBounds(d)
        return {
          dip: {
            x: d.bounds.x - vb.x,
            y: d.bounds.y - vb.y,
            width: d.bounds.width,
            height: d.bounds.height
          },
          phys: { x: p.x - frame.origin.x, y: p.y - frame.origin.y, width: p.width, height: p.height }
        }
      })
    )
    // Never leave the user with nothing on screen if the ready signal is lost.
    setTimeout(() => {
      if (overlayWindow === win && !win.isVisible()) revealOverlay()
    }, 2000)
  }
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html?${new URLSearchParams(query)}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/overlay.html'), { query })
  }
}

function revealOverlay(): void {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return
  win.show()
  win.focus()
}

function closeOverlay(): void {
  const win = overlayWindow
  overlayWindow = null
  if (win && !win.isDestroyed()) win.close()
}

/**
 * Run an overlay:* capture: close the overlay, do the work, then release the
 * session so the hotkey works again. A second click that lands after the first
 * has already started is ignored.
 */
async function overlayCapture<T>(work: () => Promise<T>): Promise<T | null> {
  if (overlayCapturing) return null
  overlayCapturing = true
  closeOverlay()
  try {
    return await work()
  } finally {
    endOverlaySession()
  }
}

function timestampName(prefix: string, ext: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${prefix}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.${ext}`
}

/** Names handed out but maybe not on disk yet (the write is still in flight). */
const reservedNames = new Set<string>()

/**
 * Timestamp name that doesn't collide with an existing file or with one another
 * capture is writing right now. Names have one-second resolution: two
 * Alt+PrintScreen presses in the same second used to write the same file, and
 * the second shot silently replaced the first.
 */
function uniqueTimestampName(folder: string, prefix: string, ext: string): string {
  const base = timestampName(prefix, ext)
  const stem = base.slice(0, -(ext.length + 1))
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${stem}_${i}.${ext}`
    const full = join(folder, name)
    if (reservedNames.has(full) || existsSync(full)) continue
    reservedNames.add(full)
    // The file exists well before this; after that existsSync covers it.
    setTimeout(() => reservedNames.delete(full), 60_000)
    return name
  }
}

async function finishCapture(
  image: Electron.NativeImage,
  notify = true,
  opts?: { copy: boolean; download: boolean }
): Promise<CaptureResult> {
  const settings = loadSettings()
  const size = image.getSize()

  const shouldCopy = opts !== undefined ? opts.copy : settings.copyToClipboard
  const shouldSave = opts !== undefined ? opts.download : settings.saveToFolder

  // Hand the bitmap straight to the clipboard — no PNG encode/decode round-trip.
  if (shouldCopy) copyNativeImageToClipboard(image)

  // Encode PNG at most once, and only when something actually needs it: the file
  // on disk, or the data URL the renderer shows. Each encode of a 4K frame costs
  // hundreds of ms on the main thread, so we skip the ones we don't need.
  let png: Buffer | null = null
  let savedPath: string | null = null
  if (shouldSave) {
    png = image.toPNG()
    ensureOutputFolder(settings.outputFolder)
    const dir = dayDir(settings.outputFolder)
    savedPath = join(dir, uniqueTimestampName(dir, 'Snap', 'png'))
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
    copied: shouldCopy,
    width: size.width,
    height: size.height
  }
  if (notify) {
    minimizedForCapture = false // the window comes back with the result below
    // Closed to the tray: there's no window to tell. Used to mean the shot
    // saved silently and nothing appeared; now a fresh window opens on it.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('capture:done', result)
    showMainWindow()
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
  const recDir = dayDir(settings.outputFolder)
  const outFile = join(recDir, uniqueTimestampName(recDir, 'Rec', 'mp4'))

  // Get the app out of the shot, then start once the window is actually gone.
  if (mainWindow && !mainWindow.isMinimized()) mainWindow.minimize()
  minimizedForCapture = false // recording owns the window state from here

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

/** Hotkeys that failed to register (taken by another app) — surfaced in the UI. */
let hotkeyFailures: string[] = []

function registerHotkeys(): void {
  globalShortcut.unregisterAll()
  hotkeyFailures = []
  const { hotkeys } = loadSettings()
  if (hotkeys.capture) {
    const ok = globalShortcut.register(hotkeys.capture, () => {
      // While recording, the hotkey stops it; otherwise it opens the overlay.
      if (recorder.isRecording()) stopRecording()
      else showOverlay()
    })
    if (!ok) hotkeyFailures.push(hotkeys.capture)
  }
  // Dedicated instant-fullscreen hotkey (skip if it collides with the overlay key).
  if (hotkeys.fullscreen && hotkeys.fullscreen !== hotkeys.capture) {
    const ok = globalShortcut.register(hotkeys.fullscreen, () => {
      void instantFullscreen()
    })
    if (!ok) hotkeyFailures.push(hotkeys.fullscreen)
  }
  if (hotkeyFailures.length) {
    console.error('Failed to register hotkeys:', hotkeyFailures.join(', '))
    mainWindow?.webContents.send('hotkeys:failed', hotkeyFailures)
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
      click: () => showMainWindow()
    },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.setToolTip(rec ? 'SnapSki — recording…' : 'SnapSki')
  tray.setContextMenu(menu)
}

function createTray(): void {
  const icon = brandIcon('tray.png')
  tray = new Tray(icon.isEmpty() ? trayIcon() : icon)
  tray.on('double-click', () => showMainWindow())
  updateTray()
}

// ---------- IPC ----------
function registerIpc(): void {
  syncMgr = new SyncManager(
    () => loadSettings().outputFolder,
    (s) => mainWindow?.webContents.send('sync:status', s),
    () => mainWindow?.webContents.send('history:changed'),
  )

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
      const items = await listLibrary(folder)
      // Sequential on purpose: image decodes are sync CPU work on the main
      // process, so yield to the event loop between items to keep the app
      // responsive while a cold cache warms up (cached items are just reads).
      const out: HistoryItem[] = []
      for (const it of items.slice(0, 120)) {
        const thumb =
          it.type === 'image'
            ? await imageThumbnail(it.path, it.mtime)
            : await videoThumbnail(it.path, it.mtime)
        out.push({ ...it, thumb, favorite: isFavorite(it.name), sync: syncMgr?.entryState(it.name) ?? null })
        await new Promise(setImmediate)
      }
      return out
    } catch {
      return []
    }
  })

  // Gallery actions -----------------------------------------------------
  ipcMain.handle('history:favorite', (_e, name: string, fav: boolean) => {
    setFavorite(name, fav)
    // Favoriting opts a shot into sync (and propagates the star to other devices).
    if (/\.png$/i.test(name)) syncMgr?.onLocalFavorite(name, fav)
  })
  ipcMain.handle('history:delete', async (_e, p: string) => {
    try {
      await shell.trashItem(p)
      syncMgr?.onLocalDelete(basename(p))
      return true
    } catch (err) {
      console.error('trash failed', err)
      return false
    }
  })
  ipcMain.handle('history:copyPath', (_e, p: string) => {
    clipboard.writeText(p)
  })
  ipcMain.handle('history:copyFile', async (_e, p: string) => {
    if (/\.png$/i.test(p)) {
      // Images go on the clipboard as pixels — pastes anywhere.
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) {
        copyNativeImageToClipboard(img)
        return true
      }
    }
    try {
      await copyFileToClipboard(p)
      return true
    } catch (err) {
      console.error('file copy failed', err)
      return false
    }
  })
  ipcMain.handle('history:showInFolder', (_e, p: string) => {
    shell.showItemInFolder(p)
  })

  // Import external images into the SnapSki folder (Add button / drag&drop).
  ipcMain.handle('history:import', async (_e, paths?: string[]) => {
    let files = paths
    if (!files || files.length === 0) {
      const res = await dialog.showOpenDialog(mainWindow ?? undefined!, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
      })
      if (res.canceled) return 0
      files = res.filePaths
    }
    const settings = loadSettings()
    ensureOutputFolder(settings.outputFolder)
    const target = dayDir(settings.outputFolder)
    let imported = 0
    for (const src of files) {
      if (!/\.(png|jpe?g|webp|bmp)$/i.test(src)) continue
      try {
        const dest = join(target, uniqueTimestampName(target, 'Import', 'png'))
        // Non-PNG sources are converted so the whole pipeline stays PNG.
        if (/\.png$/i.test(src)) {
          await copyFile(src, dest)
        } else {
          const img = nativeImage.createFromPath(src)
          if (img.isEmpty()) continue
          await writeFile(dest, img.toPNG())
        }
        imported++
      } catch (err) {
        console.error('import failed for', src, err)
      }
    }
    return imported
  })

  // Video editing: trim and/or static region blur → re-save + file-drop copy
  ipcMain.handle('video:export', async (_e, opts: VideoExportOpts) => {
    const settings = loadSettings()
    ensureOutputFolder(settings.outputFolder)
    const clipDir = dayDir(settings.outputFolder)
    const outFile = join(clipDir, uniqueTimestampName(clipDir, 'Clip', 'mp4'))
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
  ipcMain.handle(
    'image:export',
    async (_e, dataUrl: string, opts?: { copy: boolean; download: boolean }) => {
      const image = nativeImage.createFromDataURL(dataUrl)
      return finishCapture(image, false, opts)
    }
  )

  // Window controls (frameless main window)
  ipcMain.handle('win:minimize', () => mainWindow?.minimize())
  ipcMain.handle('win:toggleMaximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('win:close', () => mainWindow?.close())
  ipcMain.handle('win:setFullScreen', (_e, on: boolean) => {
    mainWindow?.setFullScreen(on)
    return mainWindow?.isFullScreen() ?? false
  })

  // Overlay → main
  ipcMain.handle('overlay:ready', () => revealOverlay())
  ipcMain.handle('overlay:region', (_e, rectCss: Rect) =>
    overlayCapture(async () => {
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
      const img = cropFrozen(rectDip) ?? (await grabRegionDip(rectDip))
      return finishCapture(img)
    })
  )
  ipcMain.handle('overlay:fullscreen', () =>
    overlayCapture(async () => {
      if (loadSettings().captureMode === 'video') {
        startRecording('fullscreen')
        return null
      }
      const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const img = cropFrozen(disp.bounds) ?? (await grabFullscreen())
      return finishCapture(img)
    })
  )
  ipcMain.handle('overlay:window', () =>
    overlayCapture(async () => {
      if (loadSettings().captureMode === 'video') {
        startRecording('window')
        return null
      }
      if (pendingWindowRect) {
        const img = cropFrozen(pendingWindowRect) ?? (await grabRegionDip(pendingWindowRect))
        return finishCapture(img)
      }
      // Foreground lookup failed: take the display under the cursor, never the
      // main-thread desktopCapturer path (it stalls the app and the game).
      const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const img = cropFrozen(disp.bounds) ?? (await grabFullscreen())
      return finishCapture(img)
    })
  )
  ipcMain.handle('overlay:cancel', () => {
    closeOverlay()
    endOverlaySession()
    // Deliberately only here, not on the overlay's 'closed' event: a successful
    // capture also closes the overlay, and raising the window at that moment
    // would put SnapSki into the shot it is about to grab.
    restoreAfterCapture()
  })

  // Recording control from the renderer
  ipcMain.handle('record:stop', () => stopRecording())
  ipcMain.handle('record:state', () => ({ active: recorder.isRecording() }))

  // Hotkeys that couldn't be registered (renderer polls once on load).
  ipcMain.handle('hotkeys:failures', () => hotkeyFailures)

  // Sync (phase 3c) -----------------------------------------------------
  ipcMain.handle('sync:status', () => syncMgr?.status() ?? null)
  ipcMain.handle('sync:create', async (_e, invite: string) => {
    // Resolve, don't throw: an invoke rejection reaches the renderer as a
    // mangled "Error invoking remote method…" string.
    try {
      await syncMgr?.createGroup(DEFAULT_HUB, invite ?? '')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('sync:join', (_e, code: string) => syncMgr?.joinByCode(code) ?? false)
  ipcMain.handle('sync:unpair', () => syncMgr?.unpair())
  ipcMain.handle('sync:setEnabled', (_e, on: boolean) => syncMgr?.setEnabled(on))
  ipcMain.handle('sync:request', (_e, names: string[]) => syncMgr?.requestSync(names))
  ipcMain.handle('sync:now', () => syncMgr?.sync())
  ipcMain.handle('sync:pairPayload', async () => {
    const code = syncMgr?.pairCode()
    if (!code) return null
    const qr = await QRCode.toDataURL(code, { margin: 1, width: 320 })
    return { code, qr }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.artur.snapski')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const settings = loadSettings()
  // Keep the OS login-item entry in sync with the saved setting (covers a moved
  // install folder, manual registry edits, or a fresh profile).
  applyAutoLaunch(settings.autoLaunch)
  registerSnapProtocol()
  initWinUtil()
  registerIpc()
  createMainWindow()
  createTray()
  registerHotkeys()
  initUpdater(() => mainWindow)
  syncMgr?.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  disposeWinUtil()
  recorder.stopRecording()
  destroyRecHud()
})

// Keep running in the tray when all windows are closed.
app.on('window-all-closed', () => {
  // Stay alive for the tray + global hotkey.
})
