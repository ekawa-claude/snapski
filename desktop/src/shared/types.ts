// Shared types between main, preload and renderer.

export type CaptureKind = 'region' | 'fullscreen' | 'window'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: number
  /** Device pixel bounds (already multiplied by scaleFactor). */
  bounds: Rect
  scaleFactor: number
}

export type CaptureMode = 'screenshot' | 'video'

export interface AppSettings {
  outputFolder: string
  hotkeys: {
    capture: string // global accelerator that opens the capture overlay
    fullscreen: string // global accelerator for an instant, no-overlay fullscreen screenshot
  }
  copyToClipboard: boolean
  saveToFolder: boolean
  /** Whether the capture hotkey/overlay takes a screenshot or records video. */
  captureMode: CaptureMode
  /** Start SnapSki automatically when Windows starts (silently, into the tray). */
  autoLaunch: boolean
}

export interface RecordingState {
  active: boolean
  kind?: CaptureKind
}

export interface RecordingResult {
  path: string
  ok: boolean
}

export interface CaptureResult {
  /** PNG data URL of the captured (and optionally cropped) image. */
  dataUrl: string
  /** Absolute path the PNG was saved to, if saving is enabled. */
  savedPath: string | null
  width: number
  height: number
}

export interface HistoryItem {
  path: string
  name: string
  mtime: number
  type: 'image' | 'video'
  /** Small thumbnail data URL, or null if it couldn't be generated. */
  thumb: string | null
  /** Starred in the gallery. */
  favorite: boolean
}

export interface VideoExportOpts {
  path: string
  /** Trim start/end in seconds (omit for no trim). */
  inSec?: number
  outSec?: number
  /**
   * Static blur rectangle in the video's natural pixels (omit for none).
   * start/end (seconds, absolute clip time) restrict the blur to a segment;
   * omit them to blur the whole (possibly trimmed) clip.
   */
  blur?: {
    x: number
    y: number
    width: number
    height: number
    start?: number
    end?: number
  } | null
}

export interface VideoExportResult {
  ok: boolean
  path: string
}

export const DEFAULT_HOTKEY = 'PrintScreen'
export const DEFAULT_FULLSCREEN_HOTKEY = 'Alt+PrintScreen'
