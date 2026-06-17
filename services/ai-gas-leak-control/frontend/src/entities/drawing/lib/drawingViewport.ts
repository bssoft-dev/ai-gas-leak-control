export const DRAWING_ZOOM_MIN = 0.5
export const DRAWING_ZOOM_MAX = 2.5
export const DRAWING_ZOOM_STEP = 0.15

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** 확대 시 패닝 한계(뷰포트 클라이언트 크기 vw×vh, 줌 z 기준) */
export function getPanLimits(vw: number, vh: number, zoom: number) {
  if (zoom <= 1) return { maxX: 0, maxY: 0 }
  return {
    maxX: Math.max(0, (vw * zoom - vw) / 2),
    maxY: Math.max(0, (vh * zoom - vh) / 2),
  }
}

export function clampDrawingPan(x: number, y: number, zoom: number, vw: number, vh: number) {
  if (zoom <= 1) return { x: 0, y: 0 }
  const { maxX, maxY } = getPanLimits(vw, vh, zoom)
  return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) }
}
