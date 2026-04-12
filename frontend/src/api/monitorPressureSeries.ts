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
  // 개발 모드에서는 항상 현재 페이지 출처의 상대 경로로 요청해 MSW(Service Worker)가
  // 가로챌 수 있게 합니다. VITE_API_BASE가 원격이면 절대 URL로는 SW 범위/매칭 문제로
  // 목 데이터가 적용되지 않을 수 있습니다.
  if (import.meta.env.DEV) {
    const raw = import.meta.env.BASE
    const root = typeof raw === 'string' && raw.length > 0 ? raw.replace(/\/$/, '') : ''
    const path = '/api/gas-leak/monitor/pressure-series'
    return root ? `${root}${path}` : path
  }
  const base = OpenAPI.BASE.replace(/\/$/, '')
  return `${base}/api/gas-leak/monitor/pressure-series`
}

export async function fetchMonitorPressureSeries(): Promise<MonitorPressureSeriesResponse> {
  const res = await fetch(monitorPressureSeriesUrl())
  if (!res.ok) throw new Error(`pressure-series ${res.status}`)
  return res.json() as Promise<MonitorPressureSeriesResponse>
}
