// SnapSki for Chrome — end-to-end harness.
//
// Loads the built dist/ into a real Chromium and drives the in-page FAB over CDP,
// so the capture → clipboard → toast path is exercised the way a user hits it.
//
//   npm run build && node scripts/e2e.mjs
//
// Two things the harness must get right or every assertion lies:
//  * the window has to be ON SCREEN — captureVisibleTab fails silently on an
//    off-screen window, which looks exactly like a broken capture;
//  * a fresh profile opens welcome.html on top, and capture follows the ACTIVE
//    tab — so bring the test page to the front before clicking anything.
//
// Chrome 137+ dropped --load-extension, so this needs a Chromium that still
// honours it (Playwright's bundled build does). Override with SNAPSKI_CHROME.
import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const PORT = 9377
const EXT = join(import.meta.dirname, '..', 'dist')
const CHROME =
  process.env.SNAPSKI_CHROME ??
  join(
    process.env.LOCALAPPDATA ?? '',
    'ms-playwright',
    'chromium-1217',
    'chrome-win64',
    'chrome.exe'
  )
// Shots are filed under Downloads/SnapSki/<today>; assert that folder exactly.
const d = new Date()
const pad = (n) => String(n).padStart(2, '0')
const DAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DOWNLOADS = join(homedir(), 'Downloads', 'SnapSki', DAY)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const list = () => fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function attach(pred, tries = 40) {
  let have = '(browser never answered on the debug port)'
  for (let i = 0; i < tries; i++) {
    try {
      const targets = await list()
      const t = targets.find(pred)
      if (t) return t
      have = targets.map((x) => `${x.type} ${x.url}`).join('\n  ')
    } catch {
      // Chrome hasn't opened the debug port yet — keep waiting.
    }
    await wait(500)
  }
  throw new Error(`target not found:\n  ${have}`)
}

function conn(target, tag) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let seq = 0
  const ready = new Promise((r) => (ws.onopen = r))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') {
      console.log(`[${tag} EXCEPTION]`, m.params.exceptionDetails.exception?.description)
      failures++
    }
  })
  const send = async (method, params = {}) => {
    await ready
    const id = ++seq
    return new Promise((resolve) => {
      const onMsg = (e) => {
        const m = JSON.parse(e.data)
        if (m.id === id) {
          ws.removeEventListener('message', onMsg)
          resolve(m)
        }
      }
      ws.addEventListener('message', onMsg)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    const ex = r.result?.exceptionDetails
    if (ex) throw new Error(`${tag} eval: ${ex.exception?.description ?? ex.text}`)
    return r.result?.result?.value
  }
  return { send, evaluate, close: () => ws.close() }
}

/** Read the toast's visible state out of its shadow root. */
const TOAST_STATE = `(() => {
  const h = document.getElementById('snapski-toast-host')
  if (!h) return null
  const c = h.shadowRoot.querySelector('.toast')
  const btn = (a) => { const b = c.querySelector('[data-act="' + a + '"]'); return !!b && !b.hidden }
  return { open: c.classList.contains('open'), status: c.querySelector('[data-status]').textContent,
           thumb: c.querySelector('.thumb').src.length, annotate: btn('annotate'),
           save: btn('save'), copy: btn('copy') }
})()`

const clickToast = (act) =>
  `document.getElementById('snapski-toast-host').shadowRoot.querySelector('[data-act="${act}"]').click()`

/** Open the FAB menu (it toggles on pointerup) and pick a capture mode. */
async function captureVia(page, mode) {
  // Capture follows the ACTIVE tab, and earlier steps may have opened an editor
  // tab on top — put the page under test back in front first.
  await page.send('Page.bringToFront')
  await wait(300)
  await page.evaluate(`(() => {
    const fab = document.getElementById('snapski-host').shadowRoot.querySelector('.fab')
    fab.setPointerCapture = () => {}; fab.releasePointerCapture = () => {}
    const o = { bubbles: true, pointerId: 1, clientX: 100, clientY: 100 }
    fab.dispatchEvent(new PointerEvent('pointerdown', o))
    fab.dispatchEvent(new PointerEvent('pointerup', o))
  })()`)
  await wait(250)
  await page.evaluate(
    `document.getElementById('snapski-host').shadowRoot.querySelector('[data-mode="${mode}"]').click()`
  )
  await wait(2500)
}

const before = existsSync(DOWNLOADS) ? new Set(readdirSync(DOWNLOADS)) : new Set()
const newFiles = () =>
  existsSync(DOWNLOADS) ? readdirSync(DOWNLOADS).filter((f) => !before.has(f)) : []

const profile = mkdtempSync(join(tmpdir(), 'snapski-e2e-'))
const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    '--window-position=40,40',
    '--window-size=1200,800',
    'https://example.com/'
  ],
  { stdio: 'ignore' }
)

