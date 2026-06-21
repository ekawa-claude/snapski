// Standalone harness to test the annotation editor in a plain browser
// (no Electron). Provides a mock window.snap and a sample image.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { EditorView } from './components/editor/EditorView'
import type { CaptureResult } from '@shared/types'
import './index.css'

// --- build a sample image to annotate ---
function sampleImage(w = 900, h = 560): string {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#1e293b')
  g.addColorStop(1, '#0f172a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#38bdf8'
  ctx.fillRect(60, 60, 220, 120)
  ctx.fillStyle = '#f472b6'
  ctx.beginPath()
  ctx.arc(640, 360, 90, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#e2e8f0'
  ctx.font = 'bold 40px Segoe UI, sans-serif'
  ctx.fillText('SnapSki editor test', 60, 320)
  ctx.font = '20px Segoe UI, sans-serif'
  ctx.fillStyle = '#94a3b8'
  ctx.fillText('annotate me — secret: 4321', 60, 360)
  return c.toDataURL('image/png')
}

const capture: CaptureResult = {
  dataUrl: sampleImage(),
  savedPath: 'C:/test/sample.png',
  width: 900,
  height: 560
}

// --- mock the preload bridge ---
;(window as unknown as { snap: unknown }).snap = {
  exportImage: async (dataUrl: string) => {
    ;(window as unknown as { __exported?: string }).__exported = dataUrl
    return { dataUrl, savedPath: 'C:/test/edited.png', width: 900, height: 560 }
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <EditorView capture={capture} onClose={() => console.log('editor closed')} />
  </React.StrictMode>
)
