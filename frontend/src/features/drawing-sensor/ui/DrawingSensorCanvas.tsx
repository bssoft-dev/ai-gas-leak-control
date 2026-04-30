import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

import {
  DRAWING_IMAGE_SLOT_HEIGHT_PCT,
  DRAWING_IMAGE_SLOT_TOP_PCT,
} from '../../../entities/drawing/lib/drawingSensorPosition'
import type { DrawingDetail } from '../../../entities/drawing/model/activeDrawing'
import { DrawingMedia } from '../../../entities/drawing/ui/DrawingMedia'
import { DrawingSensorDot } from '../../../entities/drawing/ui/DrawingSensorDot'
import {
  DrawingResetIcon,
  DrawingZoomInIcon,
  DrawingZoomOutIcon,
} from '../../../entities/drawing/ui/DrawingToolIcons'
import type { RegisteredSensor } from '../model/registeredSensor'
import { DrawingViewportMinimap } from './DrawingViewportMinimap'

type DisplaySensor = Pick<RegisteredSensor, 'id' | 'xPct' | 'yPct' | 'color' | 'label'>

type DrawingSensorCanvasProps = {
  drawingName: string
  activeDrawing: DrawingDetail | null
  displaySensors: DisplaySensor[]
  selectedSensorId: string | null
  enabled: boolean
  onToggleEnabled: () => void
  onOpenUploadDialog: () => void
  isUploadingDrawings: boolean
  pendingPlacement: { leftPct: number; topPct: number } | null
  unit: 'pressure' | 'flow'
  drawingCanvasRef: RefObject<HTMLDivElement>
  viewportRef: RefObject<HTMLDivElement>
  zoom: number
  pan: { x: number; y: number }
  isPanning: boolean
  isFabOpen: boolean
  canResetView: boolean
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerUp: (e: ReactPointerEvent) => void
  onPointerCancel: (e: ReactPointerEvent) => void
  onLostPointerCapture: () => void
  onCanvasClick: (e: ReactMouseEvent<HTMLDivElement>) => void
  onToggleFab: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onResetView: () => void
  onMoveToMonitor: () => void
  onPanToSlotFraction: (nx: number, ny: number) => void
}

