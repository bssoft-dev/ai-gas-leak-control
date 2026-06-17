import React, { useEffect, useRef, useState, useCallback } from 'react'
import { getOrCreateSseClientId } from '../sseClientId'
import './AuthPaymentWidget.css'

/**
 * Supabase 이메일 회원가입·로그인, OAuth URL, 결제 준비(카드/계좌이체/간편결제)
 */
function AuthPaymentWidget({ serviceName = '인증·결제', events = {}, onAction }) {
  const getEv = (key) => events[key] || key
  const eventsRef = useRef(events)
  eventsRef.current = events

  const [tab, setTab] = useState('login') // login | signup | payment

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [sessionToken, setSessionToken] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('auth_payment_access_token') || '' : ''
  )

  const [amount, setAmount] = useState(10000)
  const [orderName, setOrderName] = useState('테스트 주문')
  const [payMethods, setPayMethods] = useState(['card', 'trans', 'easy_pay'])
  const [lastPrepare, setLastPrepare] = useState(null)

  const esRef = useRef(null)

  const appendMsg = useCallback((text) => {
    setMsg((m) => (m ? `${m}\n${text}` : text))
  }, [])

  useEffect(() => {
    if (esRef.current) return
    const cid = getOrCreateSseClientId()
    const url =
      cid && typeof encodeURIComponent !== 'undefined'
        ? `/api/events/stream?client_id=${encodeURIComponent(cid)}&targeted_only=1`
        : '/api/events/stream'
    const es = new EventSource(url)
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const type = data.type || data.event_type
        if (type === 'SSE_CONNECTED') return
        const payload = data.payload || data
        if (type === 'AUTH_SIGN_UP_RESULT') {
          if (payload.ok) {
            appendMsg('회원가입 성공 (이메일 확인이 켜져 있으면 메일을 확인하세요)')
            if (payload.access_token) {
              setSessionToken(payload.access_token)
              localStorage.setItem('auth_payment_access_token', payload.access_token)
            }
          } else appendMsg(`회원가입 실패: ${payload.error || 'unknown'}`)
        }
        if (type === 'AUTH_SIGN_IN_RESULT') {
          if (payload.ok) {
            appendMsg('로그인 성공')
            if (payload.access_token) {
              setSessionToken(payload.access_token)
              localStorage.setItem('auth_payment_access_token', payload.access_token)
            }
          } else appendMsg(`로그인 실패: ${payload.error || 'unknown'}`)
        }
        if (type === 'AUTH_OAUTH_URL_RESULT') {
          if (payload.ok && payload.url) {
            appendMsg('OAuth 페이지로 이동합니다…')
            window.location.href = payload.url
          } else appendMsg(`OAuth URL 실패: ${payload.error || 'unknown'}`)
        }
        if (type === 'PAYMENT_PREPARE_RESULT') {
          if (payload.ok) {
            setLastPrepare(payload)
            appendMsg(
              `결제 준비 완료: merchant_uid=${payload.merchant_uid}, amount=${payload.amount}`
            )
          } else appendMsg(`결제 준비 실패: ${payload.error || 'unknown'}`)
        }
        if (type === 'PAYMENT_CONFIRM_RESULT') {
          appendMsg(`결제 확인: ${JSON.stringify(payload, null, 0)}`)
        }
      } catch (_) { }
    }
    es.onerror = () => { }
    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
  }, [appendMsg])

  const oauthRedirect = () => {
    const { origin, pathname, hash } = window.location
    return `${origin}${pathname}${hash || ''}`
  }

  const startOAuth = (provider) => {

    if (!onAction) return
    onAction(getEv('onAuthOAuthUrl'), {
      provider,
      redirect_to: oauthRedirect(),
    })
  }

  const submitSignUp = (ev) => {
    ev.preventDefault()
    if (!onAction) return
    onAction(getEv('onAuthSignUp'), { email, password })
  }

  const submitSignIn = (ev) => {
    ev.preventDefault()
    if (!onAction) return
    onAction(getEv('onAuthSignIn'), { email, password })
  }

  const preparePayment = () => {
    if (!onAction) return
    onAction(getEv('onPaymentPrepare'), {
      amount: Number(amount) || 0,
      order_name: orderName,
      payment_methods: payMethods,
      order_id: `demo-${Date.now()}`,
    })
  }

  const confirmMock = () => {
    if (!onAction || !lastPrepare?.merchant_uid) {
      appendMsg('먼저 결제 준비를 실행하세요.')
      return
    }
    onAction(getEv('onPaymentConfirm'), {
      merchant_uid: lastPrepare.merchant_uid,
      imp_uid: '',
    })
  }

  const toggleMethod = (m) => {
    setPayMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    )
  }

  return (
    <div className="auth-payment-widget">
      <header className="apw-header">
        <h1>{serviceName}</h1>
        <p className="apw-lead">
          Supabase 이메일 회원가입·로그인과 네이버·구글·카카오 OAuth, 결제(카드·계좌이체·간편) 준비를
          이벤트 버스 모듈로 처리합니다.
        </p>
        {sessionToken && (
          <p className="apw-token-hint">세션 토큰 저장됨 (로컬). 개발용입니다.</p>
        )}
      </header>

      <nav className="apw-tabs">
        <button type="button" className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>
          로그인
        </button>
        <button type="button" className={tab === 'signup' ? 'active' : ''} onClick={() => setTab('signup')}>
          회원가입
        </button>
        <button type="button" className={tab === 'payment' ? 'active' : ''} onClick={() => setTab('payment')}>
          결제
        </button>
      </nav>

      {tab === 'login' && (
        <section className="apw-panel">
          <form onSubmit={submitSignIn} className="apw-form">
            <label>
              이메일
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit">로그인</button>
          </form>
          <div className="apw-oauth">
            <p>간편 로그인</p>
            <div className="apw-oauth-btns">
              <button type="button" className="oauth-kakao" onClick={() => startOAuth('kakao')}>
                카카오
              </button>
              <button type="button" className="oauth-naver" onClick={() => startOAuth('naver')}>
                네이버
              </button>
              <button type="button" className="oauth-google" onClick={() => startOAuth('google')}>
                Google
              </button>
            </div>
            <p className="apw-hint">
              Supabase 대시보드 → Authentication → Providers에서 각 공급자를 켜고, Redirect URL에 이 서비스
              URL을 등록하세요.
            </p>
          </div>
        </section>
      )}

      {tab === 'signup' && (
        <section className="apw-panel">
          <form onSubmit={submitSignUp} className="apw-form">
            <label>
              이메일
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label>
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <button type="submit">회원가입</button>
          </form>
        </section>
      )}

      {tab === 'payment' && (
        <section className="apw-panel">
          <label className="apw-field">
            금액 (원)
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
          <label className="apw-field">
            주문명
            <input value={orderName} onChange={(e) => setOrderName(e.target.value)} />
          </label>
          <div className="apw-methods">
            <span>결제 수단 (복수 선택)</span>
            <label>
              <input
                type="checkbox"
                checked={payMethods.includes('card')}
                onChange={() => toggleMethod('card')}
              />{' '}
              일반카드
            </label>
            <label>
              <input
                type="checkbox"
                checked={payMethods.includes('trans')}
                onChange={() => toggleMethod('trans')}
              />{' '}
              계좌이체
            </label>
            <label>
              <input
                type="checkbox"
                checked={payMethods.includes('easy_pay')}
                onChange={() => toggleMethod('easy_pay')}
              />{' '}
              간편결제
            </label>
          </div>
          <div className="apw-actions">
            <button type="button" onClick={preparePayment}>
              결제 준비
            </button>
            <button type="button" className="secondary" onClick={confirmMock}>
              목업 결제 확인
            </button>
          </div>
          <p className="apw-hint">
            PAYMENT_PROVIDER=kpn 이면 한국결제네트웍스(KPN) 채널로 PortOne V2 SDK(requestPayment)를 사용합니다.
            PORTONE_STORE_ID·PORTONE_CHANNEL_KEY·PORTONE_API_SECRET(V2)이 필요합니다.
          </p>
        </section>
      )}

      <section className="apw-log">
        <h2>응답 로그</h2>
        <pre>{msg || '이벤트 결과가 여기에 표시됩니다.'}</pre>
      </section>
    </div>
  )
}

export default AuthPaymentWidget
