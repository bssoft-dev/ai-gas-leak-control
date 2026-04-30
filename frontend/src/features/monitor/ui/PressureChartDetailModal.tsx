import { useEffect, useMemo, useState } from 'react'

import type { MonitorPressurePoint } from '../../../api/monitorPressureSeries'
import { PressureChartDetail } from './PressureChartDetail'

const STROKE = {
  green: '#7cbf6a',
  yellow: '#caa23d',
} as const

const BASE_WINDOW_MS = 18_000
const MIN_WINDOW_MS = 4_000
const MAX_ZOOM_LEVEL = 8

type Props = {
  open: boolean
  onClose: () => void
  title: string
  valueText: string
  headerBg: string
  variant: 'green' | 'yellow'
  points: MonitorPressurePoint[]
  hasSeriesError: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function PressureChartDetailModal({
  open,
  onClose,
  title,
  valueText,
  headerBg,
  variant,
  points,
  hasSeriesError,
}: Props) {
  const sortedPoints = useMemo(() => [...points].sort((a, b) => a.at - b.at), [points])
  const baseEnd = sortedPoints.length > 0 ? sortedPoints[sortedPoints.length - 1].at : Date.now()
  const baseStart = sortedPoints.length > 0 ? sortedPoints[0].at : baseEnd - BASE_WINDOW_MS
  const baseEndDate = useMemo(() => new Date(baseEnd), [baseEnd])
  const maxDateStr = useMemo(() => {
    const yyyy = baseEndDate.getFullYear()
    const mm = String(baseEndDate.getMonth() + 1).padStart(2, '0')
    const dd = String(baseEndDate.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }, [baseEndDate])
  const maxTimeStr = useMemo(() => {
    const hh = String(baseEndDate.getHours()).padStart(2, '0')
    const mm = String(baseEndDate.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }, [baseEndDate])

  const minDateStr = '2026-01-01'
  const [isPinnedToLatest, setIsPinnedToLatest] = useState(true)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [zoomLevel, setZoomLevel] = useState(1)
  const [viewEndAt, setViewEndAt] = useState(baseEnd)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    setIsPinnedToLatest(true)
    setSelectedDate(maxDateStr)
    setSelectedTime(maxTimeStr)
    setZoomLevel(1)
    setViewEndAt(baseEnd)
  }, [open])

  useEffect(() => {
    if (!open || !isPinnedToLatest) return
    setSelectedDate(maxDateStr)
    setSelectedTime(maxTimeStr)
  }, [open, isPinnedToLatest, maxDateStr, maxTimeStr])

  useEffect(() => {
    if (!selectedDate) return
    if (selectedDate > maxDateStr) {
      setSelectedDate(maxDateStr)
    } else if (selectedDate < minDateStr) {
      setSelectedDate(minDateStr)
    }
  }, [selectedDate, maxDateStr])

  useEffect(() => {
    if (selectedDate === maxDateStr && selectedTime > maxTimeStr) {
      setSelectedTime(maxTimeStr)
    }
  }, [selectedDate, selectedTime, maxDateStr, maxTimeStr])

  const anchorEndAt = useMemo(() => {
    const [year, month, day] = selectedDate.split('-').map(Number)
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return baseEnd
    }

    const [hoursText, minutesText] = selectedTime.split(':')
    const hours = Number.isFinite(Number(hoursText)) ? Number(hoursText) : baseEndDate.getHours()
    const minutes = Number.isFinite(Number(minutesText)) ? Number(minutesText) : baseEndDate.getMinutes()

    return new Date(year, month - 1, day, hours, minutes, 59, 999).getTime()
  }, [baseEnd, baseEndDate, selectedDate, selectedTime])

  const nearestAvailableEndAt = useMemo(() => {
    if (sortedPoints.length === 0) return anchorEndAt
    const clampedTarget = Math.min(anchorEndAt, baseEnd)
    const found = [...sortedPoints].reverse().find((point) => point.at <= clampedTarget)
    return found?.at ?? sortedPoints[sortedPoints.length - 1].at
  }, [anchorEndAt, baseEnd, sortedPoints])

  const yDomain = useMemo<[number, number]>(() => {
    if (sortedPoints.length === 0) return [0, 1]
    const values = sortedPoints.map((point) => point.value)
    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    if (minValue === maxValue) {
      return [minValue - 0.01, maxValue + 0.01]
    }
    return [minValue, maxValue]
  }, [sortedPoints])

  const currentWindowMs = useMemo(
    () => Math.max(MIN_WINDOW_MS, Math.round(BASE_WINDOW_MS / zoomLevel)),
    [zoomLevel],
  )

  useEffect(() => {
    if (!open) return
    if (isPinnedToLatest) {
      setViewEndAt(nearestAvailableEndAt)
      return
    }

    setViewEndAt((previous) => {
      const minEnd = baseStart + currentWindowMs
      const maxEnd = nearestAvailableEndAt
      if (minEnd > maxEnd) {
        return maxEnd
      }
      return clamp(previous, minEnd, maxEnd)
    })
  }, [open, isPinnedToLatest, nearestAvailableEndAt, baseStart, currentWindowMs])

  const viewStartAt = useMemo(() => viewEndAt - currentWindowMs, [currentWindowMs, viewEndAt])
  const canZoomIn = zoomLevel < MAX_ZOOM_LEVEL
  const canPan = zoomLevel > 1

  const handleZoomIn = () => {
    if (!canZoomIn) return
    setIsPinnedToLatest(false)
    setZoomLevel((previous) => Math.min(previous * 2, MAX_ZOOM_LEVEL))
  }

  const handlePan = (deltaMs: number) => {
    if (!canPan) return
    setIsPinnedToLatest(false)
    setViewEndAt((previous) => {
      const next = previous + deltaMs
      const minEnd = baseStart + currentWindowMs
      const maxEnd = nearestAvailableEndAt
      if (minEnd > maxEnd) {
        return maxEnd
      }
      return clamp(next, minEnd, maxEnd)
    })
  }

  const handlePinchZoom = (scaleRatio: number) => {
    setIsPinnedToLatest(false)
    setZoomLevel((previous) => clamp(previous * scaleRatio, 1, MAX_ZOOM_LEVEL))
  }

  const handleResetViewport = () => {
    setIsPinnedToLatest(true)
    setSelectedDate(maxDateStr)
    setSelectedTime(maxTimeStr)
    setZoomLevel(1)
    setViewEndAt(baseEnd)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-[#0b1828]/45 px-[24px] py-[24px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pressure-chart-detail-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="relative flex w-full max-w-[1120px] flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="pressure-chart-detail-title" className="sr-only">
          차트 상세
        </h2>

        <button
          type="button"
          className="absolute right-[16px] top-[16px] z-10 flex h-[20px] w-[20px] items-center justify-center text-[#94a3b8] transition-colors hover:text-[#485b77]"
          aria-label="닫기"
          onClick={onClose}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="flex items-center gap-[8px] px-[16px] py-[10px]">
          <div className="font-['Pretendard',sans-serif] text-[14px] font-semibold text-[#334155]">
            {title} : {valueText}
          </div>
        </div>
        <div className="h-px w-full bg-[#e5e7eb]" aria-hidden="true" />

        <div className="px-[16px] pb-[14px] pt-[10px]">
          <div className="relative h-[420px] w-full">
            {hasSeriesError && points.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center bg-white px-[12px] text-center font-['Pretendard',sans-serif] text-[12px] text-[#94a3b8]">
                차트 데이터를 불러오지 못했습니다.
              </div>
            ) : (
              <>
                <div className="absolute right-[12px] top-[12px] z-10 flex items-center gap-[8px]">
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    disabled={!canZoomIn}
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[#d7e1ee] bg-white text-[#607a9f] shadow-[0_4px_10px_rgba(15,23,42,0.08)] transition hover:border-[#61a0e1] hover:text-[#4370ac] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="차트 확대"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetViewport}
                    disabled={zoomLevel === 1 && isPinnedToLatest}
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[#d7e1ee] bg-white text-[#607a9f] shadow-[0_4px_10px_rgba(15,23,42,0.08)] transition hover:border-[#61a0e1] hover:text-[#4370ac] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="기본 비율로 복귀"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M21 12a9 9 0 1 1-2.64-6.36"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M21 3v6h-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>

                <PressureChartDetail
                  points={sortedPoints}
                  stroke={STROKE[variant]}
                  viewportStartAt={viewStartAt}
                  viewportEndAt={viewEndAt}
                  yDomain={yDomain}
                  canPan={canPan}
                  onPan={handlePan}
                  onPinchZoom={handlePinchZoom}
                />
              </>
            )}
          </div>

          <div className="mt-[10px] flex items-center justify-center gap-[10px]">
            <input
              type="date"
              className="h-[30px] rounded-[6px] border border-[#e2e8f0] bg-white px-[10px] font-['Pretendard',sans-serif] text-[12px] text-[#485b77]"
              value={selectedDate}
              onChange={(event) => {
                setIsPinnedToLatest(false)
                setSelectedDate(event.target.value)
              }}
              min={minDateStr}
              max={maxDateStr}
              aria-label="날짜 선택"
            />
            <input
              type="time"
              className="h-[30px] w-[100px] rounded-[6px] border border-[#e2e8f0] bg-white px-[10px] font-['Pretendard',sans-serif] text-[12px] text-[#485b77]"
              value={selectedTime}
              onChange={(event) => {
                setIsPinnedToLatest(false)
                setSelectedTime(event.target.value)
              }}
              max={selectedDate === maxDateStr ? maxTimeStr : undefined}
              step={60}
              aria-label="시간 선택"
            />
            <button
              type="button"
              className="h-[30px] rounded-[6px] border border-[#e2e8f0] bg-white px-[10px] font-['Pretendard',sans-serif] text-[12px] text-[#485b77] hover:bg-[#f8fafc]"
              onClick={() => {
                setIsPinnedToLatest(true)
                setSelectedDate(maxDateStr)
                setSelectedTime(maxTimeStr)
              }}
              aria-label="현재로 이동"
            >
              현재
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
