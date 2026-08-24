import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Check, CircleHelp, Eye, EyeOff, HardDriveDownload, Trash2 } from 'lucide-react'
import { clearShots, historySize } from '../shared/shots-db'
import '../editor/index.css'

const ICON_KEY = 'snapski_icon'
const FAB_ENABLED_KEY = 'snapski_fab_enabled'
const AUTOSAVE_KEY = 'snapski_autosave'
type Style = 'minimal' | 'monster'

/** A labelled switch row — the shape both of this page's settings use. */
function ToggleRow({
  on,
  icon,
  title,
  hint,
  onToggle
}: {
  on: boolean
  icon: JSX.Element
  title: string
  hint: string
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      className="flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${on ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}
      >
        {icon}
      </span>
      <span className="flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span
        className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-secondary'}`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </span>
    </button>
  )
}

function OptionCard({
  active,
  title,
  desc,
  img,
  onPick
}: {
  active: boolean
  title: string
  desc: string
  img: string
  onPick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onPick}
      className={`relative flex flex-1 flex-col items-center gap-3 rounded-2xl border p-5 transition-colors ${
        active
          ? 'border-primary bg-primary/10'
          : 'border-border bg-card hover:border-primary/50 hover:bg-accent'
      }`}
    >
      {active && (
        <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-4 w-4" />
        </span>
      )}
      <img src={img} alt={title} className="h-20 w-20 object-contain" />
      <div className="text-center">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
      </div>
    </button>
  )
}

function Options(): JSX.Element {
  const [style, setStyle] = useState<Style>('minimal')
  const [fabEnabled, setFabEnabled] = useState(true)
  const [autosave, setAutosave] = useState(false)
  const [history, setHistory] = useState<{ count: number; bytes: number } | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(ICON_KEY).then((s) => {
      if (s[ICON_KEY] === 'monster' || s[ICON_KEY] === 'minimal') setStyle(s[ICON_KEY])
    })
    chrome.storage.sync
      .get({ [FAB_ENABLED_KEY]: true, [AUTOSAVE_KEY]: false })
      .then((s) => {
        setFabEnabled(s[FAB_ENABLED_KEY] !== false)
        setAutosave(s[AUTOSAVE_KEY] === true)
      })
    void historySize().then(setHistory)
  }, [])

  const wipeHistory = async (): Promise<void> => {
    if (!confirm('Delete every capture SnapSki has kept? This cannot be undone.')) return
    await clearShots()
    setHistory(await historySize())
    markSaved()
  }

  const markSaved = (): void => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
  }

  const pick = (s: Style): void => {
    setStyle(s)
    chrome.storage.local.set({ [ICON_KEY]: s })
    markSaved()
  }

  const toggleFab = (): void => {
    const next = !fabEnabled
    setFabEnabled(next)
    void chrome.storage.sync.set({ [FAB_ENABLED_KEY]: next })
    markSaved()
  }

  const toggleAutosave = (): void => {
    const next = !autosave
    setAutosave(next)
    void chrome.storage.sync.set({ [AUTOSAVE_KEY]: next })
    markSaved()
  }

  const url = (p: string): string => chrome.runtime.getURL(p)

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <div className="mb-1 flex items-center gap-2">
        <img src={url('icons/icon48.png')} className="h-7 w-7" alt="" />
        <h1 className="text-lg font-semibold tracking-tight">SnapSki — settings</h1>
        {saved && <span className="ml-auto text-xs text-primary">Saved ✓</span>}
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Customize how SnapSki appears while you browse.
      </p>

      <div className="mb-6 flex flex-col gap-3">
        <ToggleRow
          on={fabEnabled}
          icon={fabEnabled ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
          title="Floating button on websites"
          hint="Capture controls remain available from the toolbar and keyboard shortcuts when hidden."
          onToggle={toggleFab}
        />
        <ToggleRow
          on={autosave}
          icon={<HardDriveDownload className="h-5 w-5" />}
          title="Save every capture to disk"
          hint="Off by default: shots go straight to the clipboard, and Save on the toast writes the ones you want to keep. Turn this on and every capture also lands in Downloads/SnapSki, filed under today's date — including ones you then annotate, which produces a second file."
          onToggle={toggleAutosave}
        />
      </div>

      <h2 className="mb-3 text-sm font-semibold">Capture history</h2>
      <div className="mb-6 flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <Trash2 className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">
            {history ? `${history.count} capture${history.count === 1 ? '' : 's'} kept in this browser` : 'Counting…'}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {history && history.count > 0
              ? `About ${(history.bytes / (1024 * 1024)).toFixed(1)} MB. Screenshots stay on this device — nothing is uploaded — and the oldest are dropped automatically. Clear them whenever you like.`
              : 'Captures are kept here so the strip in the editor can find them again. Nothing is uploaded.'}
          </span>
        </span>
        <button
          onClick={() => void wipeHistory()}
          disabled={!history || history.count === 0}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
        >
          Clear
        </button>
      </div>

      <h2 className="mb-3 text-sm font-semibold">Icon style</h2>

      <div className="flex gap-3">
        <OptionCard
          active={style === 'minimal'}
          title="Minimal"
          desc="Frame + cursor. Crisp in the toolbar."
          img={url('icons/markp128.png')}
          onPick={() => pick('minimal')}
        />
        <OptionCard
          active={style === 'monster'}
          title="Mascot"
          desc="The SnapSki monster."
          img={url('icons/icon128.png')}
          onPick={() => pick('monster')}
        />
      </div>

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Changes apply instantly across your open tabs.
      </p>

      <button
        onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html?replay=1') })}
        className="mt-6 flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <CircleHelp className="h-4 w-4" />
        Show getting started tutorial
      </button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>
)
