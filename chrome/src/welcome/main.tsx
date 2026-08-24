import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Crop,
  Download,
  Eye,
  EyeOff,
  Focus,
  Highlighter,
  Keyboard,
  MonitorUp,
  MousePointer2,
  ScanLine,
  Sparkles
} from 'lucide-react'
import '../editor/index.css'

const FAB_ENABLED_KEY = 'snapski_fab_enabled'

const steps = [
  {
    eyebrow: 'Capture',
    title: 'Grab exactly what matters',
    text: 'Use the floating button, toolbar popup, or a keyboard shortcut. Region, visible area, and full-page capture all land on your clipboard right away — paste them straight into a chat.'
  },
  {
    eyebrow: 'Annotate',
    title: 'Make the point instantly',
    text: 'Every shot offers Annotate and Save on the way past. Open the editor for arrows, numbered steps, text, blur, highlights and spotlight — everything stays editable until you copy or download the result.'
  },
  {
    eyebrow: 'Make it yours',
    title: 'Fast when you need it, invisible when you don’t',
    text: 'Drag the floating button anywhere, hide it completely, or work only from the toolbar and keyboard shortcuts.'
  }
]

function CapturePreview(): JSX.Element {
  return (
    <div className="relative mx-auto h-[330px] max-w-[520px] overflow-hidden rounded-3xl border border-white/10 bg-[#101017] shadow-2xl shadow-black/40">
      <div className="flex h-10 items-center gap-2 border-b border-white/10 bg-white/[.03] px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <div className="ml-3 h-5 flex-1 rounded-md bg-white/[.06]" />
      </div>
      <div className="grid h-[290px] grid-cols-[1fr_150px] gap-5 p-6">
        <div className="space-y-3">
          <div className="h-5 w-2/3 rounded bg-white/10" />
          <div className="h-3 w-full rounded bg-white/[.06]" />
          <div className="h-3 w-5/6 rounded bg-white/[.06]" />
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="h-24 rounded-xl bg-gradient-to-br from-primary/30 to-sky-400/10" />
            <div className="h-24 rounded-xl bg-white/[.05]" />
          </div>
        </div>
        <div className="self-center rounded-2xl border border-white/10 bg-[#181820]/95 p-2 shadow-2xl">
          {[
            [Crop, 'Region'],
            [ScanLine, 'Visible area'],
            [MonitorUp, 'Full page']
          ].map(([Icon, label]) => {
            const ToolIcon = Icon as typeof Crop
            return (
              <div key={label as string} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs text-white/85 first:bg-primary first:text-white">
                <ToolIcon className="h-4 w-4" />
                {label as string}
              </div>
            )
          })}
        </div>
      </div>
      <div className="absolute bottom-5 right-5 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-indigo-700 shadow-xl shadow-primary/40">
        <MousePointer2 className="h-6 w-6 text-white" />
      </div>
    </div>
  )
}

function AnnotatePreview(): JSX.Element {
  const tools = [MousePointer2, Crop, Highlighter, Focus]
  return (
    <div className="relative mx-auto h-[330px] max-w-[520px] overflow-hidden rounded-3xl border border-white/10 bg-[#111118] shadow-2xl shadow-black/40">
      <div className="absolute left-4 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border border-white/10 bg-[#1a1a23]/95 p-2 shadow-xl">
        {tools.map((Icon, index) => (
          <span key={index} className={`flex h-9 w-9 items-center justify-center rounded-xl ${index === 0 ? 'bg-primary text-white' : 'text-white/55'}`}>
            <Icon className="h-4 w-4" />
          </span>
        ))}
      </div>
      <div className="absolute inset-5 left-20 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-100 to-slate-300">
        <div className="absolute left-7 top-7 h-5 w-40 rounded bg-slate-700/20" />
        <div className="absolute left-7 top-16 h-3 w-56 rounded bg-slate-700/10" />
        <div className="absolute bottom-10 left-8 h-28 w-40 rounded-xl bg-sky-300/50" />
        <div className="absolute bottom-12 right-8 h-32 w-36 rounded-xl bg-violet-300/50" />
        <div className="absolute right-16 top-12 rounded-xl border-[3px] border-rose-500 px-4 py-2 text-sm font-bold text-slate-800 shadow-lg">
          Ship this
        </div>
        <div className="absolute bottom-[104px] right-[92px] h-20 w-1 origin-bottom -rotate-[52deg] rounded-full bg-rose-500 shadow-lg after:absolute after:-left-[5px] after:-top-1 after:h-3 after:w-3 after:rotate-45 after:border-l-[4px] after:border-t-[4px] after:border-rose-500" />
        <div className="absolute bottom-8 right-[158px] flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-white shadow-lg ring-4 ring-white/80">
          1
        </div>
      </div>
      <div className="absolute bottom-3 right-5 flex gap-2">
        <span className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow-lg"><Copy className="h-3.5 w-3.5" /> Copy</span>
        <span className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#1a1a23] px-3 py-2 text-xs font-semibold text-white shadow-lg"><Download className="h-3.5 w-3.5" /> Download</span>
      </div>
    </div>
  )
}

