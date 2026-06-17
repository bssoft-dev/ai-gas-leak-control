/** 포트원 V2 + 한국결제네트웍스(KPN) 브라우저 SDK */

export const PORTONE_V2_SDK_URL = 'https://cdn.portone.io/v2/browser-sdk.js'

const PAY_METHOD_V2 = {
  card: 'CARD',
  trans: 'TRANSFER',
  transfer: 'TRANSFER',
  vbank: 'VIRTUAL_ACCOUNT',
  easy_pay: 'EASY_PAY',
  kakaopay: 'EASY_PAY',
  naverpay: 'EASY_PAY',
  tosspay: 'EASY_PAY',
}

export function isKpnCheckout(prepare) {
  if (!prepare) return false
  const p = String(prepare.provider || '').toLowerCase()
  return p === 'kpn' || prepare.sdk_version === 'v2' || !!(prepare.store_id && prepare.channel_key)
}

export function mapPayMethodToV2(method) {
  const key = String(method || 'card').trim().toLowerCase()
  return PAY_METHOD_V2[key] || 'CARD'
}

export async function ensurePortOneV2Loaded(scriptUrl = PORTONE_V2_SDK_URL) {
  if (typeof window === 'undefined') throw new Error('브라우저 환경에서만 결제가 가능합니다.')
  if (window.PortOne) return window.PortOne
  await new Promise((resolve, reject) => {
    const exist = document.querySelector('script[data-dangbae-portone-v2="1"]')
    if (exist) {
      exist.addEventListener('load', resolve, { once: true })
      exist.addEventListener('error', () => reject(new Error('포트원 V2 SDK 로드 실패')), { once: true })
      return
    }
    const s = document.createElement('script')
    s.src = scriptUrl
    s.async = true
    s.dataset.dangbaePortoneV2 = '1'
    s.onload = resolve
    s.onerror = () => reject(new Error('포트원 V2 SDK 로드 실패'))
    document.head.appendChild(s)
  })
  if (!window.PortOne) throw new Error('PortOne V2 SDK를 찾지 못했습니다.')
  return window.PortOne
}

/** V2 리다이렉트 복귀: paymentId(또는 merchant_uid), code */
export function parseKpnReturnParams() {
  const out = { payment_id: '', merchant_uid: '', imp_uid: '', code: '', imp_success: null }
  const apply = (params) => {
    if (!params) return
    const pid = params.get('paymentId') || params.get('payment_id')
    const mu = params.get('merchant_uid')
    const iu = params.get('imp_uid')
    const code = params.get('code')
    const is = params.get('imp_success')
    if (pid) out.payment_id = pid
    if (mu) out.merchant_uid = mu
    if (iu) out.imp_uid = iu
    if (code) out.code = code
    if (is != null && is !== '') out.imp_success = is
  }
  try {
    apply(new URLSearchParams(window.location.search))
  } catch {
    /* ignore */
  }
  try {
    const hash = window.location.hash || ''
    const q = hash.indexOf('?')
    if (q >= 0) apply(new URLSearchParams(hash.slice(q + 1)))
  } catch {
    /* ignore */
  }
  if (!out.payment_id && out.merchant_uid) out.payment_id = out.merchant_uid
  return out
}

export function cleanKpnReturnFromUrl() {
  if (typeof window === 'undefined') return
  try {
    const u = new URL(window.location.href)
    ;[
      'paymentId',
      'payment_id',
      'imp_uid',
      'merchant_uid',
      'imp_success',
      'code',
      'error_msg',
      'transactionType',
      'txId',
    ].forEach((k) => u.searchParams.delete(k))
    if (u.hash && u.hash.includes('?')) {
      const [path, q] = u.hash.split('?')
      const p = new URLSearchParams(q)
      ;[
        'paymentId',
        'payment_id',
        'imp_uid',
        'merchant_uid',
        'imp_success',
        'code',
        'error_msg',
        'transactionType',
        'txId',
      ].forEach((k) => p.delete(k))
      const rest = p.toString()
      u.hash = rest ? `${path}?${rest}` : path
    }
    window.history.replaceState({}, '', u.toString())
  } catch {
    /* ignore */
  }
}
