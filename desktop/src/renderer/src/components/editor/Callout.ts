import { Textbox, classRegistry } from 'fabric'

interface CalloutOptions {
  bubblePad?: number
  bubbleFill?: string
  bubbleStroke?: string
  bubbleStrokeWidth?: number
  [k: string]: unknown
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
      ctx.strokeStyle = this.bubbleStroke
      ctx.lineWidth = this.bubbleStrokeWidth
      ctx.stroke()
    }
    ctx.restore()
  }
}

classRegistry.setClass(Callout, 'callout')
