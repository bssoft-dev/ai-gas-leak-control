/** 브라우저 탭 단위 SSE / 이벤트 타깃 식별자 (SagoHub Event Bus metadata.sse_client_ids) */
const STORAGE_KEY = 'sagohub_sse_client_id'

export function getOrCreateSseClientId() {
  if (typeof sessionStorage === 'undefined') return ''
  try {
    let id = sessionStorage.getItem(STORAGE_KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `cid-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
      sessionStorage.setItem(STORAGE_KEY, id)
    }
    return id
  } catch {
    return ''
  }
}
