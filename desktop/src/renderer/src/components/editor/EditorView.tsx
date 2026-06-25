import { useEffect, useRef, useState, useCallback } from 'react'
import { Check, X } from 'lucide-react'
import {
  Canvas,
  Rect,
  IText,
  Circle,
  Group,
  FabricText,
  FabricImage,
  FabricObject
} from 'fabric'
import type { CaptureResult } from '@shared/types'
import { blurRegion } from './pixelate'
import { makeArrow, Arrow } from './arrow'
import { Callout } from './Callout'
import { EditorToolbar, type Tool } from './EditorToolbar'

interface Props {
  capture: CaptureResult
  onClose: () => void
}

/** Pick black/white text for legibility against a given background color. */
function contrastText(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#111114' : '#ffffff'
}

/** Toggle a contrasting outline around the glyphs for legibility. */
function applyTextOutline(t: IText, on: boolean, color: string): void {
  if (on) {
    const fontSize = (t as unknown as { fontSize: number }).fontSize ?? 24
    t.set({
      stroke: contrastText(color),
      strokeWidth: Math.max(2, fontSize * 0.12),
      paintFirst: 'stroke',
      strokeLineJoin: 'round'
    })
  } else {
    t.set({ strokeWidth: 0 })
  }
}

/** Toggle a solid background chip behind a text object. */
function applyTextBg(t: IText, bg: boolean, color: string): void {
  if (bg) {
    t.set({ backgroundColor: color, fill: contrastText(color) })
    ;(t as unknown as { kind: string }).kind = 'label'
  } else {
    t.set({ backgroundColor: '', fill: color })
    ;(t as unknown as { kind: string }).kind = 'text'
  }
}

/** Point on the bubble's outline along the ray toward (tx,ty) — anchors a pointer arrow. */
function bubbleEdgePoint(
  bubble: {
    getCenterPoint: () => { x: number; y: number }
    width: number
    height: number
    bubblePad?: number
    scaleX?: number
    scaleY?: number
  },
  tx: number,
  ty: number
): { x: number; y: number; inside: boolean } {
  const ctr = bubble.getCenterPoint()
  const pad = bubble.bubblePad ?? 14
  const hw = (bubble.width / 2 + pad) * (bubble.scaleX ?? 1)
  const hh = (bubble.height / 2 + pad) * (bubble.scaleY ?? 1)
  const dx = tx - ctr.x
  const dy = ty - ctr.y
  if (dx === 0 && dy === 0) return { x: ctr.x, y: ctr.y, inside: true }
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity
  const tEdge = Math.min(sx, sy)
  return { x: ctr.x + dx * tEdge, y: ctr.y + dy * tEdge, inside: tEdge >= 1 }
}

// Custom props we persist through serialization.
const EXTRA_PROPS = [
  'kind',
  'selectable',
  'evented',
  'globalCompositeOperation',
  'bubblePad',
  'bubbleFill',
  'bubbleStroke',
  'bubbleStrokeWidth'
]

