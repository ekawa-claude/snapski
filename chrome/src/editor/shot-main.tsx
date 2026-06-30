// TEMP store-screenshot harness (not shipped). Mounts the real EditorView over a
// believable mock "website screenshot" and injects real annotation objects via
// window.__fabric so we can capture a polished hero shot of the annotation editor.
import ReactDOM from 'react-dom/client'
import {
  Canvas,
  Circle,
  Group,
  IText,
  Rect,
  FabricImage
} from 'fabric'
import { EditorView } from './components/editor/EditorView'
import { makeArrow } from './components/editor/arrow'
import { Callout } from './components/editor/Callout'
import './index.css'

const RED = '#f43f5e'

// ---- draw a clean fake analytics dashboard as the captured image ----
const W = 1180
const H = 720
const cv = document.createElement('canvas')
cv.width = W
cv.height = H
const g = cv.getContext('2d')!

function rr(x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

// page bg
g.fillStyle = '#f1f5f9'
g.fillRect(0, 0, W, H)

// top bar
g.fillStyle = '#ffffff'
g.fillRect(0, 0, W, 58)
g.fillStyle = '#e2e8f0'
g.fillRect(0, 58, W, 1)
// logo
g.fillStyle = '#7c3aed'
g.beginPath()
g.arc(36, 29, 12, 0, Math.PI * 2)
g.fill()
g.fillStyle = '#0f172a'
g.font = '600 18px Inter, Segoe UI, sans-serif'
g.fillText('Acme Analytics', 58, 35)
// right: email + avatar
g.fillStyle = '#475569'
g.font = '14px Inter, Segoe UI, sans-serif'
g.textAlign = 'right'
g.fillText('jane.doe@acme.com', W - 64, 34)
g.textAlign = 'left'
g.fillStyle = '#cbd5e1'
g.beginPath()
g.arc(W - 36, 29, 14, 0, Math.PI * 2)
g.fill()

// sidebar
g.fillStyle = '#ffffff'
g.fillRect(0, 59, 188, H - 59)
g.fillStyle = '#e2e8f0'
g.fillRect(188, 59, 1, H - 59)
const nav = ['Dashboard', 'Reports', 'Customers', 'Revenue', 'Settings']
nav.forEach((n, i) => {
  const y = 96 + i * 46
  if (i === 0) {
    g.fillStyle = '#ede9fe'
    rr(14, y - 22, 160, 36, 9)
    g.fill()
    g.fillStyle = '#6d28d9'
  } else {
    g.fillStyle = '#64748b'
  }
  g.font = '15px Inter, Segoe UI, sans-serif'
  g.fillText(n, 30, y)
})

// main title
g.fillStyle = '#0f172a'
g.font = '700 24px Inter, Segoe UI, sans-serif'
g.fillText('Dashboard', 224, 104)
g.fillStyle = '#94a3b8'
g.font = '14px Inter, Segoe UI, sans-serif'
g.fillText('Overview · June 2026', 224, 128)

// KPI cards
const cards = [
  { label: 'Revenue', value: '$48,250', sub: '↑ 24% vs May', good: true },
  { label: 'Active users', value: '12,840', sub: '↑ 6% vs May', good: true },
  { label: 'Churn', value: '2.1%', sub: '↓ 0.4% vs May', good: true }
]
const cardW = 286
const cardX0 = 224
cards.forEach((c, i) => {
  const x = cardX0 + i * (cardW + 20)
  const y = 150
  g.fillStyle = '#ffffff'
  rr(x, y, cardW, 116, 14)
  g.fill()
  g.strokeStyle = '#e2e8f0'
  g.lineWidth = 1
  rr(x, y, cardW, 116, 14)
  g.stroke()
  g.fillStyle = '#64748b'
  g.font = '14px Inter, Segoe UI, sans-serif'
  g.fillText(c.label, x + 22, y + 34)
  g.fillStyle = '#0f172a'
  g.font = '700 30px Inter, Segoe UI, sans-serif'
  g.fillText(c.value, x + 22, y + 74)
  g.fillStyle = c.good ? '#16a34a' : '#dc2626'
  g.font = '13px Inter, Segoe UI, sans-serif'
  g.fillText(c.sub, x + 22, y + 98)
})

// chart card
const chX = 224
const chY = 296
const chW = cardW * 3 + 40
const chH = 372
g.fillStyle = '#ffffff'
rr(chX, chY, chW, chH, 14)
g.fill()
g.strokeStyle = '#e2e8f0'
rr(chX, chY, chW, chH, 14)
g.stroke()
g.fillStyle = '#0f172a'
g.font = '600 16px Inter, Segoe UI, sans-serif'
g.fillText('Monthly revenue', chX + 24, chY + 36)
// bars
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
const vals = [0.42, 0.5, 0.46, 0.62, 0.7, 0.95]
const baseY = chY + chH - 48
const maxBarH = 220
const bw = 70
const gap = (chW - 48 - bw * months.length) / (months.length - 1)
months.forEach((m, i) => {
  const x = chX + 24 + i * (bw + gap)
  const bh = maxBarH * vals[i]
  g.fillStyle = i === months.length - 1 ? '#7c3aed' : '#c4b5fd'
  rr(x, baseY - bh, bw, bh, 8)
  g.fill()
  g.fillStyle = '#94a3b8'
  g.font = '13px Inter, Segoe UI, sans-serif'
  g.textAlign = 'center'
  g.fillText(m, x + bw / 2, baseY + 24)
  g.textAlign = 'left'
})

const dataUrl = cv.toDataURL('image/png')

// ---- mount the real editor ----
ReactDOM.createRoot(document.getElementById('root')!).render(
  <EditorView capture={{ dataUrl }} onClose={() => {}} onExport={async () => {}} />
)

// ---- once fabric + base image are ready, inject real annotations ----
function pixelatePatch(x: number, y: number, w: number, h: number): FabricImage {
  const small = document.createElement('canvas')
  small.width = Math.max(2, Math.round(w / 10))
  small.height = Math.max(2, Math.round(h / 10))
  small.getContext('2d')!.drawImage(cv, x, y, w, h, 0, 0, small.width, small.height)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const o = out.getContext('2d')!
  o.imageSmoothingEnabled = false
  o.drawImage(small, 0, 0, w, h)
  return new FabricImage(out, { left: x, top: y, selectable: false, evented: false })
}

function badge(n: number, x: number, y: number): Group {
  const circle = new Circle({
    radius: 18,
    fill: RED,
    originX: 'center',
    originY: 'center'
  })
  const text = new IText(String(n), {
    fontSize: 22,
    fontWeight: '700',
    fill: '#ffffff',
    fontFamily: 'Inter, Segoe UI, sans-serif',
    originX: 'center',
    originY: 'center'
  })
  return new Group([circle, text], { left: x, top: y })
}

function inject(): void {
  const c = (window as unknown as { __fabric?: Canvas }).__fabric
  if (!c || !c.backgroundImage) {
    setTimeout(inject, 80)
    return
  }

  // hide the email (sensitive info) with a pixelate patch
  c.add(pixelatePatch(872, 16, 196, 26))

  // numbered step badges on the three KPI cards
  c.add(badge(1, 232, 158))
  c.add(badge(2, 232 + 306, 158))
  c.add(badge(3, 232 + 612, 158))

  // arrow pointing at the spiking June bar (curved toward the tall purple bar)
  const a = makeArrow(690, 250, 1045, 415, RED, 5)
  a.setPointsAbsolute(690, 250, 940, 250, 1045, 415)
  c.add(a)

  // speech bubble near the revenue KPI
  const callout = new Callout('Best month yet! 🎉', {
    left: 470,
    top: 196,
    width: 210,
    fontSize: 22,
    fontWeight: '600',
    fill: '#0f172a',
    fontFamily: 'Inter, Segoe UI, sans-serif',
    textAlign: 'center',
    bubbleStroke: RED
  } as never)
  c.add(callout)

  c.discardActiveObject()
  c.requestRenderAll()
}
setTimeout(inject, 200)
