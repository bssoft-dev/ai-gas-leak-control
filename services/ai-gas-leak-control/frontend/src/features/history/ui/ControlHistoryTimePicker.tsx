import { useEffect, useMemo, useRef, useState } from 'react'

const pad2 = (n: number) => String(n).padStart(2, '0')

function formatHmToDisplay(value: string) {
  if (!value) return '전체'
  const [hhText, mmText] = value.split(':')
  const hh = Number(hhText)
  const mm = Number(mmText)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return value
  const isPm = hh >= 12
  const hour12 = ((hh + 11) % 12) + 1
  return `${isPm ? 'PM' : 'AM'} ${pad2(hour12)}:${pad2(mm)}`
}

function hmFromParts(isPm: boolean, hour12: number, minute: number) {
  const clampedHour12 = Math.min(12, Math.max(1, Math.trunc(hour12)))
  const clampedMinute = ((Math.trunc(minute) % 60) + 60) % 60
  const baseHour24 = clampedHour12 % 12
  const hour24 = baseHour24 + (isPm ? 12 : 0)
  return `${pad2(hour24)}:${pad2(clampedMinute)}`
}

export function ControlHistoryTimePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ampmWheelRef = useRef<HTMLDivElement | null>(null)
  const hourWheelRef = useRef<HTMLDivElement | null>(null)
  const minuteWheelRef = useRef<HTMLDivElement | null>(null)

  const [hhText, mmText] = value.split(':')
  const hour24 = Number.isFinite(Number(hhText)) ? Number(hhText) : 0
  const minute = Number.isFinite(Number(mmText)) ? Number(mmText) : 0
  const isPm = hour24 >= 12
  const hour12 = ((hour24 + 11) % 12) + 1

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-history-timepicker-root]')) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const stepWrap = (current: number, delta: number, mod: number) => ((current + delta) % mod + mod) % mod

  const setFromParts = (nextIsPm: boolean, nextHour12: number, nextMinute: number) => {
    onChange(hmFromParts(nextIsPm, nextHour12, nextMinute))
  }

  const getWrappedItems = (mod: number, cur: number) => {
    const center = ((cur % mod) + mod) % mod
    return [-2, -1, 0, 1, 2].map((delta) => stepWrap(center, delta, mod))
  }

  const applyWheelDelta = (kind: 'ampm' | 'hour' | 'minute', delta: number) => {
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

  const handleWheel =
    (kind: 'ampm' | 'hour' | 'minute') => (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? 1 : -1
      applyWheelDelta(kind, delta)
    }

  const hourItems = useMemo(() => {
    return getWrappedItems(12, hour12 - 1).map((h0) => pad2(h0 + 1))
  }, [hour12])

  const minuteItems = useMemo(() => {
    return getWrappedItems(60, minute).map((m) => pad2(m))
  }, [minute])

  const getItemClass = (idx: number) => {
    const dist = Math.abs(idx - 2)
    if (dist === 0) return 'text-[16px] font-semibold text-[#0f172a]'
    if (dist === 1) return 'text-[14px] font-medium text-[#64748b]'
    return 'text-[13px] font-medium text-[#94a3b8]'
  }

  useEffect(() => {
    if (!open) return
    const bindWheel = (el: HTMLDivElement | null, kind: 'ampm' | 'hour' | 'minute') => {
      if (!el) return () => {}
      const onWheel = (evt: WheelEvent) => {
        evt.preventDefault()
        evt.stopPropagation()
        const delta = evt.deltaY > 0 ? 1 : -1
        applyWheelDelta(kind, delta)
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      return () => el.removeEventListener('wheel', onWheel)
    }
    const unbindAmpm = bindWheel(ampmWheelRef.current, 'ampm')
    const unbindHour = bindWheel(hourWheelRef.current, 'hour')
    const unbindMinute = bindWheel(minuteWheelRef.current, 'minute')
    return () => {
      unbindAmpm()
      unbindHour()
      unbindMinute()
    }
  }, [open, isPm, hour12, minute])

  return (
    <div className="relative" data-history-timepicker-root>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex h-[48px] w-full items-center justify-between rounded-[8px] border border-[#d7e1ee] bg-white px-[20px] pr-[52px] font-[Pretendard,sans-serif] text-[15px] leading-[1] text-[#0f172a] outline-none transition focus:border-[#d7e1ee] focus:ring-0 focus:ring-offset-0 focus:[outline:0] focus:[box-shadow:none] focus-visible:[outline:0] focus-visible:[box-shadow:none]"
        aria-label="시작 시간 선택"
        aria-expanded={open}
      >
        <span className={!value ? 'text-[#0f172a]' : ''}>{formatHmToDisplay(value)}</span>
        <span className="material-symbols-rounded pointer-events-none absolute right-[16px] top-1/2 -translate-y-1/2 text-[20px] text-[#485b77]">
          expand_more
        </span>
      </button>

      {open && (
        <div
          className="absolute left-1/2 top-full z-30 mt-[8px] w-full -translate-x-1/2 rounded-[8px] border border-[#e2e8f0] bg-white p-[16px] shadow-[0px_12px_28px_rgba(15,23,42,0.12)]"
          style={{ width: 'min(92vw, 312px)', minWidth: '100%' }}
        >
          <div className="flex items-center justify-between pb-[10px]">
            <button
              type="button"
              className="rounded-[6px] px-[10px] py-[6px] font-[Pretendard,sans-serif] text-[13px] font-medium text-[#4370ac] hover:bg-[#eef5fb] active:bg-[#e2e8f0]"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              전체
            </button>
            <button
              type="button"
              className="rounded-[6px] bg-[#4370ac] px-[12px] py-[6px] font-[Pretendard,sans-serif] text-[13px] font-semibold text-white hover:opacity-95 active:opacity-90"
              onClick={() => setOpen(false)}
            >
              확인
            </button>
          </div>

          <div className="grid grid-cols-3 gap-[10px]">
            <div className="flex flex-col items-stretch gap-[6px]">
              <div className="text-center font-[Pretendard,sans-serif] text-[12px] font-semibold text-[#64748b]">
                AM/PM
              </div>
              <div
                ref={ampmWheelRef}
                className="relative h-[176px] overflow-hidden rounded-[8px] border border-[#eef2f6] bg-white select-none"
                onWheel={handleWheel('ampm')}
              >
                <div className="absolute inset-x-[8px] top-1/2 h-[44px] -translate-y-1/2 rounded-[8px] bg-[#f1f5f9]" aria-hidden />
                <div className="absolute inset-0">
                  <button
                    type="button"
                    className="absolute left-1/2 top-1/2 w-[calc(100%-16px)] -translate-x-1/2 -translate-y-1/2 rounded-[8px] py-[10px] text-center font-[Pretendard,sans-serif] text-[16px] font-semibold text-[#0f172a] tabular-nums"
                    onClick={() => setFromParts(isPm, hour12, minute)}
                  >
                    {isPm ? 'PM' : 'AM'}
                  </button>
                  <button
                    type="button"
                    className="absolute left-1/2 w-[calc(100%-16px)] -translate-x-1/2 -translate-y-1/2 rounded-[8px] py-[10px] text-center font-[Pretendard,sans-serif] text-[14px] font-medium text-[#64748b] tabular-nums"
                    style={{ top: isPm ? 'calc(50% - 58px)' : 'calc(50% + 58px)' }}
                    onClick={() => setFromParts(!isPm, hour12, minute)}
                  >
                    {isPm ? 'AM' : 'PM'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-[6px]">
              <div className="text-center font-[Pretendard,sans-serif] text-[12px] font-semibold text-[#64748b]">시간</div>
              <div
                ref={hourWheelRef}
                className="relative h-[176px] overflow-hidden rounded-[8px] border border-[#eef2f6] bg-white select-none"
                onWheel={handleWheel('hour')}
              >
                <div className="absolute inset-x-[8px] top-1/2 h-[44px] -translate-y-1/2 rounded-[8px] bg-[#f1f5f9]" aria-hidden />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-[10px] tabular-nums">
                  {hourItems.map((h, idx) => (
                    <div key={`${h}-${idx}`} className={getItemClass(idx)}>
                      {h}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-[6px]">
              <div className="text-center font-[Pretendard,sans-serif] text-[12px] font-semibold text-[#64748b]">분</div>
              <div
                ref={minuteWheelRef}
                className="relative h-[176px] overflow-hidden rounded-[8px] border border-[#eef2f6] bg-white select-none"
                onWheel={handleWheel('minute')}
              >
                <div className="absolute inset-x-[8px] top-1/2 h-[44px] -translate-y-1/2 rounded-[8px] bg-[#f1f5f9]" aria-hidden />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-[10px] tabular-nums">
                  {minuteItems.map((m, idx) => (
                    <div key={`${m}-${idx}`} className={getItemClass(idx)}>
                      {m}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

