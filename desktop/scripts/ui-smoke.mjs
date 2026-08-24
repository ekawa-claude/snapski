// Desktop UI smoke test — boots the renderer in a plain browser, no Electron.
//
//   npm run test:ui
//
// Two kinds of rot this catches, both of which were live in the repo:
//
//  * the harness mock drifting behind the preload bridge. window.snap.onUpdateStatus
//    was added with auto-update in July and never mirrored here, so app-test.html
//    threw on mount and rendered a blank page for weeks. Nothing failed loudly.
//  * a dialog outgrowing the window. The Settings panel is a flex-centred child
//    with no height cap, so on a short window it overflowed in BOTH directions and
//    the part above the top edge was unreachable — no scrollbar goes there.
//
// Needs a Chromium that can run headless; Playwright's bundled build is used by
// default. Override with SNAPSKI_CHROME.
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const VITE_PORT = 5199
const CDP_PORT = 9411
const CHROME =
  process.env.SNAPSKI_CHROME ??
  join(
    process.env.LOCALAPPDATA ?? '',
    'ms-playwright',
    'chromium-1217',
    'chrome-win64',
    'chrome.exe'
  )

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const vite = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--config', 'vite.renderer.config.ts'],
  { cwd: join(import.meta.dirname, '..'), stdio: 'ignore', shell: process.platform === 'win32' }
)

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${VITE_PORT}/app-test.html`)
      if (r.ok) return true
    } catch {}
    await wait(500)
  }
  return false
}

function connect(target, sink) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let seq = 0
  const ready = new Promise((r) => (ws.onopen = r))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') {
      sink.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception')
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      sink.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').split('\n')[0])
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
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value
  return { send, evaluate, close: () => ws.close() }
}

/** Boot the app harness at a given window height and report what the UI did. */
async function boot(height) {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--window-size=1104,${height}`,
      `http://localhost:${VITE_PORT}/app-test.html`
    ],
    { stdio: 'ignore' }
  )
  let tab
  for (let i = 0; i < 40 && !tab; i++) {
    try {
      tab = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find(
        (t) => t.type === 'page' && t.url.includes('app-test')
      )
    } catch {}
    if (!tab) await wait(500)
  }
  if (!tab) throw new Error('browser never exposed the harness page')

  const errors = []
  const page = connect(tab, errors)
  await page.send('Runtime.enable')
  await page.send('Page.enable')
  await wait(3500)
  return { chrome, page, errors }
}

const SETTINGS_STATE = `(() => {
  const h2 = [...document.querySelectorAll('h2')].find(x => x.textContent.trim() === 'Settings')
  if (!h2) return { found: false }
  const card = h2.closest('div').parentElement
  const r = card.getBoundingClientRect()
  const body = card.querySelector('.overflow-y-auto')
  return {
    found: true,
    windowH: window.innerHeight,
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    headerVisible: h2.getBoundingClientRect().top >= 0,
    scrolls: body ? body.scrollHeight > body.clientHeight : null
  }
})()`

const OPEN_SETTINGS = `(() => {
  const b = [...document.querySelectorAll('button')]
    .find(x => /setting/i.test(x.title + ' ' + (x.getAttribute('aria-label') || '')))
  if (!b) return false
  b.click()
  return true
})()`

try {
  check('renderer dev server starts', await waitForServer())

  // --- short window: the case that was broken -------------------------------
  {
    const { chrome, page, errors } = await boot(732)
    const mounted = await page.evaluate(`document.getElementById('root')?.children.length ?? 0`)
    check('app harness mounts', mounted > 0, `${mounted} root children`)
    check('no page errors on boot', errors.length === 0, errors.slice(0, 3).join(' | '))

    check('settings dialog opens', (await page.evaluate(OPEN_SETTINGS)) === true)
    await wait(800)
    const s = await page.evaluate(SETTINGS_STATE)
    check('settings dialog found', s?.found === true, JSON.stringify(s))
    if (s?.found) {
      check('dialog stays inside the window', s.top >= 0 && s.bottom <= s.windowH, JSON.stringify(s))
      check('dialog header is reachable', s.headerVisible === true)
      check('dialog body scrolls when it must', s.scrolls === true)
    }
    page.close()
    chrome.kill()
    await wait(800)
  }

  // --- tall window: the scrollbar must not appear for no reason -------------
  {
    const { chrome, page } = await boot(1400)
    await page.evaluate(OPEN_SETTINGS)
    await wait(800)
    const s = await page.evaluate(SETTINGS_STATE)
    check('dialog fits without scrolling on a tall window', s?.scrolls === false, JSON.stringify(s))
    page.close()
    chrome.kill()
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
} finally {
  vite.kill()
  // vite spawns through a shell on Windows; make sure the port is actually free.
  if (process.platform === 'win32') {
    spawn('taskkill', ['/F', '/T', '/PID', String(vite.pid)], { stdio: 'ignore' })
  }
}
process.exit(failures === 0 ? 0 : 1)
