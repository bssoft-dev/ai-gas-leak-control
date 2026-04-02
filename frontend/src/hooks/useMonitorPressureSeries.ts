import { useCallback, useEffect, useState } from 'react'

import { fetchMonitorPressureSeries, type MonitorPressureSensorSeries } from '../api/monitorPressureSeries'

export function useMonitorPressureSeries(pollMs = 2000) {
  const [sensors, setSensors] = useState<MonitorPressureSensorSeries[]>([])
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(async () => {
    try {
      const json = await fetchMonitorPressureSeries()
      setSensors(json.sensors)
      setError(null)
    } catch (e) {
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
