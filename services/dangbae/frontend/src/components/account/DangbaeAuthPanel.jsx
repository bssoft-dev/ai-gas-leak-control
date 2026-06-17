import React from 'react'

/**
 * 이메일 로그인·회원가입 + OAuth (부모에서 이벤트 발행)
 */
export default function DangbaeAuthPanel({
  email,
  password,
  authMode,
  onEmailChange,
  onPasswordChange,
  onAuthModeChange,
  onSignIn,
  onSignUp,
  onPickProvider,
  loginSubmitLabel = '로그인',
  signupSubmitLabel = '회원가입',
  authBusy = false,
}) {
  return (
    <div className="dangbae-auth-panel">
      <div className="dangbae-account-subtabs dangbae-auth-modes" role="tablist" aria-label="로그인 또는 회원가입">
        <button
          type="button"
          role="tab"
          aria-selected={authMode === 'login'}
          className={authMode === 'login' ? 'active' : ''}
          onClick={() => onAuthModeChange('login')}
          disabled={authBusy}
        >
          로그인
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={authMode === 'signup'}
          className={authMode === 'signup' ? 'active' : ''}
          onClick={() => onAuthModeChange('signup')}
          disabled={authBusy}
        >
          회원가입
        </button>
      </div>

      {authMode === 'login' && (
        <section className="dangbae-account-panel" aria-labelledby="dangbae-auth-login-title">
          <h4 id="dangbae-auth-login-title" className="visually-hidden">
            이메일 로그인
          </h4>
          <form onSubmit={onSignIn} className="dangbae-account-form">
            <label>
              이메일
              <input
                type="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                autoComplete="email"
                required
                disabled={authBusy}
              />
            </label>
            <label>
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                autoComplete="current-password"
                required
                disabled={authBusy}
              />
            </label>
            <button type="submit" className="dangbae-account-submit" disabled={authBusy}>
              {loginSubmitLabel}
            </button>
          </form>
          <div className="dangbae-account-oauth">
            <p>간편 로그인</p>
            <div className="dangbae-account-oauth-btns">
              <button type="button" className="oauth-kakao" disabled={authBusy} onClick={() => onPickProvider('kakao')}>
                카카오
              </button>
            </div>
          </div>
        </section>
      )}

      {authMode === 'signup' && (
        <section className="dangbae-account-panel" aria-labelledby="dangbae-auth-signup-title">
          <h4 id="dangbae-auth-signup-title" className="visually-hidden">
            이메일 회원가입
          </h4>
          <form onSubmit={onSignUp} className="dangbae-account-form">
            <label>
              이메일
              <input
                type="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                autoComplete="email"
                required
                disabled={authBusy}
              />
            </label>
            <label>
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                autoComplete="new-password"
                required
                disabled={authBusy}
              />
            </label>
            <button type="submit" className="dangbae-account-submit" disabled={authBusy}>
              {signupSubmitLabel}
            </button>
          </form>
          <div className="dangbae-account-oauth">
            <p>간편 회원가입</p>
            <div className="dangbae-account-oauth-btns">
              <button type="button" className="oauth-kakao" disabled={authBusy} onClick={() => onPickProvider('kakao')}>
                카카오
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
