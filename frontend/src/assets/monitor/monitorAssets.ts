import { publicIconUrl } from '../../utils/publicIconUrl'

const icon = publicIconUrl

export const monitorAssets = {
  // Drawing placeholder image
  imgDrawing: icon('drawing-placeholder.svg'),

  // Drawing overlay controls
  imgAddCircle: icon('add-circle.svg'),
  imgDoNotDisturbOn: icon('do-not-disturb-on.svg'),
  imgEditSquare: icon('edit-square.svg'),

  // Sensor dots (dummy positioning)
  imgSensorGreenOuter: icon('sensor-green-outer.svg'),
  imgSensorGreenInner: icon('sensor-green-inner.svg'),
  imgSensorYellowOuter: icon('sensor-yellow-outer.svg'),
  imgSensorYellowInner: icon('sensor-yellow-inner.svg'),

  // Pagination chevrons
  imgChevronLeft: icon('chevron-left.svg'),
  imgChevronRight: icon('chevron-right.svg'),

  // Chart visuals
  imgLineChart: icon('line-chart-decor.svg'),
  imgChartYellowVector1: icon('chart-yellow-1.svg'),
  imgChartYellowVector2: icon('chart-yellow-2.svg'),
} as const