try {
  const swTarget = await attach(
    (t) => t.type === 'service_worker' && t.url.endsWith('/background.js')
  )
  const sw = conn(swTarget, 'SW')
  await sw.send('Runtime.enable')
  const page = conn(await attach((t) => t.type === 'page' && t.url.startsWith('http')), 'PAGE')
  await page.send('Runtime.enable')
  await page.send('Page.enable')
  await page.send('Page.bringToFront')
  await wait(600)

  const caps = () =>
    sw.evaluate(
      `chrome.storage.local.get(null).then(s => Object.keys(s).filter(k => k.startsWith('cap_')))`,
      true
    )

  // --- 1. quick path: the shot lands on the clipboard, no editor tab --------
  await captureVia(page, 'visible')
  let t = await page.evaluate(TOAST_STATE)
  check('toast opens on capture', t?.open === true, JSON.stringify(t))
  check('toast reports the copy', /Copied/.test(t?.status ?? ''), t?.status)
  check('toast shows a thumbnail', (t?.thumb ?? 0) > 1000, `${t?.thumb} bytes`)
  check('Annotate and Save offered', t?.annotate === true && t?.save === true)
  check(
    'no editor tab was opened',
    (await list()).every((x) => !x.url.includes('editor.html'))
  )

  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  const shotPath = join(import.meta.dirname, '..', 'e2e-toast.png')
  writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))
  console.log('screenshot:', shotPath)

  // --- 2. Save writes a file and the toast says so -------------------------
  await page.evaluate(clickToast('save'))
  await wait(2000)
  t = await page.evaluate(TOAST_STATE)
  check('Save reports success', /Saved/.test(t?.status ?? ''), t?.status)
  check('Save button retires after saving', t?.save === false)
  check(`Save wrote a PNG to Downloads/SnapSki/${DAY}`, newFiles().length === 1, newFiles().join(', '))
  check('Save names the day folder', (t?.status ?? '').includes(`SnapSki/${DAY}`), t?.status)

  // --- 3. Annotate hands the capture to the editor -------------------------
  await captureVia(page, 'visible')
  await page.evaluate(clickToast('annotate'))
  await wait(2500)
  const editorTarget = (await list()).find((x) => x.url.includes('editor.html'))
  check('Annotate opens the editor', !!editorTarget, editorTarget?.url)
  if (editorTarget) {
    const ed = conn(editorTarget, 'EDITOR')
    await ed.send('Runtime.enable')
    await wait(1500)
    const text = await ed.evaluate(`document.body.innerText.slice(0, 80)`)
    check('editor loaded the capture', !/expired|No capture id/.test(text), JSON.stringify(text))
    ed.close()
  }
  check('toast closed after Annotate', (await page.evaluate(TOAST_STATE))?.open === false)

  // --- 4. dismissing a shot drops it from storage --------------------------
  const stored = await caps()
  if (stored.length) await sw.evaluate(`chrome.storage.local.remove(${JSON.stringify(stored)})`, true)
  await captureVia(page, 'visible')
  const pending = await caps()
  check('capture is stored while the toast is up', pending.length === 1, pending.join(', '))
  await page.evaluate(clickToast('close'))
  await wait(800)
  const left = await caps()
  check(
    'dismissed capture is discarded',
    left.length < pending.length,
    `${pending.length} → ${left.length}`
  )

  // --- 5. autosave writes on every capture ---------------------------------
  await sw.evaluate(`chrome.storage.sync.set({ snapski_autosave: true })`, true)
  await wait(400)
  await captureVia(page, 'visible')
  t = await page.evaluate(TOAST_STATE)
  check('toast reopens for the autosaved shot', t?.open === true, JSON.stringify(t))
  check('autosave is reflected in the toast', /saved to disk/.test(t?.status ?? ''), t?.status)
  check('autosave hides the Save button', t?.save === false)
  check('autosave wrote a second PNG into the day folder', newFiles().length === 2, newFiles().join(', '))

  // Remove only the files this run created.
  for (const f of newFiles()) rmSync(join(DOWNLOADS, f), { force: true })
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
} finally {
  chrome.kill()
  await wait(1500) // Windows keeps the profile locked briefly after the exit
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    console.log('note: left behind', profile)
  }
}
process.exit(failures === 0 ? 0 : 1)
