import type { DrawingDetail } from '../../../entities/drawing/model/activeDrawing'

export type RegisteredSensor = {
  id: string
  label: string
  color: 'green' | 'orange'
  unitLabel: string
  posText: string
  xPct: number
  yPct: number
  zoneId: string
}

export function normalizeLabelKey(value: string) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

export function unitLabelToUnit(unitLabel: string): 'pressure' | 'flow' {
  return unitLabel.toLowerCase().includes('l/min') ? 'flow' : 'pressure'
}

export function mapDrawingSensorsToRegisteredSensors(sensors: DrawingDetail['sensors']): RegisteredSensor[] {
  return sensors.map((sensor) => ({
    id: sensor.id,
    label: sensor.label ?? sensor.id,
    color: sensor.variant === 'yellow' ? 'orange' : 'green',
    unitLabel: sensor.unitLabel ?? (sensor.variant === 'yellow' ? '유량 (L/min)' : '압력 (MPa)'),
    posText: `(${sensor.left.toFixed(3)}%, ${sensor.top.toFixed(3)}%)`,
    xPct: sensor.left,
    yPct: sensor.top,
    zoneId: 'zone-1',
  }))
}
