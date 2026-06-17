export type MockDrawingSensor = {
  id: string
  left: number
  top: number
  variant: 'green' | 'yellow'
  positionUnit?: 'percent' | 'legacy_px'
}

export type MockDrawingDetail = {
  id: string
  name: string
  imagePath: string
  sensors: MockDrawingSensor[]
}

const centerSensors = [
  { left: 33, top: 33, variant: 'green' as const },
  { left: 46, top: 42, variant: 'yellow' as const },
  { left: 58, top: 35, variant: 'green' as const },
  { left: 43, top: 58, variant: 'green' as const },
  { left: 57, top: 61, variant: 'yellow' as const },
]

function buildSensors(prefix: string, offsetX: number, offsetY: number): MockDrawingSensor[] {
  return centerSensors.map((sensor, index) => ({
    id: `${prefix}-${index + 1}`,
    left: sensor.left + offsetX,
    top: sensor.top + offsetY,
    variant: sensor.variant,
    positionUnit: 'percent',
  }))
}

export const mockDrawingDetails: Record<string, MockDrawingDetail> = {
  'drawing-11': {
    id: 'drawing-11',
    name: '도면 11',
    imagePath: '/mock-drawings/map_11.png',
    sensors: buildSensors('S11', -1, 0),
  },
  'drawing-12': {
    id: 'drawing-12',
    name: '도면 12',
    imagePath: '/mock-drawings/map_12.png',
    sensors: buildSensors('S12', 0, 1),
  },
  'drawing-13': {
    id: 'drawing-13',
    name: '도면 13',
    imagePath: '/mock-drawings/map_13.png',
    sensors: buildSensors('S13', 1, -1),
  },
  'drawing-14': {
    id: 'drawing-14',
    name: '도면 14',
    imagePath: '/mock-drawings/map_14.png',
    sensors: buildSensors('S14', 0, 0),
  },
  'drawing-15': {
    id: 'drawing-15',
    name: '도면 15',
    imagePath: '/mock-drawings/map_15.png',
    sensors: buildSensors('S15', 2, 1),
  },
}
