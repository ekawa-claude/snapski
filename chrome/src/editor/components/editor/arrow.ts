import { Group, Line, Triangle } from 'fabric'

/** Build an arrow (shaft + head) as a single selectable/movable group. */
export function makeArrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  strokeWidth: number
): Group {
  const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
  const headSize = Math.max(22, strokeWidth * 6)

  const line = new Line([x1, y1, x2, y2], {
    stroke: color,
    strokeWidth,
    strokeLineCap: 'round'
  })
  const head = new Triangle({
    left: x2,
    top: y2,
    originX: 'center',
    originY: 'center',
    width: headSize,
    height: headSize,
    fill: color,
    angle: angleDeg + 90
  })

  const group = new Group([line, head], { kind: 'arrow' } as never)
  return group
}
