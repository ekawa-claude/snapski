import { FabricObject, classRegistry } from 'fabric'

interface ArrowOptions {
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  cx?: number
  cy?: number
  headSize?: number
  stroke?: string
  strokeWidth?: number
  [k: string]: unknown
}

/**
 * A single-bend arrow rendered as ONE fabric object (so it moves, selects and
 * serializes cleanly). The shaft is a quadratic bezier start → control → end,
 * with a triangular head aimed along the curve's tangent at the end.
 *
 * Geometry is stored in LOCAL coordinates relative to the object's top-left
 * (x1,y1 = start · cx,cy = bend/control · x2,y2 = end). A freshly drawn arrow
 * puts the control at the chord midpoint, so the curve is a straight line and
 * looks exactly like the old Line+Triangle arrow; dragging the bend handle
 * (managed by EditorView) curves it.
 */
export class Arrow extends FabricObject {
  static type = 'arrow'

  declare x1: number
  declare y1: number
  declare x2: number
  declare y2: number
  declare cx: number
  declare cy: number
  declare headSize: number

  constructor(options: ArrowOptions = {}) {
    super(options as never)
    this.x1 = options.x1 ?? 0
    this.y1 = options.y1 ?? 0
    this.x2 = options.x2 ?? 0
    this.y2 = options.y2 ?? 0
    this.cx = options.cx ?? 0
    this.cy = options.cy ?? 0
    this.headSize = options.headSize ?? 22
    this.set({
      originX: 'left',
      originY: 'top',
      // Reshape via the bend/endpoint handles, not fabric's scaling controls.
      hasControls: false,
      // Geometry changes per-frame while bending; skip the object cache.
      objectCaching: false
    } as never)
  }

  /** Place the three points in absolute (scene) coordinates and refit the bbox. */
  setPointsAbsolute(
    ax1: number,
    ay1: number,
    acx: number,
    acy: number,
    ax2: number,
    ay2: number
  ): void {
    const pad = (this.strokeWidth ?? 4) / 2 + (this.headSize ?? 22)
    const minX = Math.min(ax1, ax2, acx) - pad
    const minY = Math.min(ay1, ay2, acy) - pad
    const maxX = Math.max(ax1, ax2, acx) + pad
    const maxY = Math.max(ay1, ay2, acy) + pad
    this.set({ left: minX, top: minY, width: maxX - minX, height: maxY - minY } as never)
    this.x1 = ax1 - minX
    this.y1 = ay1 - minY
    this.x2 = ax2 - minX
    this.y2 = ay2 - minY
    this.cx = acx - minX
    this.cy = acy - minY
    this.dirty = true
    this.setCoords()
  }

  /** Current points in absolute (scene) coordinates. */
  getPointsAbsolute(): {
    x1: number
    y1: number
    cx: number
    cy: number
    x2: number
    y2: number
  } {
    const l = this.left ?? 0
    const t = this.top ?? 0
    return {
      x1: l + this.x1,
      y1: t + this.y1,
      cx: l + this.cx,
      cy: t + this.cy,
      x2: l + this.x2,
      y2: t + this.y2
    }
  }

  /** Recompute the bounding box from the current points (after a width change). */
  reflow(): void {
    const p = this.getPointsAbsolute()
    this.setPointsAbsolute(p.x1, p.y1, p.cx, p.cy, p.x2, p.y2)
  }

  _render(ctx: CanvasRenderingContext2D): void {
    const ox = (this.width ?? 0) / 2
    const oy = (this.height ?? 0) / 2
    const x1 = this.x1 - ox
    const y1 = this.y1 - oy
    const x2 = this.x2 - ox
    const y2 = this.y2 - oy
    const cx = this.cx - ox
    const cy = this.cy - oy
    const color = (this.stroke as string) || '#f43f5e'

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = this.strokeWidth ?? 4

    const hs = this.headSize ?? 22
    // Tangent at the end (the bezier's derivative direction there = end - control).
    let dx = x2 - cx
    let dy = y2 - cy
    if (dx === 0 && dy === 0) {
      dx = x2 - x1
      dy = y2 - y1
    }
    const tlen = Math.hypot(dx, dy) || 1
    const ux = dx / tlen
    const uy = dy / tlen
    // Stop the shaft just shy of the tip so its rounded end cap hides under the
    // arrowhead instead of poking out as a blob past the sharp point.
    const backoff = Math.min(hs * 0.9, tlen * 0.9)
    const ex = x2 - ux * backoff
    const ey = y2 - uy * backoff

    // Shaft: quadratic bezier. Control at the chord midpoint == straight line.
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.quadraticCurveTo(cx, cy, ex, ey)
    ctx.stroke()

    // Head: sharp triangle, tip exactly at the end, aimed along the tangent.
    const ang = Math.atan2(dy, dx)
    ctx.translate(x2, y2)
    ctx.rotate(ang)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-hs, -hs * 0.5)
    ctx.lineTo(-hs, hs * 0.5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  toObject(propertiesToInclude: string[] = []): Record<string, unknown> {
    return super.toObject([
      'x1',
      'y1',
      'x2',
      'y2',
      'cx',
      'cy',
      'headSize',
      ...propertiesToInclude
    ])
  }
}

classRegistry.setClass(Arrow, 'arrow')

/** Build a (straight) arrow start → end; the control starts at the chord midpoint. */
export function makeArrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  strokeWidth: number
): Arrow {
  const a = new Arrow({
    stroke: color,
    strokeWidth,
    headSize: Math.max(22, strokeWidth * 6),
    kind: 'arrow'
  } as never)
  a.setPointsAbsolute(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2, x2, y2)
  return a
}
