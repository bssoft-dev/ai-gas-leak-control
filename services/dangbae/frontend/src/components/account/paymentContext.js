/** 배송 요청 직후 결제 페이지로 넘길 주문·금액 컨텍스트 (sessionStorage) */
export const DANGBAE_PAYMENT_STORAGE_KEY = 'dangbae_pending_payment'
/** 결제 준비 응답(PAYMENT_PREPARE_RESULT) — 모바일 리다이렉트 후 복원용 (sessionStorage) */
export const DANGBAE_LAST_PREPARE_KEY = 'dangbae_last_payment_prepare'

/**
 * @returns {{ order_id: string, amount: number, order_name: string, user_email?: string, user_phone?: string } | null}
 */
export function readPendingPayment() {
  try {
    const raw = sessionStorage.getItem(DANGBAE_PAYMENT_STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object') return null
    return o
  } catch {
    return null
  }
}

export function writePendingPayment(obj) {
  try {
    sessionStorage.setItem(DANGBAE_PAYMENT_STORAGE_KEY, JSON.stringify(obj))
  } catch {
    /* ignore quota */
  }
}

export function clearPendingPayment() {
  try {
    sessionStorage.removeItem(DANGBAE_PAYMENT_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 포트원 m_redirect_url 복귀 시 프론트 state가 비어도 결제창 파라미터(merchant_uid, channels 등)를 쓰기 위한 스냅샷
 * @param {object} payload PAYMENT_PREPARE_RESULT payload
 */
export function writeLastPaymentPrepare(payload) {
  if (!payload || !payload.merchant_uid) return
  try {
    const snap = {
      ok: true,
      order_id: payload.order_id,
      merchant_uid: payload.merchant_uid,
      payment_id: payload.payment_id || payload.merchant_uid,
      imp_code: payload.imp_code,
      portone_script: payload.portone_script,
      sdk_version: payload.sdk_version,
      store_id: payload.store_id,
      channel_key: payload.channel_key,
      pay_method_v2: payload.pay_method_v2,
      currency: payload.currency,
      amount: payload.amount,
      order_name: payload.order_name,
      channels: payload.channels,
      payment_methods: payload.payment_methods,
      provider: payload.provider,
    }
    sessionStorage.setItem(DANGBAE_LAST_PREPARE_KEY, JSON.stringify(snap))
  } catch {
    /* ignore */
  }
}

/**
 * @returns {object | null}
 */
export function readLastPaymentPrepare() {
  try {
    const raw = sessionStorage.getItem(DANGBAE_LAST_PREPARE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object' || !o.merchant_uid) return null
    return o
  } catch {
    return null
  }
}

export function clearLastPaymentPrepare() {
  try {
    sessionStorage.removeItem(DANGBAE_LAST_PREPARE_KEY)
  } catch {
    /* ignore */
  }
}
