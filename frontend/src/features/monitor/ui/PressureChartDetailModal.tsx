import { useEffect, useMemo, useRef, useState } from 'react'

import type { MonitorPressurePoint } from '../../../api/monitorPressureSeries'
import { PressureChartDetail } from './PressureChartDetail'

const STROKE = {
  green: '#34d399',
  yellow: '#fbbf24',
} as const

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => pad2(i))
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => pad2(i))

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

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function parseYmd(ymd: string): Date | null {
  if (!ymd) return null
  const [y, m, d] = ymd.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatYmd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function isSameYmd(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function clampDate(date: Date, minYmd: string, maxYmd: string): Date {
  const min = parseYmd(minYmd)
  const max = parseYmd(maxYmd)
  const t = date.getTime()
  if (min && t < min.getTime()) return min
  if (max && t > max.getTime()) return max
  return date
}

type OpenPickerKey = 'date' | 'time' | null

function InlineDatePicker({
  value,
  onChange,
  minYmd,
  maxYmd,
  openKey,
  setOpenKey,
}: {
  value: string
  onChange: (next: string) => void
  minYmd: string
  maxYmd: string
  openKey: OpenPickerKey
  setOpenKey: (key: OpenPickerKey) => void
}) {
  const open = openKey === 'date'
  const selectedDate = useMemo(() => parseYmd(value), [value])
  const maxDate = useMemo(() => parseYmd(maxYmd) ?? new Date(), [maxYmd])
  const minDate = useMemo(() => parseYmd(minYmd) ?? new Date(1970, 0, 1), [minYmd])

  const initialMonth = useMemo(() => {
    const base = selectedDate ?? parseYmd(maxYmd) ?? new Date()
    return startOfMonth(base)
  }, [maxYmd, selectedDate])
  const [visibleMonth, setVisibleMonth] = useState<Date>(initialMonth)

  useEffect(() => {
    if (!selectedDate) return
    setVisibleMonth(startOfMonth(selectedDate))
  }, [selectedDate])

  // 바깥 클릭 닫기는 상위(모달)에서 공통 처리

  const monthLabel = useMemo(() => {
    const yyyy = visibleMonth.getFullYear()
    const mm = visibleMonth.toLocaleString('en-US', { month: 'long' })
    return `${mm} ${yyyy}`
  }, [visibleMonth])

  const days = useMemo(() => {
    const first = startOfMonth(visibleMonth)
    const startDow = first.getDay()
    const start = new Date(first)
    start.setDate(first.getDate() - startDow)

    const grid: { date: Date; inMonth: boolean; disabled: boolean }[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const inMonth = d.getMonth() === visibleMonth.getMonth()
      const disabled = d.getTime() < minDate.getTime() || d.getTime() > maxDate.getTime()
      grid.push({ date: d, inMonth, disabled })
    }
    return grid
  }, [maxDate, minDate, visibleMonth])

  return (
    <div className="relative" data-datepicker-root>
      <button
        type="button"
        onClick={() => setOpenKey(open ? null : 'date')}
        className="flex h-[30px] w-[115px] items-center justify-between rounded-[6px] border border-[#e2e8f0] bg-white px-[10px] font-['Pretendard',sans-serif] text-[12px] text-[#485b77] pointer-events-auto transition focus:border-[#e2e8f0] focus:ring-0 focus:ring-offset-0 focus:[outline:0] focus:[box-shadow:none] focus-visible:[outline:0] focus-visible:[box-shadow:none]"
        aria-label="날짜 선택"
        aria-expanded={open}
      >
        <span className={value ? '' : 'text-[#94a3b8]'}>{value || 'YYYY-MM-DD'}</span>
        <span className="material-symbols-rounded text-[18px] leading-none text-[#485b77]" aria-hidden="true">
          calendar_month
        </span>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-30 mb-[8px] rounded-[8px] border border-[#e2e8f0] bg-white p-[16px] shadow-[0px_12px_28px_rgba(15,23,42,0.12)]"
          style={{ width: 'min(92vw, 312px)' }}
        >
          <div className="relative flex items-center justify-center pb-[10px]">
            <button
              type="button"
              className="absolute left-0 flex h-[32px] w-[32px] items-center justify-center rounded-[6px] hover:bg-[#f1f5f9] active:bg-[#e2e8f0]"
              aria-label="이전 달"
              onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))}
            >
              <span className="material-symbols-rounded text-[20px] leading-none text-[#485b77]" aria-hidden="true">
                chevron_left
              </span>
            </button>
            <div className="font-[Pretendard,sans-serif] text-[14px] font-semibold text-[#0f172a]">{monthLabel}</div>
            <button
              type="button"
              className="absolute right-0 flex h-[32px] w-[32px] items-center justify-center rounded-[6px] hover:bg-[#f1f5f9] active:bg-[#e2e8f0]"
              aria-label="다음 달"
              onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}
            >
              <span className="material-symbols-rounded text-[20px] leading-none text-[#485b77]" aria-hidden="true">
                chevron_right
              </span>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-[4px] pb-[4px] text-center font-[Pretendard,sans-serif] text-[11px] font-semibold text-[#64748b]">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-[6px]">
            {days.map(({ date, inMonth, disabled }) => {
              const isSelected = selectedDate ? isSameYmd(date, selectedDate) : false
              const isToday = isSameYmd(date, new Date())
              const baseText = inMonth ? '#0f172a' : '#9aacbf'
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  disabled={disabled}
                  className={`h-[34px] rounded-[8px] text-[13px] transition ${
                    disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-[#f1f5f9] active:bg-[#e2e8f0]'
                  } ${isSelected ? 'bg-[#4370ac] text-white' : ''}`}
                  style={{
                    color: isSelected ? '#ffffff' : baseText,
                    border: isToday && !isSelected ? '1px solid rgba(97,160,225,0.55)' : '1px solid transparent',
                  }}
                  onClick={() => {
                    const next = clampDate(date, minYmd, maxYmd)
                    onChange(formatYmd(next))
                    setOpenKey(null)
                  }}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function InlineTimePicker({
  value,
  onChange,
  openKey,
  setOpenKey,
  onConfirm,
}: {
  value: string
  onChange: (next: string) => void
  openKey: OpenPickerKey
  setOpenKey: (key: OpenPickerKey) => void
  onConfirm: () => void
}) {
  const open = openKey === 'time'
  const [hh, mm] = value.split(':')
  const hour24 = Number.isFinite(Number(hh)) ? Number(hh) : 0
  const minute = Number.isFinite(Number(mm)) ? Number(mm) : 0
  const isPm = hour24 >= 12
  const hour12 = ((hour24 + 11) % 12) + 1

  const setFromParts = (nextIsPm: boolean, nextHour12: number, nextMinute: number) => {
    const clampedHour12 = Math.min(12, Math.max(1, Math.trunc(nextHour12)))
    const clampedMinute = ((Math.trunc(nextMinute) % 60) + 60) % 60
    const baseHour24 = clampedHour12 % 12
    const nextHour24 = baseHour24 + (nextIsPm ? 12 : 0)
    onChange(`${pad2(nextHour24)}:${pad2(clampedMinute)}`)
  }

  const stepWrap = (current: number, delta: number, mod: number) => ((current + delta) % mod + mod) % mod

  const handleWheel =
    (kind: 'ampm' | 'hour' | 'minute') => (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? 1 : -1
      if (kind === 'ampm') {
        setFromParts(!isPm, hour12, minute)
        return
      }
      if (kind === 'hour') {
        const next = stepWrap(hour12 - 1, delta, 12) + 1
        setFromParts(isPm, next, minute)
        return
      }
      const next = stepWrap(minute, delta, 60)
      setFromParts(isPm, hour12, next)
    }

  const ampmItems = useMemo(() => ['AM', 'PM'] as const, [])

  const prevNextHour = useMemo(() => {
    const prev = ((hour12 + 10) % 12) + 1
    const next = (hour12 % 12) + 1
    return { prev: pad2(prev), cur: pad2(hour12), next: pad2(next) }
  }, [hour12])

  const prevNextMinute = useMemo(() => {
    const prev = (minute + 59) % 60
    const next = (minute + 1) % 60
    return { prev: pad2(prev), cur: pad2(minute), next: pad2(next) }
  }, [minute])

  return (
    <div className="relative" data-timepicker-root>
      <button
        type="button"
        onClick={() => setOpenKey(open ? null : 'time')}
        className="flex h-[30px] w-[115px] items-center justify-between rounded-[6px] border border-[#e2e8f0] bg-white px-[10px] font-['Pretendard',sans-serif] text-[12px] text-[#485b77] pointer-events-auto transition focus:border-[#e2e8f0] focus:ring-0 focus:ring-offset-0 focus:[outline:0] focus:[box-shadow:none] focus-visible:[outline:0] focus-visible:[box-shadow:none]"
        aria-label="시간 선택"
        aria-expanded={open}
      >
        <span>{value}</span>
        <span className="material-symbols-rounded text-[18px] leading-none text-[#485b77]" aria-hidden="true">
          schedule
        </span>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-30 mb-[8px] rounded-[8px] border border-[#e2e8f0] bg-white p-[16px] shadow-[0px_12px_28px_rgba(15,23,42,0.12)]"
          style={{ width: 'min(92vw, 312px)' }}
        >
          <div className="h-[2px]" />

          <div className="grid grid-cols-3 gap-[10px]">
            <div className="flex flex-col items-stretch gap-[6px]">
              <div className="text-center font-[Pretendard,sans-serif] text-[12px] font-semibold text-[#64748b]">
                AM/PM
              </div>
              <div
                className="relative h-[92px] overflow-hidden rounded-[8px] border border-[#eef2f6] bg-white select-none"
                onWheel={handleWheel('ampm')}
                role="spinbutton"
                aria-label="AM/PM 선택"
                aria-valuetext={isPm ? 'PM' : 'AM'}
              >
                <div className="absolute inset-x-[8px] top-1/2 h-[34px] -translate-y-1/2 rounded-[8px] bg-[#f1f5f9]" aria-hidden />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-[6px]">
                  {/* 3 슬롯(위/가운데/아래)로 고정 정렬: 선택된 값은 항상 가운데 */}
                  {(() => {
                    const cur = isPm ? 'PM' : 'AM'
                    const other = isPm ? 'AM' : 'PM'
                    const top = isPm ? other : ''
                    const bottom = isPm ? '' : other
                    return (
                      <>
                        <div className={`text-[13px] font-medium text-[#94a3b8] ${top ? '' : 'opacity-0'}`}>
                          {top || '00'}
                        </div>
                        <div className="text-[16px] font-semibold text-[#0f172a]">{cur}</div>
                        <div className={`text-[13px] font-medium text-[#94a3b8] ${bottom ? '' : 'opacity-0'}`}>
                          {bottom || '00'}
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-[6px]">
              <div className="text-center font-[Pretendard,sans-serif] text-[12px] font-semibold text-[#64748b]">시간</div>
              <div
                className="relative h-[92px] overflow-hidden rounded-[8px] border border-[#eef2f6] bg-white select-none"
                onWheel={handleWheel('hour')}
                role="spinbutton"
                aria-label="시간 선택"
                aria-valuemin={1}
                aria-valuemax={12}
                aria-valuenow={hour12}
              >
                <div className="absolute inset-x-[8px] top-1/2 h-[34px] -translate-y-1/2 rounded-[8px] bg-[#f1f5f9]" aria-hidden />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-[6px]">
                  <div className="text-[13px] font-medium text-[#94a3b8]">{prevNextHour.prev}</div>
                  <div className="text-[16px] font-semibold text-[#0f172a]">{prevNextHour.cur}</div>
                  <div className="text-[13px] font-medium text-[#94a3b8]">{prevNextHour.next}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-[6px]">
              <div className="text-center font-[Pretendard,sans-serif] text-[12px] font-semibold text-[#64748b]">분</div>
              <div
                className="relative h-[92px] overflow-hidden rounded-[8px] border border-[#eef2f6] bg-white select-none"
                onWheel={handleWheel('minute')}
                role="spinbutton"
                aria-label="분 선택"
                aria-valuemin={0}
                aria-valuemax={59}
                aria-valuenow={minute}
              >
                <div className="absolute inset-x-[8px] top-1/2 h-[34px] -translate-y-1/2 rounded-[8px] bg-[#f1f5f9]" aria-hidden />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-[6px]">
                  <div className="text-[13px] font-medium text-[#94a3b8]">{prevNextMinute.prev}</div>
                  <div className="text-[16px] font-semibold text-[#0f172a]">{prevNextMinute.cur}</div>
                  <div className="text-[13px] font-medium text-[#94a3b8]">{prevNextMinute.next}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-[10px]">
            <button
              type="button"
              className="rounded-[6px] px-[10px] py-[6px] font-[Pretendard,sans-serif] text-[13px] font-medium text-[#4370ac] hover:bg-[#eef5fb] active:bg-[#e2e8f0]"
              onClick={() => setOpenKey(null)}
            >
              닫기
            </button>
            <button
              type="button"
              className="rounded-[6px] bg-[#4370ac] px-[12px] py-[6px] font-[Pretendard,sans-serif] text-[13px] font-semibold text-white hover:opacity-95 active:opacity-90"
              onClick={onConfirm}
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  )
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
  const [draftDate, setDraftDate] = useState('')
  const [draftTime, setDraftTime] = useState('')
  const [zoomLevel, setZoomLevel] = useState(1)
  const [viewEndAt, setViewEndAt] = useState(baseEnd)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const lastClampToastKeyRef = useRef<string>('')
  const [openPicker, setOpenPicker] = useState<OpenPickerKey>(null)

  useEffect(() => {
    if (!toastMessage) return
    const timeoutId = window.setTimeout(() => setToastMessage(null), 2500)
    return () => window.clearTimeout(timeoutId)
  }, [toastMessage])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-datepicker-root]') || target.closest('[data-timepicker-root]')) return
      setOpenPicker(null)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

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
    setOpenPicker(null)
    setIsPinnedToLatest(true)
    setSelectedDate(maxDateStr)
    setSelectedTime(maxTimeStr)
    setDraftDate(maxDateStr)
    setDraftTime(maxTimeStr)
    setZoomLevel(1)
    setViewEndAt(baseEnd)
  }, [open])

  useEffect(() => {
    // draft 범위 클램프
    if (!open) return
    if (draftDate && draftDate > maxDateStr) setDraftDate(maxDateStr)
    if (draftDate && draftDate < minDateStr) setDraftDate(minDateStr)
  }, [open, draftDate, draftTime, maxDateStr, maxTimeStr])

  const applyDraft = () => {
    setOpenPicker(null)
    setIsPinnedToLatest(false)
    setSelectedDate(draftDate)
    setSelectedTime(draftTime)
  }

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

  // 시간은 미래도 선택 가능(확인 후 데이터 유무로 처리)

  const anchorEndAt = useMemo(() => {
    const [year, month, day] = selectedDate.split('-').map(Number)
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return baseEnd
    }

    const [hoursText, minutesText] = selectedTime.split(':')
    const hours = Number.isFinite(Number(hoursText)) ? Number(hoursText) : baseEndDate.getHours()
    const minutes = Number.isFinite(Number(minutesText)) ? Number(minutesText) : baseEndDate.getMinutes()

    // time input은 분 단위 선택이므로, 해당 분의 시작 시점으로 앵커를 잡는다.
    return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime()
  }, [baseEnd, baseEndDate, selectedDate, selectedTime])

  const nearestAvailable = useMemo(() => {
    if (sortedPoints.length === 0) {
      return { endAt: baseEnd, noDataAtSelection: true }
    }

    // 선택한 "분" 범위(00~59초) 안에 데이터가 있는지 확인
    const minuteStart = anchorEndAt
    const minuteEnd = minuteStart + 60_000 - 1
    const clampedMinuteEnd = Math.min(minuteEnd, baseEnd)

    const inMinute = [...sortedPoints]
      .reverse()
      .find((point) => point.at >= minuteStart && point.at <= clampedMinuteEnd)

    if (!inMinute) {
      return { endAt: baseEnd, noDataAtSelection: true }
    }

    return { endAt: inMinute.at, noDataAtSelection: false }
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
      setViewEndAt(nearestAvailable.endAt)
      return
    }

    setViewEndAt((previous) => {
      const minEnd = baseStart + currentWindowMs
      const maxEnd = nearestAvailable.endAt
      if (minEnd > maxEnd) {
        return maxEnd
      }
      return clamp(previous, minEnd, maxEnd)
    })
  }, [open, isPinnedToLatest, nearestAvailable.endAt, baseStart, currentWindowMs])

  useEffect(() => {
    if (!open || isPinnedToLatest) return
    if (!selectedDate || !selectedTime) return

    const minEnd = baseStart + currentWindowMs
    const maxEnd = nearestAvailable.endAt
    if (minEnd > maxEnd) {
      setViewEndAt(maxEnd)
      return
    }
    if (nearestAvailable.noDataAtSelection) {
      const toastKey = `${selectedDate} ${selectedTime}`
      if (lastClampToastKeyRef.current !== toastKey) {
        lastClampToastKeyRef.current = toastKey
        setToastMessage('해당 시간대에 데이터가 없습니다.')
      }
      // 데이터가 없는 과거 시점으로는 이동하지 않고, 현재(최신)로 복귀
      setIsPinnedToLatest(true)
      setSelectedDate(maxDateStr)
      setSelectedTime(maxTimeStr)
      setZoomLevel(1)
      setViewEndAt(baseEnd)
      return
    }

    setViewEndAt(clamp(maxEnd, minEnd, maxEnd))
  }, [
    open,
    isPinnedToLatest,
    selectedDate,
    selectedTime,
    nearestAvailable.endAt,
    nearestAvailable.noDataAtSelection,
    baseStart,
    currentWindowMs,
    baseEnd,
    maxDateStr,
    maxTimeStr,
  ])

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
      const maxEnd = nearestAvailable.endAt
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
        className="relative flex w-full max-w-[1120px] flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.18),0px_1px_3px_1px_rgba(0,0,0,0.08)]"
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

        <div className="flex min-h-[52px] items-center gap-[8px] px-[16px] py-[10px] pr-[48px]">
          <div className="font-['Pretendard',sans-serif] text-[14px] font-semibold text-[#334155]">
            {title} : {valueText}
          </div>
        </div>
        <div className="h-px w-full bg-[#e5e7eb]" aria-hidden="true" />

        <div className="px-[16px] pb-[14px] pt-[10px]">
          <div className="relative z-0 h-[420px] w-full">
            {hasSeriesError && points.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center bg-white px-[12px] text-center font-['Pretendard',sans-serif] text-[12px] text-[#94a3b8]">
                차트 데이터를 불러오지 못했습니다.
              </div>
            ) : (
              <>
                <div className="absolute right-[16px] top-[16px] z-10 flex items-center gap-[8px]">
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    disabled={!canZoomIn}
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[#d7e1ee] bg-white text-[#607a9f] shadow-[0_4px_10px_rgba(15,23,42,0.08)] transition hover:border-[#61a0e1] hover:text-[#4370ac] disabled:cursor-not-allowed"
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
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[#d7e1ee] bg-white text-[#607a9f] shadow-[0_4px_10px_rgba(15,23,42,0.08)] transition hover:border-[#61a0e1] hover:text-[#4370ac] disabled:cursor-not-allowed"
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

          <div className="relative z-10 mt-[10px] flex items-center justify-center gap-[10px] pointer-events-auto">
            <InlineDatePicker
              value={draftDate}
              minYmd={minDateStr}
              maxYmd={maxDateStr}
              onChange={(next) => {
                setDraftDate(next)
              }}
              openKey={openPicker}
              setOpenKey={setOpenPicker}
            />
            <InlineTimePicker
              value={draftTime}
              onChange={(next) => {
                setDraftTime(next)
              }}
              openKey={openPicker}
              setOpenKey={setOpenPicker}
              onConfirm={applyDraft}
            />
            <button
              type="button"
              className="h-[30px] rounded-[6px] border border-[#e2e8f0] bg-white px-[10px] font-['Pretendard',sans-serif] text-[12px] text-[#485b77] hover:bg-[#f8fafc]"
              onClick={() => {
                setIsPinnedToLatest(true)
                setSelectedDate(maxDateStr)
                setSelectedTime(maxTimeStr)
                setDraftDate(maxDateStr)
                setDraftTime(maxTimeStr)
              }}
              aria-label="현재로 이동"
            >
              현재
            </button>
          </div>
        </div>
      </div>

      {toastMessage && (
        <div
          className="pointer-events-none fixed bottom-[28px] left-1/2 z-[300] max-w-[min(92vw,420px)] -translate-x-1/2 rounded-[10px] bg-[#2f2f2f] px-[18px] py-[12px] text-center font-['Pretendard',sans-serif] text-[14px] leading-[1.45] text-white shadow-[0px_8px_24px_rgba(0,0,0,0.22)]"
          role="status"
          aria-live="polite"
        >
          {toastMessage}
        </div>
      )}
    </div>
  )
}
