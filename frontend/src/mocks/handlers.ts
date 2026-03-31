import { http, HttpResponse } from 'msw'

import state from './data/state.json'
import sensors from './data/sensors.json'
import timeseries from './data/timeseries.json'
import drawings from './data/drawings.json'
import aiHistory from './data/ai_history.json'
import { mockDrawingDetails } from './data/drawingDetails'

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
]