export function DrawingSensorCanvas({
  drawingName,
  activeDrawing,
  displaySensors,
  selectedSensorId,
  enabled,
  onToggleEnabled,
  onOpenUploadDialog,
  isUploadingDrawings,
  pendingPlacement,
  unit,
  drawingCanvasRef,
  viewportRef,
  zoom,
  pan,
  isPanning,
  isFabOpen,
  canResetView,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onCanvasClick,
  onToggleFab,
  onZoomIn,
  onZoomOut,
  onResetView,
  onMoveToMonitor,
  onPanToSlotFraction,
}: DrawingSensorCanvasProps) {
  return (
    <section className="col-span-12 flex min-h-0 min-w-0 flex-col xl:col-span-9 xl:h-full">
      <div className="flex min-h-[40px] shrink-0 items-center justify-between gap-[12px]">
        <div className="font-['Pretendard',sans-serif] text-[16px] font-semibold leading-[1.2] text-[color:var(--blue_primary_800,#4370ac)]">
          {drawingName}
        </div>

        <button
          type="button"
          className="flex h-[36px] shrink-0 items-center justify-center gap-[6px] rounded-[4px] bg-[var(--blue_icon,#1392ec)] px-[18px] py-[6px] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="도면 추가"
          disabled={isUploadingDrawings}
          onClick={onOpenUploadDialog}
        >
          <span className="material-symbols-rounded text-[18px] leading-none text-white">upload_file</span>
          <span className="whitespace-nowrap font-['Pretendard',sans-serif] text-[15px] font-medium leading-[15px] tracking-[-0.2px] text-white">
            {isUploadingDrawings ? '업로드 중...' : '도면 추가'}
          </span>
        </button>
      </div>

      <div className="mt-[8px] flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.12),0px_1px_3px_1px_rgba(0,0,0,0.05)]">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-[12px] gap-y-[8px] px-[16px] pb-[12px] pt-[16px] md:px-[24px] xl:px-[32px] xl:pt-[24px]">
            <div className="font-['Pretendard',sans-serif] text-[14px] font-normal leading-[normal] text-[color:var(--black_500,#485b77)]">
              도면 내 설치 위치 등록 (도면을 클릭하여 센서 추가)
            </div>

            <div className="flex items-center gap-[12px] py-[4px]">
              <div className="font-['Pretendard',sans-serif] text-[14px] font-normal leading-[normal] text-[color:var(--black_500,#485b77)]">
                활성화 여부
              </div>
              <button
                type="button"
                className="relative h-[20px] w-[36px] rounded-full"
                style={{ backgroundColor: enabled ? '#22c55e' : '#e2e8f0' }}
                aria-label="활성화 여부"
                onClick={onToggleEnabled}
              >
                <span
                  className="absolute top-[2px] size-[16px] rounded-full border border-white bg-white"
                  style={{ left: enabled ? 18 : 2 }}
                />
              </button>
            </div>
          </div>

          <div className="relative min-h-[420px] min-w-0 flex-1 md:min-h-[560px] xl:min-h-[786px]">
            <div
              ref={viewportRef}
              className={`absolute inset-0 overflow-hidden touch-none select-none ${
                zoom > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
              }`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onLostPointerCapture={onLostPointerCapture}
            >
              <div className="relative h-full w-full" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
                <div
                  className="relative h-full w-full"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: '50% 40%',
                    transition: isPanning ? 'none' : 'transform 0.15s ease-out',
                  }}
                >
                  <div className="relative h-full w-full overflow-hidden">
                    <div
                      ref={drawingCanvasRef}
                      data-sensor-drawing-slot
                      className={`absolute left-0 w-full overflow-hidden ${
                        enabled ? 'cursor-crosshair' : 'cursor-not-allowed opacity-90'
                      }`}
                      style={{
                        top: `${DRAWING_IMAGE_SLOT_TOP_PCT}%`,
                        height: `${DRAWING_IMAGE_SLOT_HEIGHT_PCT}%`,
                      }}
                      onClick={onCanvasClick}
                      role="presentation"
                    >
                      <div className="pointer-events-none relative h-full w-full">
                        <DrawingMedia
                          alt={drawingName}
                          src={activeDrawing?.imagePath}
                          fileKind={activeDrawing?.fileKind}
                        />
                        {displaySensors.map((sensor) => (
                          <DrawingSensorDot
                            key={sensor.id}
                            leftPct={sensor.xPct}
                            topPct={sensor.yPct}
                            variant={sensor.color === 'orange' ? 'yellow' : 'green'}
                            label={sensor.label}
                            forceShowLabel={selectedSensorId === sensor.id}
                          />
                        ))}
                        {pendingPlacement && (
                          <DrawingSensorDot
                            leftPct={pendingPlacement.leftPct}
                            topPct={pendingPlacement.topPct}
                            variant={unit === 'pressure' ? 'green' : 'yellow'}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pointer-events-none absolute inset-0 z-20">
              <div className="pointer-events-auto absolute bottom-[16px] right-[16px]">
                <div className="relative h-[44px] w-[44px]">
                <button
                  type="button"
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full border border-[#e2e8f0] bg-white shadow-[0px_3px_10px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0px_4px_12px_rgba(0,0,0,0.10)]"
                  aria-label={isFabOpen ? '도면 도구 닫기' : '도면 도구 열기'}
                  aria-expanded={isFabOpen}
                  onClick={onToggleFab}
                >
                  {isFabOpen ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M18 6L6 18M6 6l12 12" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M4 7h16M4 12h16M4 17h16" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                </button>

                {isFabOpen && (
                  <div className="absolute bottom-[54px] right-0 flex flex-col items-center gap-[2px] rounded-[9999px] border border-[#e2e8f0] bg-white px-[6px] py-[8px] shadow-[0px_3px_10px_rgba(0,0,0,0.08)]">
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면 확대"
                      onClick={onZoomIn}
                    >
                      <DrawingZoomInIcon />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면 축소"
                      onClick={onZoomOut}
                    >
                      <DrawingZoomOutIcon />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="도면 위치 초기화"
                      disabled={!canResetView}
                      onClick={onResetView}
                    >
                      <DrawingResetIcon />
                    </button>
                  </div>
                )}
                </div>
              </div>
            </div>

            <DrawingViewportMinimap
              zoom={zoom}
              pan={pan}
              viewportRef={viewportRef}
              imagePath={activeDrawing?.imagePath}
              fileKind={activeDrawing?.fileKind}
              drawingName={drawingName}
              onNavigate={onPanToSlotFraction}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
