import { useState, useRef } from 'react'
import { X, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AppSettings } from '@shared/types'

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
  const [recording, setRecording] = useState(false)
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

  const onHotkeyKeyDown = (e: React.KeyboardEvent): void => {
    e.preventDefault()
    const acc = toAccelerator(e)
    if (acc && !acc.endsWith('+')) {
      patch({ hotkeys: { capture: acc } })
      setRecording(false)
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

          {/* Hotkey */}
          <Field label="Capture hotkey" hint="Opens the region / fullscreen overlay anywhere.">
            <button
              ref={recRef}
              onClick={() => setRecording(true)}
              onBlur={() => setRecording(false)}
              onKeyDown={onHotkeyKeyDown}
              className={cn(
                'flex h-10 w-full items-center justify-between rounded-lg border bg-background px-3 text-sm transition-colors',
                recording ? 'border-primary ring-2 ring-primary/30' : 'border-input hover:border-ring/50'
              )}
            >
              <kbd className="font-mono text-xs">{local.hotkeys.capture || '—'}</kbd>
              <span className="text-[11px] text-muted-foreground">
                {recording ? 'Press keys…' : 'Click to change'}
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
        </div>

        <div className="flex justify-end border-t border-border/60 px-5 py-3.5">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
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
