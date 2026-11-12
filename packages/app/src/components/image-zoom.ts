export * as ImageZoom from "./image-zoom.js"

export interface View {
  readonly scale: number
  readonly x: number
  readonly y: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Bounds {
  readonly width: number
  readonly height: number
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly maxScale: number
}

export const fit: View = { scale: 1, x: 0, y: 0 }

export const step = Math.SQRT2

const maxNaturalZoom = 8

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const clampAxis = (offset: number, size: number, viewport: number) => {
  const limit = Math.max(0, (size - viewport) / 2)
  return clamp(offset, -limit, limit) + 0
}

export function maxScale(fitRatio: number) {
  return Math.max(1, maxNaturalZoom / fitRatio)
}

export function clampView(view: View, bounds: Bounds): View {
  return {
    scale: view.scale,
    x: clampAxis(view.x, bounds.width * view.scale, bounds.viewportWidth),
    y: clampAxis(view.y, bounds.height * view.scale, bounds.viewportHeight),
  }
}

export function zoomAt(view: View, scale: number, anchor: Point, bounds: Bounds): View {
  const next = clamp(scale, 1, bounds.maxScale)
  const ratio = next / view.scale
  return clampView(
    { scale: next, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio },
    bounds,
  )
}

export function panBy(view: View, delta: Point, bounds: Bounds): View {
  return clampView({ scale: view.scale, x: view.x + delta.x, y: view.y + delta.y }, bounds)
}

export function detailScale(fitRatio: number) {
  const actual = 1 / fitRatio
  return actual >= 1.5 ? actual : 2
}

export function wheelFactor(deltaY: number) {
  return Math.exp(-clamp(deltaY, -30, 30) / 100)
}
