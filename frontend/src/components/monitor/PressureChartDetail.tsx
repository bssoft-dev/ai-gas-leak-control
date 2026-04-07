import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { MonitorPressurePoint } from '../../api/monitorPressureSeries'

type Props = {
  points: MonitorPressurePoint[]
  /** 하단 가운데 날짜 라벨 (예: 2026 - 03 - 30 | 10시) */
  bottomLabel: string
}

function formatHHMM(t: number) {
  return new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function formatTooltipTime(t: number) {
  return new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function PressureChartDetail({ points, bottomLabel }: Props) {
  const data = points
  if (data.length === 0) return null

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 16, right: 18, left: 10, bottom: 34 }}>
          <defs>
            <linearGradient id="pressureFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#e5e7eb" strokeOpacity={0.55} />

          <XAxis
            dataKey="at"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v) => (typeof v === 'number' ? formatHHMM(v) : '')}
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={12}
          />

          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            width={28}
          />

          <Tooltip
            labelFormatter={(t) => (typeof t === 'number' ? formatTooltipTime(t) : '')}
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
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#pressureFill)"
            dot={{ r: 3, strokeWidth: 0, fill: '#ef4444' }}
            activeDot={{ r: 4, strokeWidth: 0, fill: '#ef4444' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="pointer-events-none absolute bottom-[8px] left-1/2 -translate-x-1/2 font-['Pretendard',sans-serif] text-[12px] font-semibold text-[#64748b]">
        {bottomLabel}
      </div>
    </div>
  )
}

