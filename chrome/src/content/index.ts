/// <reference types="chrome" />
export {} // module scope (avoids global name clashes with other scripts)
// SnapSki for Chrome — in-page floating button, region selector and shot toast.
// Injected on every page. Renders a draggable FAB inside a shadow root (so page
// CSS can't touch it); tapping it opens a small menu (region / visible / full).
// Region selection dims the page and lets the user drag a rectangle, then hands
// the viewport-relative rect to the background worker to crop.
// After any capture the worker sends the PNG back here: we copy it to the
// clipboard (only a focused document may, which rules out doing it in the worker
// or an offscreen page) and show a toast offering Annotate / Save.

const POS_KEY = 'snapski_fab'
const ICON_KEY = 'snapski_icon' // 'minimal' | 'monster'
const FAB_ENABLED_KEY = 'snapski_fab_enabled'
const PRIMARY = '#6c6cf5'

function svg(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Grab one PNG frame from a getDisplayMedia stream. Prefers ImageCapture (no DOM
 * needed); falls back to a detached <video> element on browsers without it.
 */
async function grabFrame(stream: MediaStream): Promise<string> {
  const track = stream.getVideoTracks()[0]
  // Let the surface start producing frames (the first frame can be black).
  await sleep(120)

  const toUrl = (src: CanvasImageSource, w: number, h: number): string => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(src, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  }

  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => unknown })
    .ImageCapture
  if (typeof IC === 'function') {
    try {
      const ic = new IC(track) as { grabFrame: () => Promise<ImageBitmap> }
      const bmp = await ic.grabFrame()
      return toUrl(bmp, bmp.width, bmp.height)
    } catch {
      // fall through to the <video> path
    }
  }

  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  // Keep it renderable but effectively invisible (display:none would stop frames).
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;'
  document.documentElement.appendChild(video)
  try {
    await video.play()
    await new Promise<void>((resolve) => {
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
      if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(() => resolve())
      else video.onloadeddata = (): void => void setTimeout(resolve, 150)
    })
    return toUrl(video, video.videoWidth, video.videoHeight)
  } finally {
    video.remove()
  }
}

/**
 * Keep our own pointer/mouse interactions from reaching the page. Many sites
 * dismiss their own popups, dropdowns and menus on any outside mousedown/click
 * or on focus loss — so opening the FAB or dragging the region overlay would
 * close the very popup the user is trying to screenshot. stopPropagation hides
 * the event from the page's outside-click handlers; preventDefault on mousedown
 * stops the click from stealing focus (which blur-closes focus-tied popups).
 * Note: this can't beat sites that dismiss via a capture-phase listener on
 * document/window, but it covers the common bubble-phase / focus cases.
 */
function isolate(el: HTMLElement): void {
  el.addEventListener('pointerdown', (e) => e.stopPropagation())
  el.addEventListener('pointerup', (e) => e.stopPropagation())
  el.addEventListener('click', (e) => e.stopPropagation())
  el.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
}
const ICON_CROP = svg('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>')
const ICON_CAM = svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/>')
const ICON_FULL = svg('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>')
const ICON_SCREEN = svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m9 9 2 2 4-4"/>')
const ICON_MASK = svg('<path d="M12 3c4.5 0 8 3 8 7 0 3-1.5 4.5-1.5 6.5S17 21 15 19.5 13 21 12 21s-1-3-3-1.5S5.5 18.5 5.5 16.5 4 13 4 10c0-4 3.5-7 8-7Z"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/>')
const ICON_PENCIL = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>')
const ICON_SAVE = svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>')
const ICON_CLOSE = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')
const ICON_COPY = svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')
const ICON_HIDE = svg('<path d="M10.7 5.1A9.8 9.8 0 0 1 12 5c5 0 9 5 9 7a11.8 11.8 0 0 1-1.7 2.7"/><path d="M6.6 6.6C4.4 8 3 10.3 3 12c0 2 4 7 9 7 1.4 0 2.7-.4 3.8-1"/><path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/>')

const TOAST_MS = 5000

interface Shot {
  id: string
  dataUrl: string
  autosaved: boolean
}

/**
 * The post-capture toast: a shot lands on the clipboard immediately and the
 * editor becomes an offer instead of a gate. Lives in its own shadow host so
 * hiding the FAB — globally, or for the duration of a capture — never hides it.
 */
