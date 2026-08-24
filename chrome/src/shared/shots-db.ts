// The capture history: every shot SnapSki takes, kept in the extension's own
// IndexedDB so the strip works whether or not you ever saved the file.
//
// Why not read the files back from Downloads: chrome.downloads can list what was
// saved, but an extension cannot read those files (that needs the user to flip
// "Allow access to file URLs" by hand), and getFileIcon only yields a 32px file
// type icon — no real thumbnails. And it would only ever show saved shots, while
// the whole point of the strip is to rescue the ones you didn't save.
//
// Both the service worker and the extension's pages use this module directly:
// same extension origin, same database. Content scripts CANNOT — they run on the
// page's origin, so their IndexedDB is the website's. They go through the worker.

const DB_NAME = 'snapski'
const DB_VERSION = 1
const STORE = 'shots'

/** Newest N shots are kept... */
const MAX_SHOTS = 60
/** ...and the whole history is trimmed to roughly this many bytes. */
const MAX_BYTES = 400 * 1024 * 1024

export interface Shot {
  id: string
  /** Capture time, ms since epoch. Also the sort key. */
  ts: number
  /** Full-size PNG data URL. */
  dataUrl: string
  /** Small JPEG data URL for the strip. */
  thumb: string
  width: number
  height: number
  /** Set once this shot has been written to disk, for the strip's badge. */
  saved?: boolean
}

/** A row without the heavy pixels — everything the strip needs to render. */
export type ShotSummary = Omit<Shot, 'dataUrl'>

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('ts', 'ts')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => db.close()
      })
  )
}

/** Rough on-disk cost of a shot — the data URLs dwarf everything else. */
const sizeOf = (s: Shot): number => s.dataUrl.length + s.thumb.length

/** Base64 a blob without FileReader, which service workers don't have. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

/** Strip thumbnails are ~160 CSS px wide; render at 2x for sharp displays. */
const THUMB_W = 320

/** Measure a capture and render the small JPEG the history strip shows. */
export async function describeShot(
  dataUrl: string
): Promise<{ thumb: string; width: number; height: number }> {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const scale = Math.min(1, THUMB_W / bmp.width)
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bmp.width * scale)),
    Math.max(1, Math.round(bmp.height * scale))
  )
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const thumb = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 }))
  const out = { thumb, width: bmp.width, height: bmp.height }
  bmp.close()
  return out
}

/** Take a fresh PNG into the history and return the stored row. */
export async function addShot(dataUrl: string): Promise<Shot> {
  const shot: Shot = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    dataUrl,
    ...(await describeShot(dataUrl))
  }
  await putShot(shot)
  return shot
}

export async function putShot(shot: Shot): Promise<void> {
  await run('readwrite', (st) => st.put(shot))
  await prune()
}

export async function getShot(id: string): Promise<Shot | undefined> {
  return run('readonly', (st) => st.get(id) as IDBRequest<Shot | undefined>)
}

export async function deleteShot(id: string): Promise<void> {
  await run('readwrite', (st) => st.delete(id))
}

export async function clearShots(): Promise<void> {
  await run('readwrite', (st) => st.clear())
}

/** All shots, newest first. Heavy — prefer listShots() for UI. */
async function allShots(): Promise<Shot[]> {
  const rows = await run('readonly', (st) => st.getAll() as IDBRequest<Shot[]>)
  return rows.sort((a, b) => b.ts - a.ts)
}

/** Newest-first summaries for the strip: thumbnails only, no full-size pixels. */
export async function listShots(limit = MAX_SHOTS): Promise<ShotSummary[]> {
  const rows = await allShots()
  return rows.slice(0, limit).map(({ dataUrl: _dataUrl, ...rest }) => rest)
}

export async function historySize(): Promise<{ count: number; bytes: number }> {
  const rows = await allShots()
  return { count: rows.length, bytes: rows.reduce((n, s) => n + sizeOf(s), 0) }
}

/** Mark a shot as written to disk (the strip badges those). */
export async function markSaved(id: string): Promise<void> {
  const shot = await getShot(id)
  if (shot) await run('readwrite', (st) => st.put({ ...shot, saved: true }))
}

/**
 * Drop the oldest shots until the history fits both caps. Screenshots hold
 * whatever was on screen, so this store must not grow without bound.
 */
export async function prune(): Promise<void> {
  const rows = await allShots()
  const doomed: string[] = []
  let bytes = 0
  rows.forEach((shot, i) => {
    bytes += sizeOf(shot)
    if (i >= MAX_SHOTS || bytes > MAX_BYTES) doomed.push(shot.id)
  })
  for (const id of doomed) await deleteShot(id)
}
