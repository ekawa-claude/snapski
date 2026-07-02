/// <reference types="chrome" />
export {} // module scope (avoids global name clashes with other scripts)
// SnapSki for Chrome — service worker.
// Responsibilities: capture the active tab (visible area or full scroll-stitched
// page), then open the annotate editor with the resulting PNG.

const CAPTURE_DELAY_MS = 300 // captureVisibleTab is rate-limited (~2/sec)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface PageMetrics {
  totalH: number
  viewH: number
  viewW: number
  dpr: number
  origX: number
  origY: number
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

interface Region {
  x: number
  y: number
  w: number
  h: number
}

/** Ask the in-page content script to hide its floating UI before a capture. */
async function hideUi(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'snapski-hide' })
  } catch {
    // No content script on this page (e.g. it was injected before reload) — fine.
  }
}
function showUi(tabId: number): void {
  chrome.tabs.sendMessage(tabId, { type: 'snapski-show' }).catch(() => {})
}

/** Capture just the visible viewport of a tab as a PNG data URL. */
async function captureVisible(tab: chrome.tabs.Tab): Promise<string> {
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
}

/** Capture the visible tab, then crop to a viewport-relative region (device px = css px × dpr). */
async function captureRegion(tab: chrome.tabs.Tab, rect: Region, dpr: number): Promise<string> {
  const full = await captureVisible(tab)
  const bmp = await createImageBitmap(await (await fetch(full)).blob())
  const sx = Math.round(rect.x * dpr)
  const sy = Math.round(rect.y * dpr)
  const sw = Math.max(1, Math.round(rect.w * dpr))
  const sh = Math.max(1, Math.round(rect.h * dpr))
  const canvas = new OffscreenCanvas(sw, sh)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh)
  bmp.close()
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return blobToDataUrl(blob)
}

/** Capture an entire scrollable page by scrolling, shooting, and stitching. */
async function captureFullPage(tab: chrome.tabs.Tab): Promise<string> {
  const tabId = tab.id!
  const [{ result: m }] = (await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      totalH: Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0
      ),
      viewH: window.innerHeight,
      viewW: window.innerWidth,
      dpr: window.devicePixelRatio || 1,
      origX: window.scrollX,
      origY: window.scrollY
    })
  })) as { result: PageMetrics }[]

  const shots: { y: number; dataUrl: string }[] = []
  let lastY = -1
  for (let y = 0; y < m.totalH; y += m.viewH) {
    await chrome.scripting.executeScript({
      target: { tabId },
      // behavior:'instant' overrides CSS scroll-behavior:smooth animations.
      func: (yy: number) => window.scrollTo({ top: yy, left: 0, behavior: 'instant' }),
      args: [y]
    })
    await sleep(CAPTURE_DELAY_MS)
    // The last scroll clamps at the page bottom: stitch by the position the page
    // actually reached, not the one we asked for, or the bottom band duplicates.
    const [{ result: actualY }] = (await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.scrollY
    })) as { result: number }[]
    const ay = typeof actualY === 'number' ? actualY : y
    if (ay <= lastY) break // scroll didn't advance — we're at the bottom
    shots.push({ y: ay, dataUrl: await captureVisible(tab) })
    lastY = ay
  }

  // Restore the user's original scroll position.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (x: number, yy: number) => window.scrollTo(x, yy),
    args: [m.origX, m.origY]
  })

  // Stitch in device pixels using an OffscreenCanvas (available in workers).
  const dpr = m.dpr
  const canvas = new OffscreenCanvas(
    Math.round(m.viewW * dpr),
    Math.round(m.totalH * dpr)
  )
  const ctx = canvas.getContext('2d')!
  for (const s of shots) {
    const bmp = await createImageBitmap(await (await fetch(s.dataUrl)).blob())
    ctx.drawImage(bmp, 0, Math.round(s.y * dpr))
    bmp.close()
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return blobToDataUrl(blob)
}

interface CaptureOpts {
  rect?: Region
  dpr?: number
}

/** Run a capture and open the editor tab with the result. */
async function captureAndOpen(
  mode: 'visible' | 'full' | 'region',
  opts: CaptureOpts = {}
): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab')
  if (tab.url && /^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url)) {
    throw new Error("Can't capture browser system pages")
  }

  // Hide the in-page FAB for the whole capture so it never lands in the shot.
  await hideUi(tab.id)
  let dataUrl: string
  try {
    if (mode === 'full') dataUrl = await captureFullPage(tab)
    else if (mode === 'region') dataUrl = await captureRegion(tab, opts.rect!, opts.dpr ?? 1)
    else dataUrl = await captureVisible(tab)
  } finally {
    showUi(tab.id)
  }

  const id = crypto.randomUUID()
  await chrome.storage.local.set({ [`cap_${id}`]: { dataUrl } })
  await chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?id=${id}`) })
}

// --- triggers -------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'capture') {
    captureAndOpen(msg.mode, { rect: msg.rect, dpr: msg.dpr })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }))
    return true // keep the message channel open for the async response
  }
  if (msg?.type === 'screen-frame') {
    // The content script grabbed a getDisplayMedia frame in-page; stash it and
    // open the editor (so the user's own tab stays where it was).
    const id = crypto.randomUUID()
    void chrome.storage.local
      .set({ [`cap_${id}`]: { dataUrl: msg.dataUrl } })
      .then(() => chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?id=${id}`) }))
    sendResponse({ ok: true })
    return false
  }
  return false
})

/** Ask the active tab's content script to start its region-selection overlay. */
async function startRegionOnActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'snapski-start-region' })
  } catch {
    // No content script (system page, or injected before this tab was reloaded).
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-visible') void captureAndOpen('visible')
  else if (command === 'capture-region') void startRegionOnActiveTab()
})

// --- toolbar icon style ---------------------------------------------------

const ICON_KEY = 'snapski_icon' // 'minimal' | 'monster'
const ICON_SETS: Record<string, Record<number, string>> = {
  monster: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png' },
  minimal: { 16: 'icons/markp16.png', 32: 'icons/markp32.png', 48: 'icons/markp48.png' }
}
function applyToolbarIcon(style: string | undefined): void {
  const path = ICON_SETS[style === 'monster' ? 'monster' : 'minimal']
  chrome.action.setIcon({ path }).catch(() => {})
}
chrome.storage.local.get(ICON_KEY).then((s) => applyToolbarIcon(s[ICON_KEY]))
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch[ICON_KEY]) applyToolbarIcon(ch[ICON_KEY].newValue)
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'snapski-capture',
    title: 'SnapSki: capture & annotate',
    contexts: ['page', 'image', 'selection']
  })
})

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'snapski-capture') void captureAndOpen('visible')
})
