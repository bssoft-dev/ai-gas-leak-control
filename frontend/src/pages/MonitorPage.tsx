import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'

import { monitorAssets } from '../assets/monitor/monitorAssets'
import { DrawingSensorDot } from '../components/drawing/DrawingSensorDot'
import { DrawingViewResetIcon } from '../components/drawing/DrawingViewResetIcon'
import { PageContentGrid } from '../components/layout/PageContentGrid'
import { PressureChartDetailModal } from '../components/monitor/PressureChartDetailModal'
import { PressureLineChart } from '../components/monitor/PressureLineChart'
import { getSensorPercentInSlot } from '../utils/drawingSensorPosition'
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
  // 디버깅/요청사항: 첫 진입 시 1번 차트 팝업을 강제로 띄움
  const [chartDetailId, setChartDetailId] = useState<string | null>('c1')
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

  const detailCard = chartDetailId ? cards.find((c) => c.id === chartDetailId) : null
  const detailSeries = detailCard ? pressureBySensorId[detailCard.id] : undefined
  const detailValueText =
    detailSeries != null
      ? `${detailSeries.latestValue.toFixed(2)} MPa`
      : pressureSeriesError
        ? '— MPa'
        : '…'

  return (
    <>
    <PageContentGrid>
        {/* 도면: 9/12 — 차트 카드와 동일 높이(786px) */}
        <section className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-9 lg:h-full">
          <div className="shrink-0 font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[#4370ac] uppercase">
            도면 명
          </div>

          <div className="mt-[12px] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]">
            <div className="relative min-h-[786px] min-w-0 flex-1">
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
                    <div className="pointer-events-none absolute left-0 top-[19.35%] h-[61.3%] w-full overflow-hidden">
                      <div className="relative h-full w-full">
                        <img
                          alt={drawingName}
                          className="absolute inset-0 h-full w-full object-contain"
                          src={activeDrawing?.imagePath ?? monitorAssets.imgDrawing}
                        />
                        {(activeDrawing?.sensors ?? []).map((s) => {
                          const { leftPct, topPct } = getSensorPercentInSlot(s)
                          return (
                            <DrawingSensorDot key={s.id} leftPct={leftPct} topPct={topPct} variant={s.variant} />
                          )
                        })}
                      </div>
                    </div>
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
                      <DrawingViewResetIcon />
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
          <div className="mt-[18px] flex shrink-0 items-center justify-center gap-[51px] text-[16px] text-[#0b1828]">
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
        <aside className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-3 lg:h-full">
          <div className="shrink-0 font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[#4370ac] uppercase -translate-y-[2px]">
            실시간 차트
          </div>

          <div className="mt-[12px] flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-[786px] min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]">
              <div className="notion-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-[8px] pl-[6px] pr-[4px] sm:pl-[8px]">
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
                      className="inline-flex w-fit max-w-full border-t border-l border-r border-[#e2e8f0] rounded-tl-[8px] rounded-tr-[8px] px-[12px] py-[4px]"
                      style={{ backgroundColor: c.headerBg }}
                    >
                      <div className="font-['Pretendard',sans-serif] text-[10px] leading-[15px] tracking-[0.5px] text-[#485b77]">
                        {c.title} : {valueText}
                      </div>
                    </div>
                    <div className="bg-white border border-[#e2e8f0] rounded-bl-[4px] rounded-br-[4px] rounded-tr-[4px] overflow-hidden">
                      <div
                        role="button"
                        tabIndex={0}
                        className="h-[120px] w-full min-w-0 cursor-pointer p-px outline-none transition-opacity hover:opacity-95 focus-visible:shadow-[inset_0_0_0_2px_var(--chart-focus-ring)] [&_*]:pointer-events-none"
                        style={
                          {
                            ['--chart-focus-ring' as string]:
                              c.variant === 'green' ? '#7cbf6a' : '#caa23d',
                          } as CSSProperties
                        }
                        aria-label={`${c.title} 차트 상세 보기`}
                        onClick={() => setChartDetailId(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setChartDetailId(c.id)
                          }
                        }}
                      >
                        <PressureLineChart points={series?.points ?? []} variant={c.variant} />
                      </div>
                    </div>
                  </div>
                )
              })}
              <div className="h-[4px]" />
              </div>
            </div>
          </div>
          <div
            className="mt-[18px] flex h-[20px] shrink-0 items-center justify-center gap-[51px]"
            aria-hidden="true"
          />
        </aside>
    </PageContentGrid>

    {detailCard && (
      <PressureChartDetailModal
        open
        onClose={() => setChartDetailId(null)}
        title={detailCard.title}
        valueText={detailValueText}
        headerBg={detailCard.headerBg}
        variant={detailCard.variant}
        points={detailSeries?.points ?? []}
        hasSeriesError={pressureSeriesError}
      />
    )}
    </>
  )
}

