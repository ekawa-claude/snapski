import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Camera, ScrollText, Loader2, Pencil, Settings } from 'lucide-react'
import '../editor/index.css'

type Mode = 'visible' | 'full'

function Popup(): JSX.Element {
  const [busy, setBusy] = useState<Mode | null>(null)
  const [error, setError] = useState<string | null>(null)

  const capture = async (mode: Mode): Promise<void> => {
    setError(null)
    setBusy(mode)
    try {
      const res = await chrome.runtime.sendMessage({ type: 'capture', mode })
      if (res?.ok) {
        window.close() // editor tab is opening; nothing left to do here
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

      {error && <p className="mt-2 px-1 text-[11px] text-destructive">{error}</p>}

      <p className="mt-3 px-1 text-[10px] leading-relaxed text-muted-foreground">
        Tip: <kbd className="rounded bg-secondary px-1 py-0.5 text-foreground">Alt+Shift+S</kbd> grabs
        the visible area, <kbd className="rounded bg-secondary px-1 py-0.5 text-foreground">Alt+R</kbd> picks
        a region. Rebind at <span className="text-foreground">chrome://extensions/shortcuts</span>.
      </p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
)
