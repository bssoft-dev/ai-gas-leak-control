import { useId, useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { MonitorPressurePoint } from '../../../api/monitorPressureSeries'

const STROKE = {
  green: '#34d399',
  yellow: '#fbbf24',
} as const

/** Y축 틱 대신 플롯 영역(offset) 높이에 맞춰 가로 격자를 균등 배치 */
function uniformHorizontalGrid(
  props: { offset: { top: number; height: number } },
  _syncWithTicks: boolean,
): number[] {
  const { top, height } = props.offset
  if (!Number.isFinite(height) || height <= 0) return []
  const segments = 4
  const coords: number[] = []
  for (let i = 0; i <= segments; i++) {
    coords.push(top + (height * i) / segments)
  }
  return coords
}

type Props = {
  points: MonitorPressurePoint[]
  variant: 'green' | 'yellow'
  /** 팝업 등 넓은 영역 — 하단 시간축 표시 */
  showTimeAxis?: boolean
}

const timeTickFormatter = (t: number) =>
  new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })

function condensePreviewPoints(points: MonitorPressurePoint[], targetCount: number) {
  if (points.length <= targetCount) return points

  const bucketSize = (points.length - 1) / (targetCount - 1)
  const sampled: MonitorPressurePoint[] = []

  for (let i = 0; i < targetCount; i++) {
    const startIndex = Math.floor(i * bucketSize)
    const endIndex = Math.min(points.length - 1, Math.floor((i + 1) * bucketSize))
    const bucket = points.slice(startIndex, endIndex + 1)
    if (bucket.length === 0) continue

    const pickedPoint =
      i % 2 === 0
        ? bucket.reduce((maxPoint, current) => (current.value > maxPoint.value ? current : maxPoint))
        : bucket.reduce((minPoint, current) => (current.value < minPoint.value ? current : minPoint))

    if (sampled[sampled.length - 1]?.at !== pickedPoint.at) {
      sampled.push(pickedPoint)
    }
  }

  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]

  if (sampled[0]?.at !== firstPoint.at) {
    sampled.unshift(firstPoint)
  }
  if (sampled[sampled.length - 1]?.at !== lastPoint.at) {
    sampled.push(lastPoint)
  }

  return sampled.sort((a, b) => a.at - b.at)
}

export function PressureLineChart({ points, variant, showTimeAxis = false }: Props) {
  const stroke = STROKE[variant]
  const gid = useId()
  const gradientId = `pressureFill-${gid.replace(/:/g, '')}`
  const data = useMemo(
    () => (showTimeAxis ? points : condensePreviewPoints(points, 12)),
    [points, showTimeAxis],
  )

  if (data.length === 0) {
    return <div className="flex h-full w-full items-center justify-center bg-[#fafafa] text-[10px] text-[#94a3b8]">데이터 없음</div>
  }

  const margin = showTimeAxis
    ? { top: 8, right: 12, left: 12, bottom: 22 }
    : { top: 6, right: 8, left: 8, bottom: 6 }

  return (
    <div
      className="h-full w-full min-h-0 rounded-[3px] [&_.recharts-surface]:outline-none [&_.recharts-surface:focus]:shadow-[0_0_0_2px_var(--chart-focus-ring)]"
      style={{ ['--chart-focus-ring' as string]: stroke }}
    >
      <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={margin}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.12} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke="#eef2f6"
          strokeOpacity={0.9}
          vertical={false}
          syncWithTicks={false}
          horizontalCoordinatesGenerator={uniformHorizontalGrid}
        />
        <XAxis
          dataKey="at"
          type="number"
          domain={['dataMin', 'dataMax']}
          hide={!showTimeAxis}
          tick={{ fontSize: 9, fill: '#94a3b8' }}
          tickFormatter={(v) => (typeof v === 'number' ? timeTickFormatter(v) : '')}
          interval="preserveStartEnd"
        />
        <YAxis domain={['auto', 'auto']} width={0} hide />
        <Tooltip
          contentStyle={{
            fontSize: 11,
            borderRadius: 6,
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
          labelFormatter={(t) =>
            typeof t === 'number'
              ? new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : ''
          }
          formatter={(value) => [`${Number(value).toFixed(2)} MPa`, '압력']}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={stroke}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          fillOpacity={1}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
