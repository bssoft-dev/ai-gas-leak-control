import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react'

import {
  clampDrawingPan,
  DRAWING_ZOOM_MAX,
  DRAWING_ZOOM_MIN,
  DRAWING_ZOOM_STEP,
  getPanLimits,
} from '../lib/drawingViewport'

type PointerDragState = {
  active: boolean
  pointerId: number
  lastX: number
  lastY: number
}

export function useDrawingViewport(resetKey: string) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [isFabOpen, setIsFabOpen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<PointerDragState | null>(null)

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setIsFabOpen(false)
  }, [resetKey])

  useEffect(() => {
    if (zoom <= 1) {
      setPan({ x: 0, y: 0 })
      return
    }
    const el = viewportRef.current
    if (!el) return
    const { clientWidth: vw, clientHeight: vh } = el
    setPan((current) => clampDrawingPan(current.x, current.y, zoom, vw, vh))
  }, [zoom])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (zoom <= 1) return
      if (e.button !== 0) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-sensor-drawing-slot]')) {
        return
      }
      const el = viewportRef.current
      if (!el) return
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      dragRef.current = {
        active: true,
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastY: e.clientY,
      }
      setIsPanning(true)
    },
    [zoom],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current
      if (!drag?.active || e.pointerId !== drag.pointerId) return
      const dx = e.clientX - drag.lastX
      const dy = e.clientY - drag.lastY
      drag.lastX = e.clientX
      drag.lastY = e.clientY

      const el = viewportRef.current
      if (!el) return
      const { clientWidth: vw, clientHeight: vh } = el
      setPan((current) => clampDrawingPan(current.x + dx, current.y + dy, zoom, vw, vh))
    },
    [zoom],
  )

  const endPointerDrag = useCallback((e: ReactPointerEvent) => {
    const drag = dragRef.current
    if (!drag?.active || e.pointerId !== drag.pointerId) return
    dragRef.current = null
    setIsPanning(false)
    try {
      viewportRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }, [])

  const panToSlotFraction = useCallback((nx: number, ny: number) => {
    const el = viewportRef.current
    if (!el || zoom <= 1) return
    const vw = el.clientWidth
    const vh = el.clientHeight
    const { maxX, maxY } = getPanLimits(vw, vh, zoom)
    const px = (0.5 - nx) * 2 * maxX
    const py = (0.4 - ny) * 2 * maxY
    setPan(clampDrawingPan(px, py, zoom, vw, vh))
  }, [zoom])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const zoomIn = useCallback(() => {
    setZoom((current) => Math.min(DRAWING_ZOOM_MAX, Math.round((current + DRAWING_ZOOM_STEP) * 1000) / 1000))
  }, [])

  const zoomOut = useCallback(() => {
    setZoom((current) => Math.max(DRAWING_ZOOM_MIN, Math.round((current - DRAWING_ZOOM_STEP) * 1000) / 1000))
  }, [])

  return {
    zoom,
    pan,
    isPanning,
    isFabOpen,
    setIsFabOpen,
    viewportRef,
    onPointerDown,
    onPointerMove,
    endPointerDrag,
    resetView,
    zoomIn,
    zoomOut,
    panToSlotFraction,
    canResetView: zoom !== 1 || pan.x !== 0 || pan.y !== 0,
    onLostPointerCapture: () => {
      dragRef.current = null
      setIsPanning(false)
    },
  }
}
