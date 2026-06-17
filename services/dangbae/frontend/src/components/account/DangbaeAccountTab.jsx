import React, { useState, useCallback, useEffect, useRef } from 'react'
import DangbaeAuthPanel from './DangbaeAuthPanel'
import './DangbaeAccountTab.css'

const OAUTH_POPUP_FLAG = 'dangbae_oauth_use_popup'

function parseOAuthPayload(hash, search) {
  const tryParse = (s) => {
    if (!s || s.length < 2) return null
    const q = s.startsWith('#') || s.startsWith('?') ? s.slice(1) : s
    return new URLSearchParams(q)
  }
  let params = tryParse(hash)
  if (!params || (!params.get('access_token') && !params.get('error'))) {
    const p2 = tryParse(search)
    if (p2 && (p2.get('access_token') || p2.get('error'))) params = p2
  }
  if (!params) return { access_token: null, refresh_token: null, error: null }
  const rawErr = params.get('error') || params.get('error_code') || params.get('error_description')
  let errMsg = null
  if (rawErr) {
    try {
      errMsg = decodeURIComponent(rawErr.replace(/\+/g, ' '))
    } catch {
      errMsg = rawErr
    }
  }
  return {
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
    error: errMsg,
  }
}

/**
 * 로그인·회원가입. standalone: 사이트 헤더 없는 전용 페이지용 상단 바.
 */
export default function DangbaeAccountTab({
  standalone = false,
  getEventName,
  onAction,
  sessionToken,
  accountMsg,
  onOAuthResult,
}) {
  const [authMode, setAuthMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [oauthLoading, setOauthLoading] = useState(false)
  const [oauthModalError, setOauthModalError] = useState(null)
  const oauthLoadingRef = useRef(false)
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimerRef = useRef(null)

  const oauthCallbackUrl = useCallback(() => {
    if (typeof window === 'undefined') return '/oauth-callback.html'
    const origin =
      window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.startsWith('192.168.')
        ? window.location.origin
        : 'https://dangbae.kr'
    return `${origin}/oauth-callback.html`
  }, [])

  const handleSignIn = useCallback(
    (ev) => {
      ev.preventDefault()
      if (!onAction) return
      onAction(getEventName('onAuthSignIn'), { email, password })
    },
    [onAction, getEventName, email, password]
  )

  const handleSignUp = useCallback(
    (ev) => {
      ev.preventDefault()
      if (!onAction) return
      onAction(getEventName('onAuthSignUp'), { email, password })
    },
    [onAction, getEventName, email, password]
  )

  const handlePickProvider = useCallback(
    (provider) => {
      if (!onAction) return
      setOauthModalError(null)
      setOauthLoading(true)
      oauthLoadingRef.current = true
      try {
        sessionStorage.setItem(OAUTH_POPUP_FLAG, '1')
      } catch (_) { }
      onAction(getEventName('onAuthOAuthUrl'), {
        provider,
        redirect_to: oauthCallbackUrl(),
      })
    },
    [onAction, getEventName, oauthCallbackUrl]
  )

  useEffect(() => {
    const onPopupOpened = (e) => {
      setOauthLoading(false)
      oauthLoadingRef.current = false
      if (e.detail && e.detail.ok === true) {
        // no-op: provider buttons are shown inline
      } else if (e.detail && e.detail.ok === false) {
        setOauthModalError('팝업을 열 수 없습니다. 브라우저에서 팝업을 허용해 주세요.')
      }
    }
    const onOAuthErr = () => {
      setOauthLoading(false)
      oauthLoadingRef.current = false
      setOauthModalError('로그인 주소를 가져오지 못했습니다. Supabase·Provider 설정을 확인해 주세요.')
    }
    window.addEventListener('dangbae-oauth-popup-opened', onPopupOpened)
    window.addEventListener('dangbae-oauth-url-failed', onOAuthErr)
    return () => {
      window.removeEventListener('dangbae-oauth-popup-opened', onPopupOpened)
      window.removeEventListener('dangbae-oauth-url-failed', onOAuthErr)
    }
  }, [])

  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== 'DANGBAE_OAUTH') return
      const { access_token, refresh_token, error } = parseOAuthPayload(e.data.hash, e.data.search)
      if (error) {
        onOAuthResult?.({ ok: false, error: `OAuth: ${error}` })
        setOauthModalError(error)
        return
      }
      if (access_token) {
        onOAuthResult?.({ ok: true, access_token, refresh_token })
        setOauthModalError(null)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onOAuthResult])

  useEffect(() => {
    if (!oauthLoading) return undefined
    const t = setTimeout(() => {
      if (oauthLoadingRef.current) {
        oauthLoadingRef.current = false
        setOauthLoading(false)
        setOauthModalError('응답 시간이 초과되었습니다. 다시 시도해 주세요.')
      }
    }, 20000)
    return () => clearTimeout(t)
  }, [oauthLoading])

  useEffect(() => {
    if (!accountMsg) return
    setToastVisible(true)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 3500)
    return () => clearTimeout(toastTimerRef.current)
  }, [accountMsg])

  return (
    <div className={`dangbae-account dangbae-account-only-auth${standalone ? ' dangbae-account--standalone' : ''}`}>
      <section className="dangbae-account-section dangbae-account-section--auth-full" aria-labelledby="dangbae-col-auth">

        <DangbaeAuthPanel
          email={email}
          password={password}
          authMode={authMode}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onAuthModeChange={setAuthMode}
          onSignIn={handleSignIn}
          onSignUp={handleSignUp}
          onPickProvider={handlePickProvider}
          authBusy={oauthLoading}
        />
      </section>
      {oauthLoading ? <p className="dangbae-oauth-inline-loading">로그인 주소를 불러오는 중…</p> : null}
      {oauthModalError ? <p className="dangbae-oauth-inline-error">{oauthModalError}</p> : null}

      {accountMsg && toastVisible && (
        <div
          className="dangbae-account-toast"
          role="alert"
          aria-live="assertive"
          onClick={() => setToastVisible(false)}
        >
          <span className="dangbae-account-toast-msg">{accountMsg}</span>
          <button
            type="button"
            className="dangbae-account-toast-close"
            aria-label="닫기"
            onClick={(e) => { e.stopPropagation(); setToastVisible(false) }}
          >✕</button>
        </div>
      )}
    </div>
  )
}
