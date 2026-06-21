import './rec-hud.css'

const params = new URLSearchParams(location.search)
const type = params.get('type')
const root = document.getElementById('hud-root') as HTMLDivElement

if (type === 'border') {
  // The window itself is the red ring (styled via body.border-mode); the centre
  // is transparent and click-through. Nothing else to render.
  document.body.classList.add('border-mode')
} else {
  // Floating control bar: REC dot + elapsed time + Stop button.
  root.innerHTML = `
    <div class="bar">
      <span class="dot"></span>
      <span id="time">0:00</span>
      <button id="stop">■ Stop</button>
    </div>
  `
  const t0 = Date.now()
  const timeEl = document.getElementById('time') as HTMLSpanElement
  const tick = (): void => {
    const s = Math.floor((Date.now() - t0) / 1000)
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  tick()
  setInterval(tick, 500)
  document.getElementById('stop')?.addEventListener('click', () => window.snap.stopRecording())
}
