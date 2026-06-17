const LS_KEY = 'sayu-llm-model'

export function getStoredLlmModel(fallback) {
  if (typeof localStorage === 'undefined') return fallback || ''
  try {
    return localStorage.getItem(LS_KEY) || fallback || ''
  } catch {
    return fallback || ''
  }
}

export function setStoredLlmModel(id) {
  if (typeof localStorage === 'undefined' || !id) return
  try {
    localStorage.setItem(LS_KEY, id)
  } catch {
    /* */
  }
}

/**
 * GET .../models → { models: [{ name, provider, size, ... }] }
 * Vite dev: /llm-api/models → 프록시
 * 프로덕션: VITE_LLM_API_BASE 를 넣으면 절대 URL로 직접 요청
 */
export async function fetchLlmModelList() {
  const fromEnv = (import.meta.env.VITE_LLM_API_BASE || '').trim().replace(/\/$/, '')
  const url = fromEnv ? `${fromEnv}/models` : '/llm-api/models'
  const r = await fetch(url)
  if (!r.ok) {
    const t = await r.text()
    throw new Error(t || r.statusText)
  }
  const j = await r.json()
  const models = j.models
  if (!Array.isArray(models)) return []
  return models
}

/** provider별로 optgroup용 정렬 */
export function groupModelsByProvider(models) {
  const map = new Map()
  for (const row of models) {
    if (!row || typeof row.name !== 'string' || !row.name) continue
    const p = row.provider != null ? String(row.provider) : 'other'
    if (!map.has(p)) map.set(p, [])
    map.get(p).push(row)
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}