function initToast(): (shot: Shot) => void {
  const host = document.createElement('div')
  host.id = 'snapski-toast-host'
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;'
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = toastCss()
  root.appendChild(style)
  document.documentElement.appendChild(host)

  const card = document.createElement('div')
  card.className = 'toast'
  card.innerHTML = `
    <img class="thumb" alt="">
    <div class="col">
      <div class="status" data-status></div>
      <div class="acts">
        <button class="act primary" data-act="annotate">${ICON_PENCIL}<span>Annotate</span></button>
        <button class="act" data-act="save">${ICON_SAVE}<span>Save</span></button>
        <button class="act" data-act="copy">${ICON_COPY}<span>Copy</span></button>
      </div>
    </div>
    <button class="x" data-act="close" title="Dismiss">${ICON_CLOSE}</button>`
  root.appendChild(card)
  isolate(card)

  const thumbEl = card.querySelector<HTMLImageElement>('.thumb')!
  const statusEl = card.querySelector<HTMLElement>('[data-status]')!
  const saveBtn = card.querySelector<HTMLButtonElement>('[data-act="save"]')!
  const copyBtn = card.querySelector<HTMLButtonElement>('[data-act="copy"]')!

  let current: Shot | null = null
  let timer = 0

  const setStatus = (text: string, bad = false): void => {
    statusEl.textContent = text
    statusEl.classList.toggle('bad', bad)
  }
  const arm = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => hide(), TOAST_MS)
  }
  // Dismissing loses nothing: every capture is in the history strip.
  const hide = (): void => {
    window.clearTimeout(timer)
    card.classList.remove('open')
    current = null
  }

  /** Put the PNG on the clipboard. Needs a focused document — hence: in the page. */
  const copy = async (dataUrl: string): Promise<boolean> => {
    try {
      const blob = await (await fetch(dataUrl)).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return true
    } catch {
      // Focus was elsewhere (devtools, another window) — the Copy button retries,
      // and clicking it is itself the focus + user gesture that makes it work.
      return false
    }
  }

  card.addEventListener('pointerenter', () => window.clearTimeout(timer))
  card.addEventListener('pointerleave', () => {
    if (current && copyBtn.hidden) arm()
  })

  card.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const shot = current
      if (!shot) return
      const act = btn.dataset.act
      if (act === 'close') return hide()
      if (act === 'annotate') {
        chrome.runtime.sendMessage({ type: 'open-editor', id: shot.id }).catch(() => {})
        return hide()
      }
      if (act === 'copy') {
        void copy(shot.dataUrl).then((ok) => {
          if (current?.id !== shot.id) return
          setStatus(ok ? 'Copied — paste anywhere' : "Still couldn't copy", !ok)
          if (ok) {
            copyBtn.hidden = true
            arm()
          }
        })
        return
      }
      if (act === 'save') {
        btn.disabled = true
        window.clearTimeout(timer)
        chrome.runtime
          .sendMessage({ type: 'save-shot', id: shot.id })
          .then((res) => {
            if (current?.id !== shot.id) return
            btn.disabled = false
            if (res?.ok) {
              saveBtn.hidden = true
              setStatus(`Saved to ${res.folder ?? 'Downloads/SnapSki'}`)
              arm()
            } else {
              setStatus(res?.error ?? "Couldn't save", true)
            }
          })
          .catch(() => {
            btn.disabled = false
            setStatus("Couldn't save", true)
          })
      }
    })
  })

  return (shot: Shot) => {
    current = shot
    thumbEl.src = shot.dataUrl
    saveBtn.hidden = shot.autosaved
    saveBtn.disabled = false
    copyBtn.hidden = true
    setStatus('Copying…')
    card.classList.add('open')
    arm()
    void copy(shot.dataUrl).then((ok) => {
      if (current?.id !== shot.id) return
      if (ok) {
        setStatus(shot.autosaved ? 'Copied · saved to disk' : 'Copied — paste anywhere')
      } else {
        // Leave it up: the user has to click Copy, so don't time out under them.
        setStatus("Couldn't copy — click Copy", true)
        copyBtn.hidden = false
        window.clearTimeout(timer)
      }
    })
  }
}

