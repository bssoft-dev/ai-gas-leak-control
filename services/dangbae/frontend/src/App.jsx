import React, { useEffect, useState, useCallback } from 'react'
import DangbaeWidget from './components/DangbaeWidget'
import DangbaeAdmin from './components/DangbaeAdmin'
import LegalStaticPage from './legal/LegalStaticPage'
import { getBusinessInfo } from './legal/businessInfo'
import {
  DANGBAE_AUTH_TOKEN_KEY,
  DANGBAE_AUTH_CHANGED_EVENT,
  notifyDangbaeAuthChanged,
} from './components/account/authConstants'
import { getOrCreateSseClientId } from './sseClientId'
import './App.css'

const LEGAL_ROUTES = ['terms', 'privacy', 'refund', 'business', 'service-pricing']

function App() {
  const [interfaceDef, setInterfaceDef] = useState(null)
  const [serviceInfo, setServiceInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const [authToken, setAuthToken] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(DANGBAE_AUTH_TOKEN_KEY) || '' : ''
  )
  const isLoggedIn = Boolean(authToken?.trim())

  const syncAuthFromStorage = useCallback(() => {
    setAuthToken(typeof window !== 'undefined' ? localStorage.getItem(DANGBAE_AUTH_TOKEN_KEY) || '' : '')
  }, [])

  useEffect(() => {
    syncAuthFromStorage()
    window.addEventListener('storage', syncAuthFromStorage)
    window.addEventListener(DANGBAE_AUTH_CHANGED_EVENT, syncAuthFromStorage)
    return () => {
      window.removeEventListener('storage', syncAuthFromStorage)
      window.removeEventListener(DANGBAE_AUTH_CHANGED_EVENT, syncAuthFromStorage)
    }
  }, [syncAuthFromStorage])

  useEffect(() => {
    if (isLoggedIn && loginModalOpen) setLoginModalOpen(false)
  }, [isLoggedIn, loginModalOpen])

  const getRouteFromHash = () => {
    const path = window.location.pathname.replace(/\/+$/, '') || '/'
    if (path === '/admin') return 'admin'
    if (path === '/driver') return 'driver'

    const rawFull = window.location.hash.replace('#', '').replace(/^\//, '')
    const raw = rawFull.split('?')[0] || ''
    if (raw === 'login' || raw === 'account') return 'login'
    if (raw === 'mypage') return 'mypage'
    if (raw === 'status') return 'status'
    if (raw === 'request') return 'request'
    if (raw === 'payment') return 'payment'
    if (raw === 'driver') return 'driver'
    if (raw === 'admin') return 'admin'
    if (raw === 'terms') return 'terms'
    if (raw === 'privacy') return 'privacy'
    if (raw === 'refund') return 'refund'
    if (raw === 'business') return 'business'
    if (raw === 'service-pricing') return 'service-pricing'
    return 'landing'
  }

  const [route, setRoute] = useState(getRouteFromHash)

  // 로그인 성공 후 #/login 페이지면 배송 신청 페이지로 자동 이동
  useEffect(() => {
    if (isLoggedIn && route === 'login') {
      window.location.hash = '#/request'
    }
  }, [isLoggedIn, route])

  useEffect(() => {
    const loadData = async () => {
      try {
        const [serviceRes, interfacesRes] = await Promise.all([
          fetch('/api/service'),
          fetch('/api/interfaces')
        ])

        if (!serviceRes.ok || !interfacesRes.ok) {
          throw new Error('Failed to load service data')
        }

        const service = await serviceRes.json()
        const interfaces = await interfacesRes.json()

        setServiceInfo(service)
        setInterfaceDef(interfaces[0] || null)
        setLoading(false)
      } catch (err) {
        setError(err.message)
        setLoading(false)
      }
    }

    loadData()
  }, [])

  useEffect(() => {
    const onHashChange = () => {
      setRoute(getRouteFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    window.addEventListener('popstate', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener('popstate', onHashChange)
    }
  }, [])

  /** 포트원 m_redirect 복귀 시 일부 PG가 쿼리만 붙이고 해시가 비는 경우 — 결제 라우트로 보냄 */
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      if (!p.get('imp_uid')) return
      const raw = (window.location.hash || '').replace('#', '').replace(/^\//, '')
      const routeFromHash = raw.split('?')[0]
      if (routeFromHash !== 'payment') {
        window.location.hash = '#/payment'
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (LEGAL_ROUTES.includes(route)) {
      window.scrollTo(0, 0)
    }
  }, [route])

  useEffect(() => {
    if (!loginModalOpen) return undefined
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setLoginModalOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loginModalOpen])

  // 마이페이지: 로그인 여부와 관계없이 접근 허용 (내부에서 조회 폼 제공)

  useEffect(() => {
    if (!interfaceDef?.events) return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state') || ''
    if (!code) return
    const eventName = 'onSaveKakaoCode'
    const eventType = interfaceDef.events[eventName] || 'ADMIN_SAVE_KAKAO_CODE'
    if (!eventType) return
    fetch('/api/events/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: eventType, payload: { code, driver_id: state } }),
    }).finally(() => {
      const url = window.location.pathname + (window.location.hash || '') || '/'
      window.history.replaceState(null, '', url)
    })
  }, [interfaceDef])

  const businessInfo = getBusinessInfo()

  const handleEvent = async (eventName, payload) => {
    if (!interfaceDef?.events) return

    const eventType = interfaceDef.events[eventName] || eventName
    if (!eventType) return

    try {
      const sseCid = getOrCreateSseClientId()
      const body = {
        type: eventType,
        payload: payload || {},
      }
      if (sseCid) {
        body.sse_client_ids = [sseCid]
      }
      await fetch('/api/events/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      console.error('Failed to publish event:', err)
    }
  }

  const scrollToSection = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }

  const goToRoute = (next) => {
    const setHashRoute = (hashRoute) => {
      const target = `/#/${hashRoute}`
      if (window.location.pathname === '/admin') {
        window.history.pushState(null, '', target)
      } else {
        window.location.hash = `#/${hashRoute}`
      }
    }

    if (next === 'request') {
      setHashRoute('request')
      setRoute('request')
      scrollToSection('app-section')
    } else if (next === 'status') {
      setHashRoute('status')
      setRoute('status')
      scrollToSection('app-section')
    } else if (next === 'login') {
      setHashRoute('login')
      setRoute('login')
    } else if (next === 'mypage') {
      setHashRoute('mypage')
      setRoute('mypage')
      scrollToSection('app-section')
    } else if (next === 'payment') {
      setHashRoute('payment')
      setRoute('payment')
      scrollToSection('app-section')
    } else if (next === 'admin') {
      window.history.pushState(null, '', '/admin')
      setRoute('admin')
      scrollToSection('app-section')
    } else if (next === 'driver') {
      window.history.pushState(null, '', '/driver')
      setRoute('driver')
      scrollToSection('app-section')
    } else {
      setHashRoute('landing')
      setRoute('landing')
      scrollToSection('hero')
    }
  }

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>로딩 중...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="app-error">
        <h2>오류 발생</h2>
        <p>{error}</p>
      </div>
    )
  }

  if (!interfaceDef) {
    return (
      <div className="app-error">
        <h2>인터페이스를 찾을 수 없습니다</h2>
      </div>
    )
  }

  const isLegalPage = LEGAL_ROUTES.includes(route)
  const appMainRoutes = ['request', 'status', 'mypage', 'payment', 'driver']
  const showMainApp = appMainRoutes.includes(route) || route === 'admin'

  const mainPageTitle =
    route === 'request'
      ? '배송 신청'
      : route === 'status'
        ? '배송 현황'
        : route === 'mypage'
          ? '마이페이지'
          : route === 'payment'
            ? '결제'
            : route === 'driver'
              ? '배송원 페이지'
              : null

  const showSiteChrome = route !== 'login'

  return (
    <div className={`app${route === 'login' ? ' app--login-route' : ''}`}>
      {showSiteChrome && (
        <header className="landing-header">
          <button type="button" className="landing-logo landing-logo-btn" onClick={() => goToRoute('landing')}>
            <span className="landing-logo-mark">당</span>
            {serviceInfo?.name || '당배'}
          </button>
          <nav className="landing-nav">
            <button
              type="button"
              className={route === 'landing' ? 'landing-nav-active' : ''}
              onClick={() => goToRoute('landing')}
            >
              메인
            </button>
            <button
              type="button"
              className={route === 'request' ? 'landing-nav-active' : ''}
              onClick={() => goToRoute('request')}
            >
              배송 신청
            </button>
            <button
              type="button"
              className={route === 'status' ? 'landing-nav-active' : ''}
              onClick={() => goToRoute('status')}
            >
              배송 현황 조회
            </button>
            {isLoggedIn ? (
              <>
                <button
                  type="button"
                  className={route === 'mypage' ? 'landing-nav-active' : ''}
                  onClick={() => goToRoute('mypage')}
                >
                  마이페이지
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      localStorage.removeItem(DANGBAE_AUTH_TOKEN_KEY)
                    } catch (_) { }
                    notifyDangbaeAuthChanged()
                    setLoginModalOpen(false)
                    if (route === 'mypage') goToRoute('landing')
                  }}
                >
                  로그아웃
                </button>
              </>
            ) : (
              <button
                type="button"
                className={loginModalOpen ? 'landing-nav-active' : ''}
                onClick={() => setLoginModalOpen(true)}
              >
                로그인
              </button>
            )}
          </nav>
        </header>
      )}

      {route === 'login' ? (
        <main className="login-route-main">
          <div className="login-route-shell">
            <DangbaeWidget
              {...interfaceDef.props}
              onAction={handleEvent}
              events={interfaceDef.events}
              page="login"
            />
          </div>
        </main>
      ) : (
        <main className="landing-main">
          {isLegalPage && <LegalStaticPage route={route} />}

          {!isLegalPage && route === 'landing' && (
            <>
              <section id="hero" className="hero-section">
                <h1 className="hero-title">
                  당신의 배송, <span>당배</span>
                </h1>
                <p className="hero-subtitle">
                  소중한 물건을 동네 배송원이 픽업해 안전하게 전달해 드립니다.
                </p>
                <button
                  type="button"
                  className="btn-main"
                  onClick={() => goToRoute('request')}
                >
                  지금 배송 신청하기
                </button>
              </section>

              <section id="features" className="features-section">
                <h2 className="section-title">당배가 좋은 이유</h2>
                <div className="features-grid">
                  <div className="feature-card">
                    <div className="feature-icon">📍</div>
                    <h3>지도로 쉽게 위치 선택</h3>
                    <p>출발지와 도착지를 지도에서 클릭하거나 검색하고, 배송 경로와 거리를 한눈에 확인하세요.</p>
                  </div>
                  <div className="feature-card">
                    <div className="feature-icon">📦</div>
                    <h3>물품 정보 입력이 간편해요</h3>
                    <p>직접 입력 또는 사진 업로드로 물품을 등록할 수 있습니다. 여러 장의 사진도 업로드 가능합니다.</p>
                  </div>
                  <div className="feature-card">
                    <div className="feature-icon">💰</div>
                    <h3>예상 배송비 자동 계산</h3>
                    <p>경로·거리와 물품 크기·무게를 반영해 예상 배송비를 자동으로 계산해 드립니다.</p>
                  </div>
                </div>
              </section>

              <section id="service-pricing-teaser" className="service-pricing-teaser">
                <h2 className="section-title">서비스 및 요금</h2>
                <div className="service-pricing-teaser-inner">
                  <p>
                    <strong>당배</strong>는 동네 물품의 픽업·배송을 연결하는 배송 서비스입니다.<br />
                    이용 대가(예상 배송비)는 출발지·도착지·물품 조건에 따라 산정되며,
                    <strong>배송 신청</strong> 화면에서 금액을 확인한 뒤 요청할 수 있습니다.
                  </p>
                  <a className="service-pricing-teaser-link" href="#/service-pricing">
                    서비스·요금 상세 안내
                  </a>
                </div>
              </section>

              <section id="steps" className="steps-section">
                <h2 className="section-title">이용 방법</h2>
                <ol className="steps-list">
                  <li>
                    <strong>배송 신청</strong> – 출발지·도착지와 물품 정보를 입력하고 배송 요청을 보내세요.
                  </li>
                  <li>
                    <strong>배송원 배정</strong> – 배송원이 배정되면 일정과 요금을 확인할 수 있습니다.
                  </li>
                  <li>
                    <strong>픽업 및 배송</strong> – 배송원이 물건을 픽업한 뒤 목적지까지 안전하게 전달합니다.
                  </li>
                </ol>
                <button
                  type="button"
                  className="btn-main btn-secondary"
                  onClick={() => goToRoute('request')}
                >
                  지금 배송 신청하기
                </button>
              </section>
            </>
          )}

          {!isLegalPage && showMainApp && (
            <section id="app-section" className="widget-section">
              {route === 'admin' ? (
                <DangbaeAdmin
                  {...interfaceDef.props}
                  events={interfaceDef.events}
                  onAction={handleEvent}
                />
              ) : (
                <div className="widget-shell">
                  {mainPageTitle ? (
                    <header className="dangbae-page-header">
                      <h1 className="dangbae-page-title">{mainPageTitle}</h1>
                    </header>
                  ) : null}
                  <DangbaeWidget
                    {...interfaceDef.props}
                    onAction={handleEvent}
                    events={interfaceDef.events}
                    page={
                      route === 'status'
                        ? 'status'
                        : route === 'mypage'
                          ? 'mypage'
                          : route === 'payment'
                            ? 'payment'
                            : route === 'driver'
                              ? 'driver'
                              : 'user'
                    }
                  />
                </div>
              )}
            </section>
          )}
        </main>
      )}

      {showSiteChrome && (
        <footer className="landing-footer">
          <div className="landing-footer-links" aria-label="법적 고지 및 고객 정보">
            <a href="/driver" target="_blank" rel="noopener noreferrer">배송원 페이지</a>
            <span className="landing-footer-sep" aria-hidden>
              |
            </span>
            <a href="/admin" target="_blank" rel="noopener noreferrer">관리자페이지</a>
            <span className="landing-footer-sep" aria-hidden>
              |
            </span>
            <a href="/#/business">사업자 정보</a>
            <span className="landing-footer-sep" aria-hidden>
              |
            </span>
            <a href="/#/terms">이용약관</a>
            <span className="landing-footer-sep" aria-hidden>
              |
            </span>
            <a href="/#/privacy">개인정보처리방침</a>
            <span className="landing-footer-sep" aria-hidden>
              |
            </span>
            <a href="/#/refund">환불정책</a>
            <span className="landing-footer-sep" aria-hidden>
              |
            </span>
            <a href="/#/service-pricing">서비스·요금 안내</a>
          </div>
          <div className="landing-footer-business" aria-label="사업자 정보">
            <p className="landing-footer-business-line">
              <strong>{businessInfo.companyName}</strong>
              <span className="landing-footer-business-sep">|</span>
              {/* <span>대표 {businessInfo.representative}</span> */}
              {/* <span className="landing-footer-business-sep">|</span> */}
              <span>사업자등록번호 {businessInfo.businessRegNo}</span>
              {businessInfo.mailOrderRegNo ? (
                <>
                  <span className="landing-footer-business-sep">|</span>
                  <span>통신판매업 신고 {businessInfo.mailOrderRegNo}</span>
                </>
              ) : null}
            </p>
            {/* <p className="landing-footer-business-line">{businessInfo.address}</p> */}
            <p className="landing-footer-business-line">
              <span>TEL {businessInfo.phone}</span>
              {businessInfo.email ? (
                <>
                  <span className="landing-footer-business-sep">|</span>
                  <a href={`mailto:${businessInfo.email}`}>{businessInfo.email}</a>
                </>
              ) : null}
            </p>
          </div>
          <p className="landing-footer-copy">
            {serviceInfo?.name || businessInfo.tradeName || '당배'} · 당신의 배송, 무거운 짐은 당배에게 맡기세요.
          </p>
        </footer>
      )}

      {showSiteChrome && loginModalOpen && (
        <div className="app-login-modal-overlay" role="presentation" onClick={() => setLoginModalOpen(false)}>
          <div
            className="app-login-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-login-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="app-login-modal-head">
              <h2 id="app-login-modal-title">로그인</h2>
              <button type="button" className="app-login-modal-close" onClick={() => setLoginModalOpen(false)} aria-label="로그인 모달 닫기">
                ×
              </button>
            </div>
            <DangbaeWidget
              {...interfaceDef.props}
              onAction={handleEvent}
              events={interfaceDef.events}
              page="login"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
