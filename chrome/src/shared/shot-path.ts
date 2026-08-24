// Where a saved shot lands. Shared by the service worker (the toast's Save and
// autosave) and the editor's own Download button — they must agree, or annotated
// shots end up in a different folder than the ones you saved straight from the
// toast.
//
// chrome.downloads.download only accepts paths RELATIVE to the Downloads folder:
// absolute paths and `..` are rejected with "Invalid filename". Nested
// subfolders are fine and are created on demand.

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * Day folder for a capture, e.g. `2026-08-24`.
 *
 * Sortable and collision-free on purpose: a short form like `Aug24` reads nicer
 * but sorts alphabetically (Apr, Aug, Dec…) and reuses the same folder name a
 * year later.
 */
export function dayFolder(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * File name for a capture, e.g. `snapski_2026-08-24_13-05-42.png`.
 *
 * Keeps the date even though the folder already carries it: these files get
 * dragged straight into chats, where the folder context is gone.
 */
export function shotName(d = new Date()): string {
  return `snapski_${dayFolder(d)}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.png`
}

/** Downloads-relative path, e.g. `SnapSki/2026-08-24/snapski_2026-08-24_13-05-42.png`. */
export function shotPath(d = new Date()): string {
  return `SnapSki/${dayFolder(d)}/${shotName(d)}`
}