function init(): void {
  const host = document.createElement('div')
  host.id = 'snapski-host'
  // Start hidden so a disabled FAB never flashes while storage is loading.
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;display:none;'
  const root = host.attachShadow({ mode: 'open' })
  document.documentElement.appendChild(host)

  let fabEnabled = true
  let temporarilyHidden = false
  const applyVisibility = (): void => {
    host.style.display = fabEnabled && !temporarilyHidden ? '' : 'none'
  }
  chrome.storage.sync.get({ [FAB_ENABLED_KEY]: true }).then((s) => {
    fabEnabled = s[FAB_ENABLED_KEY] !== false
    applyVisibility()
  })
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'sync' && ch[FAB_ENABLED_KEY]) {
      fabEnabled = ch[FAB_ENABLED_KEY].newValue !== false
      applyVisibility()
    }
  })

  const style = document.createElement('style')
  style.textContent = css()
  root.appendChild(style)

  const showToast = initToast()

  // ---- FAB ----
  const fab = document.createElement('button')
  fab.className = 'fab'
  fab.title = 'SnapSki — capture'
  const fabImg = document.createElement('img')
  fabImg.alt = 'SnapSki'
  fab.appendChild(fabImg)
  root.appendChild(fab)
  isolate(fab)

  // Icon style — monster mascot vs minimal frame+cursor mark — is a shared setting.
  const MONSTER_SRC = chrome.runtime.getURL('icons/icon128.png')
  const MINIMAL_SRC = chrome.runtime.getURL('icons/markw128.png')
  let iconStyle: string = 'minimal'
  const applyStyle = (style: string | undefined): void => {
    iconStyle = style === 'monster' ? 'monster' : 'minimal' // default = minimal
    const minimal = iconStyle === 'minimal'
    fab.classList.toggle('minimal', minimal)
    fabImg.src = minimal ? MINIMAL_SRC : MONSTER_SRC
    reflectToggle(iconStyle)
  }
  chrome.storage.local.get(ICON_KEY).then((s) => applyStyle(s[ICON_KEY]))
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch[ICON_KEY]) applyStyle(ch[ICON_KEY].newValue)
  })

  // ---- menu ----
  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.innerHTML = `
    <button class="item" data-mode="region">${ICON_CROP}<span>Region</span></button>
    <button class="item" data-mode="visible">${ICON_CAM}<span>Visible area</span></button>
    <button class="item" data-mode="full">${ICON_FULL}<span>Full page</span></button>
    <button class="item" data-mode="screen">${ICON_SCREEN}<span>Capture screen</span></button>
    <div class="sep"></div>
    <button class="item toggle" data-act="toggle-icon">${ICON_MASK}<span>Mascot icon</span><span class="sw" data-sw></span></button>
    <button class="item subdued" data-act="hide-fab">${ICON_HIDE}<span data-hide-label>Hide floating button</span></button>`
  root.appendChild(menu)
  isolate(menu)

  // Reflect current icon style on the toggle switch.
  const swEl = menu.querySelector<HTMLElement>('[data-sw]')!
  const reflectToggle = (style: string | undefined): void => {
    swEl.classList.toggle('on', style === 'monster')
  }

  let menuOpen = false
  const closeMenu = (): void => {
    menuOpen = false
    menu.classList.remove('open')
  }
  const openMenu = (): void => {
    positionMenu()
    menuOpen = true
    menu.classList.add('open')
  }
  const positionMenu = (): void => {
    const r = fab.getBoundingClientRect()
    // Open the menu on whichever side has room.
    const onLeft = r.left > window.innerWidth / 2
    const above = r.top > window.innerHeight / 2
    menu.style.left = onLeft ? '' : `${r.right + 8}px`
    menu.style.right = onLeft ? `${window.innerWidth - r.left + 8}px` : ''
    menu.style.top = above ? '' : `${r.top}px`
    menu.style.bottom = above ? `${window.innerHeight - r.bottom}px` : ''
  }

  menu.querySelectorAll<HTMLButtonElement>('.item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.act === 'toggle-icon') {
        // Flip mascot/minimal — storage.onChanged updates the FAB, toolbar & options.
        const next = iconStyle === 'monster' ? 'minimal' : 'monster'
        chrome.storage.local.set({ [ICON_KEY]: next })
        reflectToggle(next) // optimistic; onChanged will confirm
        return
      }
      if (btn.dataset.act === 'hide-fab') {
        const label = btn.querySelector<HTMLElement>('[data-hide-label]')!
        label.textContent = 'Hidden — restore from toolbar'
        btn.disabled = true
        setTimeout(() => void chrome.storage.sync.set({ [FAB_ENABLED_KEY]: false }), 700)
        return
      }
      const mode = btn.dataset.mode as 'region' | 'visible' | 'full' | 'screen'
      closeMenu()
      if (mode === 'region') startRegion()
      else if (mode === 'screen') void startScreenCapture()
      else chrome.runtime.sendMessage({ type: 'capture', mode })
    })
  })

  document.addEventListener('click', (e) => {
    if (menuOpen && e.target !== host) closeMenu()
  })

  // ---- position + drag ----
  let pos = { left: 0, top: 0 }
  const applyPos = (): void => {
    fab.style.left = `${pos.left}px`
    fab.style.top = `${pos.top}px`
  }
  const clamp = (): void => {
    const m = 8
    pos.left = Math.min(Math.max(pos.left, m), window.innerWidth - 56 - m)
    pos.top = Math.min(Math.max(pos.top, m), window.innerHeight - 56 - m)
  }
  chrome.storage.local.get(POS_KEY).then((s) => {
    const saved = s[POS_KEY] as { left: number; top: number } | undefined
    pos = saved ?? { left: window.innerWidth - 72, top: window.innerHeight - 96 }
    clamp()
    applyPos()
  })
  window.addEventListener('resize', () => {
    clamp()
    applyPos()
    if (menuOpen) positionMenu()
  })

  let down: { x: number; y: number; left: number; top: number } | null = null
  let dragging = false
  fab.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    down = { x: e.clientX, y: e.clientY, left: pos.left, top: pos.top }
    dragging = false
    fab.setPointerCapture(e.pointerId)
  })
  fab.addEventListener('pointermove', (e) => {
    if (!down) return
    const dx = e.clientX - down.x
    const dy = e.clientY - down.y
    if (!dragging && Math.hypot(dx, dy) > 5) {
      dragging = true
      fab.classList.add('dragging')
      closeMenu()
    }
    if (dragging) {
      pos.left = down.left + dx
      pos.top = down.top + dy
      clamp()
      applyPos()
    }
  })
  fab.addEventListener('pointerup', (e) => {
    fab.releasePointerCapture(e.pointerId)
    if (dragging) {
      fab.classList.remove('dragging')
      chrome.storage.local.set({ [POS_KEY]: pos })
    } else {
      menuOpen ? closeMenu() : openMenu()
    }
    down = null
  })

  // ---- screen capture (address bar / console / anything on screen) ----
  // Runs in the page so the user's real tab stays in front — getDisplayMedia
  // needs a user gesture, which this FAB-menu click provides. The native picker
  // appears over the current page; picking "Window" or "Entire Screen" then
  // captures the browser chrome and a docked DevTools console.
  async function startScreenCapture(): Promise<void> {
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as MediaTrackConstraints,
        audio: false
      })
      // Hide our FAB so it never lands in the shot, then grab a frame.
      temporarilyHidden = true
      applyVisibility()
      const dataUrl = await grabFrame(stream)
      chrome.runtime.sendMessage({ type: 'screen-frame', dataUrl })
    } catch (e) {
      // NotAllowedError = the user dismissed the picker (or the site blocks
      // display-capture). Nothing to do — silently abort.
      if (!/NotAllowed|Permission/i.test(String((e as Error)?.name ?? e))) {
        console.warn('SnapSki screen capture failed', e)
      }
    } finally {
      stream?.getTracks().forEach((t) => t.stop())
      temporarilyHidden = false
      applyVisibility()
    }
  }

  // ---- region selection ----
  function startRegion(): void {
    temporarilyHidden = true
    applyVisibility() // keep FAB/menu out of the shot
    const ov = document.createElement('div')
    ov.className = 'overlay'
    const box = document.createElement('div')
    box.className = 'sel'
    const label = document.createElement('div')
    label.className = 'dim-label'
    label.textContent = 'Drag to select · Esc to cancel'
    const sizeTag = document.createElement('div')
    sizeTag.className = 'size'
    ov.append(box, label, sizeTag)
    // Region overlay lives in the light DOM so it covers everything, but styled
    // via a dedicated stylesheet to avoid leaking onto the page.
    const ovStyle = document.createElement('style')
    ovStyle.textContent = overlayCss()
    document.documentElement.append(ovStyle, ov)
    isolate(ov)

    let start: { x: number; y: number } | null = null
    const cleanup = (restoreFab = true): void => {
      ov.remove()
      ovStyle.remove()
      document.removeEventListener('keydown', onKey, true)
      if (restoreFab) {
        temporarilyHidden = false
        applyVisibility()
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cleanup()
      }
    }
    document.addEventListener('keydown', onKey, true)

    ov.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY }
      label.style.display = 'none'
      box.style.display = 'block'
    })
    ov.addEventListener('pointermove', (e) => {
      if (!start) return
      const x = Math.min(start.x, e.clientX)
      const y = Math.min(start.y, e.clientY)
      const w = Math.abs(e.clientX - start.x)
      const h = Math.abs(e.clientY - start.y)
      box.style.cssText += `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`
      sizeTag.textContent = `${Math.round(w)} × ${Math.round(h)}`
      sizeTag.style.cssText += `display:block;left:${x}px;top:${Math.max(0, y - 24)}px;`
    })
    ov.addEventListener('pointerup', (e) => {
      if (!start) return
      const rect = {
        x: Math.min(start.x, e.clientX),
        y: Math.min(start.y, e.clientY),
        w: Math.abs(e.clientX - start.x),
        h: Math.abs(e.clientY - start.y)
      }
      cleanup(false)
      if (rect.w > 4 && rect.h > 4) {
        // FAB already hidden; give the page one paint to drop the overlay, then
        // ask the worker to capture+crop.
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            setTimeout(
              () => {
                chrome.runtime.sendMessage({
                  type: 'capture',
                  mode: 'region',
                  rect,
                  dpr: window.devicePixelRatio || 1
                }).finally(() => {
                  temporarilyHidden = false
                  applyVisibility()
                })
              },
              60
            )
          )
        )
      } else {
        temporarilyHidden = false
        applyVisibility()
      }
    })
  }

  // ---- hide/show handshake from the worker (so the FAB never lands in a shot) ----
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'snapski-hide') {
      temporarilyHidden = true
      applyVisibility()
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(() => sendResponse({ ok: true }), 50))
      )
      return true
    }
    if (msg?.type === 'snapski-show') {
      temporarilyHidden = false
      applyVisibility()
      return false
    }
    if (msg?.type === 'snapski-shot') {
      showToast({ id: msg.id, dataUrl: msg.dataUrl, autosaved: msg.autosaved === true })
      sendResponse({ ok: true })
      return false
    }
    if (msg?.type === 'snapski-start-region') {
      closeMenu()
      startRegion()
      return false
    }
    return false
  })
}

