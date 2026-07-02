import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X,
  ChevronLeft,
  ChevronRight,
  Star,
  Pencil,
  Scissors,
  Copy,
  Link2,
  FolderOpen,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HistoryItem } from '@shared/types'

interface Props {
  items: HistoryItem[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  onAnnotate: (item: HistoryItem) => void
  onEditClip: (item: HistoryItem) => void
  onToggleFavorite: (item: HistoryItem) => void
  onDelete: (item: HistoryItem) => void
  showToast: (msg: string) => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 8

export function GalleryViewer({
  items,
  index,
  onIndexChange,
  onClose,
  onAnnotate,
  onEditClip,
  onToggleFavorite,
  onDelete,
  showToast
}: Props): JSX.Element | null {
  const item = items[index]
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isFull, setIsFull] = useState(false)
  const isFullRef = useRef(false)
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const setFullScreen = useCallback(async (on: boolean): Promise<void> => {
    const state = await window.snap.winSetFullScreen(on)
    isFullRef.current = state
    setIsFull(state)
  }, [])

  // Leaving the viewer (close, or the editor replacing it) restores the window.
  useEffect(() => {
    return () => {
      if (isFullRef.current) void window.snap.winSetFullScreen(false)
    }
  }, [])

  // Reset the view whenever we move to another item.
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [item?.path])

  const prev = useCallback(() => {
    if (index > 0) onIndexChange(index - 1)
  }, [index, onIndexChange])
  const next = useCallback(() => {
    if (index < items.length - 1) onIndexChange(index + 1)
  }, [index, items.length, onIndexChange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // First Esc leaves fullscreen, the next one closes the viewer.
      if (e.key === 'Escape') {
        if (isFullRef.current) void setFullScreen(false)
        else onClose()
      } else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'Delete' && item) onDelete(item)
      else if ((e.key === 'f' || e.key === 'F') && item) onToggleFavorite(item)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev, next, item, onDelete, onToggleFavorite, setFullScreen])

  if (!item) return null
  const isVideo = item.type === 'video'
  const src = window.snap.mediaUrl(item.path)

  const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

  const onWheel = (e: React.WheelEvent): void => {
    if (isVideo) return
    const z = clampZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8))
    if (z === MIN_ZOOM) setPan({ x: 0, y: 0 })
    setZoom(z)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (isVideo || zoom <= 1) return
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) })
  }
  const onPointerUp = (): void => {
    dragRef.current = null
  }

  const copyImage = async (): Promise<void> => {
    const ok = await window.snap.copyFile(item.path)
    showToast(ok ? (isVideo ? 'Video file copied to clipboard' : 'Image copied to clipboard') : 'Copy failed')
  }
  const copyPath = async (): Promise<void> => {
    await window.snap.copyPath(item.path)
    showToast('File path copied to clipboard')
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-black/95 backdrop-blur-sm">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-sm font-medium text-white/90">{item.name}</span>
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] tabular-nums text-white/60">
            {index + 1} / {items.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ViewerBtn
            title={item.favorite ? 'Unfavorite (F)' : 'Favorite (F)'}
            onClick={() => onToggleFavorite(item)}
          >
            <Star
              className={cn(
                'h-4 w-4',
                item.favorite ? 'fill-amber-400 text-amber-400' : 'text-white/70'
              )}
            />
          </ViewerBtn>
          <ViewerBtn title="Close (Esc)" onClick={onClose}>
            <X className="h-4 w-4 text-white/80" />
          </ViewerBtn>
        </div>
      </header>

      {/* Stage */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onWheel={onWheel}
      >
        {isVideo ? (
          <video
            key={item.path}
            src={src}
            controls
            autoPlay
            className="max-h-full max-w-full outline-none"
          />
        ) : (
          <img
            key={item.path}
            src={src}
            alt={item.name}
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={() => {
              setZoom(zoom > 1 ? 1 : 2)
              if (zoom > 1) setPan({ x: 0, y: 0 })
            }}
            className={cn(
              'max-h-full max-w-full select-none object-contain',
              zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
            )}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: dragRef.current ? 'none' : 'transform 120ms ease-out'
            }}
          />
        )}

        {/* Nav chevrons */}
        {index > 0 && (
          <NavBtn side="left" onClick={prev}>
            <ChevronLeft className="h-6 w-6" />
          </NavBtn>
        )}
        {index < items.length - 1 && (
          <NavBtn side="right" onClick={next}>
            <ChevronRight className="h-6 w-6" />
          </NavBtn>
        )}

        {/* Zoom indicator */}
        {!isVideo && zoom > 1 && (
          <span className="absolute bottom-4 right-4 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white/80 backdrop-blur">
            {Math.round(zoom * 100)}%
          </span>
        )}
      </div>

      {/* Bottom toolbar */}
      <footer className="flex h-14 shrink-0 items-center justify-center gap-1.5 border-t border-white/10 px-4">
        {isVideo ? (
          <ToolBtn label="Edit clip" onClick={() => onEditClip(item)}>
            <Scissors className="h-4 w-4" />
          </ToolBtn>
        ) : (
          <>
            <ToolBtn label="Annotate" onClick={() => onAnnotate(item)}>
              <Pencil className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              label="Zoom in"
              onClick={() => setZoom((z) => clampZoom(z * 1.25))}
              iconOnly
            >
              <ZoomIn className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              label="Zoom out"
              onClick={() => {
                setZoom((z) => {
                  const nz = clampZoom(z * 0.8)
                  if (nz === MIN_ZOOM) setPan({ x: 0, y: 0 })
                  return nz
                })
              }}
              iconOnly
            >
              <ZoomOut className="h-4 w-4" />
            </ToolBtn>
          </>
        )}
        <ToolBtn
          label={isFull ? 'Exit fullscreen' : 'Fullscreen'}
          onClick={() => void setFullScreen(!isFull)}
          iconOnly
        >
          {isFull ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </ToolBtn>
        <span className="mx-2 h-6 w-px bg-white/10" />
        <ToolBtn label={isVideo ? 'Copy file' : 'Copy image'} onClick={copyImage}>
          <Copy className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Copy path" onClick={copyPath}>
          <Link2 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Show in folder" onClick={() => window.snap.showInFolder(item.path)} iconOnly>
          <FolderOpen className="h-4 w-4" />
        </ToolBtn>
        <span className="mx-2 h-6 w-px bg-white/10" />
        <ToolBtn label="Delete" onClick={() => onDelete(item)} danger>
          <Trash2 className="h-4 w-4" />
        </ToolBtn>
      </footer>
    </div>
  )
}

function ViewerBtn({
  title,
  onClick,
  children
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
    >
      {children}
    </button>
  )
}

function NavBtn({
  side,
  onClick,
  children
}: {
  side: 'left' | 'right'
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur transition-all hover:bg-black/70 hover:text-white',
        side === 'left' ? 'left-4' : 'right-4'
      )}
    >
      {children}
    </button>
  )
}

function ToolBtn({
  label,
  onClick,
  children,
  iconOnly = false,
  danger = false
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  iconOnly?: boolean
  danger?: boolean
}): JSX.Element {
  return (
    <button
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors',
        danger
          ? 'text-red-400 hover:bg-red-500/15 hover:text-red-300'
          : 'text-white/75 hover:bg-white/10 hover:text-white'
      )}
    >
      {children}
      {!iconOnly && <span>{label}</span>}
    </button>
  )
}
