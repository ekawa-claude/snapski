import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Camera, ScrollText, Loader2, Pencil, Settings, Crop, Eye, EyeOff, CircleHelp } from 'lucide-react'
import { listShots, type ShotSummary } from '../shared/shots-db'
import '../editor/index.css'

type Mode = 'visible' | 'full'
const FAB_ENABLED_KEY = 'snapski_fab_enabled'

function Popup(): JSX.Element {
  const [busy, setBusy] = useState<Mode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fabEnabled, setFabEnabled] = useState(true)
  const [recent, setRecent] = useState<ShotSummary[]>([])

  useEffect(() => {
    chrome.storage.sync.get({ [FAB_ENABLED_KEY]: true }).then((s) => {
      setFabEnabled(s[FAB_ENABLED_KEY] !== false)
    })
    void listShots(6).then(setRecent)
  }, [])

  /** Open the editor — on a specific capture, or on the newest one. */
  const openEditor = (id?: string): void => {
    const url = chrome.runtime.getURL(`editor.html${id ? `?id=${id}` : ''}`)
    void chrome.tabs.create({ url })
    window.close()
  }

  const toggleFab = (): void => {
    const next = !fabEnabled
    setFabEnabled(next)
    void chrome.storage.sync.set({ [FAB_ENABLED_KEY]: next })
  }

  const openTutorial = (): void => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html?replay=1') })
    window.close()
  }

  /** Region selection runs in the page's content script — hand off and close. */
  const startRegion = async (): Promise<void> => {
    setError(null)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('No active tab')
      await chrome.tabs.sendMessage(tab.id, { type: 'snapski-start-region' })
      window.close()
    } catch {
      setError("Can't select a region on this page (reload it and try again)")
    }
  }

  const capture = async (mode: Mode): Promise<void> => {
    setError(null)
    setBusy(mode)
    try {
      const res = await chrome.runtime.sendMessage({ type: 'capture', mode })
      if (res?.ok) {
        window.close() // the toast takes over in the page; nothing left to do here
      } else {
        setError(res?.error ?? 'Capture failed')
        setBusy(null)
      }
    } catch (e) {
      setError(String(e))
      setBusy(null)
    }
  }

  return (
    <div className="w-[260px] bg-background p-3 text-foreground">
      <div className="mb-3 flex items-center gap-2 px-1">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/30">
          <Pencil className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">SnapSki</span>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          title="Settings"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={() => capture('visible')}
          disabled={busy != null}
          className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-accent disabled:opacity-50"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground group-hover:bg-primary group-hover:text-primary-foreground">
            {busy === 'visible' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </span>
          <span>
            <span className="block text-sm font-medium">Visible area</span>
            <span className="block text-[11px] text-muted-foreground">What you see now</span>
          </span>
        </button>

        <button
          onClick={() => startRegion()}
          disabled={busy != null}
          className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-accent disabled:opacity-50"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground group-hover:bg-primary group-hover:text-primary-foreground">
            <Crop className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-medium">Region</span>
            <span className="block text-[11px] text-muted-foreground">Drag to select an area</span>
          </span>
        </button>

        <button
          onClick={() => capture('full')}
          disabled={busy != null}
          className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-accent disabled:opacity-50"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground group-hover:bg-primary group-hover:text-primary-foreground">
            {busy === 'full' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScrollText className="h-4 w-4" />}
          </span>
          <span>
            <span className="block text-sm font-medium">Full page</span>
            <span className="block text-[11px] text-muted-foreground">Scroll &amp; stitch</span>
          </span>
        </button>
      </div>

      {recent.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-2 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recent
            </span>
            <button
              onClick={() => openEditor()}
              className="ml-auto text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Open editor
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {recent.map((s) => (
              <button
                key={s.id}
                onClick={() => openEditor(s.id)}
                title={`${s.width}×${s.height} — open in the editor`}
                className="h-[42px] w-[70px] shrink-0 overflow-hidden rounded-md border border-border/70 transition-colors hover:border-primary"
              >
                <img src={s.thumb} alt="" className="h-full w-full bg-black/40 object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={toggleFab}
        aria-pressed={fabEnabled}
        className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {fabEnabled ? <Eye className="h-4 w-4 text-primary" /> : <EyeOff className="h-4 w-4" />}
        <span className="flex-1">Floating button</span>
        <span
          className={`relative h-5 w-9 rounded-full transition-colors ${fabEnabled ? 'bg-primary' : 'bg-secondary'}`}
          aria-hidden="true"
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${fabEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
          />
        </span>
      </button>

      {error && <p className="mt-2 px-1 text-[11px] text-destructive">{error}</p>}

      <p className="mt-3 px-1 text-[10px] leading-relaxed text-muted-foreground">
        Tip: <kbd className="rounded bg-secondary px-1 py-0.5 text-foreground">Alt+Shift+S</kbd> grabs
        the visible area, <kbd className="rounded bg-secondary px-1 py-0.5 text-foreground">Alt+R</kbd> picks
        a region. Rebind at <span className="text-foreground">chrome://extensions/shortcuts</span>.
      </p>

      <button
        onClick={openTutorial}
        className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <CircleHelp className="h-3.5 w-3.5" />
        How SnapSki works
      </button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
)