function css(): string {
  return `
  .fab{position:fixed;width:56px;height:56px;border:none;border-radius:50%;
    background:transparent;cursor:grab;
    box-shadow:0 8px 24px rgba(80,69,224,.5),0 2px 6px rgba(0,0,0,.35);
    display:flex;align-items:center;justify-content:center;padding:0;opacity:.7;
    transition:opacity .15s,transform .12s,box-shadow .15s;touch-action:none;}
  .fab:hover{opacity:1;transform:scale(1.08);box-shadow:0 10px 28px rgba(80,69,224,.6),0 2px 6px rgba(0,0,0,.35);}
  .fab.dragging{cursor:grabbing;opacity:1;transform:scale(1.04);}
  .fab img{width:100%;height:100%;object-fit:contain;border-radius:50%;
    pointer-events:none;-webkit-user-drag:none;user-select:none;}
  /* Minimal style: white mark sits on a brand-purple disc. */
  .fab.minimal{background:linear-gradient(145deg,${PRIMARY},#5145e0);}
  .fab.minimal img{width:60%;height:60%;border-radius:0;}
  .menu{position:fixed;display:none;flex-direction:column;gap:2px;padding:6px;
    background:rgba(20,20,26,.96);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.08);
    border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);
    font-family:'Segoe UI',system-ui,sans-serif;}
  .menu.open{display:flex;animation:pop .12s ease-out;}
  @keyframes pop{from{opacity:0;transform:translateY(4px) scale(.97)}to{opacity:1;transform:none}}
  .item{display:flex;align-items:center;gap:10px;padding:8px 12px 8px 10px;border:none;
    background:transparent;color:#e7e7ea;font-size:13px;font-weight:500;border-radius:9px;
    cursor:pointer;white-space:nowrap;text-align:left;}
  .item:hover{background:${PRIMARY};color:#fff;}
  .item:disabled{cursor:default;opacity:.72;}
  .item:disabled:hover{background:transparent;color:#bdbdc4;}
  .item svg{width:17px;height:17px;flex:none;}
  .item:first-child{color:#fff;}
  .item:first-child svg{color:${PRIMARY};}
  .item:first-child:hover svg{color:#fff;}
  .sep{height:1px;margin:4px 6px;background:rgba(255,255,255,.08);}
  .item.toggle{color:#bdbdc4;}
  .item.toggle .sw{margin-left:auto;width:30px;height:17px;border-radius:9px;
    background:rgba(255,255,255,.18);position:relative;flex:none;transition:background .15s;}
  .item.toggle .sw::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;
    border-radius:50%;background:#fff;transition:transform .15s;}
  .item.toggle .sw.on{background:${PRIMARY};}
  .item.toggle .sw.on::after{transform:translateX(13px);}
  .item.toggle:hover{background:rgba(255,255,255,.06);color:#fff;}
  .item.subdued{color:#bdbdc4;}
  .item.subdued:hover{background:rgba(255,255,255,.06);color:#fff;}`
}

