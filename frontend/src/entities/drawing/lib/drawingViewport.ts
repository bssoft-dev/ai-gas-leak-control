export const DRAWING_ZOOM_MIN = 0.5
export const DRAWING_ZOOM_MAX = 2.5
export const DRAWING_ZOOM_STEP = 0.15

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function clampDrawingPan(x: number, y: number, zoom: number, vw: number, vh: number) {
  if (zoom <= 1) return { x: 0, y: 0 }
  const maxX = Math.max(0, (vw * zoom - vw) / 2)
  const maxY = Math.max(0, (vh * zoom - vh) / 2)
  return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) }
}
