import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  DRAWING_IMAGE_SLOT_HEIGHT_PCT,
  DRAWING_IMAGE_SLOT_TOP_PCT,
  getSensorPercentInSlot,
} from '../../../entities/drawing/lib/drawingSensorPosition'
import { useActiveDrawing } from '../../../entities/drawing/model/activeDrawing'
import { useDrawingViewport } from '../../../entities/drawing/model/useDrawingViewport'
import { DrawingMedia } from '../../../entities/drawing/ui/DrawingMedia'
import { DrawingSensorDot } from '../../../entities/drawing/ui/DrawingSensorDot'
import { DrawingViewResetIcon } from '../../../entities/drawing/ui/DrawingViewResetIcon'
import { formatDrawingName } from '../../../shared/lib/formatDrawingName'
import { PageContentGrid } from '../../../shared/ui/layout/PageContentGrid'
import { PaginationArrowButton } from '../../../shared/ui/navigation/PaginationArrowButton'
import { drawingSensorAssets } from '../../drawing-sensor/assets/drawingSensorAssets'
import { monitorAssets } from '../assets/monitorAssets'
import { buildMonitorChartCards } from '../lib/buildMonitorChartCards'
import { useMonitorPressureSeries } from '../model/useMonitorPressureSeries'
import { PressureChartDetailModal } from '../ui/PressureChartDetailModal'
import { PressureLineChart } from '../ui/PressureLineChart'

