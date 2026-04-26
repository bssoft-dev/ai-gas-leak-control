import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'

import { getSensorPercentInSlot } from '../../../entities/drawing/lib/drawingSensorPosition'
import { useActiveDrawing } from '../../../entities/drawing/model/activeDrawing'
import { DrawingSensorDot } from '../../../entities/drawing/ui/DrawingSensorDot'
import { DrawingViewResetIcon } from '../../../entities/drawing/ui/DrawingViewResetIcon'
import { PageContentGrid } from '../../../shared/ui/layout/PageContentGrid'
import { monitorAssets } from '../assets/monitorAssets'
import { useMonitorPressureSeries } from '../model/useMonitorPressureSeries'
import { PressureChartDetailModal } from '../ui/PressureChartDetailModal'
import { PressureLineChart } from '../ui/PressureLineChart'

type ChartCard = {
  id: string
  title: string
  headerBg: string
  variant: 'green' | 'yellow'
  unitLabel: string
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
  const pressureSeriesByVariant = useMemo(
    () => ({
      green: pressureSeries.find((s) => s.variant === 'green'),
      yellow: pressureSeries.find((s) => s.variant === 'yellow'),
    }),
    [pressureSeries],
  )
  const { drawings, activeDrawingId, activeDrawing, activeIndex, total, goPrev, goNext } = useActiveDrawing()
  const [drawingZoom, setDrawingZoom] = useState(1)
  const [drawingFabOpen, setDrawingFabOpen] = useState(false)
  const [drawingPan, setDrawingPan] = useState({ x: 0, y: 0 })
  const [isDrawingPanning, setIsDrawingPanning] = useState(false)
  const [chartDetailId, setChartDetailId] = useState<string | null>(null)
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

  const selectedDrawing = drawings.find((d) => d.id === activeDrawingId)
  const drawingName = selectedDrawing?.name ?? activeDrawing?.name ?? '도면'
  const page = total <= 0 ? 0 : activeIndex + 1
  const totalPages = total
  const canResetDrawingView = drawingZoom !== 1 || drawingPan.x !== 0 || drawingPan.y !== 0

  const cards: ChartCard[] = useMemo(
    () =>
      (activeDrawing?.sensors ?? []).map((sensor, index) => {
        const isFlow = sensor.variant === 'yellow'
        return {
          id: sensor.id,
          title: sensor.label ?? `${isFlow ? '유량' : '압력'} 센서 ${index + 1}`,
          headerBg: isFlow ? '#fbf6e9' : '#f1f7ea',
          variant: sensor.variant,
          unitLabel: sensor.unitLabel ?? (isFlow ? '유량 (L/min)' : '압력 (MPa)'),
        }
      }),
    [activeDrawing?.sensors],
  )

  const detailCard = chartDetailId ? cards.find((c) => c.id === chartDetailId) : null
  const detailSeries = detailCard ? pressureSeriesByVariant[detailCard.variant] : undefined
  const detailUnit = detailCard?.unitLabel.includes('L/min') ? 'L/min' : 'MPa'
  const detailValueText =
    detailSeries != null
      ? `${detailSeries.latestValue.toFixed(2)} ${detailUnit}`
      : pressureSeriesError
        ? `-- ${detailUnit}`
        : '--'

  return (
    <>
      <PageContentGrid>
        <section className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-9 lg:h-full">
          <div className="shrink-0 font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[#4370ac]">
            {drawingName}
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
                      aria-label="도면 위치 초기화"
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
                      aria-label="도면/센서 생성으로 이동"
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

          <div className="mt-[18px] flex shrink-0 items-center justify-center gap-[51px] text-[16px] text-[#0b1828]">
            <button type="button" className="h-[20px] w-[20px] flex items-center justify-center" onClick={goPrev}>
              <img alt="" className="-scale-x-100 block h-[20px] w-[20px]" src={monitorAssets.imgChevronLeft} />
            </button>
            <div className="font-['Pretendard',sans-serif] font-normal leading-[20px]">
              {page} / {totalPages}
            </div>
            <button type="button" className="h-[20px] w-[20px] flex items-center justify-center" onClick={goNext}>
              <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgChevronRight} />
            </button>
          </div>
        </section>

        <aside className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-3 lg:h-full">
          <div className="shrink-0 font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[#4370ac] -translate-y-[2px]">
            실시간 차트
          </div>

          <div className="mt-[12px] flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-[786px] min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]">
              <div className="notion-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-[8px] pl-[6px] pr-[4px] sm:pl-[8px]">
                {pressureSeriesError && (
                  <div className="w-full rounded-[6px] border border-amber-200 bg-amber-50 px-[10px] py-[6px] font-['Pretendard',sans-serif] text-[10px] text-amber-900">
                    차트 데이터를 불러오지 못했습니다.
                  </div>
                )}
                {cards.map((c) => {
                  const series = pressureSeriesByVariant[c.variant]
                  const unit = c.unitLabel.includes('L/min') ? 'L/min' : 'MPa'
                  const valueText =
                    series != null
                      ? `${series.latestValue.toFixed(2)} ${unit}`
                      : pressureSeriesError
                        ? `-- ${unit}`
                        : '--'

                  return (
                    <div key={c.id} className="w-full min-w-0">
                      <div
                        className="inline-flex w-fit max-w-full rounded-tl-[8px] rounded-tr-[8px] border-l border-r border-t border-[#e2e8f0] px-[12px] py-[4px]"
                        style={{ backgroundColor: c.headerBg }}
                      >
                        <div className="font-['Pretendard',sans-serif] text-[10px] leading-[15px] tracking-[0.5px] text-[#485b77]">
                          {c.title} : {valueText}
                        </div>
                      </div>
                      <div className="overflow-hidden rounded-bl-[4px] rounded-br-[4px] rounded-tr-[4px] border border-[#e2e8f0] bg-white">
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
