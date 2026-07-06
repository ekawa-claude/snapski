import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppSettings,
  CaptureResult,
  HistoryItem,
  RecordingResult,
  RecordingState,
  Rect,
  SyncStatus,
  UpdateStatus,
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

  // history / gallery
  listHistory: (): Promise<HistoryItem[]> => ipcRenderer.invoke('history:list'),
  openHistory: (path: string): Promise<CaptureResult> => ipcRenderer.invoke('history:open', path),
  setFavorite: (name: string, fav: boolean): Promise<void> =>
    ipcRenderer.invoke('history:favorite', name, fav),
  deleteHistory: (path: string): Promise<boolean> => ipcRenderer.invoke('history:delete', path),
  copyPath: (path: string): Promise<void> => ipcRenderer.invoke('history:copyPath', path),
  copyFile: (path: string): Promise<boolean> => ipcRenderer.invoke('history:copyFile', path),
  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke('history:showInFolder', path),
  importImages: (paths?: string[]): Promise<number> =>
    ipcRenderer.invoke('history:import', paths),
  /** Absolute path for a File dropped onto the window (drag&drop import). */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  // hotkeys that failed to register (taken by another app)
  getHotkeyFailures: (): Promise<string[]> => ipcRenderer.invoke('hotkeys:failures'),
  onHotkeysFailed: (cb: (keys: string[]) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, keys: string[]): void => cb(keys)
    ipcRenderer.on('hotkeys:failed', listener)
    return () => ipcRenderer.removeListener('hotkeys:failed', listener)
  },

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

  // auto-update
  onUpdateStatus: (cb: (s: UpdateStatus) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: UpdateStatus): void => cb(s)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('update:check'),

  // window controls
  winMinimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
  winToggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('win:toggleMaximize'),
  winClose: (): Promise<void> => ipcRenderer.invoke('win:close'),
  winSetFullScreen: (on: boolean): Promise<boolean> =>
    ipcRenderer.invoke('win:setFullScreen', on),

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
  },

  // sync (phase 3c)
  syncStatus: (): Promise<SyncStatus | null> => ipcRenderer.invoke('sync:status'),
  syncCreate: (): Promise<SyncStatus | null> => ipcRenderer.invoke('sync:create'),
  syncJoin: (code: string): Promise<boolean> => ipcRenderer.invoke('sync:join', code),
  syncUnpair: (): Promise<void> => ipcRenderer.invoke('sync:unpair'),
  syncSetEnabled: (on: boolean): Promise<void> => ipcRenderer.invoke('sync:setEnabled', on),
  syncRequest: (names: string[]): Promise<void> => ipcRenderer.invoke('sync:request', names),
  syncNow: (): Promise<void> => ipcRenderer.invoke('sync:now'),
  syncPairPayload: (): Promise<{ code: string; qr: string } | null> =>
    ipcRenderer.invoke('sync:pairPayload'),
  onSyncStatus: (cb: (s: SyncStatus) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, s: SyncStatus): void => cb(s)
    ipcRenderer.on('sync:status', listener)
    return () => ipcRenderer.removeListener('sync:status', listener)
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