function toastCss(): string {
  return `
  .toast{position:fixed;top:16px;left:50%;display:flex;align-items:center;gap:12px;
    max-width:min(460px,calc(100vw - 32px));padding:10px 10px 10px 12px;
    background:rgba(20,20,26,.96);backdrop-filter:blur(12px);
    border:1px solid rgba(255,255,255,.08);border-radius:14px;
    box-shadow:0 12px 40px rgba(0,0,0,.5);
    font-family:'Segoe UI',system-ui,sans-serif;
    opacity:0;pointer-events:none;transform:translateX(-50%) translateY(-10px);
    transition:opacity .16s ease-out,transform .16s ease-out;}
  .toast.open{opacity:1;pointer-events:auto;transform:translateX(-50%);}
  .toast .thumb{width:76px;height:48px;flex:none;object-fit:cover;border-radius:8px;
    background:#111;border:1px solid rgba(255,255,255,.1);}
  .toast .col{display:flex;flex-direction:column;gap:7px;min-width:0;}
  .toast .status{color:#e7e7ea;font-size:12.5px;font-weight:500;line-height:1.2;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .toast .status.bad{color:#ff9a8b;}
  .toast .acts{display:flex;gap:6px;}
  .act{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:none;
    border-radius:8px;background:rgba(255,255,255,.08);color:#e7e7ea;
    font:600 12px 'Segoe UI',system-ui,sans-serif;cursor:pointer;white-space:nowrap;
    transition:background .12s,color .12s;}
  .act:hover{background:rgba(255,255,255,.16);color:#fff;}
  .act.primary{background:${PRIMARY};color:#fff;}
  .act.primary:hover{background:#5145e0;}
  .act:disabled{opacity:.55;cursor:default;}
  .act[hidden]{display:none;}
  .act svg{width:14px;height:14px;flex:none;}
  .toast .x{margin-left:auto;align-self:flex-start;display:flex;padding:4px;border:none;
    background:transparent;color:#8b8b96;border-radius:7px;cursor:pointer;
    transition:background .12s,color .12s;}
  .toast .x:hover{background:rgba(255,255,255,.1);color:#fff;}
  .toast .x svg{width:15px;height:15px;}`
}

function overlayCss(): string {
  return `
  #snapski-host{}
  .overlay{position:fixed;inset:0;z-index:2147483646;cursor:crosshair;}
  .overlay .sel{position:fixed;display:none;border:1.5px solid ${PRIMARY};
    box-shadow:0 0 0 100000px rgba(10,10,14,.45);background:transparent;}
  .overlay .dim-label{position:fixed;top:18px;left:50%;transform:translateX(-50%);
    background:rgba(20,20,26,.92);color:#fff;padding:6px 14px;border-radius:9px;
    font:500 13px 'Segoe UI',system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.4);}
  .overlay .size{position:fixed;display:none;background:${PRIMARY};color:#fff;
    padding:2px 7px;border-radius:6px;font:600 11px ui-monospace,monospace;pointer-events:none;}`
}

// Run last, once everything (icons, helpers) is defined. Guard against double
// injection (e.g. SPA re-navigation re-running the script).
if (!(window as unknown as { __snapski?: boolean }).__snapski) {
  ;(window as unknown as { __snapski?: boolean }).__snapski = true
  init()
}
