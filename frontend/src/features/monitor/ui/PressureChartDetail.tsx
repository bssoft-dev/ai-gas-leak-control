import { useId, useMemo, useRef, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { MonitorPressurePoint } from '../../../api/monitorPressureSeries'

type Props = {
  points: MonitorPressurePoint[]
  stroke: string
  viewportStartAt: number
  viewportEndAt: number
  yDomain: [number, number]
  canPan: boolean
  onPan: (deltaMs: number) => void
  onPinchZoom: (scaleRatio: number) => void
}

const TICK_STEP_MS = 2000

const timeTickFormatter = (t: number) => {
  const date = new Date(t)
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function uniformHorizontalGrid(
  props: { offset: { top: number; height: number } },
  _syncWithTicks: boolean,
): number[] {
  const { top, height } = props.offset
  if (!Number.isFinite(height) || height <= 0) return []
  const segments = 4
  const coords: number[] = []
  for (let i = 0; i <= segments; i++) {
    coords.push(top + (height * i) / segments)
  }
  return coords
}

function interpolateBoundaryPoint(
  left: MonitorPressurePoint,
  right: MonitorPressurePoint,
  targetAt: number,
): MonitorPressurePoint {
  if (right.at === left.at) {
    return { at: targetAt, value: right.value }
  }

  const ratio = (targetAt - left.at) / (right.at - left.at)
  return {
    at: targetAt,
    value: left.value + (right.value - left.value) * ratio,
  }
}

export function PressureChartDetail({
  points,
  stroke,
  viewportStartAt,
  viewportEndAt,
  yDomain,
  canPan,
  onPan,
  onPinchZoom,
}: Props) {
  const gid = useId()
  const gradientId = `pressureDetailFill-${gid.replace(/:/g, '')}`
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pointerStartRef = useRef<{ x: number; width: number } | null>(null)
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchDistanceRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const sortedPoints = useMemo(() => [...points].sort((a, b) => a.at - b.at), [points])
  const chartData = useMemo(() => {
    const inWindow = sortedPoints.filter((point) => point.at >= viewportStartAt && point.at <= viewportEndAt)
    const beforeStart = [...sortedPoints].reverse().find((point) => point.at < viewportStartAt)
    const afterStart = sortedPoints.find((point) => point.at > viewportStartAt)
    const beforeEnd = [...sortedPoints].reverse().find((point) => point.at < viewportEndAt)
    const afterEnd = sortedPoints.find((point) => point.at > viewportEndAt)
    const nextData = [...inWindow]

    if (beforeStart && afterStart && !nextData.some((point) => point.at === viewportStartAt)) {
      nextData.unshift(interpolateBoundaryPoint(beforeStart, afterStart, viewportStartAt))
    }

    if (beforeEnd && afterEnd && !nextData.some((point) => point.at === viewportEndAt)) {
      nextData.push(interpolateBoundaryPoint(beforeEnd, afterEnd, viewportEndAt))
    }

    return nextData
  }, [sortedPoints, viewportEndAt, viewportStartAt])

  const xTicks = useMemo(() => {
    const alignedStart = Math.ceil(viewportStartAt / TICK_STEP_MS) * TICK_STEP_MS
    const alignedEnd = Math.floor(viewportEndAt / TICK_STEP_MS) * TICK_STEP_MS
    const ticks: number[] = []
    for (let current = alignedStart; current <= alignedEnd; current += TICK_STEP_MS) {
      ticks.push(current)
    }
    if (ticks.length === 0) {
      ticks.push(alignedEnd)
    } else if (ticks[ticks.length - 1] !== alignedEnd) {
      ticks.push(alignedEnd)
    }
    return ticks
  }, [viewportEndAt, viewportStartAt])

  const applyPanDelta = (deltaPixels: number, width: number) => {
    if (!canPan || width <= 0) return
    const duration = viewportEndAt - viewportStartAt
    const deltaMs = (-deltaPixels / width) * duration
    onPan(deltaMs)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (activePointersRef.current.size === 2) {
      const [first, second] = [...activePointersRef.current.values()]
      pinchDistanceRef.current = Math.hypot(second.x - first.x, second.y - first.y)
      pointerStartRef.current = null
      setIsDragging(false)
    } else if (canPan && containerRef.current) {
      pointerStartRef.current = {
        x: event.clientX,
        width: containerRef.current.clientWidth,
      }
      setIsDragging(true)
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) return
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (activePointersRef.current.size === 2) {
      const [first, second] = [...activePointersRef.current.values()]
      const nextDistance = Math.hypot(second.x - first.x, second.y - first.y)
      const previousDistance = pinchDistanceRef.current
      if (previousDistance && previousDistance > 0) {
        const scaleRatio = nextDistance / previousDistance
        if (Math.abs(scaleRatio - 1) > 0.02) {
          onPinchZoom(scaleRatio)
          pinchDistanceRef.current = nextDistance
        }
      } else {
        pinchDistanceRef.current = nextDistance
      }
      return
    }

    if (!canPan || !pointerStartRef.current) return
    const { x, width } = pointerStartRef.current
    if (width <= 0) return
    const deltaX = event.clientX - x
    applyPanDelta(deltaX, width)
    pointerStartRef.current = {
      x: event.clientX,
      width,
    }
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(event.pointerId)
    if (activePointersRef.current.size < 2) {
      pinchDistanceRef.current = null
    }
    if (pointerStartRef.current) {
      pointerStartRef.current = null
      setIsDragging(false)
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!canPan || !containerRef.current) return
    const dominantDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (dominantDelta === 0) return
    event.preventDefault()
    applyPanDelta(dominantDelta, containerRef.current.clientWidth)
  }

  if (chartData.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white text-[12px] text-[#94a3b8]">
        데이터 없음
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`h-full w-full touch-none select-none outline-none [&_*]:outline-none [&_*]:focus:outline-none ${
        canPan ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 16, right: 18, left: 10, bottom: 8 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.14} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="#eef2f6"
            strokeOpacity={0.9}
            vertical={false}
            syncWithTicks={false}
            horizontalCoordinatesGenerator={uniformHorizontalGrid}
          />

          <XAxis
            dataKey="at"
            type="number"
            domain={[viewportStartAt, viewportEndAt]}
            ticks={xTicks}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(value) => (typeof value === 'number' ? timeTickFormatter(value) : '')}
            axisLine={false}
            tickLine={false}
          />

          <YAxis
            domain={yDomain}
            tick={{ fontSize: 11, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            width={36}
          />

          <Tooltip
            labelFormatter={(value) =>
              typeof value === 'number'
                ? new Date(value).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : ''
            }
            formatter={(value) => [`${Number(value).toFixed(2)} MPa`, '압력']}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              boxShadow: '0 6px 18px rgba(0,0,0,0.10)',
            }}
          />

          <Area
            type="monotone"
            dataKey="value"
            stroke="none"
            fill={`url(#${gradientId})`}
            fillOpacity={1}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: stroke }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
