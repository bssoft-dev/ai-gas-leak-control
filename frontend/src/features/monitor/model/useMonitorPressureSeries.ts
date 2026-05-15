import { useCallback, useEffect, useState } from 'react'

import { fetchMonitorPressureSeries, type MonitorPressureSensorSeries } from '../../../api/monitorPressureSeries'

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

function buildMockSeries(now = Date.now()): MonitorPressureSensorSeries[] {
  const configs = [
    { sensorId: 'c1', variant: 'green' as const, base: 11.88 },
    { sensorId: 'c2', variant: 'green' as const, base: 11.76 },
    { sensorId: 'c3', variant: 'green' as const, base: 11.9 },
    { sensorId: 'c4', variant: 'yellow' as const, base: 11.65 },
    { sensorId: 'c5', variant: 'yellow' as const, base: 11.58 },
    { sensorId: 'c6', variant: 'yellow' as const, base: 11.72 },
  ]
  return configs.map((c, idx) => {
    const points = mockPressurePoints(now, idx + 1, c.base)
    return {
      sensorId: c.sensorId,
      variant: c.variant,
      points,
      latestValue: points[points.length - 1].value,
    }
  })
}

export function useMonitorPressureSeries(pollMs = 2000) {
  const [sensors, setSensors] = useState<MonitorPressureSensorSeries[]>([])
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(async () => {
    try {
      const json = await fetchMonitorPressureSeries()
      setSensors(json.sensors)
      setError(null)
    } catch (e) {
      // 백엔드가 없을 때(프록시 ECONNREFUSED 등)도 관제 UI를 계속 사용할 수 있도록 폴백 더미 제공
      if (import.meta.env.DEV) {
        setSensors(buildMockSeries())
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

  return { sensors, error, reload: load }
}
