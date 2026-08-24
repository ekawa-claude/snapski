import { Textbox, classRegistry } from 'fabric'

interface CalloutOptions {
  bubblePad?: number
  bubbleFill?: string
  bubbleStroke?: string
  bubbleStrokeWidth?: number
  [k: string]: unknown
}

/** Mix a hex color toward white by `amt` (0–1) — used for the border's gloss highlight. */
function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const mix = (c: number): number => Math.round(c + (255 - c) * amt)
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/**
 * An editable speech bubble: a real fabric Textbox (so text editing, wrapping
 * and resizing keep working) whose background is drawn as a rounded, bordered
 * bubble. No tail — point at things with the separate arrow tool.
 */
export class Callout extends Textbox {
  static type = 'callout'

  declare bubblePad: number
  declare bubbleFill: string
  declare bubbleStroke: string
  declare bubbleStrokeWidth: number

  constructor(text: string, options: CalloutOptions = {}) {
    super(text, options as never)
    this.bubblePad = options.bubblePad ?? 14
    this.bubbleFill = options.bubbleFill ?? '#ffffff'
    this.bubbleStroke = options.bubbleStroke ?? '#f43f5e'
    this.bubbleStrokeWidth = options.bubbleStrokeWidth ?? 2.5
  }

  _renderBackground(ctx: CanvasRenderingContext2D): void {
    const pad = this.bubblePad
    const w = this.width + pad * 2
    const h = this.height + pad * 2
    const x = -w / 2
    const y = -h / 2
    const radius = 14

    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, radius)
    ctx.fillStyle = this.bubbleFill
    ctx.fill()
    if (this.bubbleStroke && this.bubbleStrokeWidth > 0) {
      // Gradient border (lighter at the top) instead of a flat stroke. bubbleFill
      // is white in every current use, so a glassy highlight only ever reads on
      // the border — the one part of the bubble that's actually colored.
      const glow = ctx.createLinearGradient(0, y, 0, y + h)
      glow.addColorStop(0, lighten(this.bubbleStroke, 0.45))
      glow.addColorStop(0.6, this.bubbleStroke)
      ctx.strokeStyle = glow
      ctx.lineWidth = this.bubbleStrokeWidth
      ctx.stroke()
    }

    ctx.restore()
  }
}

classRegistry.setClass(Callout, 'callout')
