import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppSettings,
  CaptureResult,
  HistoryItem,
  RecordingResult,
  RecordingState,
  Rect,
  VideoExportOpts,
  VideoExportResult
} from '../shared/types'

const api = {
  // settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', patch),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:chooseFolder'),
  openFolder: (): Promise<void> => ipcRenderer.invoke('settings:openFolder'),

  // capture trigger (from main UI button)
  triggerCapture: (): Promise<void> => ipcRenderer.invoke('capture:trigger'),

  // history
  listHistory: (): Promise<HistoryItem[]> => ipcRenderer.invoke('history:list'),
  openHistory: (path: string): Promise<CaptureResult> => ipcRenderer.invoke('history:open', path),

  // video editing
  mediaUrl: (path: string): string => `snap://media/${encodeURIComponent(path)}`,
  exportVideo: (opts: VideoExportOpts): Promise<VideoExportResult> =>
    ipcRenderer.invoke('video:export', opts),
  onVideoProgress: (cb: (frac: number) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, frac: number): void => cb(frac)
    ipcRenderer.on('video:progress', listener)
    return () => ipcRenderer.removeListener('video:progress', listener)
  },

  // editor export
  exportImage: (dataUrl: string): Promise<CaptureResult> =>
    ipcRenderer.invoke('image:export', dataUrl),

  // window controls
  winMinimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
  winToggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('win:toggleMaximize'),
  winClose: (): Promise<void> => ipcRenderer.invoke('win:close'),

  // overlay → main
  overlayRegion: (rect: Rect): Promise<CaptureResult | null> =>
    ipcRenderer.invoke('overlay:region', rect),
  overlayFullscreen: (): Promise<CaptureResult | null> => ipcRenderer.invoke('overlay:fullscreen'),
  overlayWindow: (): Promise<CaptureResult | null> => ipcRenderer.invoke('overlay:window'),
  overlayCancel: (): Promise<void> => ipcRenderer.invoke('overlay:cancel'),

  // recording
  stopRecording: (): Promise<void> => ipcRenderer.invoke('record:stop'),
  getRecordState: (): Promise<RecordingState> => ipcRenderer.invoke('record:state'),
  onRecordState: (cb: (s: RecordingState) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: RecordingState): void => cb(s)
    ipcRenderer.on('record:state', listener)
    return () => ipcRenderer.removeListener('record:state', listener)
  },
  onRecordDone: (cb: (r: RecordingResult) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, r: RecordingResult): void => cb(r)
    ipcRenderer.on('record:done', listener)
    return () => ipcRenderer.removeListener('record:done', listener)
  },

  // main → renderer events
  onCaptureDone: (cb: (r: CaptureResult) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, r: CaptureResult): void => cb(r)
    ipcRenderer.on('capture:done', listener)
    return () => ipcRenderer.removeListener('capture:done', listener)
  },
  // Silent history refresh (instant fullscreen) — does NOT raise the window.
  onHistoryChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('history:changed', listener)
    return () => ipcRenderer.removeListener('history:changed', listener)
  }
}

export type SnapApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('snap', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.snap = api
}
