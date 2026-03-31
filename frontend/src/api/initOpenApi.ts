import { OpenAPI } from './core/OpenAPI'

export function initOpenApi() {
  const base = import.meta.env.VITE_API_BASE as string | undefined
  if (typeof base === 'string') {
    OpenAPI.BASE = base
  }
}

