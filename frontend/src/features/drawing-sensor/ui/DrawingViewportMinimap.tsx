import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

import type { DrawingFileKind } from '../../../entities/drawing/lib/drawingFileKind'
import { getPanLimits } from '../../../entities/drawing/lib/drawingViewport'
import { DrawingMedia } from '../../../entities/drawing/ui/DrawingMedia'

type DrawingViewportMinimapProps = {
  zoom: number
  pan: { x: number; y: number }
  viewportRef: RefObject<HTMLDivElement | null>
  imagePath?: string
  fileKind?: DrawingFileKind
  drawingName: string
  onNavigate: (nx: number, ny: number) => void
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

export function DrawingViewportMinimap({
  zoom,
  pan,
  viewportRef,
  imagePath,
  fileKind,
  drawingName,
  onNavigate,
}: DrawingViewportMinimapProps) {
  const [vw, setVw] = useState(0)
  const [vh, setVh] = useState(0)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setVw(el.clientWidth)
      setVh(el.clientHeight)
    })
    ro.observe(el)
    setVw(el.clientWidth)
    setVh(el.clientHeight)
    return () => ro.disconnect()
  }, [viewportRef])

  const applyNavFromClient = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      onNavigate(clamp01((clientX - rect.left) / rect.width), clamp01((clientY - rect.top) / rect.height))
    },
    [onNavigate],
  )

  const onThumbPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const r = e.currentTarget.getBoundingClientRect()
    applyNavFromClient(e.clientX, e.clientY, r)
  }

  const onThumbPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const r = e.currentTarget.getBoundingClientRect()
    applyNavFromClient(e.clientX, e.clientY, r)
  }

  const onThumbPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  if (zoom <= 1 || vw < 16) return null

  const { maxX, maxY } = getPanLimits(vw, vh, zoom)
  const nxCenter = maxX > 0 ? 0.5 - pan.x / (2 * maxX) : 0.5
  const nyCenter = maxY > 0 ? 0.4 - pan.y / (2 * maxY) : 0.4
  const fracW = Math.min(1, 1 / zoom)
  const fracH = Math.min(1, 1 / zoom)
  let left = nxCenter - fracW / 2
  let top = nyCenter - fracH / 2
  left = Math.max(0, Math.min(1 - fracW, left))
  top = Math.max(0, Math.min(1 - fracH, top))

  return (
    <div
      className="pointer-events-auto absolute bottom-[16px] left-[16px] z-[25] w-[184px] overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white shadow-[0px_4px_14px_rgba(0,0,0,0.12)]"
      role="region"
      aria-label="도면 미니맵, 클릭 또는 드래그로 보는 위치를 이동합니다"
    >
      <button
        type="button"
        className="relative block h-[112px] w-full cursor-grab touch-none border-0 bg-[#f1f5f9] p-0 text-left active:cursor-grabbing"
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={onThumbPointerUp}
        onPointerCancel={onThumbPointerUp}
        onLostPointerCapture={onThumbPointerUp}
      >
        {imagePath ? (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <DrawingMedia alt={drawingName} src={imagePath} fileKind={fileKind} />
          </div>
        ) : null}
        <div
          className="pointer-events-none absolute border-2 border-[#4370ac] bg-[#4370ac]/20"
          style={{
            left: `${left * 100}%`,
            top: `${top * 100}%`,
            width: `${fracW * 100}%`,
            height: `${fracH * 100}%`,
          }}
        />
        <span className="sr-only">클릭 또는 끌어서 도면 보기 위치를 바꿉니다</span>
      </button>
    </div>
  )
}
