import { useEffect } from 'react'

import type { MonitorPressurePoint } from '../../api/monitorPressureSeries'
import { PressureChartDetail } from './PressureChartDetail'

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

  if (!open) return null

  const bottomLabel =
    points.length > 0
      ? (() => {
          const d = new Date(points[points.length - 1].at)
          const yyyy = d.getFullYear()
          const mm = String(d.getMonth() + 1).padStart(2, '0')
          const dd = String(d.getDate()).padStart(2, '0')
          const hh = d.getHours()
          return `${yyyy} - ${mm} - ${dd} | ${hh}시`
        })()
      : ''

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-[#0b1828]/45 px-[24px] py-[24px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pressure-chart-detail-title"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-[632px] flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]"
        onClick={(e) => e.stopPropagation()}
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
          <div className="h-[360px] w-full">
            {hasSeriesError && points.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center bg-white px-[12px] text-center font-['Pretendard',sans-serif] text-[12px] text-[#94a3b8]">
                차트 데이터를 불러오지 못했습니다.
              </div>
            ) : (
              <PressureChartDetail points={points} bottomLabel={bottomLabel} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
