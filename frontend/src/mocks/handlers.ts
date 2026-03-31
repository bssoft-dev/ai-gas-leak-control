import { http, HttpResponse } from 'msw'

import state from './data/state.json'
import sensors from './data/sensors.json'
import timeseries from './data/timeseries.json'
import drawings from './data/drawings.json'
import aiHistory from './data/ai_history.json'

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
  http.get('/api/gas-leak/ai-history', () => HttpResponse.json(aiHistory)),
]

