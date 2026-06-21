import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronLeft, Play, Pause, Droplets, Scissors, Check, Loader2, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { HistoryItem } from '@shared/types'

interface Props {
  item: HistoryItem
  onClose: () => void
}

interface Frac {
  x: number
  y: number
  w: number
  h: number
}

function fmt(sec: number): string {
  if (!isFinite(sec)) return '0:00'
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  const cs = Math.floor((s * 100) % 100)
  return `${m}:${String(r).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function VideoEditorView({ item, onClose }: Props): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const src = window.snap.mediaUrl(item.path)

  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [inSec, setInSec] = useState(0)
  const [outSec, setOutSec] = useState(0)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [display, setDisplay] = useState({ w: 0, h: 0 })
  const [blurOn, setBlurOn] = useState(false)
  const [blur, setBlur] = useState<Frac>({ x: 0.3, y: 0.3, w: 0.4, h: 0.3 })
  const [blurStart, setBlurStart] = useState(0)
  const [blurEnd, setBlurEnd] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)

  const trimmed = inSec > 0.05 || outSec < duration - 0.05

  // fit the video into the available area, preserving aspect
  const fit = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap || !natural.w) return
    const availW = wrap.clientWidth - 64
    const availH = wrap.clientHeight - 64
    const scale = Math.min(availW / natural.w, availH / natural.h, 1)
    setDisplay({ w: Math.round(natural.w * scale), h: Math.round(natural.h * scale) })
  }, [natural])

  useEffect(() => {
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fit])

  useEffect(() => {
    const off = window.snap.onVideoProgress((f) => setProgress(f))
    return off
  }, [])

  const onLoaded = (): void => {
    const v = videoRef.current
    if (!v) return
    setDuration(v.duration)
    setOutSec(v.duration)
    setBlurEnd(v.duration)
    setNatural({ w: v.videoWidth, h: v.videoHeight })
  }

  const onTime = (): void => {
    const v = videoRef.current
    if (!v) return
    setCurrent(v.currentTime)
    // Only clamp during playback — otherwise this fights manual scrubbing/seeks.
    if (!v.paused && v.currentTime >= outSec) {
      v.pause()
      v.currentTime = outSec
      setPlaying(false)
    }
  }

  const togglePlay = (): void => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      if (v.currentTime < inSec || v.currentTime >= outSec - 0.02) v.currentTime = inSec
      v.play()
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }

  // ---- timeline dragging ----
  const seekTo = (sec: number): void => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(duration, sec))
    setCurrent(v.currentTime)
  }

  const dragHandle =
    (which: 'in' | 'out' | 'seek' | 'blurStart' | 'blurEnd') => (e: React.PointerEvent) => {
      e.preventDefault()
      const tl = timelineRef.current
      if (!tl || !duration) return
      // pause so scrubbing shows individual frames
      const v = videoRef.current
      if (v && !v.paused) {
        v.pause()
        setPlaying(false)
      }
      const rect = tl.getBoundingClientRect()
      const apply = (clientX: number): void => {
        const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
        const sec = frac * duration
        if (which === 'in') {
          const s = Math.min(sec, outSec - 0.1)
          setInSec(s)
          seekTo(s)
        } else if (which === 'out') {
          const s = Math.max(sec, inSec + 0.1)
          setOutSec(s)
          seekTo(s)
        } else if (which === 'blurStart') {
          const s = Math.min(sec, blurEnd - 0.1)
          setBlurStart(s)
          seekTo(s)
        } else if (which === 'blurEnd') {
          const s = Math.max(sec, blurStart + 0.1)
          setBlurEnd(s)
          seekTo(s)
        } else seekTo(sec)
      }
      apply(e.clientX)
      const move = (ev: PointerEvent): void => apply(ev.clientX)
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }

  // ---- blur rect dragging (move + bottom-right resize) ----
  const dragBlur = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY }
    const base = { ...blur }
    const move = (ev: PointerEvent): void => {
      const dx = (ev.clientX - start.x) / display.w
      const dy = (ev.clientY - start.y) / display.h
      if (mode === 'move') {
        setBlur({
          ...base,
          x: Math.max(0, Math.min(1 - base.w, base.x + dx)),
          y: Math.max(0, Math.min(1 - base.h, base.y + dy))
        })
      } else {
        setBlur({
          ...base,
          w: Math.max(0.05, Math.min(1 - base.x, base.w + dx)),
          h: Math.max(0.05, Math.min(1 - base.y, base.h + dy))
        })
      }
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const toggleBlur = (): void => {
    setBlurOn((on) => {
      if (!on) {
        // default the blur segment to the current trim range
        setBlurStart(inSec)
        setBlurEnd(outSec)
      }
      return !on
    })
  }

  const doExport = async (): Promise<void> => {
    setExporting(true)
    setProgress(0)
    setDone(false)
    const blurPx = blurOn
      ? {
          x: Math.round(blur.x * natural.w),
          y: Math.round(blur.y * natural.h),
          width: Math.round(blur.w * natural.w),
          height: Math.round(blur.h * natural.h),
          start: blurStart,
          end: blurEnd
        }
      : null
    const res = await window.snap.exportVideo({
      path: item.path,
      inSec: trimmed ? inSec : undefined,
      outSec: trimmed ? outSec : undefined,
      blur: blurPx
    })
    setExporting(false)
    setDone(res.ok)
    if (res.ok) setTimeout(() => setDone(false), 2600)
  }

  const inPct = duration ? (inSec / duration) * 100 : 0
  const outPct = duration ? (outSec / duration) * 100 : 100
  const playPct = duration ? (current / duration) * 100 : 0
  const blurStartPct = duration ? (blurStart / duration) * 100 : 0
  const blurEndPct = duration ? (blurEnd / duration) * 100 : 100

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background">
      {/* top bar */}
      <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-border/60 pl-2 pr-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="no-drag gap-1.5" onClick={onClose}>
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <span className="ml-1 text-sm font-semibold tracking-tight">Edit clip</span>
          <span className="ml-1 text-xs text-muted-foreground">{item.name}</span>
        </div>
        <div className="no-drag flex items-center gap-2">
          {done && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Check className="h-3.5 w-3.5" /> Saved & copied
            </span>
          )}
          <Button size="sm" className="gap-1.5" onClick={doExport} disabled={exporting}>
            {exporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {Math.round(progress * 100)}%
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Export
              </>
            )}
          </Button>
        </div>
      </header>

      {/* video stage */}
      <div ref={wrapRef} className="preview-surface relative flex flex-1 items-center justify-center overflow-hidden">
        <div className="relative" style={{ width: display.w || 'auto', height: display.h || 'auto' }}>
          <video
            ref={videoRef}
            src={src}
            className="block rounded-lg shadow-2xl shadow-black/50 ring-1 ring-white/5"
            style={{ width: display.w || undefined, height: display.h || undefined }}
            onLoadedMetadata={onLoaded}
            onTimeUpdate={onTime}
            onClick={togglePlay}
          />
          {blurOn && (
            <div
              onPointerDown={dragBlur('move')}
              className="absolute cursor-move rounded-sm border-2 border-primary/90 bg-primary/10 backdrop-blur-md"
              style={{
                left: `${blur.x * display.w}px`,
                top: `${blur.y * display.h}px`,
                width: `${blur.w * display.w}px`,
                height: `${blur.h * display.h}px`
              }}
            >
              <span className="absolute -top-6 left-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                Blur
              </span>
              <span
                onPointerDown={dragBlur('resize')}
                className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-primary bg-background"
              />
            </div>
          )}
        </div>
      </div>

      {/* controls */}
      <div className="shrink-0 border-t border-border/60 bg-card/30 px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="icon" className="h-9 w-9 shrink-0" onClick={togglePlay}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>

            {/* timeline */}
            <div className="flex-1">
              <div
                ref={timelineRef}
                className="relative h-9 cursor-pointer select-none rounded-lg bg-secondary"
                onPointerDown={dragHandle('seek')}
              >
                {/* trimmed-out regions */}
                <div className="absolute inset-y-0 left-0 rounded-l-lg bg-background/70" style={{ width: `${inPct}%` }} />
                <div className="absolute inset-y-0 right-0 rounded-r-lg bg-background/70" style={{ width: `${100 - outPct}%` }} />
                {/* selected range outline */}
                <div
                  className="absolute inset-y-0 border-y-2 border-primary/70"
                  style={{ left: `${inPct}%`, right: `${100 - outPct}%` }}
                />
                {/* blur segment band (amber, lower strip) */}
                {blurOn && (
                  <>
                    <div
                      className="absolute bottom-1 h-1.5 rounded-full bg-amber-400"
                      style={{ left: `${blurStartPct}%`, right: `${100 - blurEndPct}%` }}
                    />
                    <BlurHandle pct={blurStartPct} onPointerDown={dragHandle('blurStart')} />
                    <BlurHandle pct={blurEndPct} onPointerDown={dragHandle('blurEnd')} />
                  </>
                )}
                {/* playhead */}
                <div className="absolute inset-y-0 z-20 w-0.5 bg-white" style={{ left: `${playPct}%` }} />
                {/* in handle */}
                <Handle pct={inPct} onPointerDown={dragHandle('in')} />
                {/* out handle */}
                <Handle pct={outPct} onPointerDown={dragHandle('out')} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <Scissors className="h-3.5 w-3.5" /> In <span className="tabular-nums text-foreground">{fmt(inSec)}</span>
              </span>
              <span>
                Out <span className="tabular-nums text-foreground">{fmt(outSec)}</span>
              </span>
              <span>
                Length <span className="tabular-nums text-foreground">{fmt(outSec - inSec)}</span>
              </span>
              <span className="opacity-60">{fmt(current)} / {fmt(duration)}</span>
            </div>
            <div className="flex items-center gap-2">
              {blurOn && (
                <span className="text-amber-400">
                  Blur {fmt(blurStart)}–{fmt(blurEnd)}
                </span>
              )}
              <button
                onClick={() => window.snap.openFolder()}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-accent hover:text-foreground"
              >
                <FolderOpen className="h-3.5 w-3.5" /> Folder
              </button>
              <button
                onClick={toggleBlur}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition-colors',
                  blurOn ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:text-foreground'
                )}
              >
                <Droplets className="h-3.5 w-3.5" />
                {blurOn ? 'Blur on' : 'Add blur'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Handle({
  pct,
  onPointerDown
}: {
  pct: number
  onPointerDown: (e: React.PointerEvent) => void
}): JSX.Element {
  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation()
        onPointerDown(e)
      }}
      className="absolute top-1/2 z-10 flex h-9 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-md bg-primary shadow-md"
      style={{ left: `${pct}%` }}
    >
      <span className="h-3.5 w-0.5 rounded bg-primary-foreground/70" />
    </div>
  )
}

function BlurHandle({
  pct,
  onPointerDown
}: {
  pct: number
  onPointerDown: (e: React.PointerEvent) => void
}): JSX.Element {
  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation()
        onPointerDown(e)
      }}
      title="Blur segment edge"
      className="absolute bottom-0 z-30 h-4 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm border border-amber-600 bg-amber-400 shadow"
      style={{ left: `${pct}%` }}
    />
  )
}
