import { OpenAPI } from './core/OpenAPI'

export type MonitorPressurePoint = {
  at: number
  value: number
}

export type MonitorPressureSensorSeries = {
  sensorId: string
  variant: 'green' | 'yellow'
  points: MonitorPressurePoint[]
  latestValue: number
}

export type MonitorPressureSeriesResponse = {
  sensors: MonitorPressureSensorSeries[]
}

function monitorPressureSeriesUrl() {
  const base = OpenAPI.BASE.replace(/\/$/, '')
  return `${base}/api/gas-leak/monitor/pressure-series`
}

export async function fetchMonitorPressureSeries(): Promise<MonitorPressureSeriesResponse> {
  const res = await fetch(monitorPressureSeriesUrl())
  if (!res.ok) throw new Error(`pressure-series ${res.status}`)
  return res.json() as Promise<MonitorPressureSeriesResponse>
}
