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
  sensors: MonitorPressureSensorSeries[]
}

type GasLeakSeriesPoint = {
  t: string
  v: number
}

type GasLeakTimeseriesResponse = {
  pressure?: GasLeakSeriesPoint[]
  flow?: GasLeakSeriesPoint[]
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

function mapTimeseriesToMonitorSeries(payload: GasLeakTimeseriesResponse): MonitorPressureSeriesResponse {
  const pressurePoints = toPoints(payload.pressure)
  const flowPoints = toPoints(payload.flow)

  return {
    sensors: [
      buildSeries('c1', 'green', pressurePoints),
      buildSeries('c2', 'green', pressurePoints),
      buildSeries('c3', 'green', pressurePoints),
      buildSeries('c4', 'yellow', flowPoints),
      buildSeries('c5', 'yellow', flowPoints),
      buildSeries('c6', 'yellow', flowPoints),
    ],
  }
}

export async function fetchMonitorPressureSeries(): Promise<MonitorPressureSeriesResponse> {
  const response = await DefaultService.getGasLeakTimeseriesApiGasLeakTimeseriesGet() as GasLeakTimeseriesResponse
  return mapTimeseriesToMonitorSeries(response)
}
