import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useId, useRef } from 'react'

import type { MonitorPressurePoint } from '../../api/monitorPressureSeries'

type Props = {
  points: MonitorPressurePoint[]
  /** 하단 가운데 날짜 라벨 (예: 2026 - 03 - 30 | 10시) */
  bottomLabel: string
  stroke: string
  /**
   * 날짜 이동용: 이 값이 주어지면 points의 시간축을 anchorEndAt 기준으로 재매핑한다.
   * (서버 히스토리 API가 없는 상태에서 UI 이동 동작을 제공)
   */
  anchorEndAt?: number
}

const TICK_STEP_MS = 2000
const TICK_COUNT = 10

function formatMMSS(t: number) {
  const d = new Date(t)
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${mm}:${ss}`
}

/** 차트 좌측 여백(Y축 + margin)과 맞추기 — 커스텀 x 라벨 줄 정렬용 */
const CHART_MARGIN = { top: 16, right: 18, left: 10, bottom: 8 } as const

export function PressureChartDetail({ points, bottomLabel, stroke, anchorEndAt }: Props) {
  const sortedRaw = [...points].sort((a, b) => a.at - b.at)
  if (sortedRaw.length === 0) return null

  const rawMaxAt = sortedRaw[sortedRaw.length - 1].at
  const rawMinAt = sortedRaw[0].at

  if (!Number.isFinite(rawMinAt) || !Number.isFinite(rawMaxAt)) return null

  const mapped =
    typeof anchorEndAt === 'number' && Number.isFinite(anchorEndAt)
      ? sortedRaw.map((p) => ({ ...p, at: anchorEndAt + (p.at - rawMaxAt) }))
      : sortedRaw

  const maxAt = mapped[mapped.length - 1].at

  /** x축 10개 tick, 2초 간격(총 18초) — 데이터 끝(maxAt)에 맞춤 */
  const end = Math.ceil(maxAt / TICK_STEP_MS) * TICK_STEP_MS
  const start = end - TICK_STEP_MS * (TICK_COUNT - 1)
  const xTicks = Array.from({ length: TICK_COUNT }, (_, i) => start + TICK_STEP_MS * i)
  const xDomain: [number, number] = [start, end]

  /** 도메인 안의 점만 사용 → 스케일이 전체 폭을 쓰고 우측 몰림 방지 */
  const dataInWindow = mapped.filter((p) => p.at >= start && p.at <= end)
  const chartData =
    dataInWindow.length >= 2
      ? dataInWindow
      : mapped.length >= 2
        ? mapped.slice(-Math.min(mapped.length, 10))
        : mapped

  const plotLeftPadPx = CHART_MARGIN.left + 28
  const xAxisScrollRef = useRef<HTMLDivElement>(null)
  const gid = useId()
  const gradientId = `pressureFill-${gid.replace(/:/g, '')}`

  const onWheelHorizontal = (e: React.WheelEvent) => {
    const el = xAxisScrollRef.current
    if (!el) return
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (dx === 0) return
    // 팝업 내부에서만 사용: 휠을 가로 스크롤로 변환
    e.preventDefault()
    el.scrollLeft += dx
  }

  return (
    <div className="relative flex h-full w-full flex-col overscroll-contain" onWheel={onWheelHorizontal}>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ ...CHART_MARGIN, bottom: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.12} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#e5e7eb" strokeOpacity={0.55} />

          <XAxis
            dataKey="at"
            type="number"
            domain={xDomain}
            tick={false}
            axisLine={false}
            tickLine={false}
            height={0}
          />

          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            width={28}
          />

          <Tooltip
            labelFormatter={(t) => (typeof t === 'number' ? formatMMSS(t) : '')}
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
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={{ r: 3, strokeWidth: 0, fill: stroke }}
            activeDot={{ r: 4, strokeWidth: 0, fill: stroke }}
            isAnimationActive={false}
          />
        </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Recharts 기본 tick이 겹치는 문제 회피: 플롯 영역과 동일 폭으로 균등 분배 */}
      <div
        ref={xAxisScrollRef}
        className="notion-scrollbar shrink-0 overflow-x-auto pt-[2px] text-[9px] leading-[12px] text-[#64748b]"
        style={{ paddingLeft: plotLeftPadPx, paddingRight: CHART_MARGIN.right }}
        onWheel={onWheelHorizontal}
      >
        <div className="grid w-[max(100%,560px)] grid-cols-10 text-center">
          {xTicks.map((t) => (
            <span key={t} className="min-w-0 tabular-nums">
              {formatMMSS(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="pointer-events-none mt-[6px] shrink-0 text-center font-['Pretendard',sans-serif] text-[12px] font-semibold text-[#64748b]">
        {bottomLabel}
      </div>
    </div>
  )
}
