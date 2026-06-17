import { DefaultService } from './services/DefaultService'

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
  /** 레거시 variant 기반 시리즈 목록 (하위 호환 유지) */
  sensors: MonitorPressureSensorSeries[]
  /** 센서 ID(또는 label) 기반 시리즈 Map — 엣지 timeseries.sensors 딕셔너리에서 생성 */
  seriesBySensorId: Map<string, MonitorPressureSensorSeries>
}

type GasLeakSeriesPoint = {
  t: string
  v: number
}

type GasLeakTimeseriesResponse = {
  /** 레거시: 단일 압력 시계열 */
  pressure?: GasLeakSeriesPoint[]
  /** 레거시: 단일 유량 시계열 */
  flow?: GasLeakSeriesPoint[]
  /** 신규: 엣지 센서 ID → 시계열 딕셔너리 (GAS_LEAK_SYNC_STATE) */
  sensors?: Record<string, GasLeakSeriesPoint[]>
}

function toPoints(points: GasLeakSeriesPoint[] | undefined): MonitorPressurePoint[] {
  if (!Array.isArray(points)) return []
  return points.map((point) => ({
    at: new Date(point.t).getTime(),
    value: point.v,
  }))
}

function buildSeries(
  sensorId: string,
  variant: 'green' | 'yellow',
  points: MonitorPressurePoint[],
): MonitorPressureSensorSeries {
  return {
    sensorId,
    variant,
    points,
    latestValue: points[points.length - 1]?.value ?? 0,
  }
}

/**
 * 엣지 timeseries 응답을 MonitorPressureSeriesResponse로 변환합니다.
 *
 * 우선순위:
 * 1. payload.sensors 딕셔너리 (엣지 GAS_LEAK_SYNC_STATE 신규 형식)
 * 2. payload.pressure / payload.flow 배열 (레거시 fallback)
 */
function mapTimeseriesToMonitorSeries(payload: GasLeakTimeseriesResponse): MonitorPressureSeriesResponse {
  const seriesBySensorId = new Map<string, MonitorPressureSensorSeries>()

  // 1) sensors 딕셔너리 파싱 (엣지 연동 신규 형식)
  if (payload.sensors && typeof payload.sensors === 'object') {
    for (const [sensorId, rawPoints] of Object.entries(payload.sensors)) {
      if (!Array.isArray(rawPoints) || rawPoints.length === 0) continue
      const points = toPoints(rawPoints)
      if (points.length === 0) continue
      // sensor_type을 알 수 없으므로 variant는 'green'으로 기본 설정
      // MonitorPage에서 DrawingSensor.variant로 덮어씌움
      seriesBySensorId.set(sensorId, buildSeries(sensorId, 'green', points))
    }
  }

  // 2) 레거시 pressure / flow 배열 fallback — sensors 딕셔너리가 비어 있을 때 사용
  const pressurePoints = toPoints(payload.pressure)
  const flowPoints = toPoints(payload.flow)

  const legacySensors: MonitorPressureSensorSeries[] = [
    buildSeries('c1', 'green', pressurePoints),
    buildSeries('c2', 'green', pressurePoints),
    buildSeries('c3', 'green', pressurePoints),
    buildSeries('c4', 'yellow', flowPoints),
    buildSeries('c5', 'yellow', flowPoints),
    buildSeries('c6', 'yellow', flowPoints),
  ]

  // 레거시 시리즈도 seriesBySensorId에 등록 (seriesBySensorId에 없는 경우만)
  for (const series of legacySensors) {
    if (!seriesBySensorId.has(series.sensorId)) {
      seriesBySensorId.set(series.sensorId, series)
    }
  }

  return {
    sensors: legacySensors,
    seriesBySensorId,
  }
}

export async function fetchMonitorPressureSeries(): Promise<MonitorPressureSeriesResponse> {
  const response = await DefaultService.getGasLeakTimeseriesApiGasLeakTimeseriesGet() as GasLeakTimeseriesResponse
  return mapTimeseriesToMonitorSeries(response)
}
