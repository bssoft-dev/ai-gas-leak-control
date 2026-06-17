import React from 'react'

/**
 * 간편 로그인 전용 모달 — 카카오 선택 후 부모에서 OAuth URL 요청
 */
export default function OAuthLoginModal({ open, onClose, onPickProvider, loading, errorHint }) {
  if (!open) return null

  return (
    <div
      className="dangbae-oauth-modal-overlay"
      role="presentation"
      onClick={loading ? undefined : onClose}
    >
      <div
        className="dangbae-oauth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dangbae-oauth-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dangbae-oauth-modal-title" className="dangbae-oauth-modal-title">
          간편 로그인
        </h2>
        <p className="dangbae-oauth-modal-desc">
          사용할 서비스를 선택하면 <strong>새 창(팝업)</strong>에서 로그인합니다. 팝업이 차단되면 주소창 옆에서
          허용해 주세요.
        </p>
        <p className="dangbae-oauth-modal-note">
          카카오는 Supabase 대시보드에서 Provider를 켜고, Redirect URL에 이 사이트의{' '}
          <code>
            {typeof window !== 'undefined'
              ? `${
                  window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname.startsWith('192.168.')
                    ? window.location.origin
                    : 'https://dangbae.kr'
                }/oauth-callback.html`
              : '/oauth-callback.html'}
          </code>
          를 등록해야 합니다.
        </p>
        {errorHint ? <p className="dangbae-oauth-modal-err">{errorHint}</p> : null}
        <div className="dangbae-oauth-modal-btns">
          <button
            type="button"
            className="oauth-kakao"
            disabled={loading}
            onClick={() => onPickProvider('kakao')}
          >
            카카오
          </button>

        </div>
        {loading ? <p className="dangbae-oauth-modal-loading">로그인 주소를 불러오는 중…</p> : null}
        <button type="button" className="dangbae-oauth-modal-close" onClick={onClose} disabled={loading}>
          닫기
        </button>
      </div>
    </div>
  )
}