export function EditorView({ capture, onClose }: Props): JSX.Element {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fcRef = useRef<Canvas | null>(null)
  const baseElRef = useRef<HTMLImageElement | null>(null)

  const toolRef = useRef<Tool>('select')
  const colorRef = useRef('#f43f5e')
  const widthRef = useRef(4)
  const badgeRef = useRef(1)
  const textBgRef = useRef(false)
  const textOutlineRef = useRef(true)
  const bubbleArrowRef = useRef(true)
  // Active "aim the pointer" gesture: a bubble awaiting its pointer arrow.
  const aimRef = useRef<{ bubble: FabricObject; preview: FabricObject | null; armed: boolean } | null>(
    null
  )
  // Ephemeral reshape handles (start / end / bend) shown while an arrow is selected.
  const arrowSelRef = useRef<{ arrow: FabricObject; handles: FabricObject[] } | null>(null)

  const drawing = useRef<{ obj: FabricObject | null; x: number; y: number } | null>(null)
  // Pending crop marquee: the fabric Rect overlay + its region in scene (natural px) coords.
  const cropObjRef = useRef<FabricObject | null>(null)
  const cropRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const [cropPending, setCropPending] = useState(false)
  const history = useRef<{ stack: string[]; index: number; restoring: boolean }>({
    stack: [],
    index: -1,
    restoring: false
  })

  const [tool, setToolState] = useState<Tool>('select')
  const [color, setColor] = useState('#f43f5e')
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [nextBadge, setNextBadge] = useState(1)
  const [textBg, setTextBg] = useState(false)
  const [textOutline, setTextOutline] = useState(true)
  const [bubbleArrow, setBubbleArrow] = useState(true)
  const [aiming, setAiming] = useState(false)
  const [selectedKind, setSelectedKind] = useState<string | null>(null)

  const resetBadge = (): void => {
    badgeRef.current = 1
    setNextBadge(1)
  }
  const toggleTextBg = (): void => {
    textBgRef.current = !textBgRef.current
    setTextBg(textBgRef.current)
    const c = fcRef.current
    const active = c?.getActiveObject() as (FabricObject & { kind?: string }) | undefined
    if (active && (active.kind === 'text' || active.kind === 'label')) {
      applyTextBg(active as unknown as IText, textBgRef.current, colorRef.current)
      c?.requestRenderAll()
      snapshot()
    }
  }
  const toggleTextOutline = (): void => {
    textOutlineRef.current = !textOutlineRef.current
    setTextOutline(textOutlineRef.current)
    const c = fcRef.current
    const active = c?.getActiveObject() as (FabricObject & { kind?: string }) | undefined
    if (active && (active.kind === 'text' || active.kind === 'label')) {
      applyTextOutline(active as unknown as IText, textOutlineRef.current, colorRef.current)
      c?.requestRenderAll()
      snapshot()
    }
  }

  const clearCropMarquee = (): void => {
    const c = fcRef.current
    if (cropObjRef.current && c) c.remove(cropObjRef.current)
    cropObjRef.current = null
    cropRectRef.current = null
    setCropPending(false)
  }

  const setTool = (t: Tool): void => {
    // Abandon any in-progress crop marquee when switching away from the crop tool.
    if (t !== 'crop' && cropObjRef.current) clearCropMarquee()
    toolRef.current = t
    setToolState(t)
    const c = fcRef.current
    if (!c) return
    const drawingTool = t !== 'select' && t !== 'text' && t !== 'badge' && t !== 'bubble'
    c.selection = t === 'select'
    c.defaultCursor = t === 'select' ? 'default' : 'crosshair'
    c.skipTargetFind = drawingTool
    c.forEachObject((o) => {
      o.selectable = t === 'select'
      o.evented = t === 'select'
    })
    if (t !== 'select') c.discardActiveObject()
    c.requestRenderAll()
  }

  const toggleBubbleArrow = (): void => {
    bubbleArrowRef.current = !bubbleArrowRef.current
    setBubbleArrow(bubbleArrowRef.current)
  }

  // Begin aiming a pointer arrow for a bubble: next move rubber-bands an arrow
  // from the bubble's edge to the cursor; a click commits it.
  const startAim = useCallback((bubble: FabricObject): void => {
    const c = fcRef.current
    if (!c) return
    const it = bubble as unknown as IText
    if (it.isEditing) it.exitEditing()
    c.discardActiveObject()
    c.selection = false
    c.skipTargetFind = true
    c.defaultCursor = 'crosshair'
    c.forEachObject((o) => {
      o.evented = false
    })
    aimRef.current = { bubble, preview: null, armed: false }
    toolRef.current = 'select'
    setToolState('select')
    setAiming(true)
    c.requestRenderAll()
  }, [])

  const cancelAim = useCallback((): void => {
    const c = fcRef.current
    if (c && aimRef.current?.preview) c.remove(aimRef.current.preview)
    aimRef.current = null
    setAiming(false)
    setTool('select')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toolbar action: draw a pointer from the currently-selected bubble.
  const addPointerToSelected = (): void => {
    const c = fcRef.current
    const a = c?.getActiveObject() as (FabricObject & { kind?: string }) | undefined
    if (a && a.kind === 'callout') startAim(a)
  }

  // ---------- arrow reshape handles ----------
  // Remove any active reshape handles from the canvas.
  const tearDownArrowHandles = (): void => {
    const c = fcRef.current
    const sel = arrowSelRef.current
    if (sel && c) sel.handles.forEach((h) => c.remove(h))
    arrowSelRef.current = null
  }

  // Show three draggable handles (start / end / bend) for the given arrow.
  const buildArrowHandles = (arrow: FabricObject): void => {
    const c = fcRef.current
    if (!c) return
    if (arrowSelRef.current?.arrow === arrow) return
    tearDownArrowHandles()
    const ar = arrow as Arrow
    const pts = ar.getPointsAbsolute()
    const col = (ar.stroke as string) || colorRef.current
    const mk = (x: number, y: number, role: string): FabricObject => {
      const h = new Circle({
        left: x,
        top: y,
        radius: 6,
        originX: 'center',
        originY: 'center',
        fill: role === 'ctrl' ? col : '#ffffff',
        stroke: role === 'ctrl' ? '#ffffff' : col,
        strokeWidth: 2,
        hasControls: false,
        hasBorders: false,
        excludeFromExport: true
      } as never)
      ;(h as unknown as { kind: string; role: string }).kind = 'handle'
      ;(h as unknown as { role: string }).role = role
      c.add(h)
      return h
    }
    const handles = [
      mk(pts.x1, pts.y1, 'p1'),
      mk(pts.x2, pts.y2, 'p2'),
      mk(pts.cx, pts.cy, 'ctrl')
    ]
    arrowSelRef.current = { arrow, handles }
    c.requestRenderAll()
  }

  // Move the handles back onto the arrow's current points (after a move/reshape).
  const repositionArrowHandles = (): void => {
    const sel = arrowSelRef.current
    if (!sel) return
    const pts = (sel.arrow as Arrow).getPointsAbsolute()
    const pos: Record<string, { x: number; y: number }> = {
      p1: { x: pts.x1, y: pts.y1 },
      p2: { x: pts.x2, y: pts.y2 },
      ctrl: { x: pts.cx, y: pts.cy }
    }
    sel.handles.forEach((h) => {
      const role = (h as unknown as { role: string }).role
      const m = pos[role]
      if (m) {
        h.set({ left: m.x, top: m.y })
        h.setCoords()
      }
    })
  }

  // A handle is being dragged: push its position into the arrow's geometry.
  const onHandleMoving = (h: FabricObject): void => {
    const sel = arrowSelRef.current
    if (!sel) return
    const ar = sel.arrow as Arrow
    const role = (h as unknown as { role: string }).role
    const ctr = h.getCenterPoint()
    const pts = ar.getPointsAbsolute()
    if (role === 'p1') {
      pts.x1 = ctr.x
      pts.y1 = ctr.y
    } else if (role === 'p2') {
      pts.x2 = ctr.x
      pts.y2 = ctr.y
    } else {
      pts.cx = ctr.x
      pts.cy = ctr.y
    }
    ar.setPointsAbsolute(pts.x1, pts.y1, pts.cx, pts.cy, pts.x2, pts.y2)
    fcRef.current?.requestRenderAll()
  }

  // ---------- history ----------
  const snapshot = useCallback(() => {
    const c = fcRef.current
    if (!c || history.current.restoring) return
    const json = JSON.stringify(c.toObject(EXTRA_PROPS))
    const h = history.current
    h.stack = h.stack.slice(0, h.index + 1)
    h.stack.push(json)
    h.index = h.stack.length - 1
    setCanUndo(h.index > 0)
    setCanRedo(false)
  }, [])

  // ---------- fit canvas to viewport ----------
  const fit = useCallback(() => {
    const c = fcRef.current
    const wrap = wrapRef.current
    if (!c || !wrap) return
    const natW = c.getWidth()
    const natH = c.getHeight()
    // Reserve space on the left for the floating tool rail so the image never
    // hides under it; keep symmetric breathing room elsewhere.
    const availW = wrap.clientWidth - (96 + 32)
    const availH = wrap.clientHeight - 64
    const scale = Math.min(availW / natW, availH / natH, 1)
    c.setDimensions({ width: `${natW * scale}px`, height: `${natH * scale}px` }, { cssOnly: true })
  }, [])

  const restore = useCallback(
    async (json: string) => {
      const c = fcRef.current
      if (!c) return
      history.current.restoring = true
      // loadFromJSON drops every object (handles are excludeFromExport, so they're
      // gone too) — clear the stale handle refs before they dangle.
      arrowSelRef.current = null
      await c.loadFromJSON(json)
      // The background image is the source of truth for canvas size — restoring it
      // also restores any earlier crop (dimensions aren't part of the JSON itself).
      const bg = c.backgroundImage as FabricImage | undefined
      if (bg) {
        const el = bg.getElement() as HTMLImageElement
        if (el) baseElRef.current = el
        const w = Math.round(bg.width ?? c.getWidth())
        const h = Math.round(bg.height ?? c.getHeight())
        if (w && h) c.setDimensions({ width: w, height: h })
      }
      // Re-apply tool selectability after reload.
      const selectable = toolRef.current === 'select'
      c.forEachObject((o) => {
        o.selectable = selectable
        o.evented = selectable
      })
      c.requestRenderAll()
      fit()
      history.current.restoring = false
    },
    [fit]
  )

  const undo = useCallback(async () => {
    const h = history.current
    if (h.index <= 0) return
    h.index -= 1
    await restore(h.stack[h.index])
    setCanUndo(h.index > 0)
    setCanRedo(h.index < h.stack.length - 1)
  }, [restore])

  const redo = useCallback(async () => {
    const h = history.current
    if (h.index >= h.stack.length - 1) return
    h.index += 1
    await restore(h.stack[h.index])
    setCanUndo(h.index > 0)
    setCanRedo(h.index < h.stack.length - 1)
  }, [restore])

  const deleteSelected = useCallback(() => {
    const c = fcRef.current
    if (!c) return
    const active = c.getActiveObjects()
    // If a reshape handle is "selected", Delete should drop the whole arrow.
    const sel = arrowSelRef.current
    if (sel && active.some((o) => (o as FabricObject & { kind?: string }).kind === 'handle')) {
      c.remove(sel.arrow)
      tearDownArrowHandles()
      c.discardActiveObject()
      c.requestRenderAll()
      snapshot()
      return
    }
    if (!active.length) return
    active.forEach((o) => c.remove(o))
    c.discardActiveObject()
    c.requestRenderAll()
    snapshot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot])

  // Apply the pending crop: rebuild the base image, resize the canvas, and shift
  // every annotation so it stays aligned with the cropped region.
  const applyCrop = useCallback(async () => {
    const c = fcRef.current
    const base = baseElRef.current
    const region = cropRectRef.current
    if (!c || !base || !region) return

    const natW = c.getWidth()
    const natH = c.getHeight()
    const cx = Math.max(0, Math.min(Math.round(region.x), natW - 1))
    const cy = Math.max(0, Math.min(Math.round(region.y), natH - 1))
    const cw = Math.max(1, Math.min(Math.round(region.w), natW - cx))
    const ch = Math.max(1, Math.min(Math.round(region.h), natH - cy))

    // Crop the current base into an offscreen canvas, then bake to an <img> so it
    // serializes cleanly into the undo history.
    const off = document.createElement('canvas')
    off.width = cw
    off.height = ch
    const ctx = off.getContext('2d')
    if (!ctx) return
    ctx.drawImage(base, cx, cy, cw, ch, 0, 0, cw, ch)
    const url = off.toDataURL('image/png')
    const newImg = new Image()
    await new Promise<void>((res) => {
      newImg.onload = (): void => res()
      newImg.src = url
    })

    // Remove the marquee before reflowing the rest.
    if (cropObjRef.current) c.remove(cropObjRef.current)
    cropObjRef.current = null
    cropRectRef.current = null
    setCropPending(false)

    c.getObjects().forEach((o) => {
      o.set({ left: (o.left ?? 0) - cx, top: (o.top ?? 0) - cy })
      o.setCoords()
    })

    baseElRef.current = newImg
    c.backgroundImage = new FabricImage(newImg, { selectable: false, evented: false })
    c.setDimensions({ width: cw, height: ch })
    c.requestRenderAll()
    setTool('select')
    fit()
    snapshot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, snapshot])

  const cancelCrop = useCallback(() => {
    clearCropMarquee()
    setTool('select')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- mount ----------
  useEffect(() => {
    const el = canvasElRef.current
    if (!el) return
    const c = new Canvas(el, {
      backgroundColor: '#101013',
      preserveObjectStacking: true,
      uniformScaling: false
    })
    fcRef.current = c
    if (import.meta.env.DEV) (window as unknown as { __fabric?: Canvas }).__fabric = c

    const img = new Image()
    img.onload = () => {
      baseElRef.current = img
      const fimg = new FabricImage(img, { selectable: false, evented: false })
      c.setDimensions({ width: img.naturalWidth, height: img.naturalHeight })
      c.backgroundImage = fimg
      c.requestRenderAll()
      fit()
      // Seed history with the clean base.
      history.current.stack = [JSON.stringify(c.toObject(EXTRA_PROPS))]
      history.current.index = 0
      setCanUndo(false)
      setCanRedo(false)
    }
    img.src = capture.dataUrl

    // change tracking
    const onChange = (): void => snapshot()
    c.on('object:added', (e) => {
      // Reshape handles aren't part of the drawing; never snapshot for them.
      if ((e.target as FabricObject & { kind?: string })?.kind === 'handle') return
      // Don't snapshot the live pointer-aim preview arrows; the commit snapshots once.
      if (!drawing.current && !aimRef.current) snapshot()
    })
    c.on('object:modified', (e) => {
      const o = e.target as (FabricObject & { kind?: string }) | undefined
      if (o && o.kind === 'blur') reblur(o)
      // Keep handles glued to the arrow after a move or reshape.
      if (o && (o.kind === 'handle' || o.kind === 'arrow')) repositionArrowHandles()
      onChange()
    })
    c.on('object:moving', (e) => {
      const o = e.target as (FabricObject & { kind?: string }) | undefined
      if (!o) return
      if (o.kind === 'handle') onHandleMoving(o)
      else if (o.kind === 'arrow') repositionArrowHandles()
    })
    c.on('object:removed', () => {})

    // track selection so the properties panel can edit the selected object
    const onSelect = (): void => {
      const a = c.getActiveObject() as AnyObj | null
      if (!a) return
      // Selecting one of our own reshape handles shouldn't disturb the panel.
      if (a.kind === 'handle') return
      syncPanelFromObject(a)
      if (a.kind === 'arrow') buildArrowHandles(a)
      else tearDownArrowHandles()
    }
    c.on('selection:created', onSelect)
    c.on('selection:updated', onSelect)
    c.on('selection:cleared', () => {
      setSelectedKind(null)
      tearDownArrowHandles()
    })

    // ---------- drawing interactions ----------
    c.on('mouse:down', (opt) => {
      // Pointer-aim mode: a click commits the pointer arrow (once armed by a move).
      const aim = aimRef.current
      if (aim) {
        if (aim.armed) {
          const ap = c.getScenePoint(opt.e)
          if (aim.preview) c.remove(aim.preview)
          const edge = bubbleEdgePoint(aim.bubble as never, ap.x, ap.y)
          if (!edge.inside) {
            const col = (aim.bubble as { bubbleStroke?: string }).bubbleStroke || colorRef.current
            const arrow = makeArrow(edge.x, edge.y, ap.x, ap.y, col, widthRef.current)
            c.add(arrow) // aimRef still set → object:added won't snapshot
            c.setActiveObject(arrow)
          }
          aimRef.current = null
          setAiming(false)
          setTool('select')
          c.requestRenderAll()
          snapshot()
        }
        return
      }

      const t = toolRef.current
      const p = c.getScenePoint(opt.e)
      if (t === 'select') return

      if (t === 'text') {
        const text = new IText('Text', {
          left: p.x,
          top: p.y,
          fill: colorRef.current,
          fontSize: Math.max(18, widthRef.current * 6),
          fontFamily: 'Inter, Segoe UI, sans-serif',
          padding: textBgRef.current ? 6 : 0,
          kind: 'text'
        } as never)
        if (textBgRef.current) applyTextBg(text, true, colorRef.current)
        if (textOutlineRef.current) applyTextOutline(text, true, colorRef.current)
        c.add(text)
        setTool('select')
        c.setActiveObject(text)
        text.enterEditing()
        text.selectAll()
        snapshot()
        return
      }

      if (t === 'badge') {
        const n = badgeRef.current++
        setNextBadge(badgeRef.current)
        const r = 18
        const circle = new Circle({
          radius: r,
          fill: colorRef.current,
          originX: 'center',
          originY: 'center',
          stroke: '#ffffff',
          strokeWidth: 2
        })
        const label = new FabricText(String(n), {
          fontSize: 20,
          fontWeight: 700,
          fill: '#ffffff',
          fontFamily: 'Inter, Segoe UI, sans-serif',
          originX: 'center',
          originY: 'center'
        })
        const badge = new Group([circle, label], {
          left: p.x,
          top: p.y,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
          kind: 'badge'
        } as never)
        c.add(badge)
        // Stay on the badge tool — steps are placed in quick succession.
        snapshot()
        return
      }

      if (t === 'bubble') {
        const callout = new Callout('Text', {
          left: p.x,
          top: p.y,
          originX: 'center',
          originY: 'center',
          width: 130,
          fontSize: 22,
          textAlign: 'center',
          fontFamily: 'Inter, Segoe UI, sans-serif',
          fill: '#111114',
          bubbleFill: '#ffffff',
          bubbleStroke: colorRef.current,
          bubbleStrokeWidth: 2.5,
          kind: 'callout'
        } as never)
        c.add(callout)
        setTool('select')
        c.setActiveObject(callout)
        ;(callout as unknown as IText).enterEditing()
        ;(callout as unknown as IText).selectAll()
        snapshot()
        // With the pointer option on, start aiming an arrow once text editing ends.
        if (bubbleArrowRef.current) {
          const cb = callout as unknown as {
            on: (e: string, h: () => void) => void
            off: (e: string, h: () => void) => void
          }
          const onExit = (): void => {
            cb.off('editing:exited', onExit)
            startAim(callout)
          }
          cb.on('editing:exited', onExit)
        }
        return
      }

      // Starting a fresh crop marquee discards any previous one.
      if (t === 'crop' && cropObjRef.current) {
        c.remove(cropObjRef.current)
        cropObjRef.current = null
        cropRectRef.current = null
        setCropPending(false)
      }

      // drag-to-draw tools
      drawing.current = { obj: null, x: p.x, y: p.y }
    })

    c.on('mouse:move', (opt) => {
      // Pointer-aim mode: rubber-band an arrow from the bubble edge to the cursor.
      const aim = aimRef.current
      if (aim) {
        const ap = c.getScenePoint(opt.e)
        if (aim.preview) {
          c.remove(aim.preview)
          aim.preview = null
        }
        aim.armed = true
        const edge = bubbleEdgePoint(aim.bubble as never, ap.x, ap.y)
        if (!edge.inside) {
          const col = (aim.bubble as { bubbleStroke?: string }).bubbleStroke || colorRef.current
          const arrow = makeArrow(edge.x, edge.y, ap.x, ap.y, col, widthRef.current)
          arrow.selectable = false
          arrow.evented = false
          aim.preview = arrow
          c.add(arrow)
        }
        c.requestRenderAll()
        return
      }

      const d = drawing.current
      if (!d) return
      const t = toolRef.current
      const p = c.getScenePoint(opt.e)
      const left = Math.min(d.x, p.x)
      const top = Math.min(d.y, p.y)
      const w = Math.abs(p.x - d.x)
      const h = Math.abs(p.y - d.y)

      if (d.obj) c.remove(d.obj)

      let obj: FabricObject | null = null
      if (t === 'rect') {
        obj = new Rect({
          left,
          top,
          width: w,
          height: h,
          fill: 'transparent',
          stroke: colorRef.current,
          strokeWidth: widthRef.current,
          rx: 4,
          ry: 4,
          kind: 'rect'
        } as never)
      } else if (t === 'highlight') {
        obj = new Rect({
          left,
          top,
          width: w,
          height: h,
          fill: colorRef.current,
          opacity: 0.4,
          globalCompositeOperation: 'multiply',
          kind: 'highlight'
        } as never)
      } else if (t === 'arrow') {
        obj = makeArrow(d.x, d.y, p.x, p.y, colorRef.current, widthRef.current)
      } else if (t === 'blur') {
        obj = new Rect({
          left,
          top,
          width: w,
          height: h,
          fill: 'rgba(124,124,245,0.25)',
          stroke: '#7c7cf5',
          strokeDashArray: [5, 4],
          strokeWidth: 1,
          kind: 'blur-pending'
        } as never)
      } else if (t === 'crop') {
        obj = new Rect({
          left,
          top,
          width: w,
          height: h,
          fill: 'rgba(124,124,245,0.12)',
          stroke: '#ffffff',
          strokeDashArray: [6, 4],
          strokeWidth: 2,
          kind: 'crop'
        } as never)
      }

      if (obj) {
        obj.selectable = false
        obj.evented = false
        d.obj = obj
        c.add(obj)
      }
      c.requestRenderAll()
    })

    c.on('mouse:up', () => {
      const d = drawing.current
      if (!d) return
      drawing.current = null
      const t = toolRef.current
      const obj = d.obj

      if (t === 'crop') {
        // Keep the marquee on-canvas and surface the Apply/Cancel bar; stay in crop mode.
        if (obj) {
          const b = obj.getBoundingRect()
          if (b.width > 8 && b.height > 8) {
            cropObjRef.current = obj
            cropRectRef.current = { x: b.left, y: b.top, w: b.width, h: b.height }
            setCropPending(true)
          } else {
            c.remove(obj)
          }
        }
        c.requestRenderAll()
        return
      }

      if (t === 'blur' && obj) {
        // Replace the marquee with a real blurred image of the region.
        const b = obj.getBoundingRect()
        c.remove(obj)
        if (b.width > 4 && b.height > 4 && baseElRef.current) {
          const px = blurRegion(baseElRef.current, b.left, b.top, b.width, b.height)
          const blurImg = new FabricImage(px, {
            left: b.left,
            top: b.top,
            selectable: false,
            evented: false,
            kind: 'blur'
          } as never)
          c.add(blurImg)
        }
      } else if (obj) {
        if ((obj.width ?? 0) < 3 && (obj.height ?? 0) < 3) {
          c.remove(obj) // ignore stray clicks
        }
      }
      // Stay on the current drawing tool (like the badge tool) so the user can keep
      // placing shapes without re-selecting it. Switch to the select tool to edit.
      c.requestRenderAll()
      snapshot()
    })

    return () => {
      c.dispose()
      fcRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.dataUrl])

  // recompute a blur object's pixels at its current bounds
  const reblur = (o: FabricObject): void => {
    const c = fcRef.current
    const base = baseElRef.current
    if (!c || !base) return
    const b = o.getBoundingRect()
    const px = blurRegion(base, b.left, b.top, b.width, b.height)
    const img = o as FabricImage
    img.setElement(px)
    img.set({ scaleX: 1, scaleY: 1, width: px.width, height: px.height, left: b.left, top: b.top })
    img.setCoords()
    c.requestRenderAll()
  }

  // keep refs synced for new-object defaults
  useEffect(() => {
    colorRef.current = color
  }, [color])
  useEffect(() => {
    widthRef.current = strokeWidth
  }, [strokeWidth])

  type AnyObj = FabricObject & {
    kind?: string
    fill?: string
    stroke?: string
    bubbleStroke?: string
    backgroundColor?: string
    fontSize?: number
    getObjects?: () => FabricObject[]
  }

  // Apply a colour to the currently selected object (by kind).
  const applyColorToActive = (col: string): void => {
    const c = fcRef.current
    const a = c?.getActiveObject() as AnyObj | undefined
    if (!a) return
    const kind = a.kind ?? a.type
    if (kind === 'blur') return
    if (kind === 'callout') a.set('bubbleStroke' as never, col)
    else if (kind === 'label') a.set({ backgroundColor: col, fill: contrastText(col) })
    else if (kind === 'highlight') a.set('fill', col)
    else if (kind === 'badge') a.getObjects?.()[0]?.set('fill', col)
    else if (kind === 'text' || a.type === 'i-text' || a.type === 'text') {
      a.set('fill', col)
      if (textOutlineRef.current) applyTextOutline(a as unknown as IText, true, col)
    } else if (kind === 'arrow') {
      a.set('stroke', col)
    } else a.set('stroke', col)
    a.set('dirty', true)
    c?.requestRenderAll()
    snapshot()
  }

  // Apply a width/size to the currently selected object.
  const applyWidthToActive = (n: number): void => {
    const c = fcRef.current
    const a = c?.getActiveObject() as AnyObj | undefined
    if (!a) return
    const kind = a.kind ?? a.type
    if (kind === 'rect') a.set('strokeWidth', n)
    else if (kind === 'arrow') {
      a.set('strokeWidth', n)
      // Scale the arrowhead to match the shaft (mirrors makeArrow's headSize).
      ;(a as unknown as Arrow).headSize = Math.max(22, n * 6)
      ;(a as unknown as Arrow).reflow()
      repositionArrowHandles()
    } else if (kind === 'text' || kind === 'label' || a.type === 'i-text') {
      a.set('fontSize' as never, Math.max(18, n * 6))
      if (textOutlineRef.current) applyTextOutline(a as unknown as IText, true, (a.fill as string) ?? color)
    } else return
    a.set('dirty', true)
    c?.requestRenderAll()
    snapshot()
  }

  const chooseColor = (col: string): void => {
    setColor(col)
    applyColorToActive(col)
  }
  const chooseWidth = (n: number): void => {
    setStrokeWidth(n)
    applyWidthToActive(n)
  }

  // Reflect a newly selected object's props in the panel (no apply-back).
  const syncPanelFromObject = (a: AnyObj): void => {
    const kind = a.kind ?? a.type
    setSelectedKind(kind)
    if (kind === 'callout') setColor(a.bubbleStroke ?? color)
    else if (kind === 'label') setColor(a.backgroundColor ?? color)
    else if (kind === 'highlight' || kind === 'badge') {
      const fill = kind === 'badge' ? (a.getObjects?.()[0]?.get('fill') as string) : a.fill
      if (fill) setColor(fill)
    } else if (kind === 'text' || a.type === 'i-text' || a.type === 'text') {
      if (a.fill) setColor(a.fill)
    } else if (kind === 'arrow') {
      if (a.stroke) setColor(a.stroke)
    } else if (a.stroke) setColor(a.stroke)

    if (kind === 'rect') setStrokeWidth(Math.max(1, Math.round((a as { strokeWidth?: number }).strokeWidth ?? 4)))
    else if (kind === 'arrow') {
      const sw = (a as { strokeWidth?: number }).strokeWidth
      if (sw) setStrokeWidth(Math.max(1, Math.round(sw)))
    } else if (kind === 'text' || kind === 'label') {
      setStrokeWidth(Math.max(1, Math.round((a.fontSize ?? 24) / 6)))
    }

    if (kind === 'text' || kind === 'label') {
      const bg = kind === 'label'
      textBgRef.current = bg
      setTextBg(bg)
      const outline =
        ((a as { strokeWidth?: number }).strokeWidth ?? 0) > 0 &&
        (a as { paintFirst?: string }).paintFirst === 'stroke'
      textOutlineRef.current = outline
      setTextOutline(outline)
    }
  }

  // resize handling
  useEffect(() => {
    const onResize = (): void => fit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fit])

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const editingText = (fcRef.current?.getActiveObject() as IText)?.isEditing
      if (editingText) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Enter' && cropPending) {
        e.preventDefault()
        applyCrop()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      } else if (e.key === 'Escape') {
        if (aiming) cancelAim()
        else if (cropPending) cancelCrop()
        else setTool('select')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, deleteSelected, cropPending, applyCrop, cancelCrop, aiming, cancelAim])

  const save = async (): Promise<void> => {
    const c = fcRef.current
    if (!c) return
    setSaving(true)
    c.discardActiveObject()
    tearDownArrowHandles()
    c.requestRenderAll()
    const dataUrl = c.toDataURL({ format: 'png', multiplier: 1, enableRetinaScaling: false })
    await window.snap.exportImage(dataUrl)
    setSaving(false)
    setSavedNote(true)
    setTimeout(() => setSavedNote(false), 1600)
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background">
      <EditorToolbar
        tool={tool}
        setTool={setTool}
        selectedKind={selectedKind}
        color={color}
        setColor={chooseColor}
        strokeWidth={strokeWidth}
        setStrokeWidth={chooseWidth}
        nextBadge={nextBadge}
        onResetBadge={resetBadge}
        textBg={textBg}
        onToggleTextBg={toggleTextBg}
        textOutline={textOutline}
        onToggleTextOutline={toggleTextOutline}
        bubbleArrow={bubbleArrow}
        onToggleBubbleArrow={toggleBubbleArrow}
        onAddPointer={addPointerToSelected}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onDelete={deleteSelected}
        onSave={save}
        onClose={onClose}
        saving={saving}
        savedNote={savedNote}
      />
      <div
        ref={wrapRef}
        className="preview-surface relative flex flex-1 items-center justify-center overflow-hidden py-8 pl-24 pr-8"
      >
        <div className="overflow-hidden rounded-lg shadow-2xl shadow-black/50 ring-1 ring-white/5">
          <canvas ref={canvasElRef} />
        </div>

        {/* Pointer-aim hint */}
        {aiming && (
          <div className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-popover/90 px-3 py-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
              <span className="px-1 text-[11px] text-muted-foreground">
                Click where the bubble should point · Esc to skip
              </span>
            </div>
          </div>
        )}

        {/* Crop confirm bar */}
        {(tool === 'crop' || cropPending) && (
          <div className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2">
            <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-border/70 bg-popover/90 px-3 py-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
              <span className="px-1 text-[11px] text-muted-foreground">
                {cropPending ? 'Adjust by dragging a new box' : 'Drag to select the area to keep'}
              </span>
              <button
                onClick={cancelCrop}
                className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                onClick={applyCrop}
                disabled={!cropPending}
                className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-colors enabled:hover:bg-primary/90 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                Apply crop
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
