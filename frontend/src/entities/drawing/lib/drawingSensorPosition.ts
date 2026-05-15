/** 관제/도면 UI 뷰포트 높이 — 이미지 슬롯 높이 계산에 사용 */
export const DRAWING_VIEWPORT_HEIGHT_PX = 786

/** 도면 이미지가 차지하는 세로 구간(관제·도면/센서 페이지와 동일) */
export const DRAWING_IMAGE_SLOT_TOP_PCT = 19.35
export const DRAWING_IMAGE_SLOT_HEIGHT_PCT = 61.3

/**
 * 레거시 목업/API: 이 픽셀 좌표는 "이미지 슬롯" 기준으로 약 900×(786×0.613) 설계 캔버스에서의 위치.
 * 뷰포트 너비가 바뀌어도 슬롯 비율(%)로 변환하면 도면과 함께 스케일됨.
 */
export const LEGACY_SENSOR_REF_WIDTH = 900
export const LEGACY_SENSOR_REF_HEIGHT = DRAWING_VIEWPORT_HEIGHT_PX * (DRAWING_IMAGE_SLOT_HEIGHT_PCT / 100)

export type SensorPositionInput = {
  left: number
  top: number
  /** 생략 또는 legacy_px: left/top은 레거시 픽셀. percent: 슬롯 내 0~100 */
  positionUnit?: 'percent' | 'legacy_px'
}

function clampPct(n: number) {
  return Math.min(100, Math.max(0, n))
}

export function getSensorPercentInSlot(s: SensorPositionInput): { leftPct: number; topPct: number } {
  if (s.positionUnit === 'percent') {
    return { leftPct: clampPct(s.left), topPct: clampPct(s.top) }
  }
  return {
    leftPct: clampPct((s.left / LEGACY_SENSOR_REF_WIDTH) * 100),
    topPct: clampPct((s.top / LEGACY_SENSOR_REF_HEIGHT) * 100),
  }
}
