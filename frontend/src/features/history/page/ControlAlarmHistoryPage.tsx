import { useCallback, useEffect, useMemo, useState } from 'react'

import { DefaultService } from '../../../api/services/DefaultService'
import { PaginationArrowButton } from '../../../shared/ui/navigation/PaginationArrowButton'
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
  icon?: 'refresh' | 'reset'
}

const PAGE_SIZE = 20

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
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return formatter.format(date)
}

function IconTooltipButton({
  label,
  onClick,
  disabled = false,
  spin = false,
  icon = 'refresh',
}: IconTooltipButtonProps) {
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-full border border-[#d7e1ee] bg-white text-[#607a9f] transition hover:border-[#61a0e1] hover:text-[#4370ac] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon === 'refresh' ? (
          <svg
            viewBox="0 0 24 24"
            className={`h-[20px] w-[20px] ${spin ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="h-[20px] w-[20px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 7h12" />
            <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
            <path d="M8 7l.8 11a1.5 1.5 0 0 0 1.5 1.4h3.4a1.5 1.5 0 0 0 1.5-1.4L16 7" />
            <path d="M10.25 10.25v5.5" />
            <path d="M13.75 10.25v5.5" />
          </svg>
        )}
      </button>
      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-[#23344d] px-[10px] py-[6px] text-[12px] font-medium text-white opacity-0 shadow-[0_8px_20px_rgba(15,23,42,0.18)] transition group-hover:opacity-100">
        {label}
      </div>
    </div>
  )
}

export function ControlAlarmHistoryPage() {
  const [rows, setRows] = useState<ControlHistoryRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [actionQuery, setActionQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const loadRows = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')

    try {
      const response = await DefaultService.getGasLeakControlHistoryApiGasLeakControlHistoryGet()
      setRows(Array.isArray(response) ? response : [])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '제어·알람 이력을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const actionOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.action).filter(Boolean))),
    [rows],
  )

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const date = new Date(row.at)
      const hasValidDate = !Number.isNaN(date.getTime())

      if (selectedDate) {
        const rowDate = hasValidDate ? date.toISOString().slice(0, 10) : ''
        if (rowDate !== selectedDate) {
          return false
        }
      }

      if (selectedTime) {
        const rowTime = hasValidDate
          ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
          : ''
        if (rowTime !== selectedTime) {
          return false
        }
      }

      if (actionQuery && row.action !== actionQuery) {
        return false
      }

      return true
    })
  }, [actionQuery, rows, selectedDate, selectedTime])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))

  useEffect(() => {
    setCurrentPage(1)
  }, [selectedDate, selectedTime, actionQuery, rows])

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages))
  }, [totalPages])

  const pagedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE
    return filteredRows.slice(startIndex, startIndex + PAGE_SIZE)
  }, [currentPage, filteredRows])

  const resetFilters = useCallback(() => {
    setSelectedDate('')
    setSelectedTime('')
    setActionQuery('')
    setCurrentPage(1)
  }, [])

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="flex min-h-[240px] items-center justify-center px-[24px] py-[56px] text-center font-[Pretendard,sans-serif] text-[15px] text-[#607a9f]">
          제어·알람 이력을 불러오는 중입니다.
        </div>
      )
    }

    if (errorMessage) {
      return (
        <div className="flex min-h-[240px] items-center justify-center px-[24px] py-[56px] text-center font-[Pretendard,sans-serif] text-[15px] text-[#d14343]">
          {errorMessage}
        </div>
      )
    }

    if (rows.length === 0) {
      return (
        <div className="flex min-h-[240px] items-center justify-center px-[24px] py-[56px] text-center font-[Pretendard,sans-serif] text-[15px] text-[#607a9f]">
          표시할 제어·알람 이력이 없습니다.
        </div>
      )
    }

    if (filteredRows.length === 0) {
      return (
        <div className="flex min-h-[240px] items-center justify-center px-[24px] py-[56px] text-center font-[Pretendard,sans-serif] text-[15px] text-[#607a9f]">
          선택한 조건에 맞는 이력이 없습니다.
        </div>
      )
    }

    return pagedRows.map((row, index) => (
      <div
        key={`${row.at}-${row.action}-${index}`}
        className="grid grid-cols-[2.2fr_1.4fr_2.8fr_0.6fr] gap-[16px] border-t border-[#e8edf5] px-[24px] py-[22px] font-[Pretendard,sans-serif] text-[16px] leading-[1.6] text-[#1f2937]"
      >
        <div>{formatHistoryTime(row.at)}</div>
        <div>{row.action}</div>
        <div>{row.detail || '-'}</div>
        <div className="text-right">{row.level}</div>
      </div>
    ))
  }, [errorMessage, filteredRows.length, isLoading, pagedRows, rows.length])

  return (
    <div className="w-full px-[24px] py-[24px]">
      <HistoryTabs
        actions={
          <IconTooltipButton
            label="새로고침"
            onClick={() => {
              void loadRows()
            }}
            disabled={isLoading}
            spin={isLoading}
            icon="refresh"
          />
        }
      />

      <div className="mb-[24px] border-b border-[#dbe5f1] pb-[16px]">
        <div className="flex w-full flex-wrap items-end gap-[16px]">
          <label className="min-w-[180px] flex-1 font-[Pretendard,sans-serif]">
            <span className="mb-[8px] block text-[14px] font-semibold text-[#607a9f]">날짜</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="h-[48px] w-full rounded-[14px] border border-[#d7e1ee] bg-white px-[16px] font-[Pretendard,sans-serif] text-[15px] text-[#0f172a] outline-none transition placeholder:text-[#9aacbf] focus:border-[#61a0e1]"
            />
          </label>

          <label className="min-w-[180px] flex-1 font-[Pretendard,sans-serif]">
            <span className="mb-[8px] block text-[14px] font-semibold text-[#607a9f]">시간</span>
            <input
              type="time"
              value={selectedTime}
              onChange={(event) => setSelectedTime(event.target.value)}
              className="h-[48px] w-full rounded-[14px] border border-[#d7e1ee] bg-white px-[16px] font-[Pretendard,sans-serif] text-[15px] text-[#0f172a] outline-none transition focus:border-[#61a0e1]"
            />
          </label>

          <label className="min-w-[180px] flex-1 font-[Pretendard,sans-serif]">
            <span className="mb-[8px] block text-[14px] font-semibold text-[#607a9f]">동작</span>
            <select
              value={actionQuery}
              onChange={(event) => setActionQuery(event.target.value)}
              className="h-[48px] w-full rounded-[14px] border border-[#d7e1ee] bg-white px-[16px] font-[Pretendard,sans-serif] text-[15px] text-[#0f172a] outline-none transition focus:border-[#61a0e1]"
            >
              <option value="">전체</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>

          <div className="shrink-0 font-[Pretendard,sans-serif]">
            <span className="mb-[8px] block text-[14px] font-semibold text-transparent select-none" aria-hidden>
              {'\u00a0'}
            </span>
            <div className="flex h-[48px] items-center">
              <IconTooltipButton label="필터 초기화" onClick={resetFilters} icon="reset" />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-[#dbe5f1] bg-white">
        <div className="grid grid-cols-[2.2fr_1.4fr_2.8fr_0.6fr] gap-[16px] bg-[#f8fafc] px-[24px] py-[18px] font-[Pretendard,sans-serif] text-[15px] font-semibold text-[#607a9f]">
          <div>시각</div>
          <div>동작</div>
          <div>내용</div>
          <div className="text-right">단계</div>
        </div>

        {content}
      </div>

      {filteredRows.length > 0 ? (
        <div className="mt-[16px] flex items-center justify-center gap-[12px]">
          <PaginationArrowButton
            direction="prev"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            ariaLabel="이전 페이지"
          />
          <div className="font-[Pretendard,sans-serif] text-[14px] font-semibold text-[#485b77]">
            {currentPage} / {totalPages}
          </div>
          <PaginationArrowButton
            direction="next"
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            ariaLabel="다음 페이지"
          />
        </div>
      ) : null}
    </div>
  )
}

export default ControlAlarmHistoryPage
