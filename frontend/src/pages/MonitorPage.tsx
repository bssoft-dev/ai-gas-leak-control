import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { monitorAssets } from '../assets/monitor/monitorAssets'
import { PageContentGrid } from '../components/layout/PageContentGrid'
import { PressureLineChart } from '../components/monitor/PressureLineChart'
import { useMonitorPressureSeries } from '../hooks/useMonitorPressureSeries'
import { useActiveDrawing } from '../state/activeDrawing'

type ChartCard = {
  id: string
  title: string
  headerBg: string
  variant: 'green' | 'yellow'
}

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.15

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function clampDrawingPan(x: number, y: number, zoom: number, vw: number, vh: number) {
  if (zoom <= 1) return { x: 0, y: 0 }
  const maxX = Math.max(0, (vw * zoom - vw) / 2)
  const maxY = Math.max(0, (vh * zoom - vh) / 2)
  return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) }
}

export default function MonitorPage() {
  const navigate = useNavigate()
  const { sensors: pressureSeries, error: pressureSeriesError } = useMonitorPressureSeries(2000)
  const pressureBySensorId = useMemo(
    () => Object.fromEntries(pressureSeries.map((s) => [s.sensorId, s])),
    [pressureSeries],
  )
  const { drawings, activeDrawingId, activeDrawing, activeIndex, total, goPrev, goNext } = useActiveDrawing()
  const [drawingZoom, setDrawingZoom] = useState(1)
  const [drawingFabOpen, setDrawingFabOpen] = useState(false)
  const [drawingPan, setDrawingPan] = useState({ x: 0, y: 0 })
  const [isDrawingPanning, setIsDrawingPanning] = useState(false)
  const drawingViewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ active: boolean; pointerId: number; lastX: number; lastY: number } | null>(null)

  useEffect(() => {
    setDrawingZoom(1)
    setDrawingPan({ x: 0, y: 0 })
  }, [activeDrawingId])

  useEffect(() => {
    if (drawingZoom <= 1) {
      setDrawingPan({ x: 0, y: 0 })
      return
    }
    const el = drawingViewportRef.current
    if (!el) return
    const { clientWidth: vw, clientHeight: vh } = el
    setDrawingPan((p) => clampDrawingPan(p.x, p.y, drawingZoom, vw, vh))
  }, [drawingZoom])

  const onDrawingPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (drawingZoom <= 1) return
      if (e.button !== 0) return
      const el = drawingViewportRef.current
      if (!el) return
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      dragRef.current = { active: true, pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
      setIsDrawingPanning(true)
    },
    [drawingZoom],
  )

  const onDrawingPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d?.active || e.pointerId !== d.pointerId) return
      const dx = e.clientX - d.lastX
      const dy = e.clientY - d.lastY
      d.lastX = e.clientX
      d.lastY = e.clientY
      const el = drawingViewportRef.current
      if (!el) return
      const { clientWidth: vw, clientHeight: vh } = el
      setDrawingPan((p) => clampDrawingPan(p.x + dx, p.y + dy, drawingZoom, vw, vh))
    },
    [drawingZoom],
  )

  const endDrawingDrag = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d?.active || e.pointerId !== d.pointerId) return
    dragRef.current = null
    setIsDrawingPanning(false)
    try {
      drawingViewportRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }, [])

  const drawingName = activeDrawing?.name ?? drawings.find((d) => d.id === activeDrawingId)?.name ?? '도면'
  const page = total <= 0 ? 0 : activeIndex + 1
  const totalPages = total
  const canResetDrawingView =
    drawingZoom !== 1 || drawingPan.x !== 0 || drawingPan.y !== 0

  const cards: ChartCard[] = [
    { id: 'c1', title: '압력 센서 1', headerBg: '#f1f7ea', variant: 'green' },
    { id: 'c2', title: '압력 센서 2', headerBg: '#f1f7ea', variant: 'green' },
    { id: 'c3', title: '압력 센서 3', headerBg: '#f1f7ea', variant: 'green' },
    { id: 'c4', title: '압력 센서 4', headerBg: '#fbf6e9', variant: 'yellow' },
    { id: 'c5', title: '압력 센서 5', headerBg: '#fbf6e9', variant: 'yellow' },
  ]

  const SensorDot = ({
    left,
    top,
    variant,
  }: {
    left: number
    top: number
    variant: 'green' | 'yellow'
  }) => {
    const color = variant === 'green' ? '#7cbf6a' : '#caa23d'
    const halo = variant === 'green' ? 'rgba(124,191,106,0.55)' : 'rgba(202,162,61,0.55)'
    const haloMid = variant === 'green' ? 'rgba(124,191,106,0.25)' : 'rgba(202,162,61,0.25)'

    return (
      <div className="absolute" style={{ left, top, width: 14, height: 14 }}>
        {/* halo */}
        <div
          className="absolute rounded-full"
          style={{
            left: -6,
            top: -6,
            width: 26,
            height: 26,
            background: `radial-gradient(circle, ${halo} 0%, ${haloMid} 45%, rgba(0,0,0,0) 70%)`,
            filter: 'blur(0.2px)',
          }}
        />
        {/* inner circle */}
        <div className="absolute left-[2px] top-[2px] w-[10px] h-[10px] rounded-full" style={{ backgroundColor: color }} />
      </div>
    )
  }

  return (
    <PageContentGrid>
        {/* 도면: 9/12 — 차트 카드와 동일 높이(786px) */}
        <section className="col-span-12 flex min-w-0 flex-col lg:col-span-9">
          <div className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[#4370ac] uppercase">
            도면 명
          </div>

          <div className="mt-[12px] relative bg-white rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)] overflow-hidden">
            <div className="h-[786px] relative">
              <div
                ref={drawingViewportRef}
                className={`absolute inset-0 overflow-hidden touch-none select-none ${
                  drawingZoom > 1 ? (isDrawingPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
                }`}
                onPointerDown={onDrawingPointerDown}
                onPointerMove={onDrawingPointerMove}
                onPointerUp={endDrawingDrag}
                onPointerCancel={endDrawingDrag}
                onLostPointerCapture={() => {
                  dragRef.current = null
                  setIsDrawingPanning(false)
                }}
              >
                <div
                  className="relative h-full w-full"
                  style={{ transform: `translate(${drawingPan.x}px, ${drawingPan.y}px)` }}
                >
                  <div
                    className="relative h-full w-full"
                    style={{
                      transform: `scale(${drawingZoom})`,
                      transformOrigin: '50% 40%',
                      transition: isDrawingPanning ? 'none' : 'transform 0.15s ease-out',
                    }}
                  >
                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                      <img
                        alt={drawingName}
                        className="absolute left-0 top-[19.35%] w-full h-[61.3%] object-contain"
                        src={activeDrawing?.imagePath ?? monitorAssets.imgDrawing}
                      />
                    </div>

                    {(activeDrawing?.sensors ?? []).map((s) => (
                      <SensorDot key={s.id} left={s.left} top={s.top} variant={s.variant} />
                    ))}
                  </div>
                </div>
              </div>

              {/* FAB: 닫힘 = 햄버거 원형만, 열림 = 세로 pill(확대·축소·수정) + X 토글 */}
              <div className="absolute bottom-[16px] right-[16px] z-20 flex flex-col-reverse items-center gap-[10px]">
                <button
                  type="button"
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full border border-[#e2e8f0] bg-white shadow-[0px_4px_14px_rgba(0,0,0,0.14)] transition-shadow hover:shadow-[0px_6px_18px_rgba(0,0,0,0.16)]"
                  aria-label={drawingFabOpen ? '도면 도구 닫기' : '도면 도구 열기'}
                  aria-expanded={drawingFabOpen}
                  onClick={() => setDrawingFabOpen((v) => !v)}
                >
                  {drawingFabOpen ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M18 6L6 18M6 6l12 12"
                        stroke="#94a3b8"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 7h16M4 12h16M4 17h16"
                        stroke="#94a3b8"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </button>

                {drawingFabOpen && (
                  <div className="flex flex-col items-center gap-[2px] rounded-[9999px] border border-[#e2e8f0] bg-white px-[6px] py-[8px] shadow-[0px_4px_14px_rgba(0,0,0,0.14)]">
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면 확대"
                      onClick={() =>
                        setDrawingZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 1000) / 1000))
                      }
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgAddCircle} />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면 축소"
                      onClick={() =>
                        setDrawingZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 1000) / 1000))
                      }
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgDoNotDisturbOn} />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="도면 크기·위치 원래대로"
                      disabled={!canResetDrawingView}
                      onClick={() => {
                        setDrawingZoom(1)
                        setDrawingPan({ x: 0, y: 0 })
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"
                          stroke="#94a3b8"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면·센서 생성에서 수정"
                      onClick={() => {
                        setDrawingFabOpen(false)
                        navigate('/drawing-sensor')
                      }}
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgEditSquare} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pagination */}
          <div className="mt-[18px] flex items-center justify-center gap-[51px] text-[16px] text-[#0b1828]">
            <button type="button" className="w-[20px] h-[20px] flex items-center justify-center" onClick={goPrev}>
              <img alt="" className="-scale-x-100 block w-[20px] h-[20px]" src={monitorAssets.imgChevronLeft} />
            </button>
            <div className="font-['Pretendard',sans-serif] font-normal leading-[20px]">
              {page} / {totalPages}
            </div>
            <button type="button" className="w-[20px] h-[20px] flex items-center justify-center" onClick={goNext}>
              <img alt="" className="block w-[20px] h-[20px]" src={monitorAssets.imgChevronRight} />
            </button>
          </div>
        </section>

        {/* 실시간 차트: 3/12 — 도면 카드와 같은 세로 길이 */}
        <aside className="col-span-12 flex min-w-0 flex-col lg:col-span-3">
          <div className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[#4370ac] uppercase -translate-y-[2px]">
            실시간 차트
          </div>

          <div className="mt-[12px] flex h-[786px] min-h-0 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-[8px] px-[6px] sm:px-[8px]">
              {pressureSeriesError && (
                <div className="w-full rounded-[6px] border border-amber-200 bg-amber-50 px-[10px] py-[6px] font-['Pretendard',sans-serif] text-[10px] text-amber-900">
                  차트 데이터를 불러오지 못했습니다. 개발 모드에서 MSW가 켜져 있는지 확인하세요.
                </div>
              )}
              {cards.map((c) => {
                const series = pressureBySensorId[c.id]
                const valueText =
                  series != null
                    ? `${series.latestValue.toFixed(2)} MPa`
                    : pressureSeriesError
                      ? '— MPa'
                      : '…'
                return (
                  <div key={c.id} className="w-full min-w-0">
                    <div
                      className="border-t border-l border-r border-[#e2e8f0] rounded-tl-[8px] rounded-tr-[8px] px-[12px] py-[4px]"
                      style={{ backgroundColor: c.headerBg }}
                    >
                      <div className="font-['Pretendard',sans-serif] text-[10px] leading-[15px] tracking-[0.5px] text-[#485b77]">
                        {c.title} : {valueText}
                      </div>
                    </div>
                    <div className="bg-white border border-[#e2e8f0] rounded-bl-[4px] rounded-br-[4px] rounded-tr-[4px] overflow-hidden">
                      <div className="h-[120px] w-full min-w-0 p-px">
                        <PressureLineChart points={series?.points ?? []} variant={c.variant} />
                      </div>
                    </div>
                  </div>
                )
              })}
              <div className="h-[4px]" />
            </div>
          </div>
        </aside>
    </PageContentGrid>
  )
}