export default function MonitorPage() {
  const navigate = useNavigate()
  const { imgAttachFileAdd } = drawingSensorAssets
  const { sensors: pressureSeries, error: pressureSeriesError } = useMonitorPressureSeries(2000)
  const pressureSeriesByVariant = useMemo(
    () => ({
      green: pressureSeries.find((sensor) => sensor.variant === 'green'),
      yellow: pressureSeries.find((sensor) => sensor.variant === 'yellow'),
    }),
    [pressureSeries],
  )
  const {
    drawings,
    activeDrawingId,
    activeDrawing,
    activeIndex,
    total,
    goPrev,
    goNext,
    toggleDrawingActive,
  } = useActiveDrawing()
  const [chartDetailId, setChartDetailId] = useState<string | null>(null)
  const viewport = useDrawingViewport(activeDrawingId)

  const selectedDrawing = drawings.find((drawing) => drawing.id === activeDrawingId)
  const isDrawingActive = Boolean(selectedDrawing?.isActive)
  const drawingName = formatDrawingName(selectedDrawing?.name ?? activeDrawing?.name) || '도면'
  const cards = useMemo(
    () => (isDrawingActive ? buildMonitorChartCards(activeDrawing?.sensors ?? []) : []),
    [activeDrawing?.sensors, isDrawingActive],
  )
  const detailCard = chartDetailId ? cards.find((card) => card.id === chartDetailId) : null
  const detailSeries = detailCard ? pressureSeriesByVariant[detailCard.variant] : undefined
  const detailUnit = detailCard?.unitLabel.includes('L/min') ? 'L/min' : 'MPa'
  const detailValueText =
    detailSeries != null
      ? `${detailSeries.latestValue.toFixed(2)} ${detailUnit}`
      : pressureSeriesError
        ? `-- ${detailUnit}`
        : '--'
  const page = total <= 0 ? 0 : activeIndex + 1

  if (total === 0) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-[24px]">
        <div className="flex flex-col items-center justify-center rounded-[12px] bg-white px-[32px] py-[48px] text-center">
          <p className="font-['Pretendard',sans-serif] text-[24px] font-semibold leading-[1.4] text-[color:var(--black_title,#0b1828)]">
            업로드된 도면이 없습니다.
          </p>
          <button
            type="button"
            className="mt-[20px] flex h-[48px] items-center justify-center gap-[8px] rounded-[4px] bg-[var(--blue_icon,#1392ec)] px-[22px] py-[8px]"
            onClick={() => navigate('/drawing-sensor')}
            aria-label="도면 업로드"
          >
            <img alt="" className="block h-[20px] w-[20px]" src={imgAttachFileAdd} />
            <span className="whitespace-nowrap font-['Pretendard',sans-serif] text-[16px] font-medium leading-[15px] tracking-[-0.25px] text-white">
              도면 업로드
            </span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <PageContentGrid>
        <section className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-9 lg:h-full">
          <div className="flex min-h-[40px] shrink-0 items-center justify-between gap-[12px]">
            <div className="min-w-0 font-['Pretendard',sans-serif] text-[16px] font-semibold leading-[1.2] text-[color:var(--blue_primary_800,#4370ac)]">
              {drawingName}
            </div>
            <div
              className="invisible flex h-[40px] shrink-0 items-center justify-center gap-[8px] rounded-[4px] px-[22px] py-[8px]"
              aria-hidden
            >
              <img alt="" className="block h-[20px] w-[20px]" src={imgAttachFileAdd} />
              <span className="whitespace-nowrap font-['Pretendard',sans-serif] text-[16px] font-medium leading-[15px] tracking-[-0.25px]">
                도면 추가
              </span>
            </div>
          </div>

          <div className="mt-[12px] flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-[12px] gap-y-[8px] px-[32px] pb-[12px] pt-[24px]">
                <div className="font-['Pretendard',sans-serif] text-[14px] font-normal leading-[normal] text-[color:var(--black_500,#485b77)]">
                  도면 내 설치 위치 등록 (도면을 클릭하여 센서 추가)
                </div>

                <div className="flex items-center gap-[12px] py-[4px]">
                  <div className="font-['Pretendard',sans-serif] text-[14px] font-normal leading-[normal] text-[color:var(--black_500,#485b77)]">
                    활성화 여부
                  </div>
                  <button
                    type="button"
                    className="relative h-[20px] w-[36px] rounded-full disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ backgroundColor: isDrawingActive ? '#22c55e' : '#e2e8f0' }}
                    aria-label="활성화 여부"
                    disabled={!activeDrawingId}
                    onClick={() => {
                      if (activeDrawingId) {
                        toggleDrawingActive(activeDrawingId)
                      }
                    }}
                  >
                    <span
                      className="absolute top-[2px] size-[16px] rounded-full border border-white bg-white"
                      style={{ left: isDrawingActive ? 18 : 2 }}
                    />
                  </button>
                </div>
              </div>

              <div className="relative min-h-[786px] min-w-0 flex-1 shrink-0">
                <div
                  ref={viewport.viewportRef}
                  className={`absolute inset-0 overflow-hidden touch-none select-none ${
                    viewport.zoom > 1 ? (viewport.isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
                  }`}
                  onPointerDown={viewport.onPointerDown}
                  onPointerMove={viewport.onPointerMove}
                  onPointerUp={viewport.endPointerDrag}
                  onPointerCancel={viewport.endPointerDrag}
                  onLostPointerCapture={viewport.onLostPointerCapture}
                >
                <div
                  className="relative h-full w-full"
                  style={{ transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px)` }}
                >
                  <div
                    className="relative h-full w-full"
                    style={{
                      transform: `scale(${viewport.zoom})`,
                      transformOrigin: '50% 40%',
                      transition: viewport.isPanning ? 'none' : 'transform 0.15s ease-out',
                    }}
                  >
                    <div className="relative h-full w-full overflow-hidden">
                      <div
                        className="pointer-events-none absolute left-0 w-full overflow-hidden"
                        style={{
                          top: `${DRAWING_IMAGE_SLOT_TOP_PCT}%`,
                          height: `${DRAWING_IMAGE_SLOT_HEIGHT_PCT}%`,
                        }}
                      >
                        <div className="relative h-full w-full">
                          <DrawingMedia
                            alt={drawingName}
                            src={activeDrawing?.imagePath}
                            fileKind={activeDrawing?.fileKind}
                          />
                          {isDrawingActive &&
                            (activeDrawing?.sensors ?? []).map((sensor) => {
                              const { leftPct, topPct } = getSensorPercentInSlot(sensor)
                              return (
                                <DrawingSensorDot
                                  key={sensor.id}
                                  leftPct={leftPct}
                                  topPct={topPct}
                                  variant={sensor.variant}
                                />
                              )
                            })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                </div>

                <div className="absolute bottom-[16px] right-[16px] z-20 flex flex-col-reverse items-center gap-[10px]">
                <button
                  type="button"
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full border border-[#e2e8f0] bg-white shadow-[0px_4px_14px_rgba(0,0,0,0.14)] transition-shadow hover:shadow-[0px_6px_18px_rgba(0,0,0,0.16)]"
                  aria-label={viewport.isFabOpen ? '도면 도구 닫기' : '도면 도구 열기'}
                  aria-expanded={viewport.isFabOpen}
                  onClick={() => viewport.setIsFabOpen((open) => !open)}
                >
                  {viewport.isFabOpen ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M18 6L6 18M6 6l12 12" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M4 7h16M4 12h16M4 17h16" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                </button>

                {viewport.isFabOpen && (
                  <div className="flex flex-col items-center gap-[2px] rounded-[9999px] border border-[#e2e8f0] bg-white px-[6px] py-[8px] shadow-[0px_4px_14px_rgba(0,0,0,0.14)]">
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면 확대"
                      onClick={viewport.zoomIn}
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgAddCircle} />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면 축소"
                      onClick={viewport.zoomOut}
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgDoNotDisturbOn} />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="도면 위치 초기화"
                      disabled={!viewport.canResetView}
                      onClick={viewport.resetView}
                    >
                      <DrawingViewResetIcon />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면/센서 생성으로 이동"
                      onClick={() => {
                        viewport.setIsFabOpen(false)
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
          </div>

          <div className="mt-[18px] flex shrink-0 items-center justify-center gap-[51px] text-[16px] text-[#0b1828]">
            <PaginationArrowButton direction="prev" onClick={goPrev} ariaLabel="이전 도면" />
            <div className="font-['Pretendard',sans-serif] font-normal leading-[20px]">
              {page} / {total}
            </div>
            <PaginationArrowButton direction="next" onClick={goNext} ariaLabel="다음 도면" />
          </div>
        </section>

        <aside className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-3 lg:h-full">
          <div className="flex min-h-[40px] shrink-0 items-center font-['Pretendard',sans-serif] text-[16px] font-semibold leading-[1.2] text-[color:var(--blue_primary_800,#4370ac)] -translate-y-[2px]">
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

                {cards.map((card) => {
                  const series = pressureSeriesByVariant[card.variant]
                  const unit = card.unitLabel.includes('L/min') ? 'L/min' : 'MPa'
                  const valueText =
                    series != null
                      ? `${series.latestValue.toFixed(2)} ${unit}`
                      : pressureSeriesError
                        ? `-- ${unit}`
                        : '--'

                  return (
                    <div key={card.id} className="w-full min-w-0">
                      <div
                        className="inline-flex w-fit max-w-full rounded-tl-[8px] rounded-tr-[8px] border-l border-r border-t border-[#e2e8f0] px-[12px] py-[4px]"
                        style={{ backgroundColor: card.headerBg }}
                      >
                        <div className="font-['Pretendard',sans-serif] text-[10px] leading-[15px] tracking-[0.5px] text-[#485b77]">
                          {card.title} : {valueText}
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
                                card.variant === 'green' ? '#7cbf6a' : '#caa23d',
                            } as CSSProperties
                          }
                          aria-label={`${card.title} 차트 상세 보기`}
                          onClick={() => setChartDetailId(card.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setChartDetailId(card.id)
                            }
                          }}
                        >
                          <PressureLineChart points={series?.points ?? []} variant={card.variant} />
                        </div>
                      </div>
                    </div>
                  )
                })}
                {!isDrawingActive && (
                  <div className="flex min-h-[140px] items-center justify-center px-[16px] text-center font-['Pretendard',sans-serif] text-[13px] leading-[1.6] text-[#7a89a1]">
                    비활성화 도면은 센서 차트와 센서 표시를 제공하지 않습니다.
                  </div>
                )}
                <div className="h-[4px]" />
              </div>
            </div>
          </div>
          <div className="mt-[18px] flex h-[20px] shrink-0 items-center justify-center gap-[51px]" aria-hidden="true" />
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
