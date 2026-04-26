import type { DrawingSensor } from '../../../entities/drawing/model/activeDrawing'

export type MonitorChartCard = {
  id: string
  title: string
  headerBg: string
  variant: 'green' | 'yellow'
  unitLabel: string
}

export function buildMonitorChartCards(sensors: DrawingSensor[]): MonitorChartCard[] {
  return sensors.map((sensor, index) => {
    const isFlow = sensor.variant === 'yellow'
    return {
      id: sensor.id,
      title: sensor.label ?? `${isFlow ? '유량' : '압력'} 센서 ${index + 1}`,
      headerBg: isFlow ? '#fbf6e9' : '#f1f7ea',
      variant: sensor.variant,
      unitLabel: sensor.unitLabel ?? (isFlow ? '유량 (L/min)' : '압력 (MPa)'),
    }
  })
}
