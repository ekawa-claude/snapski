// Capture payload handed from the background service worker to the editor page.
// Mirrors the desktop SnapSki CaptureResult, trimmed to what the browser needs.
export interface CaptureResult {
  /** PNG data URL of the captured (and optionally cropped/stitched) image. */
  dataUrl: string
  /** Unused in the extension; kept so the ported editor type-checks unchanged. */
  savedPath?: string | null
  width?: number
  height?: number
}
