import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

import {
  DRAWING_IMAGE_SLOT_HEIGHT_PCT,
  DRAWING_IMAGE_SLOT_TOP_PCT,
} from '../../../entities/drawing/lib/drawingSensorPosition'
import type { DrawingDetail } from '../../../entities/drawing/model/activeDrawing'
import { DrawingMedia } from '../../../entities/drawing/ui/DrawingMedia'
import { DrawingSensorDot } from '../../../entities/drawing/ui/DrawingSensorDot'
import { DrawingViewResetIcon } from '../../../entities/drawing/ui/DrawingViewResetIcon'
import { monitorAssets } from '../../monitor/assets/monitorAssets'
import { drawingSensorAssets } from '../assets/drawingSensorAssets'
import type { RegisteredSensor } from '../model/registeredSensor'

type DisplaySensor = Pick<RegisteredSensor, 'id' | 'xPct' | 'yPct' | 'color'>

type DrawingSensorCanvasProps = {
  drawingName: string
  activeDrawing: DrawingDetail | null
  displaySensors: DisplaySensor[]
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
}

export function DrawingSensorCanvas({
  drawingName,
  activeDrawing,
  displaySensors,
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
}: DrawingSensorCanvasProps) {
  const { imgAttachFileAdd } = drawingSensorAssets

  return (
    <section className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-9 lg:h-full">
      <div className="flex min-h-[40px] shrink-0 items-center justify-between gap-[12px]">
        <div className="font-['Pretendard',sans-serif] text-[16px] font-semibold leading-[1.2] text-[color:var(--blue_primary_800,#4370ac)]">
          {drawingName}
        </div>

        <button
          type="button"
          className="flex h-[40px] shrink-0 items-center justify-center gap-[8px] rounded-[4px] bg-[var(--blue_icon,#1392ec)] px-[22px] py-[8px] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="도면 추가"
          disabled={isUploadingDrawings}
          onClick={onOpenUploadDialog}
        >
          <img alt="" className="block h-[20px] w-[20px]" src={imgAttachFileAdd} />
          <span className="whitespace-nowrap font-['Pretendard',sans-serif] text-[16px] font-medium leading-[15px] tracking-[-0.25px] text-white">
            {isUploadingDrawings ? '업로드 중...' : '도면 추가'}
          </span>
        </button>
      </div>

      <div className="mt-[12px] flex min-h-0 flex-1 flex-col">
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

          <div className="relative min-h-[786px] min-w-0 flex-1">
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
                      className={`absolute left-0 w-full overflow-hidden ${zoom <= 1 ? 'cursor-crosshair' : ''}`}
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
              <div className="pointer-events-auto absolute bottom-[16px] right-[16px] flex flex-col-reverse items-center gap-[10px]">
                <button
                  type="button"
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full border border-[#e2e8f0] bg-white shadow-[0px_4px_14px_rgba(0,0,0,0.14)] transition-shadow hover:shadow-[0px_6px_18px_rgba(0,0,0,0.16)]"
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
                  <div className="flex flex-col items-center gap-[2px] rounded-[9999px] border border-[#e2e8f0] bg-white px-[6px] py-[8px] shadow-[0px_4px_14px_rgba(0,0,0,0.14)]">
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면 확대"
                      onClick={onZoomIn}
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgAddCircle} />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면 축소"
                      onClick={onZoomOut}
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgDoNotDisturbOn} />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="도면 위치 초기화"
                      disabled={!canResetView}
                      onClick={onResetView}
                    >
                      <DrawingViewResetIcon />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="관제 화면으로 이동"
                      onClick={onMoveToMonitor}
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgEditSquare} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
