/**
 * Produce a smoothly blurred copy of a sub-region of the base image.
 * Region coords are in the base image's natural pixel space (== canvas space).
 * We sample a padded source so the gaussian blur doesn't bleed transparent
 * edges into the region, then return just the requested w×h crop.
 */
export function blurRegion(
  base: HTMLImageElement | HTMLCanvasElement,
  left: number,
  top: number,
  width: number,
  height: number,
  radius = 10
): HTMLCanvasElement {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const pad = Math.ceil(radius * 2)

  const padded = document.createElement('canvas')
  padded.width = w + pad * 2
  padded.height = h + pad * 2
  const pctx = padded.getContext('2d')!
  pctx.filter = `blur(${radius}px)`
  // Draw the region (plus padding) blurred. Source padding may run off the
  // base edges; that's fine — drawImage clips and we only keep the center.
  pctx.drawImage(
    base,
    left - pad,
    top - pad,
    w + pad * 2,
    h + pad * 2,
    0,
    0,
    w + pad * 2,
    h + pad * 2
  )

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const octx = out.getContext('2d')!
  octx.drawImage(padded, pad, pad, w, h, 0, 0, w, h)
  return out
}

/** Mosaic / pixelate variant (kept for an optional censor style). */
export function pixelateRegion(
  base: HTMLImageElement | HTMLCanvasElement,
  left: number,
  top: number,
  width: number,
  height: number,
  blockSize = 12
): HTMLCanvasElement {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const octx = out.getContext('2d')!
  const sw = Math.max(1, Math.round(w / blockSize))
  const sh = Math.max(1, Math.round(h / blockSize))
  const small = document.createElement('canvas')
  small.width = sw
  small.height = sh
  const sctx = small.getContext('2d')!
  sctx.imageSmoothingEnabled = false
  sctx.drawImage(base, left, top, width, height, 0, 0, sw, sh)
  octx.imageSmoothingEnabled = false
  octx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h)
  return out
}
