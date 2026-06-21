// Standalone harness to test the full App (home + history + editor wiring) in a
// plain browser with a mocked preload bridge.
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import type { CaptureResult, HistoryItem } from '@shared/types'
import './index.css'

function swatchImg(label: string, hue: number): string {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 400
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `hsl(${hue} 40% 18%)`
  ctx.fillRect(0, 0, 640, 400)
  ctx.fillStyle = `hsl(${hue} 70% 60%)`
  ctx.fillRect(40, 40, 220, 120)
  ctx.fillStyle = '#e2e8f0'
  ctx.font = 'bold 36px Segoe UI, sans-serif'
  ctx.fillText(label, 40, 260)
  return c.toDataURL('image/png')
}

const history: HistoryItem[] = [0, 1, 2, 3, 4].map((i) => ({
  // point the test video at the sample served by vite from /public
  path: i === 1 ? '/sample.mp4' : `C:/test/Snap_${i}.png`,
  name: i === 1 ? 'Rec_clip.mp4' : `Snap_${i}.png`,
  mtime: Date.now() - i * 1000,
  type: i === 1 ? 'video' : 'image',
  thumb: swatchImg(i === 1 ? `Clip ${i}` : `Snap ${i}`, i * 60)
}))

let captureCb: ((r: CaptureResult) => void) | null = null
let recStateCb: ((s: { active: boolean }) => void) | null = null
let recDoneCb: ((r: { path: string; ok: boolean }) => void) | null = null
const w = window as unknown as Record<string, unknown>
w.__fireCapture = (r: CaptureResult) => captureCb?.(r)
w.__fireRecState = (active: boolean) => recStateCb?.({ active })
w.__fireRecDone = (ok: boolean) => recDoneCb?.({ path: 'C:/test/Rec.mp4', ok })

const mock = {
  getSettings: async () => ({
    outputFolder: 'C:/Users/User/Pictures/SnapSki',
    hotkeys: { capture: 'PrintScreen' },
    copyToClipboard: true,
    saveToFolder: true,
    captureMode: 'screenshot'
  }),
  setSettings: async (p: unknown) => ({
    outputFolder: 'C:/Users/User/Pictures/SnapSki',
    hotkeys: { capture: 'PrintScreen' },
    copyToClipboard: true,
    saveToFolder: true,
    captureMode: 'screenshot',
    ...(p as object)
  }),
  chooseFolder: async () => null,
  openFolder: async () => {},
  triggerCapture: async () => {},
  listHistory: async () => history,
  mediaUrl: (path: string) => path,
  exportVideo: async () => ({ ok: true, path: 'C:/test/Clip.mp4' }),
  onVideoProgress: () => () => {},
  openHistory: async (path: string): Promise<CaptureResult> => ({
    dataUrl: swatchImg('Editing ' + path.split('/').pop(), 200),
    savedPath: path,
    width: 640,
    height: 400
  }),
  exportImage: async (dataUrl: string): Promise<CaptureResult> => ({
    dataUrl,
    savedPath: 'C:/test/edited.png',
    width: 640,
    height: 400
  }),
  winMinimize: async () => {},
  winToggleMaximize: async () => false,
  winClose: async () => {},
  stopRecording: async () => {
    recStateCb?.({ active: false })
    recDoneCb?.({ path: 'C:/test/Rec.mp4', ok: true })
  },
  getRecordState: async () => ({ active: false }),
  onRecordState: (cb: (s: { active: boolean }) => void) => {
    recStateCb = cb
    return () => {
      recStateCb = null
    }
  },
  onRecordDone: (cb: (r: { path: string; ok: boolean }) => void) => {
    recDoneCb = cb
    return () => {
      recDoneCb = null
    }
  },
  onCaptureDone: (cb: (r: CaptureResult) => void) => {
    captureCb = cb
    return () => {
      captureCb = null
    }
  }
}
;(window as unknown as { snap: unknown }).snap = mock

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
