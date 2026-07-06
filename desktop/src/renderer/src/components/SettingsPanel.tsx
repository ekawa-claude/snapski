import { useState, useRef, useEffect } from 'react'
import { X, FolderOpen, Cloud, RefreshCw, Link2Off } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AppSettings, SyncStatus } from '@shared/types'

interface Props {
  settings: AppSettings
  onClose: () => void
  onChange: () => void
}

/** Translate a keyboard event into an Electron accelerator string. */
function toAccelerator(e: React.KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')

  let key = e.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    // modifier-only — not a complete accelerator yet
    return parts.length ? parts.join('+') + '+' : null
  }
  if (key === ' ') key = 'Space'
  else if (key === 'PrintScreen') key = 'PrintScreen'
  else if (key.length === 1) key = key.toUpperCase()
  else if (key.startsWith('Arrow')) key = key.replace('Arrow', '')

  parts.push(key)
  return parts.join('+')
}

export function SettingsPanel({ settings, onClose, onChange }: Props): JSX.Element {
  const [local, setLocal] = useState(settings)
  const [recording, setRecording] = useState<'capture' | 'fullscreen' | null>(null)
  const recRef = useRef<HTMLButtonElement>(null)

  const patch = async (next: Partial<AppSettings>): Promise<void> => {
    const updated = await window.snap.setSettings(next)
    setLocal(updated)
    onChange()
  }

  const chooseFolder = async (): Promise<void> => {
    const folder = await window.snap.chooseFolder()
    if (folder) {
      setLocal((s) => ({ ...s, outputFolder: folder }))
      onChange()
    }
  }

  const onHotkeyKeyDown = (which: 'capture' | 'fullscreen') => (e: React.KeyboardEvent): void => {
    e.preventDefault()
    const acc = toAccelerator(e)
    if (acc && !acc.endsWith('+')) {
      patch({ hotkeys: { ...local.hotkeys, [which]: acc } })
      setRecording(null)
      recRef.current?.blur()
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in"
        onClick={onClose}
      />
      <div className="relative z-10 w-[440px] overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl shadow-black/60 animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <h2 className="text-sm font-semibold">Settings</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-5 p-5">
          {/* Output folder */}
          <Field label="Output folder" hint="Screenshots are saved here as PNG.">
            <div className="flex gap-2">
              <div className="flex h-10 flex-1 items-center truncate rounded-lg border border-input bg-background px-3 text-xs text-muted-foreground">
                {local.outputFolder}
              </div>
              <Button variant="secondary" size="icon" onClick={chooseFolder} title="Choose folder">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </Field>

          {/* Hotkeys */}
          <Field label="Capture hotkey" hint="Opens the region / fullscreen overlay anywhere.">
            <button
              ref={recording === 'capture' ? recRef : undefined}
              onClick={() => setRecording('capture')}
              onBlur={() => setRecording((r) => (r === 'capture' ? null : r))}
              onKeyDown={onHotkeyKeyDown('capture')}
              className={cn(
                'flex h-10 w-full items-center justify-between rounded-lg border bg-background px-3 text-sm transition-colors',
                recording === 'capture'
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'border-input hover:border-ring/50'
              )}
            >
              <kbd className="font-mono text-xs">{local.hotkeys.capture || '—'}</kbd>
              <span className="text-[11px] text-muted-foreground">
                {recording === 'capture' ? 'Press keys…' : 'Click to change'}
              </span>
            </button>
          </Field>

          <Field
            label="Instant fullscreen hotkey"
            hint="Grabs the whole screen instantly — no overlay, no window pop-up. Great for games."
          >
            <button
              ref={recording === 'fullscreen' ? recRef : undefined}
              onClick={() => setRecording('fullscreen')}
              onBlur={() => setRecording((r) => (r === 'fullscreen' ? null : r))}
              onKeyDown={onHotkeyKeyDown('fullscreen')}
              className={cn(
                'flex h-10 w-full items-center justify-between rounded-lg border bg-background px-3 text-sm transition-colors',
                recording === 'fullscreen'
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'border-input hover:border-ring/50'
              )}
            >
              <kbd className="font-mono text-xs">{local.hotkeys.fullscreen || '—'}</kbd>
              <span className="text-[11px] text-muted-foreground">
                {recording === 'fullscreen' ? 'Press keys…' : 'Click to change'}
              </span>
            </button>
          </Field>

          {/* Toggles */}
          <div className="space-y-1">
            <Toggle
              label="Auto-copy to clipboard"
              checked={local.copyToClipboard}
              onChange={(v) => patch({ copyToClipboard: v })}
            />
            <Toggle
              label="Save to output folder"
              checked={local.saveToFolder}
              onChange={(v) => patch({ saveToFolder: v })}
            />
            <Toggle
              label="Launch at startup"
              hint="Starts SnapSki with Windows, silently in the tray."
              checked={local.autoLaunch}
              onChange={(v) => patch({ autoLaunch: v })}
            />
          </div>

          <div className="border-t border-border/60 pt-4">
            <SyncSection />
          </div>
        </div>

        <div className="flex justify-end border-t border-border/60 px-5 py-3.5">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}

function formatBytes(b: number): string {
  if (b <= 0) return '0 MB'
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTime(ts: number): string {
  return ts > 0 ? new Date(ts).toLocaleString() : '—'
}

function SyncSection(): JSX.Element {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [pair, setPair] = useState<{ code: string; qr: string } | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.snap.syncStatus().then(setStatus)
    return window.snap.onSyncStatus(setStatus)
  }, [])

  const refresh = async (): Promise<void> => setStatus(await window.snap.syncStatus())
  const showQr = async (): Promise<void> => setPair(await window.snap.syncPairPayload())

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.snap.syncCreate()
      await refresh()
      await showQr()
    } catch {
      /* register failed — status shows nothing changed */
    } finally {
      setBusy(false)
    }
  }

  const join = async (): Promise<void> => {
    const code = joinCode.trim()
    if (!code) return
    if (await window.snap.syncJoin(code)) {
      setJoinCode('')
      await refresh()
    }
  }

  const paired = status?.paired ?? false

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Cloud className="h-4 w-4 text-primary" />
        <div>
          <div className="text-xs font-semibold text-foreground">Sync</div>
          <div className="text-[11px] text-muted-foreground">
            Favorites &amp; selected shots follow you across devices.
          </div>
        </div>
      </div>

      {!paired ? (
        <div className="space-y-2">
          <Button className="w-full" disabled={busy} onClick={create}>
            {busy ? 'Creating…' : 'Create a sync group'}
          </Button>
          <div className="text-center text-[11px] text-muted-foreground">or join an existing one</div>
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Paste code (snapski://…)"
              className="flex h-9 flex-1 rounded-lg border border-input bg-background px-3 text-xs"
            />
            <Button variant="secondary" disabled={!joinCode.trim()} onClick={join}>
              Join
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Toggle
            label="Enable sync"
            hint={status?.enabled ? undefined : 'Off — the queue is paused.'}
            checked={status?.enabled ?? false}
            onChange={async (v) => {
              await window.snap.syncSetEnabled(v)
              await refresh()
            }}
          />

          <div className="rounded-lg border border-border/60 p-3 text-xs space-y-1.5">
            <StatRow label="Last sync" value={formatTime(status?.lastSyncAt ?? 0)} />
            <StatRow label="Queued" value={String(status?.queued ?? 0)} />
            <StatRow
              label="On server"
              value={
                status && status.serverQuota > 0
                  ? `${formatBytes(status.serverUsed)} of ${formatBytes(status.serverQuota)}`
                  : formatBytes(status?.serverUsed ?? 0)
              }
            />
          </div>

          {status?.storageFull && (
            <p className="text-[11px] text-destructive">
              Group storage is full — new shots won&apos;t upload.
            </p>
          )}
          {status?.lastError && (
            <p className="truncate text-[11px] text-destructive">Sync error: {status.lastError}</p>
          )}

          {!pair ? (
            <Button variant="secondary" className="w-full" onClick={showQr}>
              Show QR to pair a phone
            </Button>
          ) : (
            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <img
                src={pair.qr}
                alt="Pairing QR"
                className="mx-auto h-40 w-40 rounded bg-white p-1"
              />
              <textarea
                readOnly
                value={pair.code}
                onFocus={(e) => e.currentTarget.select()}
                className="h-14 w-full resize-none rounded border border-input bg-background p-2 font-mono text-[10px]"
              />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => navigator.clipboard.writeText(pair.code)}
                >
                  Copy code
                </Button>
                <Button variant="ghost" onClick={() => setPair(null)}>
                  Hide
                </Button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => window.snap.syncNow()}>
              <RefreshCw className={cn('mr-2 h-3.5 w-3.5', status?.running && 'animate-spin')} />
              Sync now
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await window.snap.syncUnpair()
                setPair(null)
                await refresh()
              }}
            >
              <Link2Off className="mr-2 h-3.5 w-3.5" />
              Unpair
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left text-sm transition-colors hover:bg-accent/50"
    >
      <span className="flex flex-col">
        <span className="text-foreground">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <span
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-secondary'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'left-0.5 translate-x-4' : 'left-0.5'
          )}
        />
      </span>
    </button>
  )
}