function CustomizePreview({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }): JSX.Element {
  return (
    <div className="mx-auto max-w-[520px] space-y-3 rounded-3xl border border-white/10 bg-[#111118] p-5 shadow-2xl shadow-black/40">
      <button onClick={onToggle} aria-pressed={enabled} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[.035] p-4 text-left transition-colors hover:bg-white/[.06]">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${enabled ? 'bg-primary/20 text-primary' : 'bg-white/[.06] text-white/45'}`}>
          {enabled ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">Floating button</span>
          <span className="mt-1 block text-xs text-white/45">Show quick capture controls on websites</span>
        </span>
        <span className={`relative h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-white/10'}`}>
          <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </span>
      </button>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
          <Keyboard className="mb-3 h-5 w-5 text-primary" />
          <div className="text-xs font-semibold">Visible area</div>
          <kbd className="mt-2 inline-block rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/70">Alt + Shift + S</kbd>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
          <Crop className="mb-3 h-5 w-5 text-primary" />
          <div className="text-xs font-semibold">Select region</div>
          <kbd className="mt-2 inline-block rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/70">Alt + R</kbd>
        </div>
      </div>
      <p className="px-1 text-[11px] leading-relaxed text-white/40">
        Screen capture stays in the floating menu because Chrome requires a click on the current page before showing its screen picker.
      </p>
    </div>
  )
}

function Welcome(): JSX.Element {
  const [step, setStep] = useState(0)
  const [fabEnabled, setFabEnabled] = useState(true)

  useEffect(() => {
    chrome.storage.sync.get({ [FAB_ENABLED_KEY]: true }).then((s) => {
      setFabEnabled(s[FAB_ENABLED_KEY] !== false)
    })
  }, [])

  const toggleFab = (): void => {
    const next = !fabEnabled
    setFabEnabled(next)
    void chrome.storage.sync.set({ [FAB_ENABLED_KEY]: next })
  }

  const finish = async (): Promise<void> => {
    const tab = await chrome.tabs.getCurrent()
    if (tab?.id != null) await chrome.tabs.remove(tab.id)
    else window.close()
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute left-1/2 top-[-280px] h-[560px] w-[760px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-7 sm:px-10">
        <header className="flex items-center gap-3">
          <img src={chrome.runtime.getURL('icons/icon48.png')} className="h-8 w-8" alt="" />
          <div>
            <div className="text-sm font-semibold tracking-tight">SnapSki</div>
            <div className="text-[10px] uppercase tracking-[.18em] text-muted-foreground">Getting started</div>
          </div>
          <span className="ml-auto rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-medium text-primary">
            About 60 seconds
          </span>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[.85fr_1.15fr] lg:gap-16">
          <div className="max-w-lg">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-primary">
              <Sparkles className="h-4 w-4" />
              {steps[step].eyebrow}
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{steps[step].title}</h1>
            <p className="mt-5 text-base leading-7 text-muted-foreground">{steps[step].text}</p>

            <div className="mt-8 flex items-center gap-3">
              {step > 0 && (
                <button onClick={() => setStep((s) => s - 1)} className="flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-accent">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
              )}
              {step < steps.length - 1 ? (
                <button onClick={() => setStep((s) => s + 1)} className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:scale-[1.02]">
                  Next <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button onClick={() => void finish()} className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:scale-[1.02]">
                  Start capturing <Check className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="mt-8 flex gap-2" aria-label={`Step ${step + 1} of ${steps.length}`}>
              {steps.map((_, index) => (
                <button key={index} onClick={() => setStep(index)} aria-label={`Go to step ${index + 1}`} className={`h-1.5 rounded-full transition-all ${index === step ? 'w-9 bg-primary' : 'w-4 bg-white/15 hover:bg-white/30'}`} />
              ))}
            </div>
          </div>

          <div>
            {step === 0 && <CapturePreview />}
            {step === 1 && <AnnotatePreview />}
            {step === 2 && <CustomizePreview enabled={fabEnabled} onToggle={toggleFab} />}
          </div>
        </section>
      </div>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Welcome />
  </React.StrictMode>
)
