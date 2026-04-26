import { useEffect, useMemo, useState } from 'react'

import type { MonitorPressurePoint } from '../../../api/monitorPressureSeries'
import { PressureChartDetail } from './PressureChartDetail'

const STROKE = {
  green: '#7cbf6a',
  yellow: '#caa23d',
} as const

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
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const baseEnd = points.length > 0 ? points[points.length - 1].at : Date.now()
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
  const [isPinnedToNow, setIsPinnedToNow] = useState(true)
  const [selectedDate, setSelectedDate] = useState(() => {
    const yyyy = baseEndDate.getFullYear()
    const mm = String(baseEndDate.getMonth() + 1).padStart(2, '0')
    const dd = String(baseEndDate.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  })
  const [selectedTime, setSelectedTime] = useState(() => {
    const hh = String(baseEndDate.getHours()).padStart(2, '0')
    const mm = String(baseEndDate.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  })

  // 팝업을 새로 열 때: "현재" 고정 모드로 초기화
  useEffect(() => {
    if (!open) return
    setIsPinnedToNow(true)
    setSelectedDate(maxDateStr)
    setSelectedTime(maxTimeStr)
  }, [open])

  // "현재" 고정일 때만, 폴링으로 들어오는 최신 시간에 따라가게
  useEffect(() => {
    if (!open) return
    if (!isPinnedToNow) return
    setSelectedDate(maxDateStr)
    setSelectedTime(maxTimeStr)
  }, [open, isPinnedToNow, maxDateStr, maxTimeStr])

  // 미래 날짜/최소 연도 제한 강제 (직접 입력, 브라우저별 동작 차이 보정)
  useEffect(() => {
    if (selectedDate > maxDateStr) setSelectedDate(maxDateStr)
    else if (selectedDate < minDateStr) setSelectedDate(minDateStr)
  }, [selectedDate, maxDateStr])

  // 미래 시간 제한: max 날짜(오늘)에서는 maxTimeStr 이후로 못 가게
  useEffect(() => {
    if (selectedDate === maxDateStr && selectedTime > maxTimeStr) {
      setSelectedTime(maxTimeStr)
    }
  }, [selectedDate, selectedTime, maxDateStr, maxTimeStr])

  const anchorEndAt = useMemo(() => {
    // selectedDate(YYYY-MM-DD) + selectedTime(HH:MM, 24h)로 anchorEndAt 생성
    const [y, m, d] = selectedDate.split('-').map((v) => Number(v))
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return baseEnd
    const [hh, mm] = selectedTime.split(':').map((v) => Number(v))
    const hours = Number.isFinite(hh) ? hh : baseEndDate.getHours()
    const minutes = Number.isFinite(mm) ? mm : baseEndDate.getMinutes()
    const anchor = new Date(y, m - 1, d, hours, minutes, 0, 0)
    return anchor.getTime()
  }, [selectedDate, selectedTime, baseEnd])

  const bottomLabel = useMemo(() => {
    const d = new Date(anchorEndAt)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = d.getHours()
    return `${yyyy} - ${mm} - ${dd} | ${hh}시`
  }, [anchorEndAt])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-[#0b1828]/45 px-[24px] py-[24px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pressure-chart-detail-title"
      onMouseDown={(e) => {
        // 열기 클릭(mouseup/click)이 오버레이에 잡혀 즉시 닫히는 현상 방지
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex w-full max-w-[720px] flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="pressure-chart-detail-title" className="sr-only">
          차트 상세
        </h2>

        {/* 닫기: Figma 팝업처럼 우측 상단 고정 */}
        <button
          type="button"
          className="absolute right-[16px] top-[16px] z-10 flex h-[20px] w-[20px] items-center justify-center text-[#94a3b8] transition-colors hover:text-[#485b77]"
          aria-label="닫기"
          onClick={onClose}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* 상단 타이틀 바 (이미지 스타일) */}
        <div className="flex items-center gap-2 px-[16px] py-[10px]">
          <div className="font-['Pretendard',sans-serif] text-[14px] font-semibold text-[#334155]">
            {title} : {valueText}
          </div>
        </div>
        <div className="h-px w-full bg-[#e5e7eb]" aria-hidden />

        <div className="px-[16px] pb-[14px] pt-[10px]">
          <div className="h-[420px] w-full">
            {hasSeriesError && points.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center bg-white px-[12px] text-center font-['Pretendard',sans-serif] text-[12px] text-[#94a3b8]">
                차트 데이터를 불러오지 못했습니다.
              </div>
            ) : (
              <PressureChartDetail
                points={points}
                bottomLabel={bottomLabel}
                stroke={STROKE[variant]}
                anchorEndAt={anchorEndAt}
              />
            )}
          </div>

          {/* 하단: 날짜 선택 + 현재 버튼(1시 옆) */}
          <div className="mt-[10px] flex items-center justify-center gap-[10px]">
            <input
              type="date"
              className="h-[30px] rounded-[6px] border border-[#e2e8f0] bg-white px-[10px] font-['Pretendard',sans-serif] text-[12px] text-[#485b77]"
              value={selectedDate}
              onChange={(e) => {
                setIsPinnedToNow(false)
                setSelectedDate(e.target.value)
              }}
              min={minDateStr}
              max={maxDateStr}
              aria-label="날짜 선택"
            />
            <input
              type="time"
              className="h-[30px] w-[92px] rounded-[6px] border border-[#e2e8f0] bg-white px-[10px] font-['Pretendard',sans-serif] text-[12px] text-[#485b77]"
              value={selectedTime}
              onChange={(e) => {
                setIsPinnedToNow(false)
                setSelectedTime(e.target.value)
              }}
              max={selectedDate === maxDateStr ? maxTimeStr : undefined}
              step={60}
              aria-label="시간 선택(24시간)"
            />
            <button
              type="button"
              className="h-[30px] rounded-[6px] border border-[#e2e8f0] bg-white px-[10px] font-['Pretendard',sans-serif] text-[12px] text-[#485b77] hover:bg-[#f8fafc]"
              onClick={() => {
                setIsPinnedToNow(true)
                setSelectedDate(maxDateStr)
                setSelectedTime(maxTimeStr)
              }}
              aria-label="현재로 돌아오기"
            >
              현재
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
