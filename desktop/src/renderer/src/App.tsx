import { useEffect, useState, useCallback } from 'react'
import {
  Camera,
  Settings as SettingsIcon,
  FolderOpen,
  Check,
  Copy,
  ImageIcon,
  Pencil,
  Video,
  Square,
  CircleDot,
  Play,
  Scissors
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AppSettings, CaptureMode, CaptureResult, HistoryItem } from '@shared/types'
import { SettingsPanel } from './components/SettingsPanel'
import { WindowControls } from './components/WindowControls'
import { EditorView } from './components/editor/EditorView'
import { VideoEditorView } from './components/video/VideoEditorView'

function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [flash, setFlash] = useState(false)
  const [editing, setEditing] = useState<CaptureResult | null>(null)
  const [editingVideo, setEditingVideo] = useState<HistoryItem | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)

  const mode: CaptureMode = settings?.captureMode ?? 'screenshot'

  const refreshHistory = useCallback(async () => {
    setHistory(await window.snap.listHistory())
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }, [])

  useEffect(() => {
    window.snap.getSettings().then(setSettings)
    window.snap.getRecordState().then((s) => setRecording(s.active))
    refreshHistory()
    const offCapture = window.snap.onCaptureDone((r) => {
      setFlash(true)
      setTimeout(() => setFlash(false), 450)
      showToast(`Copied to clipboard & saved · ${r.width}×${r.height}`)
      // a new capture supersedes whatever was being edited
      setEditing(null)
      setEditingVideo(null)
      refreshHistory()
    })
    const offRecState = window.snap.onRecordState((s) => setRecording(s.active))
    const offRecDone = window.snap.onRecordDone((r) => {
      showToast(r.ok ? 'Recording saved & copied to clipboard' : 'Recording failed')
      refreshHistory()
    })
    return () => {
      offCapture()
      offRecState()
      offRecDone()
    }
  }, [refreshHistory, showToast])

  const setMode = useCallback(async (m: CaptureMode) => {
    setSettings(await window.snap.setSettings({ captureMode: m }))
  }, [])

  const refreshSettings = useCallback(async () => {
    setSettings(await window.snap.getSettings())
  }, [])

  const openInEditor = useCallback(async (path: string) => {
    const cap = await window.snap.openHistory(path)
    setEditing(cap)
  }, [])

  const closeEditor = useCallback(() => {
    setEditing(null)
    refreshHistory()
  }, [refreshHistory])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-border/60 pl-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30">
            <Camera className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-sm font-semibold tracking-tight">SnapSki</span>
        </div>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="no-drag mr-1"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </Button>
          <WindowControls />
        </div>
      </header>

      {/* Body */}
      <main className="relative flex flex-1 overflow-hidden">
        {/* Left: capture controls */}
        <section className="flex w-[380px] shrink-0 flex-col gap-6 border-r border-border/60 p-7">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Capture</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Press{' '}
              <kbd className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                {settings?.hotkeys.capture ?? 'PrintScreen'}
              </kbd>{' '}
              {mode === 'video'
                ? 'to pick a region or screen — press it again to stop recording.'
                : 'anywhere, then drag a region or pick fullscreen.'}
            </p>
          </div>

          {/* mode toggle */}
          <div className="flex gap-1 rounded-xl border border-border/60 bg-card/40 p-1">
            <ModeTab
              active={mode === 'screenshot'}
              disabled={recording}
              onClick={() => setMode('screenshot')}
              icon={<Camera className="h-3.5 w-3.5" />}
              label="Screenshot"
            />
            <ModeTab
              active={mode === 'video'}
              disabled={recording}
              onClick={() => setMode('video')}
              icon={<Video className="h-3.5 w-3.5" />}
              label="Video"
            />
          </div>

          {recording ? (
            <Button
              size="lg"
              variant="destructive"
              className="w-full"
              onClick={() => window.snap.stopRecording()}
            >
              <Square className="h-4 w-4 fill-current" />
              Stop recording
            </Button>
          ) : (
            <Button size="lg" className="w-full" onClick={() => window.snap.triggerCapture()}>
              {mode === 'video' ? <CircleDot className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
              {mode === 'video' ? 'Start recording' : 'New screenshot'}
            </Button>
          )}

          <div className="space-y-2.5 rounded-xl border border-border/60 bg-card/40 p-4">
            <Row
              label="Auto-copy to clipboard"
              on={!!settings?.copyToClipboard}
              icon={<Copy className="h-3.5 w-3.5" />}
            />
            <Row
              label="Save to folder"
              on={!!settings?.saveToFolder}
              icon={<ImageIcon className="h-3.5 w-3.5" />}
            />
            <button
              className="no-drag mt-1 flex w-full items-center gap-2 truncate rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => window.snap.openFolder()}
              title={settings?.outputFolder}
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{settings?.outputFolder ?? '—'}</span>
            </button>
          </div>
        </section>

        {/* Right: history */}
        <section className="preview-surface relative flex flex-1 flex-col overflow-hidden">
          <div
            className={cn(
              'pointer-events-none absolute inset-0 z-10 bg-primary/10 opacity-0 transition-opacity',
              flash && 'opacity-100'
            )}
          />

          {/* transient toast */}
          <div
            className={cn(
              'pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2 transition-all',
              toast ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
            )}
          >
            <div className="flex items-center gap-2 rounded-full border border-border/70 bg-popover/90 px-3.5 py-1.5 text-xs font-medium shadow-xl backdrop-blur">
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              {toast ?? ''}
            </div>
          </div>

          {history.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-dashed border-border bg-card/30">
                <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">No captures yet</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Press {settings?.hotkeys.capture ?? 'PrintScreen'} or “New capture”
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between px-7 pb-3 pt-6">
                <h2 className="text-sm font-semibold tracking-tight">Recent</h2>
                <span className="text-xs text-muted-foreground">{history.length} in folder</span>
              </div>
              <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto px-7 pb-7 xl:grid-cols-3">
                {history.map((item) => (
                  <button
                    key={item.path}
                    onClick={() =>
                      item.type === 'video' ? setEditingVideo(item) : openInEditor(item.path)
                    }
                    title={`${item.name} — click to ${item.type === 'video' ? 'edit clip' : 'annotate'}`}
                    className="group relative aspect-video overflow-hidden rounded-xl border border-border/70 bg-card shadow-lg shadow-black/30 transition-all hover:ring-2 hover:ring-primary/60"
                  >
                    {item.thumb ? (
                      <img src={item.thumb} alt={item.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        {item.type === 'video' ? (
                          <Video className="h-6 w-6 text-muted-foreground/40" />
                        ) : (
                          <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                        )}
                      </div>
                    )}
                    {item.type === 'video' && (
                      <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                        <Play className="h-2.5 w-2.5 fill-current" /> Video
                      </span>
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="flex items-center gap-1.5 rounded-lg bg-popover/90 px-2.5 py-1.5 text-xs font-medium shadow-lg backdrop-blur">
                        {item.type === 'video' ? (
                          <>
                            <Scissors className="h-3.5 w-3.5" /> Edit clip
                          </>
                        ) : (
                          <>
                            <Pencil className="h-3.5 w-3.5" /> Annotate
                          </>
                        )}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      {showSettings && settings && (
        <SettingsPanel
          settings={settings}
          onClose={() => setShowSettings(false)}
          onChange={refreshSettings}
        />
      )}

      {editing && <EditorView capture={editing} onClose={closeEditor} />}

      {editingVideo && (
        <VideoEditorView
          item={editingVideo}
          onClose={() => {
            setEditingVideo(null)
            refreshHistory()
          }}
        />
      )}
    </div>
  )
}

function ModeTab({
  active,
  disabled,
  onClick,
  icon,
  label
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
        active
          ? 'bg-secondary text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function Row({
  label,
  on,
  icon
}: {
  label: string
  on: boolean
  icon: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-medium',
          on ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary text-muted-foreground'
        )}
      >
        {on ? 'On' : 'Off'}
      </span>
    </div>
  )
}

export default App
