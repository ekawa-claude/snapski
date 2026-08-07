import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Check, CircleHelp, Eye, EyeOff } from 'lucide-react'
import '../editor/index.css'

const ICON_KEY = 'snapski_icon'
const FAB_ENABLED_KEY = 'snapski_fab_enabled'
type Style = 'minimal' | 'monster'

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
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(ICON_KEY).then((s) => {
      if (s[ICON_KEY] === 'monster' || s[ICON_KEY] === 'minimal') setStyle(s[ICON_KEY])
    })
    chrome.storage.sync.get({ [FAB_ENABLED_KEY]: true }).then((s) => {
      setFabEnabled(s[FAB_ENABLED_KEY] !== false)
    })
  }, [])

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

      <button
        onClick={toggleFab}
        aria-pressed={fabEnabled}
        className="mb-6 flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent"
      >
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${fabEnabled ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
          {fabEnabled ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">Floating button on websites</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Capture controls remain available from the toolbar and keyboard shortcuts when hidden.
          </span>
        </span>
        <span
          className={`relative h-6 w-11 rounded-full transition-colors ${fabEnabled ? 'bg-primary' : 'bg-secondary'}`}
          aria-hidden="true"
        >
          <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${fabEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </span>
      </button>

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
