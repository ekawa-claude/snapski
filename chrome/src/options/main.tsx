import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Check } from 'lucide-react'
import '../editor/index.css'

const ICON_KEY = 'snapski_icon'
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
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(ICON_KEY).then((s) => {
      if (s[ICON_KEY] === 'monster' || s[ICON_KEY] === 'minimal') setStyle(s[ICON_KEY])
    })
  }, [])

  const pick = (s: Style): void => {
    setStyle(s)
    chrome.storage.local.set({ [ICON_KEY]: s })
    setSaved(true)
    setTimeout(() => setSaved(false), 1400)
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
        Icon style for the toolbar and the floating button.
      </p>

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
        Applies instantly. On already-open tabs the floating button updates after you reload the
        page.
      </p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>
)
