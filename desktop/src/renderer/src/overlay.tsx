import './overlay.css'

interface Pt {
  x: number
  y: number
}

const root = document.getElementById('overlay-root') as HTMLDivElement

const isVideo = new URLSearchParams(location.search).get('mode') === 'video'
if (isVideo) document.body.classList.add('video')
const verb = isVideo ? 'record' : 'capture'

root.innerHTML = `
  <div id="dim"></div>
  <div id="sel"></div>
  <div id="size"></div>
  <div id="hint">
    ${isVideo ? '<span class="rec"><span class="rec-dot"></span>REC</span>' : ''}
    <span class="key">Drag</span> to ${verb} a region
    <span class="dot">·</span>
    <button id="btn-full" class="obtn">Fullscreen</button>
    <button id="btn-win" class="obtn">Active window</button>
    <span class="dot">·</span>
    <button id="btn-cancel" class="obtn ghost">Cancel (Esc)</button>
  </div>
`

const sel = document.getElementById('sel') as HTMLDivElement
const sizeLabel = document.getElementById('size') as HTMLDivElement
const hint = document.getElementById('hint') as HTMLDivElement

let start: Pt | null = null
let dragging = false

function rectFrom(a: Pt, b: Pt): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

function paint(r: { x: number; y: number; width: number; height: number }): void {
  sel.style.display = 'block'
  sel.style.left = `${r.x}px`
  sel.style.top = `${r.y}px`
  sel.style.width = `${r.width}px`
  sel.style.height = `${r.height}px`
  sizeLabel.style.display = 'block'
  sizeLabel.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`
  sizeLabel.style.left = `${r.x}px`
  sizeLabel.style.top = `${Math.max(0, r.y - 28)}px`
}

window.addEventListener('mousedown', (e) => {
  if ((e.target as HTMLElement).closest('.obtn')) return
  start = { x: e.clientX, y: e.clientY }
  dragging = true
  hint.style.opacity = '0'
})

window.addEventListener('mousemove', (e) => {
  if (!dragging || !start) return
  paint(rectFrom(start, { x: e.clientX, y: e.clientY }))
})

window.addEventListener('mouseup', async (e) => {
  if (!dragging || !start) return
  dragging = false
  const r = rectFrom(start, { x: e.clientX, y: e.clientY })
  start = null
  if (r.width < 5 || r.height < 5) {
    // treated as a click, not a region — show the hint again
    sel.style.display = 'none'
    sizeLabel.style.display = 'none'
    hint.style.opacity = '1'
    return
  }
  await window.snap.overlayRegion(r)
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.snap.overlayCancel()
})

document.getElementById('btn-full')?.addEventListener('click', () => window.snap.overlayFullscreen())
document.getElementById('btn-win')?.addEventListener('click', () => window.snap.overlayWindow())
document.getElementById('btn-cancel')?.addEventListener('click', () => window.snap.overlayCancel())
