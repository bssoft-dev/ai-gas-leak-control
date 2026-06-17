import { OpenAPI } from './core/OpenAPI'

export function initOpenApi() {
  const base = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://aglc.bs-soft.co.kr'
  OpenAPI.BASE = base
}
