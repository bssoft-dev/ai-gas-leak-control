import { useCallback, useEffect, useState } from 'react'

import {
  fetchMonitorPressureSeries,
  type MonitorPressureSensorSeries,
} from '../../../api/monitorPressureSeries'

const PRESSURE_POINT_COUNT = 45
const PRESSURE_STEP_MS = 2000

function mockPressurePoints(now: number, seed: number, baseMpa: number) {
  const points: { at: number; value: number }[] = []
  for (let i = 0; i < PRESSURE_POINT_COUNT; i++) {
    const at = now - (PRESSURE_POINT_COUNT - 1 - i) * PRESSURE_STEP_MS
    const phase = seed * 0.7 + i * 0.12 + now / 12000
    const wobble = Math.sin(phase) * 0.28 + Math.cos(phase * 0.4) * 0.12
    const noise = ((seed * 17 + i * 31 + Math.floor(now / 1000)) % 1000) / 1000 * 0.08 - 0.04
    const value = Math.round((baseMpa + wobble + noise) * 100) / 100
    points.push({ at, value })
  }
  return points
}

/**
 * DEV mock 시리즈를 생성합니다.
 * mockDrawingDetails의 센서 ID 패턴(S11-1 ~ S15-5)에 맞춰 Map을 함께 구성하여
 * 개발 환경에서도 차트에 데이터가 표시됩니다.
 */
function buildMockSeries(now = Date.now()): {
  sensors: MonitorPressureSensorSeries[]
  seriesBySensorId: Map<string, MonitorPressureSensorSeries>
} {
  const configs = [
    { sensorId: 'c1', variant: 'green' as const, base: 11.88 },
    { sensorId: 'c2', variant: 'green' as const, base: 11.76 },
    { sensorId: 'c3', variant: 'green' as const, base: 11.9 },
    { sensorId: 'c4', variant: 'yellow' as const, base: 11.65 },
    { sensorId: 'c5', variant: 'yellow' as const, base: 11.58 },
    { sensorId: 'c6', variant: 'yellow' as const, base: 11.72 },
  ]
  const sensors = configs.map((c, idx) => {
    const points = mockPressurePoints(now, idx + 1, c.base)
    return {
      sensorId: c.sensorId,
      variant: c.variant,
      points,
      latestValue: points[points.length - 1].value,
    }
  })

  // seriesBySensorId: c1~c6 기본 ID + mock drawing 센서 ID(S11-1 ~ S15-5) 패턴 포함
  const seriesBySensorId = new Map<string, MonitorPressureSensorSeries>()
  for (const series of sensors) {
    seriesBySensorId.set(series.sensorId, series)
  }

  // mock drawing 센서 ID(예: S11-1, S11-2, ...) 에 라운드로빈으로 데이터 매핑
  const drawingPrefixes = ['S11', 'S12', 'S13', 'S14', 'S15']
  for (const prefix of drawingPrefixes) {
    for (let i = 1; i <= 5; i++) {
      const mockSensorId = `${prefix}-${i}`
      const seriesTemplate = sensors[((parseInt(prefix.slice(1)) + i) % sensors.length)]
      seriesBySensorId.set(mockSensorId, {
        ...seriesTemplate,
        sensorId: mockSensorId,
      })
    }
  }

  return { sensors, seriesBySensorId }
}

const MAX_POINTS = 60

/** 두 데이터 포인트를 시간(at) 기준으로 중복 제거하며 합칩니다. */
function mergePoints(oldPoints: { at: number; value: number }[], newPoints: { at: number; value: number }[]) {
  const map = new Map<number, number>()
  oldPoints.forEach((p) => map.set(p.at, p.value))
  newPoints.forEach((p) => map.set(p.at, p.value))

  return Array.from(map.entries())
    .map(([at, value]) => ({ at, value }))
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_POINTS)
}

export function useMonitorPressureSeries(pollMs = 2000) {
  const [sensors, setSensors] = useState<MonitorPressureSensorSeries[]>([])
  const [seriesBySensorId, setSeriesBySensorId] = useState<Map<string, MonitorPressureSensorSeries>>(
    new Map(),
  )
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(async () => {
    try {
      const json = await fetchMonitorPressureSeries()

      // 기존 데이터와 병합 (sensors 배열)
      setSensors((prev) => {
        const nextMap = new Map<string, MonitorPressureSensorSeries>()
        prev.forEach((s) => nextMap.set(s.sensorId, s))

        json.sensors.forEach((newS) => {
          const oldS = nextMap.get(newS.sensorId)
          const mergedPoints = mergePoints(oldS?.points ?? [], newS.points)
          nextMap.set(newS.sensorId, {
            ...newS,
            points: mergedPoints,
            latestValue: mergedPoints.length > 0 ? mergedPoints[mergedPoints.length - 1].value : newS.latestValue,
          })
        })
        return Array.from(nextMap.values())
      })

      // 기존 데이터와 병합 (seriesBySensorId 맵)
      setSeriesBySensorId((prev) => {
        const next = new Map(prev)
        json.seriesBySensorId.forEach((newS, sensorId) => {
          const oldS = next.get(sensorId)
          const mergedPoints = mergePoints(oldS?.points ?? [], newS.points)
          next.set(sensorId, {
            ...newS,
            points: mergedPoints,
            latestValue: mergedPoints.length > 0 ? mergedPoints[mergedPoints.length - 1].value : newS.latestValue,
          })
        })
        return next
      })

      setError(null)
    } catch (e) {
      if (import.meta.env.DEV) {
        const mock = buildMockSeries()
        // Mock 데이터는 매번 새로 생성되므로 덮어씌워도 무방함 (또는 여기도 병합 가능)
        setSensors(mock.sensors)
        setSeriesBySensorId(mock.seriesBySensorId)
        setError(null)
        return
      }
      setError(e instanceof Error ? e : new Error(String(e)))
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), pollMs)
    return () => window.clearInterval(id)
  }, [load, pollMs])

  return { sensors, seriesBySensorId, error, reload: load }
}
