import { useCallback, useEffect, useMemo, useState } from 'react'

import { DefaultService } from '../../../api/services/DefaultService'
import { HistoryTabs } from '../ui/HistoryTabs'

type ControlHistoryRow = {
  at: string
  action: string
  detail: string
  level: number
}

type IconTooltipButtonProps = {
  label: string
  onClick: () => void
  disabled?: boolean
  spin?: boolean
}

const formatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
})

function formatHistoryTime(value: string) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return formatter.format(date)
}

function IconTooltipButton({ label, onClick, disabled = false, spin = false }: IconTooltipButtonProps) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[9999px] border border-[#d8e1ec] bg-white text-[#5f7697] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg viewBox="0 0 20 20" className={`h-[18px] w-[18px] ${spin ? 'animate-spin' : ''}`} fill="none">
          <path
            d="M16.667 10A6.667 6.667 0 1 1 14.714 5.286"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M12.857 5.286H14.714V3.429"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="pointer-events-none absolute left-1/2 top-[-10px] z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[6px] bg-[#1f2a3d] px-[8px] py-[5px] text-[12px] font-medium text-white opacity-0 shadow-[0px_6px_16px_rgba(15,23,42,0.18)] transition group-hover:opacity-100">
        {label}
      </div>
    </div>
  )
}

export default function ControlAlarmHistoryPage() {
  const [rows, setRows] = useState<ControlHistoryRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [actionQuery, setActionQuery] = useState('')

  const loadRows = useCallback(() => {
    let cancelled = false

    setIsLoading(true)
    setErrorMessage(null)

    DefaultService.getGasLeakControlHistoryApiGasLeakControlHistoryGet()
      .then((response) => {
        if (cancelled) return
        const nextRows = Array.isArray(response) ? response : []
        setRows(
          nextRows.map((row) => ({
            at: String(row.at ?? ''),
            action: String(row.action ?? ''),
            detail: String(row.detail ?? ''),
            level: Number(row.level ?? 0),
          })),
        )
      })
      .catch((error: any) => {
        if (cancelled) return
        setErrorMessage(error?.message ?? '제어·알람 이력을 불러오지 못했습니다.')
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cleanup = loadRows()
    return cleanup
  }, [loadRows])

  const actionOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.action).filter(Boolean)))
  }, [rows])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const date = new Date(row.at)
      if (Number.isNaN(date.getTime())) return false

      const matchesDate = !selectedDate || row.at.slice(0, 10) === selectedDate
      const matchesTime =
        !selectedTime ||
        `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` ===
          selectedTime
      const matchesAction = !actionQuery || row.action === actionQuery

      return matchesDate && matchesTime && matchesAction
    })
  }, [actionQuery, rows, selectedDate, selectedTime])

  const resetFilters = useCallback(() => {
    setSelectedDate('')
    setSelectedTime('')
    setActionQuery('')
  }, [])

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="px-[20px] py-[32px] font-['Pretendard',sans-serif] text-[14px] text-[#7a89a1]">
          제어·알람 이력을 불러오는 중입니다.
        </div>
      )
    }

    if (errorMessage) {
      return (
        <div className="px-[20px] py-[32px] font-['Pretendard',sans-serif] text-[14px] text-[#dc2626]">
          {errorMessage}
        </div>
      )
    }

    if (rows.length === 0) {
      return (
        <div className="px-[20px] py-[32px] font-['Pretendard',sans-serif] text-[14px] text-[#7a89a1]">
          표시할 제어·알람 이력이 없습니다.
        </div>
      )
    }

    if (filteredRows.length === 0) {
      return (
        <div className="px-[20px] py-[32px] font-['Pretendard',sans-serif] text-[14px] text-[#7a89a1]">
          현재 필터 조건에 맞는 이력이 없습니다.
        </div>
      )
    }

    return (
      <div className="divide-y divide-[#eef2f7]">
        {filteredRows.map((row, index) => (
          <div
            key={`${row.at}-${row.action}-${index}`}
            className="grid grid-cols-[2.3fr_1.4fr_2.6fr_0.6fr] px-[20px] py-[18px] font-['Pretendard',sans-serif] text-[15px] leading-[1.5] text-[#2c3c53]"
          >
            <div className="font-medium text-[#0b1828]">{formatHistoryTime(row.at)}</div>
            <div className="font-medium text-[#4370ac]">{row.action || '-'}</div>
            <div>{row.detail || '-'}</div>
            <div className="text-right text-[#485b77]">{row.level}</div>
          </div>
        ))}
      </div>
    )
  }, [errorMessage, filteredRows, isLoading, rows.length])

  return (
    <div className="px-[24px] py-[24px]">
      <HistoryTabs actions={<IconTooltipButton label="새로고침" onClick={loadRows} disabled={isLoading} spin={isLoading} />} />

      <div className="mb-[12px] border-b border-[#e2e8f0] pb-[12px]">
        <div className="flex w-full flex-wrap items-end gap-[10px]">
          <div className="min-w-[180px] flex-1">
            <label className="mb-[4px] block font-['Pretendard',sans-serif] text-[12px] font-medium text-[#7a89a1]">
              날짜
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="h-[40px] w-full rounded-[8px] border border-[#d8e1ec] bg-white px-[12px] font-['Pretendard',sans-serif] text-[14px] text-[#0b1828] outline-none transition focus:border-[#61a0e1]"
            />
          </div>

          <div className="min-w-[160px] flex-1">
            <label className="mb-[4px] block font-['Pretendard',sans-serif] text-[12px] font-medium text-[#7a89a1]">
              시간
            </label>
            <input
              type="time"
              value={selectedTime}
              onChange={(event) => setSelectedTime(event.target.value)}
              className="h-[40px] w-full rounded-[8px] border border-[#d8e1ec] bg-white px-[12px] font-['Pretendard',sans-serif] text-[14px] text-[#0b1828] outline-none transition focus:border-[#61a0e1]"
            />
          </div>

          <div className="min-w-[180px] flex-[1.1]">
            <label className="mb-[4px] block font-['Pretendard',sans-serif] text-[12px] font-medium text-[#7a89a1]">
              동작
            </label>
            <select
              value={actionQuery}
              onChange={(event) => setActionQuery(event.target.value)}
              className="h-[40px] w-full rounded-[8px] border border-[#d8e1ec] bg-white px-[12px] font-['Pretendard',sans-serif] text-[14px] text-[#0b1828] outline-none transition focus:border-[#61a0e1]"
            >
              <option value="">전체</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>

          <IconTooltipButton label="필터 초기화" onClick={resetFilters} />
        </div>
      </div>

      <div className="overflow-hidden rounded-[8px] border border-[#e2e8f0] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.04)]">
        <div className="grid grid-cols-[2.3fr_1.4fr_2.6fr_0.6fr] border-b border-[#e2e8f0] bg-[#f8fafc] px-[20px] py-[16px] font-['Pretendard',sans-serif] text-[14px] font-semibold text-[#7a89a1]">
          <div>시각</div>
          <div>동작</div>
          <div>내용</div>
          <div className="text-right">단계</div>
        </div>
        {content}
      </div>
    </div>
  )
}
