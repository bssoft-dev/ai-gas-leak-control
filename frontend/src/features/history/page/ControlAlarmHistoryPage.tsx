import { useCallback, useEffect, useMemo, useState } from 'react'

import { DefaultService } from '../../../api/services/DefaultService'
import { PaginationArrowButton } from '../../../shared/ui/navigation/PaginationArrowButton'
import { HistoryTabs } from '../ui/HistoryTabs'
import { ControlHistoryTimePicker } from '../ui/ControlHistoryTimePicker'
import { IconTooltipButton } from '../ui/IconTooltipButton'

type ControlHistoryRow = {
  at: string
  action: string
  detail: string
  level: number
}

const PAGE_SIZE = 20

const pad2 = (n: number) => String(n).padStart(2, '0')

function getTodayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

function getNowTimeHM(): string {
  const d = new Date()
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const START_TIME_HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => pad2(i))
const START_TIME_MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => pad2(i))

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

function clampDate(date: Date, maxYmd: string): Date {
  const max = parseYmd(maxYmd)
  if (!max) return date
  return date.getTime() > max.getTime() ? max : date
}

function DatePickerInput({
  label,
  value,
  onChange,
  maxYmd,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  maxYmd: string
}) {
  const [open, setOpen] = useState(false)
  const selectedDate = useMemo(() => parseYmd(value), [value])
  const initialMonth = useMemo(() => {
    const base = selectedDate ?? parseYmd(maxYmd) ?? new Date()
    return startOfMonth(base)
  }, [maxYmd, selectedDate])
  const [visibleMonth, setVisibleMonth] = useState<Date>(initialMonth)

  useEffect(() => {
    // 선택 날짜가 바뀌면 보이는 월도 동기화
    if (!selectedDate) return
    setVisibleMonth(startOfMonth(selectedDate))
  }, [selectedDate])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-datepicker-root]')) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const maxDate = useMemo(() => parseYmd(maxYmd) ?? new Date(), [maxYmd])

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
      const disabled = d.getTime() > maxDate.getTime()
      grid.push({ date: d, inMonth, disabled })
    }
    return grid
  }, [maxDate, visibleMonth])

  return (
    <label className="min-w-[180px] flex-1 font-[Pretendard,sans-serif]">
      <span className="mb-[8px] block text-[14px] font-semibold text-[#607a9f]">{label}</span>
      <div className="relative" data-datepicker-root>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-[48px] w-full items-center justify-between rounded-[8px] border border-[#d7e1ee] bg-white px-[16px] font-[Pretendard,sans-serif] text-[15px] text-[#0f172a] transition focus:border-[#d7e1ee] focus:ring-0 focus:ring-offset-0 focus:[outline:0] focus:[box-shadow:none] focus-visible:[outline:0] focus-visible:[box-shadow:none]"
          aria-label="시작 날짜"
          aria-expanded={open}
        >
          <span className={value ? '' : 'text-[#9aacbf]'}>{value || 'YYYY-MM-DD'}</span>
          <span className="material-symbols-rounded text-[20px] leading-none text-[#485b77]" aria-hidden="true">
            calendar_month
          </span>
        </button>

        {open && (
          <div className="absolute left-0 top-full z-30 mt-[8px] w-full rounded-[8px] border border-[#e2e8f0] bg-white p-[16px] shadow-[0px_12px_28px_rgba(15,23,42,0.12)]">
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

            <div className="grid grid-cols-7 gap-[6px] pb-[6px] text-center font-[Pretendard,sans-serif] text-[12px] font-semibold text-[#64748b]">
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
                      const next = clampDate(date, maxYmd)
                      onChange(formatYmd(next))
                      setOpen(false)
                    }}
                  >
                    {date.getDate()}
                  </button>
                )
              })}
            </div>

            <div className="flex items-center justify-end pt-[10px]">
              <button
                type="button"
                className="rounded-[6px] px-[10px] py-[6px] font-[Pretendard,sans-serif] text-[13px] font-medium text-[#4370ac] hover:bg-[#eef5fb] active:bg-[#e2e8f0]"
                onClick={() => {
                  onChange(maxYmd)
                  setVisibleMonth(startOfMonth(parseYmd(maxYmd) ?? new Date()))
                  setOpen(false)
                }}
              >
                Today
              </button>
            </div>
          </div>
        )}
      </div>
    </label>
  )
}

function ActionPickerInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedLabel = value || '전체'
  const items = useMemo(() => ['', ...options], [options])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-action-picker-root]')) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <label className="min-w-[180px] flex-1 font-[Pretendard,sans-serif]">
      <span className="mb-[8px] block text-[14px] font-semibold text-[#607a9f]">{label}</span>
      <div className="relative" data-action-picker-root>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-[48px] w-full items-center justify-between rounded-[8px] border border-[#d7e1ee] bg-white px-[20px] font-[Pretendard,sans-serif] text-[15px] leading-[1] text-[#0f172a] transition focus:border-[#d7e1ee] focus:ring-0 focus:ring-offset-0 focus:[outline:0] focus:[box-shadow:none] focus-visible:[outline:0] focus-visible:[box-shadow:none]"
          aria-label={label}
          aria-expanded={open}
        >
          <span className="min-w-0 truncate text-left">{selectedLabel}</span>
          <span
            className={`material-symbols-rounded shrink-0 text-[20px] leading-none text-[#485b77] transition-transform ${
              open ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          >
            expand_more
          </span>
        </button>

        {open && (
          <div className="absolute left-0 top-full z-30 mt-[8px] w-full overflow-hidden rounded-[8px] border border-[#e2e8f0] bg-white p-[8px] shadow-[0px_12px_28px_rgba(15,23,42,0.12)]">
            <div className="notion-scrollbar flex max-h-[240px] flex-col gap-[4px] overflow-y-auto">
              {items.map((item) => {
                const optionLabel = item || '전체'
                const isSelected = item === value
                return (
                  <button
                    key={item || '_all'}
                    type="button"
                    className={`flex h-[40px] w-full items-center justify-between rounded-[8px] px-[12px] text-left font-[Pretendard,sans-serif] text-[14px] transition ${
                      isSelected
                        ? 'bg-[#eef5fb] font-semibold text-[#4370ac]'
                        : 'text-[#0f172a] hover:bg-[#f8fafc] active:bg-[#e2e8f0]'
                    }`}
                    onClick={() => {
                      onChange(item)
                      setOpen(false)
                    }}
                  >
                    <span className="min-w-0 truncate">{optionLabel}</span>
                    {isSelected ? (
                      <span className="material-symbols-rounded text-[18px] leading-none text-[#4370ac]" aria-hidden>
                        check
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </label>
  )
}

/** 날짜·시간 입력으로 구간 시작 시각(ms). 둘 다 비어 있으면 null(하한 없음). 날짜만 있으면 해당일 00:00:00, 시간만 있으면 오늘 그 시각(로컬). */
function getFilterRangeStartMs(selectedDate: string, selectedTime: string): number | null {
  const hasDate = Boolean(selectedDate)
  const hasTime = Boolean(selectedTime && selectedTime.length > 0)
  if (!hasDate && !hasTime) return null

  const datePart = hasDate ? selectedDate : getTodayYmd()
  const timePart = hasTime
    ? selectedTime.length === 5
      ? `${selectedTime}:00`
      : selectedTime
    : '00:00:00'

  const parsed = new Date(`${datePart}T${timePart}`)
  if (Number.isNaN(parsed.getTime())) return null

  return parsed.getTime()
}

export function ControlAlarmHistoryPage() {
  const [rows, setRows] = useState<ControlHistoryRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState(getNowTimeHM)
  const [actionQuery, setActionQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (!selectedDate && selectedTime) {
      setSelectedDate(getTodayYmd())
    }
  }, [selectedDate, selectedTime])

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
    const nowMs = Date.now()
    const rangeStartMs = getFilterRangeStartMs(selectedDate, selectedTime)

    const inRange = rows.filter((row) => {
      const rowMs = new Date(row.at).getTime()
      if (Number.isNaN(rowMs)) return false
      if (rowMs > nowMs) return false
      if (rangeStartMs != null && rowMs < rangeStartMs) return false
      if (actionQuery && row.action !== actionQuery) return false
      return true
    })

    return inRange.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
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
          시작 시각부터 현재까지 구간에 해당하는 이력이 없습니다.
        </div>
      )
    }

    return pagedRows.map((row, index) => (
      <div
        key={`${row.at}-${row.action}-${index}`}
        className="grid min-w-[760px] grid-cols-[2.2fr_1.4fr_2.8fr_0.6fr] gap-[16px] border-t border-[#e8edf5] px-[16px] py-[14px] font-[Pretendard,sans-serif] text-[14px] leading-[1.6] text-[#1f2937] md:px-[24px] md:text-[16px]"
      >
        <div>{formatHistoryTime(row.at)}</div>
        <div>{row.action}</div>
        <div>{row.detail || '-'}</div>
        <div className="text-right">{row.level}</div>
      </div>
    ))
  }, [errorMessage, filteredRows.length, isLoading, pagedRows, rows.length])

  return (
    <div className="no-focus-outline w-full px-[12px] py-[18px] sm:px-[16px] md:px-[24px] md:py-[24px]">
      <HistoryTabs
        actions={
          <>
          <IconTooltipButton
            label="새로고침"
            onClick={() => {
              void loadRows()
            }}
            disabled={isLoading}
            spin={isLoading}
            icon="refresh"
          />
          <div className="xl:hidden">
            <IconTooltipButton label="필터 초기화" onClick={resetFilters} icon="reset" />
          </div>
          </>
        }
      />

      <div className="mb-[20px] border-b border-[#dbe5f1] pb-[16px] md:mb-[24px]">
        <div className="flex w-full flex-wrap items-end gap-[16px]">
          <DatePickerInput
            label="시작 날짜"
            value={selectedDate}
            onChange={setSelectedDate}
            maxYmd={getTodayYmd()}
          />

          <label className="min-w-[180px] flex-1 font-[Pretendard,sans-serif]">
            <span className="mb-[8px] block text-[14px] font-semibold text-[#607a9f]">시작 시간</span>
            <ControlHistoryTimePicker value={selectedTime} onChange={setSelectedTime} />
          </label>

          <ActionPickerInput
            label="동작"
            value={actionQuery}
            options={actionOptions}
            onChange={setActionQuery}
          />

          <div className="hidden shrink-0 font-[Pretendard,sans-serif] xl:block">
            <span className="mb-[8px] block text-[14px] font-semibold text-transparent select-none" aria-hidden>
              {'\u00a0'}
            </span>
            <div className="flex h-[48px] items-center">
              <IconTooltipButton label="필터 초기화" onClick={resetFilters} icon="reset" />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[8px] border border-[#dbe5f1] bg-white">
        <div className="grid min-w-[760px] grid-cols-[2.2fr_1.4fr_2.8fr_0.6fr] gap-[16px] bg-[#f8fafc] px-[16px] py-[14px] font-[Pretendard,sans-serif] text-[14px] font-semibold text-[#607a9f] md:px-[24px] md:text-[15px]">
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
          <div className="min-w-[6rem] shrink-0 text-center tabular-nums font-[Pretendard,sans-serif] text-[14px] font-normal text-[#8ea1bb]">
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
