/** Supabase 세션 토큰 로컬 저장 키 (SSE AUTH_*_RESULT와 동일) */
export const DANGBAE_AUTH_TOKEN_KEY = 'dangbae_auth_access_token'

/** 로그인/로그아웃 후 헤더·위젯이 세션을 다시 읽도록 알림 */
export const DANGBAE_AUTH_CHANGED_EVENT = 'dangbae-auth-changed'

export function notifyDangbaeAuthChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DANGBAE_AUTH_CHANGED_EVENT))
}

/** JWT access_token에서 표시용 이메일 추출 (검증 없음) */
export function getEmailFromAccessToken(token) {
  if (!token || typeof token !== 'string') return ''
  const parts = token.split('.')
  if (parts.length < 2) return ''
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4
    if (pad) b64 += '='.repeat(4 - pad)
    const json = atob(b64)
    const payload = JSON.parse(json)
    return (
      payload.email ||
      (payload.user_metadata && payload.user_metadata.email) ||
      ''
    )
  } catch {
    return ''
  }
}
