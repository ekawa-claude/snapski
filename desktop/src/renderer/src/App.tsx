import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  Camera,
  Settings as SettingsIcon,
  FolderOpen,
  Check,
  Copy,
  ImageIcon,
  ImagePlus,
  Link2,
  Pencil,
  Star,
  Trash2,
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
import { GalleryViewer } from './components/GalleryViewer'

interface CtxMenu {
  x: number
  y: number
  item: HistoryItem
}

function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [flash, setFlash] = useState(false)
  const [editing, setEditing] = useState<CaptureResult | null>(null)
  const [editingVideo, setEditingVideo] = useState<HistoryItem | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [filterFav, setFilterFav] = useState(false)
  const [viewerPath, setViewerPath] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [dropHint, setDropHint] = useState(false)

  const mode: CaptureMode = settings?.captureMode ?? 'screenshot'

  const visible = useMemo(
    () => (filterFav ? history.filter((h) => h.favorite) : history),
    [history, filterFav]
  )
  const favCount = useMemo(() => history.filter((h) => h.favorite).length, [history])
  const viewerIndex = viewerPath ? visible.findIndex((h) => h.path === viewerPath) : -1

  // Latest filter state, readable from the (never re-created) capture handler.
  const filterFavRef = useRef(filterFav)
  filterFavRef.current = filterFav

  const refreshHistory = useCallback(async () => {
    const list = await window.snap.listHistory()
    setHistory(list)
    return list
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }, [])

  useEffect(() => {
    window.snap.getSettings().then(setSettings)
    window.snap.getRecordState().then((s) => setRecording(s.active))
    refreshHistory()
    const offCapture = window.snap.onCaptureDone(async (r) => {
      setFlash(true)
      setTimeout(() => setFlash(false), 450)
      showToast(`Copied to clipboard & saved · ${r.width}×${r.height}`)
      // a new capture supersedes whatever was being edited
      setEditing(null)
      setEditingVideo(null)
      const list = await refreshHistory()
      // If the gallery viewer was already open, follow the fresh shot; if it
      // wasn't (we're on the home screen), stay put. Only follow when the new
      // capture is actually in the current filter, so the fav tab doesn't blank.
      if (r.savedPath) {
        const inView = (filterFavRef.current ? list.filter((h) => h.favorite) : list).some(
          (h) => h.path === r.savedPath
        )
        setViewerPath((prev) => (prev && inView ? r.savedPath : prev))
      }
    })
    // Instant fullscreen: refresh the grid in place, without raising the window.
    const offHistory = window.snap.onHistoryChanged(() => refreshHistory())
    const offRecState = window.snap.onRecordState((s) => setRecording(s.active))
    const offRecDone = window.snap.onRecordDone((r) => {
      showToast(r.ok ? 'Recording saved & copied to clipboard' : 'Recording failed')
      refreshHistory()
    })
    // Surface hotkeys another app grabbed before us.
    const warnHotkeys = (keys: string[]): void => {
      if (keys.length) showToast(`Hotkey ${keys.join(', ')} is taken by another app`)
    }
    window.snap.getHotkeyFailures().then(warnHotkeys)
    const offHotkeys = window.snap.onHotkeysFailed(warnHotkeys)
    return () => {
      offCapture()
      offHistory()
      offRecState()
      offRecDone()
      offHotkeys()
    }
  }, [refreshHistory, showToast])

  // Any click/escape dismisses the tile context menu.
  useEffect(() => {
    if (!ctxMenu) return
    const close = (): void => setCtxMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

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

  const toggleFavorite = useCallback((item: HistoryItem) => {
    // Optimistic: flip locally, persist in the background.
    setHistory((hs) =>
      hs.map((h) => (h.path === item.path ? { ...h, favorite: !item.favorite } : h))
    )
    void window.snap.setFavorite(item.name, !item.favorite)
  }, [])

  const deleteItem = useCallback(
    async (item: HistoryItem) => {
      const ok = await window.snap.deleteHistory(item.path)
      showToast(ok ? 'Moved to Recycle Bin' : 'Delete failed')
      // Only after a successful trash: step the viewer to a neighbour.
      if (ok && viewerPath === item.path) {
        const idx = visible.findIndex((h) => h.path === item.path)
        const neighbour = visible[idx + 1] ?? visible[idx - 1] ?? null
        setViewerPath(neighbour ? neighbour.path : null)
      }
      if (ok) refreshHistory()
    },
    [viewerPath, visible, refreshHistory, showToast]
  )

  const importFiles = useCallback(
    async (paths?: string[]) => {
      const n = await window.snap.importImages(paths)
      if (n > 0) {
        showToast(`Imported ${n} image${n > 1 ? 's' : ''}`)
        refreshHistory()
      }
    },
    [refreshHistory, showToast]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDropHint(false)
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => window.snap.pathForFile(f))
        .filter((p) => /\.(png|jpe?g|webp|bmp)$/i.test(p))
      if (paths.length) void importFiles(paths)
    },
    [importFiles]
  )

  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      onDragOver={(e) => {
        e.preventDefault()
        if (e.dataTransfer.types.includes('Files')) setDropHint(true)
      }}
      onDragLeave={() => setDropHint(false)}
      onDrop={onDrop}
    >
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
                <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-0.5">
                  <FilterTab active={!filterFav} onClick={() => setFilterFav(false)}>
                    All · {history.length}
                  </FilterTab>
                  <FilterTab active={filterFav} onClick={() => setFilterFav(true)}>
                    <Star
                      className={cn('h-3 w-3', filterFav && 'fill-amber-400 text-amber-400')}
                    />
                    {favCount}
                  </FilterTab>
                </div>
                <button
                  onClick={() => void importFiles()}
                  title="Add images from disk to annotate"
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  Add images
                </button>
              </div>
              {visible.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <Star className="h-6 w-6 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">
                    No favorites yet — hover a capture and hit the star
                  </p>
                </div>
              ) : (
                <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto px-7 pb-7 xl:grid-cols-3">
                  {visible.map((item) => (
                    <div
                      key={item.path}
                      role="button"
                      tabIndex={0}
                      onClick={() => setViewerPath(item.path)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setViewerPath(item.path)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setCtxMenu({ x: e.clientX, y: e.clientY, item })
                      }}
                      title={`${item.name} — click to view`}
                      className="group relative aspect-video cursor-pointer overflow-hidden rounded-xl border border-border/70 bg-card shadow-lg shadow-black/30 transition-all hover:ring-2 hover:ring-primary/60"
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
                      {/* Star: always visible when favorited, appears on hover otherwise */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFavorite(item)
                        }}
                        title={item.favorite ? 'Unfavorite' : 'Favorite'}
                        className={cn(
                          'absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/55 backdrop-blur transition-all hover:bg-black/75',
                          item.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        )}
                      >
                        <Star
                          className={cn(
                            'h-3.5 w-3.5',
                            item.favorite ? 'fill-amber-400 text-amber-400' : 'text-white/80'
                          )}
                        />
                      </button>
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="flex items-center gap-1.5 rounded-lg bg-popover/90 px-2.5 py-1.5 text-xs font-medium shadow-lg backdrop-blur">
                          {item.type === 'video' ? (
                            <>
                              <Play className="h-3.5 w-3.5" /> View
                            </>
                          ) : (
                            <>
                              <ImageIcon className="h-3.5 w-3.5" /> View
                            </>
                          )}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Unmounted while an editor is open so its key handlers (Del, F, arrows,
          Esc) can't fire while typing/annotating; remounts when the editor closes. */}
      {viewerIndex >= 0 && !editing && !editingVideo && (
        <GalleryViewer
          items={visible}
          index={viewerIndex}
          onIndexChange={(i) => setViewerPath(visible[i]?.path ?? null)}
          onClose={() => setViewerPath(null)}
          onAnnotate={(item) => void openInEditor(item.path)}
          onEditClip={(item) => setEditingVideo(item)}
          onToggleFavorite={toggleFavorite}
          onDelete={(item) => void deleteItem(item)}
          showToast={showToast}
        />
      )}

      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[180px] overflow-hidden rounded-xl border border-border/70 bg-popover/95 py-1 shadow-2xl backdrop-blur"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 200),
            top: Math.min(ctxMenu.y, window.innerHeight - 240)
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.item.type === 'video' ? (
            <CtxItem
              icon={<Scissors className="h-3.5 w-3.5" />}
              label="Edit clip"
              onClick={() => {
                setEditingVideo(ctxMenu.item)
                setCtxMenu(null)
              }}
            />
          ) : (
            <CtxItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              label="Annotate"
              onClick={() => {
                void openInEditor(ctxMenu.item.path)
                setCtxMenu(null)
              }}
            />
          )}
          <CtxItem
            icon={<Star className={cn('h-3.5 w-3.5', ctxMenu.item.favorite && 'fill-amber-400 text-amber-400')} />}
            label={ctxMenu.item.favorite ? 'Unfavorite' : 'Favorite'}
            onClick={() => {
              toggleFavorite(ctxMenu.item)
              setCtxMenu(null)
            }}
          />
          <div className="my-1 h-px bg-border/60" />
          <CtxItem
            icon={<Copy className="h-3.5 w-3.5" />}
            label={ctxMenu.item.type === 'video' ? 'Copy file' : 'Copy image'}
            onClick={() => {
              const it = ctxMenu.item
              setCtxMenu(null)
              void window.snap.copyFile(it.path).then((ok) => {
                showToast(ok ? 'Copied to clipboard' : 'Copy failed')
              })
            }}
          />
          <CtxItem
            icon={<Link2 className="h-3.5 w-3.5" />}
            label="Copy path"
            onClick={() => {
              const it = ctxMenu.item
              setCtxMenu(null)
              void window.snap.copyPath(it.path).then(() => showToast('File path copied'))
            }}
          />
          <CtxItem
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            label="Show in folder"
            onClick={() => {
              void window.snap.showInFolder(ctxMenu.item.path)
              setCtxMenu(null)
            }}
          />
          <div className="my-1 h-px bg-border/60" />
          <CtxItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Delete"
            danger
            onClick={() => {
              const it = ctxMenu.item
              setCtxMenu(null)
              void deleteItem(it)
            }}
          />
        </div>
      )}

      {/* drag&drop import hint */}
      {dropHint && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 bg-card/60 px-10 py-8">
            <ImagePlus className="h-8 w-8 text-primary" />
            <p className="text-sm font-medium">Drop images to add them to SnapSki</p>
          </div>
        </div>
      )}

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

function FilterTab({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-secondary text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function CtxItem({
  icon,
  label,
  onClick,
  danger = false
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs font-medium transition-colors',
        danger
          ? 'text-red-400 hover:bg-red-500/15 hover:text-red-300'
          : 'text-foreground/85 hover:bg-accent hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
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
