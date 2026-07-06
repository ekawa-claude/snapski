// Desktop side of SnapSki sync (phase 3c). Mirrors the Android engine but
// bridges the hub's opaque shot ids to the desktop library, whose identity is
// the file *name* in the output folder. A sync map (name <-> id) carries that.
//
// Opt-in, like Android: only files the user marks (Sync action) or favorites
// ever leave the machine. Hub is unchanged — this is pure client policy.

import { app, safeStorage } from 'electron'
import { join } from 'path'
import { randomUUID, createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { readFile, writeFile, unlink } from 'fs/promises'
import { isFavorite, setFavorite } from './favorites'

interface MapEntry {
  id: string
  uploadedSeq: number | null
  wantSync: boolean
  favoriteTs: number
}

interface PendingOp {
  localId: string
  kind: 'favorite' | 'delete'
  shotId: string
  value: boolean | null
  ts: number
}

interface Persisted {
  hubUrl: string | null
  groupId: string | null
  tokenEnc: string | null // base64 of safeStorage-encrypted token (or plaintext fallback)
  tokenPlain: string | null // fallback when safeStorage unavailable
  enabled: boolean
  cursor: number
  lastSyncAt: number
  serverUsed: number
  serverQuota: number
  map: Record<string, MapEntry>
  ops: PendingOp[]
  tombstones: string[]
}

export interface SyncStatus {
  paired: boolean
  enabled: boolean
  running: boolean
  lastSyncAt: number
  queued: number
  serverUsed: number
  serverQuota: number
  storageFull: boolean
  lastError: string | null
  hubUrl: string | null
}

interface ChangeItem {
  seq: number
  kind: string
  shot_id: string
  ts?: number
  value?: boolean
  meta?: {
    id: string
    createdAt?: number
    favorite?: boolean
    source?: string
    editedFrom?: string | null
  }
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex')
}

export class SyncManager {
  private state: Persisted
  private running = false
  private storageFull = false
  private lastError: string | null = null
  private timer: NodeJS.Timeout | null = null
  private eventsGen = 0
  private eventsAbort: AbortController | null = null

  constructor(
    private getOutputFolder: () => string,
    private onStatus: (s: SyncStatus) => void,
    private onLibraryChanged: () => void,
  ) {
    this.state = this.load()
  }

  // --- lifecycle ---------------------------------------------------------

  start(): void {
    if (this.timer) return
    // SSE carries the live load; this is just a slow reconnect safety net.
    this.timer = setInterval(() => void this.sync(), 120_000)
    void this.sync()
    this.startEvents()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stopEvents()
  }

  // --- SSE (live sync while running) -------------------------------------

  private startEvents(): void {
    this.stopEvents()
    if (!this.state.enabled || !this.isPaired()) return
    const gen = ++this.eventsGen
    void this.eventsLoop(gen)
  }

  private stopEvents(): void {
    this.eventsGen++
    this.eventsAbort?.abort()
    this.eventsAbort = null
  }

  /** Hold a /events stream open; a `data: changed` frame triggers a pull. */
  private async eventsLoop(gen: number): Promise<void> {
    let backoff = 1000
    while (gen === this.eventsGen && this.state.enabled && this.isPaired()) {
      const ac = new AbortController()
      this.eventsAbort = ac
      try {
        const res = await fetch(`${this.base()}/events`, {
          headers: { Authorization: this.auth() },
          signal: ac.signal,
        })
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`)
        backoff = 1000
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (gen === this.eventsGen) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let idx: number
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            if (frame.startsWith('data:')) void this.sync()
          }
        }
      } catch {
        /* dropped/aborted — reconnect below unless superseded */
      }
      if (gen !== this.eventsGen) return
      await new Promise((r) => setTimeout(r, backoff))
      backoff = Math.min(backoff * 2, 30_000)
    }
  }

  // --- pairing -----------------------------------------------------------

  /** Create a brand-new group on the hub (this device is the origin). */
  async createGroup(hubUrl: string): Promise<{ code: string }> {
    const url = hubUrl.trim().replace(/\/+$/, '')
    const groupId = randomUUID()
    const token = randomBytes(32).toString('base64')
    const res = await fetch(`${url}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId, token_hash: sha256Hex(token) }),
    })
    if (!res.ok) throw new Error(`register failed: ${res.status}`)
    this.setToken(token)
    this.state.hubUrl = url
    this.state.groupId = groupId
    this.state.enabled = true
    this.persist()
    void this.sync()
    this.startEvents()
    return { code: this.pairCode()! }
  }

  /** Join an existing group by pasting a snapski://pair code. */
  joinByCode(raw: string): boolean {
    const p = parsePairCode(raw)
    if (!p) return false
    this.setToken(p.token)
    this.state.hubUrl = p.hubUrl
    this.state.groupId = p.groupId
    this.state.enabled = true
    this.state.cursor = 0
    this.persist()
    void this.sync()
    this.startEvents()
    return true
  }

  unpair(): void {
    this.stopEvents()
    this.state = this.blank()
    this.persist()
    this.emit()
  }

  setEnabled(on: boolean): void {
    this.state.enabled = on
    this.persist()
    if (on) {
      void this.sync()
      this.startEvents()
    } else {
      this.stopEvents()
      this.emit()
    }
  }

  /** The pairing payload other devices scan/paste. */
  pairCode(): string | null {
    const { hubUrl, groupId } = this.state
    const token = this.getToken()
    if (!hubUrl || !groupId || !token) return null
    const u = encodeURIComponent(hubUrl)
    const t = encodeURIComponent(token)
    return `snapski://pair?v=1&url=${u}&g=${groupId}&t=${t}`
  }

  isPaired(): boolean {
    return !!(this.state.hubUrl && this.state.groupId && this.getToken())
  }

  // --- opt-in intent from the UI ----------------------------------------

  requestSync(names: string[]): void {
    for (const name of names) this.ensureEntry(name, true)
    this.persist()
    void this.sync()
  }

  /** Called after the app flips a file's favorite locally. */
  onLocalFavorite(name: string, fav: boolean): void {
    const e = this.ensureEntry(name, fav || undefined) // favorite=true opts in
    const ts = Date.now()
    e.favoriteTs = ts
    if (fav) e.wantSync = true
    this.enqueueOp({ localId: randomUUID(), kind: 'favorite', shotId: e.id, value: fav, ts })
    this.persist()
    void this.sync()
  }

  /** Called after the app deletes a file locally. */
  onLocalDelete(name: string): void {
    const e = this.state.map[name]
    if (!e) return
    const ts = Date.now()
    if (e.uploadedSeq != null) {
      this.enqueueOp({ localId: randomUUID(), kind: 'delete', shotId: e.id, value: null, ts })
    }
    this.state.tombstones.push(e.id)
    delete this.state.map[name]
    this.persist()
    void this.sync()
  }

  /** Sync state for a file name, for the gallery to badge. */
  entryState(name: string): { wantSync: boolean; uploaded: boolean } | null {
    const e = this.state.map[name]
    if (!e) return null
    return { wantSync: e.wantSync, uploaded: e.uploadedSeq != null }
  }

  status(): SyncStatus {
    const queued =
      Object.values(this.state.map).filter((e) => e.wantSync && e.uploadedSeq == null).length +
      this.state.ops.length
    return {
      paired: this.isPaired(),
      enabled: this.state.enabled,
      running: this.running,
      lastSyncAt: this.state.lastSyncAt,
      queued,
      serverUsed: this.state.serverUsed,
      serverQuota: this.state.serverQuota,
      storageFull: this.storageFull,
      lastError: this.lastError,
      hubUrl: this.state.hubUrl,
    }
  }

  // --- the cycle ---------------------------------------------------------

  async sync(): Promise<void> {
    if (!this.state.enabled || !this.isPaired() || this.running) return
    this.running = true
    this.lastError = null
    this.emit()
    let libraryTouched = false
    try {
      this.storageFull = await this.pushShots()
      await this.pushOps()
      libraryTouched = await this.pull()
      this.state.lastSyncAt = Date.now()
      this.persist()
    } catch (err) {
      const e = err as { status?: number; message?: string }
      if (e.status === 507) this.storageFull = true
      else this.lastError = e.message ?? String(err)
    } finally {
      this.running = false
      this.emit()
      if (libraryTouched) this.onLibraryChanged()
    }
  }

  /** Returns true on quota (507). */
  private async pushShots(): Promise<boolean> {
    const folder = this.getOutputFolder()
    for (const [name, e] of Object.entries(this.state.map)) {
      if (!e.wantSync || e.uploadedSeq != null) continue
      const full = join(folder, name)
      if (!existsSync(full)) continue
      try {
        const buf = await readFile(full)
        const seq = await this.uploadShot(e.id, name, buf)
        e.uploadedSeq = seq
        this.persist()
      } catch (err) {
        const status = (err as { status?: number }).status
        if (status === 507) return true
        if (status === 413) continue
        throw err
      }
    }
    return false
  }

  private async pushOps(): Promise<void> {
    const notUploaded = new Set(
      Object.values(this.state.map).filter((e) => e.wantSync && e.uploadedSeq == null).map((e) => e.id),
    )
    const kept: PendingOp[] = []
    for (const op of this.state.ops) {
      if (op.kind === 'favorite' && notUploaded.has(op.shotId)) {
        kept.push(op)
        continue
      }
      await this.postOp(op)
    }
    this.state.ops = kept
    this.persist()
  }

  /** Returns true if local files changed (so the gallery should reload). */
  private async pull(): Promise<boolean> {
    let cursor = this.state.cursor
    let touched = false
    for (let guard = 0; guard < 100; guard++) {
      const resp = await this.getChanges(cursor)
      for (const c of resp.changes as ChangeItem[]) {
        if (c.kind === 'shot') {
          if (await this.applyRemoteShot(c)) touched = true
        } else if (c.kind === 'favorite') {
          this.applyRemoteFavorite(c.shot_id, c.value ?? true, c.ts ?? 0)
        } else if (c.kind === 'delete') {
          if (await this.applyRemoteDelete(c.shot_id)) touched = true
        }
      }
      cursor = resp.next
      this.state.cursor = cursor
      this.state.serverUsed = resp.usage ?? 0
      this.state.serverQuota = resp.quota ?? 0
      this.persist()
      if (!resp.has_more) break
    }
    return touched
  }

  private nameForId(id: string): string | null {
    for (const [name, e] of Object.entries(this.state.map)) if (e.id === id) return name
    return null
  }

  private async applyRemoteShot(c: ChangeItem): Promise<boolean> {
    const id = c.shot_id
    if (this.state.tombstones.includes(id) || this.nameForId(id)) return false
    const meta = c.meta
    if (!meta) return false
    const name = `Sync-${id}.png`
    const full = join(this.getOutputFolder(), name)
    try {
      const buf = await this.downloadFile(id)
      await writeFile(full, buf)
    } catch {
      return false // deleted server-side before we fetched — skip
    }
    this.state.map[name] = {
      id,
      uploadedSeq: c.seq,
      wantSync: true,
      favoriteTs: c.ts ?? 0,
    }
    if (meta.favorite) setFavorite(name, true)
    this.persist()
    return true
  }

  private applyRemoteFavorite(id: string, value: boolean, ts: number): void {
    const name = this.nameForId(id)
    if (!name) return
    const e = this.state.map[name]
    if (ts >= e.favoriteTs) {
      setFavorite(name, value)
      e.favoriteTs = ts
      this.persist()
    }
  }

  private async applyRemoteDelete(id: string): Promise<boolean> {
    const name = this.nameForId(id)
    this.state.tombstones.push(id)
    if (!name) {
      this.persist()
      return false
    }
    const full = join(this.getOutputFolder(), name)
    try {
      await unlink(full)
    } catch {
      // already gone
    }
    delete this.state.map[name]
    this.persist()
    return true
  }

  // --- hub http ----------------------------------------------------------

  private auth(): string {
    return `Bearer ${this.state.groupId}:${this.getToken()}`
  }

  private base(): string {
    return this.state.hubUrl!.replace(/\/+$/, '')
  }

  private async uploadShot(id: string, name: string, buf: Buffer): Promise<number> {
    const fd = new FormData()
    fd.append(
      'meta',
      JSON.stringify({ id, createdAt: Date.now(), favorite: isFavorite(name), source: 'desktop' }),
    )
    fd.append('file', new Blob([new Uint8Array(buf)], { type: 'image/png' }), `${id}.png`)
    const res = await fetch(`${this.base()}/shots`, {
      method: 'POST',
      headers: { Authorization: this.auth() },
      body: fd,
    })
    if (!res.ok) throw httpErr(res.status, await safeText(res))
    return (await res.json()).seq
  }

  private async postOp(op: PendingOp): Promise<void> {
    const body: Record<string, unknown> = { kind: op.kind, shot_id: op.shotId, ts: op.ts }
    if (op.value != null) body.value = op.value
    const res = await fetch(`${this.base()}/ops`, {
      method: 'POST',
      headers: { Authorization: this.auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw httpErr(res.status, await safeText(res))
  }

  private async getChanges(
    since: number,
  ): Promise<{ changes: ChangeItem[]; next: number; has_more: boolean; usage: number; quota: number }> {
    const res = await fetch(`${this.base()}/changes?since=${since}`, {
      headers: { Authorization: this.auth() },
    })
    if (!res.ok) throw httpErr(res.status, await safeText(res))
    return res.json()
  }

  private async downloadFile(id: string): Promise<Buffer> {
    const res = await fetch(`${this.base()}/shots/${id}/file`, {
      headers: { Authorization: this.auth() },
    })
    if (!res.ok) throw httpErr(res.status, 'download failed')
    return Buffer.from(await res.arrayBuffer())
  }

  // --- helpers -----------------------------------------------------------

  private ensureEntry(name: string, want?: boolean): MapEntry {
    let e = this.state.map[name]
    if (!e) {
      e = { id: shortId(), uploadedSeq: null, wantSync: !!want, favoriteTs: 0 }
      this.state.map[name] = e
    } else if (want) {
      e.wantSync = true
    }
    return e
  }

  private enqueueOp(op: PendingOp): void {
    this.state.ops.push(op)
  }

  private emit(): void {
    this.onStatus(this.status())
  }

  // --- token + persistence ----------------------------------------------

  private setToken(token: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      this.state.tokenEnc = safeStorage.encryptString(token).toString('base64')
      this.state.tokenPlain = null
    } else {
      this.state.tokenPlain = token
      this.state.tokenEnc = null
    }
  }

  private getToken(): string | null {
    if (this.state.tokenEnc) {
      try {
        return safeStorage.decryptString(Buffer.from(this.state.tokenEnc, 'base64'))
      } catch {
        return null
      }
    }
    return this.state.tokenPlain
  }

  private statePath(): string {
    return join(app.getPath('userData'), 'sync-state.json')
  }

  private blank(): Persisted {
    return {
      hubUrl: null,
      groupId: null,
      tokenEnc: null,
      tokenPlain: null,
      enabled: false,
      cursor: 0,
      lastSyncAt: 0,
      serverUsed: 0,
      serverQuota: 0,
      map: {},
      ops: [],
      tombstones: [],
    }
  }

  private load(): Persisted {
    try {
      if (existsSync(this.statePath())) {
        return { ...this.blank(), ...JSON.parse(readFileSync(this.statePath(), 'utf-8')) }
      }
    } catch {
      // corrupt — start fresh
    }
    return this.blank()
  }

  private persist(): void {
    try {
      writeFileSync(this.statePath(), JSON.stringify(this.state), 'utf-8')
    } catch (err) {
      console.error('sync persist failed', err)
    }
  }
}

function httpErr(status: number, message: string): Error & { status: number } {
  const e = new Error(`hub ${status}: ${message}`) as Error & { status: number }
  e.status = status
  return e
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

export function parsePairCode(
  raw: string,
): { hubUrl: string; groupId: string; token: string } | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'snapski:' || u.host !== 'pair') return null
    const hubUrl = u.searchParams.get('url')?.replace(/\/+$/, '') ?? ''
    const groupId = u.searchParams.get('g') ?? ''
    const token = u.searchParams.get('t') ?? ''
    if (!hubUrl || !groupId || !token) return null
    return { hubUrl, groupId, token }
  } catch {
    return null
  }
}
