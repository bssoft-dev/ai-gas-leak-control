import { http, HttpResponse } from 'msw'

import state from './data/state.json'
import sensors from './data/sensors.json'
import timeseries from './data/timeseries.json'
import drawings from './data/drawings.json'
import aiHistory from './data/ai_history.json'
import { mockDrawingDetails } from './data/drawingDetails'

/** 관제 화면 실시간 압력 시계열 (2초 간격 폴링용 MSW 더미) */
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

export const handlers = [
  // Swagger "GET /" (text/html) mocking for frontend-only dev
  http.get('/', () => {
    return HttpResponse.text('<html><body>MSW mock index</body></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }),

  http.get('/api/gas-leak/state', () => HttpResponse.json(state)),
  http.get('/api/gas-leak/sensors', () => HttpResponse.json(sensors)),
  http.get('/api/gas-leak/timeseries', () => HttpResponse.json(timeseries)),
  http.get('/api/gas-leak/drawings', () => HttpResponse.json(drawings)),
  http.get('/api/gas-leak/drawings/:drawing_id', ({ params }) => {
    const drawingId = String(params.drawing_id ?? '')
    const detail = mockDrawingDetails[drawingId]
    if (!detail) {
      return HttpResponse.json(
        {
          detail: [
            {
              loc: ['path', 'drawing_id'],
              msg: 'Not found',
              type: 'not_found',
              input: drawingId,
              ctx: {},
            },
          ],
        },
        { status: 404 },
      )
    }

    // 도면 1건 + 센서(설치 위치) 목록
    return HttpResponse.json(detail)
  }),
  http.get('/api/gas-leak/ai-history', () => HttpResponse.json(aiHistory)),

  http.get('/api/gas-leak/monitor/pressure-series', () => {
    const now = Date.now()
    const configs = [
      { sensorId: 'c1', variant: 'green' as const, base: 11.88 },
      { sensorId: 'c2', variant: 'green' as const, base: 11.76 },
      { sensorId: 'c3', variant: 'green' as const, base: 11.9 },
      { sensorId: 'c4', variant: 'yellow' as const, base: 11.65 },
      { sensorId: 'c5', variant: 'yellow' as const, base: 11.58 },
      { sensorId: 'c6', variant: 'yellow' as const, base: 11.72 },
    ]
    const sensors = configs.map((c, idx) => {
      const points = mockPressurePoints(now, idx + 1, c.base)
      return {
        sensorId: c.sensorId,
        variant: c.variant,
        points,
        latestValue: points[points.length - 1].value,
      }
    })
    return HttpResponse.json({ sensors })
  }),
]

