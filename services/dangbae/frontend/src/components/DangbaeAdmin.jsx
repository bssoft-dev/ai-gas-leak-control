import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DangbaeKakaoMap from './DangbaeKakaoMap'
import './DangbaeAdmin.css'

const SITUATION_LABELS = { waiting: '대기', delivering: '배송중', off: '휴무' }
const STATUS_LABELS = { agreed: '동의', pending: '미동의' }
const ORDER_STATUS_LABELS = {
  payment_pending: '결제 대기',
  pending: '접수 대기',
  assigned: '픽업예정',
  picked_up: '픽업완료',
  delivered: '배송완료',
  cancel_requested: '취소요청 중',
  cancelled: '취소완료',
}

function orderItemImageSrc(stored) {
  if (!stored) return ''
  const s = String(stored).trim()
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:') || s.startsWith('/')) return s
  return `/api/dangbae-order-item-image?p=${encodeURIComponent(s)}`
}

function fmtTs(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('ko-KR')
}

const KAKAO_CONSENT_URL = 'https://kauth.kakao.com/oauth/authorize?client_id=ee5b2ac53eda17c8ab823a90fb9b573a&redirect_uri=https://dangbae.bs-soft.co.kr&response_type=code&scope=talk_message'

const ADMIN_SESSION_KEY = 'dangbae_admin_session'
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000 // 24시간
const EMPTY_DRIVER_FORM = { name: '', phone: '', status: 'pending', situation: 'waiting' }

const MENU_ITEMS = [
  { key: 'dashboard', label: '관리자 대시보드' },
  { key: 'drivers', label: '배송원 관리' },
  { key: 'orders', label: '배송건 관리' },
  { key: 'silent', label: '묵음 배송관리' },
  { key: 'live', label: '현재 배송현황' },
  { key: 'driverHistory', label: '배송원별 배송이력' },
  { key: 'requesterLookup', label: '배송건(의뢰인) 조회' },
  { key: 'bundle', label: '묶음배송 운영' },
]

function getStoredSession() {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY)
    if (!raw) return false
    const data = JSON.parse(raw)
    if (data.expiresAt <= Date.now()) {
      clearAdminSession()
      return false
    }
    return true
  } catch {
    return false
  }
}

function saveAdminSession() {
  const expiresAt = Date.now() + SESSION_DURATION_MS
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ expiresAt }))
}

function clearAdminSession() {
  localStorage.removeItem(ADMIN_SESSION_KEY)
}

function toValidDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function DangbaeAdmin({ events = {}, onAction, kakao_map_appkey = '' }) {
  const [activeMenu, setActiveMenu] = useState('dashboard')
  const [authenticated, setAuthenticated] = useState(getStoredSession)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [drivers, setDrivers] = useState([])
  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [driversLoading, setDriversLoading] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [editingDriver, setEditingDriver] = useState(null)
  const [formDriver, setFormDriver] = useState(EMPTY_DRIVER_FORM)
  const [assignOrderId, setAssignOrderId] = useState(null)
  const [detailOrder, setDetailOrder] = useState(null)
  const [bundleOrderIds, setBundleOrderIds] = useState([])
  const [bundleActualFares, setBundleActualFares] = useState({})
  const [bundleSaving, setBundleSaving] = useState(false)
  const [bundleDriverSelect, setBundleDriverSelect] = useState('')
  const [orderFilter, setOrderFilter] = useState('all')
  const [orderSearch, setOrderSearch] = useState('')
  const [liveFilter, setLiveFilter] = useState('all')
  const [liveQuery, setLiveQuery] = useState('')
  const [historySituationFilter, setHistorySituationFilter] = useState('all')
  const [historyQuery, setHistoryQuery] = useState('')
  const [requesterQuery, setRequesterQuery] = useState('')
  const eventSourceRef = useRef(null)
  const bundleGroupIdRef = useRef('')
  const mapAppKey = (kakao_map_appkey && String(kakao_map_appkey).trim()) || ''

  const refreshAll = useCallback(() => {
    setDriversLoading(true)
    setOrdersLoading(true)
    onAction('onAdminDriverList', {})
    onAction('onAdminOrdersQuery', {})
  }, [onAction])

  const handleAuth = async (e) => {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)
    onAction('onAdminAuth', { password })
  }

  useEffect(() => {
    // 브로드캐스트: 모든 이벤트(타깃 포함) 수신 — 일반 사용자 SSE와 구분
    const url = '/api/events/stream?subscribe_all=1'
    if (eventSourceRef.current) return
    const es = new EventSource(url)
    eventSourceRef.current = es
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const type = data.type || data.event_type
        const payload = data.payload || data
        if (type === 'ADMIN_AUTH_RESULT') {
          const ok = !!payload?.ok
          setAuthenticated(ok)
          setAuthLoading(false)
          if (ok) saveAdminSession()
          else {
            clearAdminSession()
            setAuthError('비밀번호가 올바르지 않습니다.')
          }
        }
        if (type === 'ADMIN_DRIVER_LIST_RESULT') {
          setDrivers(Array.isArray(payload?.drivers) ? payload.drivers : [])
          setDriversLoading(false)
        }
        if (type === 'ADMIN_DRIVER_SAVED') {
          setDriversLoading(false)
          if (payload?.ok) {
            setEditingDriver(null)
            setFormDriver(EMPTY_DRIVER_FORM)
            setSaveError('')
            onAction('onAdminDriverList', {})
          } else setSaveError(payload?.error || '저장 실패')
        }
        if (type === 'ADMIN_DRIVER_DELETED') {
          setDriversLoading(false)
          if (payload?.ok) {
            setDeleteError('')
            onAction('onAdminDriverList', {})
          } else setDeleteError(payload?.error || '삭제 실패')
        }
        if (type === 'ORDER_QUERIED') {
          setOrdersLoading(false)
          const list = payload?.orders ?? (payload?.order_id ? [{ order_id: payload.order_id, ...payload }] : [])
          setOrders(Array.isArray(list) ? list : [])
        }
        if (type === 'ADMIN_KAKAO_CODE_SAVED' && payload?.ok) {
          onAction('onAdminDriverList', {})
        }
      } catch (_) {}
    }
    es.onerror = () => {}
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!authenticated) return
    setDriversLoading(true)
    setOrdersLoading(true)
    setTimeout(() => {
      refreshAll()
    }, 500)
  }, [authenticated, refreshAll])

  const submitDriver = (e) => {
    e.preventDefault()
    setSaveError('')
    setDriversLoading(true)
    if (editingDriver) {
      onAction('onAdminDriverSave', { id: editingDriver.id, ...formDriver })
    } else {
      onAction('onAdminDriverSave', formDriver)
    }
  }

  const deleteDriver = (id) => {
    if (!window.confirm('이 배송원을 삭제할까요?')) return
    setDeleteError('')
    setDriversLoading(true)
    onAction('onAdminDriverDelete', { id })
  }

  const assignDriver = (orderId, driver) => {
    const order = orders.find((o) => (o.order_id || o.id) === orderId)
    if (!order) return
    onAction('onOrderUpdate', {
      order_id: orderId,
      driver_id: driver.id,
      driver_name: driver.name,
      driver_phone: driver.phone,
      status: 'assigned',
      custom_event_type: 'DANGBAE_DRIVER_ASSIGNED',
    })
    onAction('onAdminDriverSave', { ...driver, situation: 'delivering' })
    setAssignOrderId(null)
    setTimeout(() => {
      onAction('onAdminOrdersQuery', {})
      setOrdersLoading(true)
    }, 300)
  }

  const completeOrder = (order) => {
    const oid = order.order_id || order.id
    onAction('onOrderUpdate', {
      order_id: oid,
      status: 'delivered',
      custom_event_type: 'DANGBAE_DELIVERY_CONFIRMED',
    })
    if (order.driver_id) {
      const remains = orders.some((o) => {
        const status = o.status || 'pending'
        const id = o.order_id || o.id
        return String(o.driver_id) === String(order.driver_id) && id !== oid && (status === 'assigned' || status === 'picked_up')
      })
      const driver = drivers.find((d) => String(d.id) === String(order.driver_id))
      if (driver && !remains) onAction('onAdminDriverSave', { ...driver, situation: 'waiting' })
    }
    setTimeout(() => {
      onAction('onAdminOrdersQuery', {})
      setOrdersLoading(true)
    }, 300)
  }

  const markPickedUp = (order) => {
    const oid = order.order_id || order.id
    onAction('onOrderUpdate', { order_id: oid, status: 'picked_up' })
    setTimeout(() => {
      onAction('onAdminOrdersQuery', {})
      setOrdersLoading(true)
    }, 300)
  }

  const approveCancel = (order) => {
    const oid = order.order_id || order.id
    onAction('onOrderUpdate', { order_id: oid, status: 'cancelled', admin_cancel_approve: true })
    setTimeout(() => {
      onAction('onAdminOrdersQuery', {})
      setOrdersLoading(true)
    }, 300)
  }

  const assignableDrivers = useMemo(
    () => drivers.filter((d) => d.situation !== 'off' && d.status === 'agreed'),
    [drivers]
  )

  const driverHistory = useMemo(() => {
    return drivers.map((driver) => {
      const linked = orders.filter((o) => String(o.driver_id || '') === String(driver.id))
      return {
        driver,
        completed: linked.filter((o) => (o.status || 'pending') === 'delivered'),
        pickupScheduled: linked.filter((o) => (o.status || 'pending') === 'assigned'),
        pickupDone: linked.filter((o) => (o.status || 'pending') === 'picked_up'),
        pending: linked.filter((o) => (o.status || 'pending') === 'pending'),
      }
    })
  }, [drivers, orders])
  const dashboardMetrics = useMemo(() => {
    const now = Date.now()
    const dayAgo = now - 24 * 60 * 60 * 1000
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000

    const requestedCount = orders.filter((o) => (o.status || '') === 'pending').length
    const inProgressCount = orders.filter((o) => ['assigned', 'picked_up'].includes(o.status || 'pending')).length
    const deliveredOrders = orders.filter((o) => (o.status || 'pending') === 'delivered')
    const deliveredCount = deliveredOrders.length

    const totalDrivers = drivers.length
    const deliveringDrivers = drivers.filter((d) => d.situation === 'delivering').length
    const waitingDriversCount = drivers.filter((d) => d.situation === 'waiting').length

    const fareValues = deliveredOrders
      .map((o) => {
        const actual = Number(o.actual_fare)
        if (Number.isFinite(actual) && actual > 0) return actual
        const estimated = Number(o.estimated_fare)
        return Number.isFinite(estimated) && estimated > 0 ? estimated : null
      })
      .filter((v) => v != null)
    const avgRevenuePerOrder = fareValues.length
      ? Math.round(fareValues.reduce((sum, v) => sum + v, 0) / fareValues.length)
      : null

    const durationHours = deliveredOrders
      .map((o) => {
        const created = toValidDate(o.created_at)
        const finished = toValidDate(o.delivered_at || o.completed_at || o.updated_at)
        if (!created || !finished) return null
        const ms = finished.getTime() - created.getTime()
        if (ms <= 0) return null
        return ms / (1000 * 60 * 60)
      })
      .filter((h) => h != null)
    const avgDeliveryHours = durationHours.length
      ? durationHours.reduce((sum, h) => sum + h, 0) / durationHours.length
      : null

    const newOrders24h = orders.filter((o) => {
      const created = toValidDate(o.created_at)
      return created && created.getTime() >= dayAgo
    }).length
    const newCompleted24h = deliveredOrders.filter((o) => {
      const completed = toValidDate(o.delivered_at || o.completed_at || o.updated_at)
      return completed && completed.getTime() >= dayAgo
    }).length
    const newDrivers7d = drivers.filter((d) => {
      const created = toValidDate(d.created_at || d.updated_at)
      return created && created.getTime() >= weekAgo
    }).length

    return {
      requestedCount,
      inProgressCount,
      deliveredCount,
      totalDrivers,
      deliveringDrivers,
      waitingDriversCount,
      avgRevenuePerOrder,
      avgDeliveryHours,
      newOrders24h,
      newCompleted24h,
      newDrivers7d,
    }
  }, [drivers, orders])

  const waitingDrivers = assignableDrivers.filter((d) => d.situation === 'waiting')
  const pendingOrders = orders.filter((o) => (o.status || '') === 'pending' && !o.driver_id)
  const bundleOrders = bundleOrderIds.map((id) => orders.find((o) => (o.order_id || o.id) === id)).filter(Boolean)
  const bundleRouteStops = useMemo(() => {
    const list = bundleOrderIds
      .map((id) => orders.find((o) => (o.order_id || o.id) === id))
      .filter(Boolean)
    const out = []
    for (const order of list) {
      if (order.origin_lat != null && order.origin_lng != null) {
        out.push({ lat: Number(order.origin_lat), lng: Number(order.origin_lng) })
      }
      if (order.dest_lat != null && order.dest_lng != null) {
        out.push({ lat: Number(order.dest_lat), lng: Number(order.dest_lng) })
      }
    }
    return out
  }, [bundleOrderIds, orders])

  const liveOrders = useMemo(
    () => orders.filter((o) => ['assigned', 'picked_up'].includes(o.status || 'pending')),
    [orders]
  )
  const liveOrdersFiltered = useMemo(() => {
    const q = liveQuery.trim().toLowerCase()
    return liveOrders.filter((o) => {
      const st = o.status || 'pending'
      if (liveFilter !== 'all' && st !== liveFilter) return false
      if (!q) return true
      const oid = String(o.order_id || o.id || '').toLowerCase()
      const driver = String(o.driver_name || '').toLowerCase()
      const phone = String(o.driver_phone || '').toLowerCase()
      const origin = String(o.origin_address || '').toLowerCase()
      const dest = String(o.dest_address || '').toLowerCase()
      return (
        oid.includes(q) ||
        driver.includes(q) ||
        phone.includes(q) ||
        origin.includes(q) ||
        dest.includes(q)
      )
    })
  }, [liveOrders, liveFilter, liveQuery])
  const silentOrders = orders.filter((o) => {
    const memo = `${o.memo || ''} ${o.request_note || ''}`.toLowerCase()
    return o.is_silent === true || o.silent_delivery === true || o.no_call === true || memo.includes('묵음')
  })

  const ordersForManagementList = useMemo(() => {
    const list = [...orders]
    list.sort((a, b) => {
      const ga = String(a.bundle_group_id || '').trim()
      const gb = String(b.bundle_group_id || '').trim()
      if (ga && gb && ga === gb) return (Number(a.route_order) || 0) - (Number(b.route_order) || 0)
      if (ga && !gb) return -1
      if (!ga && gb) return 1
      const ida = String(a.order_id || a.id || '')
      const idb = String(b.order_id || b.id || '')
      return ida.localeCompare(idb, undefined, { numeric: true })
    })
    return list
  }, [orders])

  const visibleOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase()
    return ordersForManagementList.filter((o) => {
      const st = o.status || 'pending'
      if (orderFilter !== 'all' && st !== orderFilter) return false
      if (!q) return true
      const oid = String(o.order_id || o.id || '').toLowerCase()
      const user = String(o.user_name || o.requester_name || '').toLowerCase()
      const userPhone = String(o.user_phone || '').toLowerCase()
      const driver = String(o.driver_name || '').toLowerCase()
      const driverPhone = String(o.driver_phone || '').toLowerCase()
      const origin = String(o.origin_address || '').toLowerCase()
      const dest = String(o.dest_address || '').toLowerCase()
      const gid = String(o.bundle_group_id || '').toLowerCase()
      return (
        oid.includes(q) ||
        user.includes(q) ||
        userPhone.includes(q) ||
        driver.includes(q) ||
        driverPhone.includes(q) ||
        origin.includes(q) ||
        dest.includes(q) ||
        gid.includes(q)
      )
    })
  }, [ordersForManagementList, orderFilter, orderSearch])

  const driverHistoryRows = useMemo(() => {
    const q = historyQuery.trim().toLowerCase()
    return driverHistory.filter(({ driver }) => {
      if (historySituationFilter !== 'all' && (driver.situation || 'waiting') !== historySituationFilter) {
        return false
      }
      if (!q) return true
      const name = String(driver.name || '').toLowerCase()
      const phone = String(driver.phone || '').toLowerCase()
      const id = String(driver.id || '').toLowerCase()
      return name.includes(q) || phone.includes(q) || id.includes(q)
    })
  }, [driverHistory, historySituationFilter, historyQuery])

  const requesterFilteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (!requesterQuery.trim()) return true
      const q = requesterQuery.trim().toLowerCase()
      const oid = String(o.order_id || o.id || '').toLowerCase()
      const name = String(o.user_name || o.requester_name || '').toLowerCase()
      const phone = String(o.user_phone || '').toLowerCase()
      const email = String(o.user_email || '').toLowerCase()
      return oid.includes(q) || name.includes(q) || phone.includes(q) || email.includes(q)
    })
  }, [orders, requesterQuery])

  if (!authenticated) {
    return (
      <div className="dangbae-admin">
        <div className="admin-auth-card">
          <h2>관리자 로그인</h2>
          <p className="auth-sub">비밀번호를 입력하세요.</p>
          <form onSubmit={handleAuth}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              autoComplete="current-password"
              disabled={authLoading}
            />
            <button type="submit" disabled={authLoading}>
              {authLoading ? '확인 중...' : '로그인'}
            </button>
          </form>
          {authError && <p className="admin-error">{authError}</p>}
        </div>
      </div>
    )
  }

  const addToBundle = (ids) => {
    setBundleOrderIds((prev) => {
      const next = Array.from(new Set([...prev, ...ids]))
      if (prev.length === 0 && next.length > 0 && !bundleGroupIdRef.current) {
        try {
          bundleGroupIdRef.current =
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `bg_${Date.now()}_${Math.random().toString(16).slice(2)}`
        } catch {
          bundleGroupIdRef.current = `bg_${Date.now()}`
        }
      }
      return next
    })
  }
  const removeFromBundle = (id) => {
    setBundleOrderIds((prev) => {
      const next = prev.filter((x) => x !== id)
      if (next.length === 0) bundleGroupIdRef.current = ''
      return next
    })
    setBundleActualFares((f) => ({ ...f, [id]: undefined }))
  }
  const moveBundleOrder = (index, delta) => {
    const next = [...bundleOrderIds]
    const to = index + delta
    if (to < 0 || to >= next.length) return
    const tmp = next[index]
    next[index] = next[to]
    next[to] = tmp
    setBundleOrderIds(next)
  }
  const saveBundleRouteOrder = () => {
    if (!bundleOrderIds.length) return
    if (!bundleGroupIdRef.current) {
      try {
        bundleGroupIdRef.current =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `bg_${Date.now()}_${Math.random().toString(16).slice(2)}`
      } catch {
        bundleGroupIdRef.current = `bg_${Date.now()}`
      }
    }
    const gid = bundleGroupIdRef.current
    setBundleSaving(true)
    bundleOrderIds.forEach((oid, idx) =>
      onAction('onOrderUpdate', { order_id: oid, route_order: idx + 1, bundle_group_id: gid })
    )
    setTimeout(() => {
      onAction('onAdminOrdersQuery', {})
      setOrdersLoading(true)
      setBundleSaving(false)
    }, 400)
  }
  const assignBundleDriver = (driver) => {
    if (!driver || !bundleOrderIds.length) return
    setBundleSaving(true)
    setBundleDriverSelect('')
    bundleOrderIds.forEach((oid) => assignDriver(oid, driver))
    setTimeout(() => { onAction('onAdminOrdersQuery', {}); setOrdersLoading(true); setBundleSaving(false) }, 400)
  }
  const saveBundleActualFares = () => {
    const entries = Object.entries(bundleActualFares).filter(([, v]) => v != null && String(v).trim() !== '')
    if (!entries.length) return
    setBundleSaving(true)
    entries.forEach(([oid, value]) => onAction('onOrderUpdate', { order_id: oid, actual_fare: Number(value) }))
    setTimeout(() => { onAction('onAdminOrdersQuery', {}); setOrdersLoading(true); setBundleSaving(false) }, 400)
  }

  const handleLogout = () => {
    clearAdminSession()
    setAuthenticated(false)
  }

  return (
    <div className="dangbae-admin">
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-brand">
            <span className="admin-sidebar-logo">당</span>
            <div className="admin-sidebar-brand-text">
              <h1 className="admin-sidebar-title">당배 관리자</h1>
              <p className="admin-sidebar-subtitle">Delivery Control Center</p>
            </div>
          </div>
          <div className="admin-sidebar-summary">
            <span>진행중 {liveOrders.length}</span>
            <span>대기 {waitingDrivers.length}</span>
          </div>
          <nav className="admin-menu" aria-label="관리 메뉴">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`admin-menu-item${activeMenu === item.key ? ' is-active' : ''}`}
                onClick={() => setActiveMenu(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="admin-sidebar-actions">
            <button type="button" className="btn-sm btn-outline admin-refresh" onClick={refreshAll} disabled={driversLoading || ordersLoading}>
              {driversLoading || ordersLoading ? '불러오는 중…' : '새로고침'}
            </button>
            <button type="button" className="btn-sm btn-outline admin-logout" onClick={handleLogout}>로그아웃</button>
          </div>
        </aside>

        <div className="admin-content">
      {activeMenu === 'dashboard' && (
        <section className="admin-section">
          <div className="admin-section-card">
            <div className="admin-section-header">
              <h2>대시보드 요약</h2>
            </div>
            <div className="section-body">
              <div className="admin-kpis">
                <div className="admin-kpi">
                  <strong>{dashboardMetrics.requestedCount.toLocaleString()}</strong>
                  <span>배송현황 · 의뢰</span>
                </div>
                <div className="admin-kpi">
                  <strong>{dashboardMetrics.inProgressCount.toLocaleString()}</strong>
                  <span>배송현황 · 진행</span>
                </div>
                <div className="admin-kpi">
                  <strong>{dashboardMetrics.deliveredCount.toLocaleString()}</strong>
                  <span>배송현황 · 완료</span>
                </div>
                <div className="admin-kpi">
                  <strong>{dashboardMetrics.totalDrivers.toLocaleString()}</strong>
                  <span>배송원 현황 · 총원</span>
                </div>
                <div className="admin-kpi">
                  <strong>{dashboardMetrics.deliveringDrivers.toLocaleString()}</strong>
                  <span>배송원 현황 · 배송중</span>
                </div>
                <div className="admin-kpi">
                  <strong>{dashboardMetrics.waitingDriversCount.toLocaleString()}</strong>
                  <span>배송원 현황 · 대기중</span>
                </div>
                <div className="admin-kpi">
                  <strong>
                    {dashboardMetrics.avgRevenuePerOrder != null
                      ? `${dashboardMetrics.avgRevenuePerOrder.toLocaleString()}원`
                      : '-'}
                  </strong>
                  <span>매출현황 · 건별 평균 매출</span>
                </div>
                <div className="admin-kpi">
                  <strong>
                    {dashboardMetrics.avgDeliveryHours != null
                      ? `${dashboardMetrics.avgDeliveryHours.toFixed(1)}시간`
                      : '-'}
                  </strong>
                  <span>매출현황 · 평균 배송 소요시간</span>
                </div>
              </div>
              <div className="admin-kpis">
                <div className="admin-kpi">
                  <strong>{dashboardMetrics.newOrders24h.toLocaleString()}</strong>
                  <span>신규 데이터(24h) · 신규 의뢰</span>
                </div>
                <div className="admin-kpi">
                  <strong>{dashboardMetrics.newCompleted24h.toLocaleString()}</strong>
                  <span>신규 데이터(24h) · 신규 완료</span>
                </div>
                <div className="admin-kpi">
                  <strong>{dashboardMetrics.newDrivers7d.toLocaleString()}</strong>
                  <span>신규 데이터(7d) · 신규 배송원</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {(activeMenu === 'dashboard' || activeMenu === 'live') && (
        <section className="admin-section">
          <div className="admin-section-card">
            <div className="admin-section-header">
              <h2>현재 배송현황</h2>
            </div>
            <div className="section-body">
              <div className="admin-kpis">
                <div className="admin-kpi"><strong>{drivers.length}</strong><span>전체 배송원</span></div>
                <div className="admin-kpi"><strong>{waitingDrivers.length}</strong><span>대기 배송원</span></div>
                <div className="admin-kpi"><strong>{liveOrders.length}</strong><span>진행중 배송</span></div>
                <div className="admin-kpi">
                  <strong>{orders.filter((o) => (o.status || '') === 'payment_pending').length}</strong>
                  <span>결제 대기</span>
                </div>
                <div className="admin-kpi">
                  <strong>{orders.filter((o) => (o.status || '') === 'pending').length}</strong>
                  <span>접수 대기</span>
                </div>
              </div>
              <div className="admin-inline-filters">
                <select value={liveFilter} onChange={(e) => setLiveFilter(e.target.value)}>
                  <option value="all">전체 상태</option>
                  <option value="assigned">픽업예정</option>
                  <option value="picked_up">픽업완료</option>
                </select>
                <input
                  type="text"
                  placeholder="주문번호/배송원/전화/주소 검색"
                  value={liveQuery}
                  onChange={(e) => setLiveQuery(e.target.value)}
                />
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>주문</th>
                      <th>상태</th>
                      <th>배송원</th>
                      <th>출발지</th>
                      <th>도착지</th>
                      <th>배정</th>
                      <th>픽업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveOrdersFiltered.map((order) => {
                      const oid = order.order_id || order.id
                      return (
                        <tr key={oid}>
                          <td>#{oid}</td>
                          <td>
                            <span className={`admin-order-status ${order.status || 'pending'}`}>
                              {ORDER_STATUS_LABELS[order.status || 'pending']}
                            </span>
                          </td>
                          <td>{[order.driver_name, order.driver_phone].filter(Boolean).join(' / ') || '-'}</td>
                          <td>{order.origin_address || '-'}</td>
                          <td>{order.dest_address || '-'}</td>
                          <td className="admin-ts-cell">{fmtTs(order.assigned_at)}</td>
                          <td className="admin-ts-cell">{fmtTs(order.picked_up_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {liveOrdersFiltered.length === 0 && <p className="muted">조건에 맞는 진행중 배송이 없습니다.</p>}
            </div>
          </div>
        </section>
      )}

      {(activeMenu === 'dashboard' || activeMenu === 'drivers') && (
      <section className="admin-section">
        <div className="admin-section-card">
          <div className="admin-section-header">
            <h2>배송원 관리</h2>
          </div>
          <div className="section-body">
            <form className="admin-driver-form" onSubmit={submitDriver}>
              <input placeholder="이름" value={formDriver.name} onChange={(e) => setFormDriver((f) => ({ ...f, name: e.target.value }))} required />
              <input type="tel" placeholder="전화번호" value={formDriver.phone} onChange={(e) => setFormDriver((f) => ({ ...f, phone: e.target.value }))} required />
              <select value={formDriver.status} onChange={(e) => setFormDriver((f) => ({ ...f, status: e.target.value }))}>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={formDriver.situation} onChange={(e) => setFormDriver((f) => ({ ...f, situation: e.target.value }))}>
                {Object.entries(SITUATION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <div className="admin-form-actions">
                <button type="submit">{editingDriver ? '수정' : '등록'}</button>
                {editingDriver && <button type="button" onClick={() => { setEditingDriver(null); setFormDriver(EMPTY_DRIVER_FORM); setSaveError('') }}>취소</button>}
              </div>
            </form>
            {(saveError || deleteError) && <p className="admin-error inline">{saveError || deleteError}</p>}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>이름</th><th>전화번호</th><th>동의 상태</th><th>현황</th><th /></tr></thead>
                <tbody>
                  {(driversLoading && drivers.length === 0 ? [] : drivers).map((d) => (
                    <tr key={d.id}>
                      <td>{d.name}</td>
                      <td>{d.phone}</td>
                      <td>
                        <span className="status-cell">
                          <span className={`admin-badge ${d.status === 'agreed' ? 'agreed' : 'pending'}`}>{STATUS_LABELS[d.status] ?? d.status}</span>
                          {(d.status === 'pending' || !d.status) && <a href={`${KAKAO_CONSENT_URL}&state=${encodeURIComponent(d.id)}`} target="_blank" rel="noopener noreferrer" className="btn-sm btn-kakao">동의하기</a>}
                        </span>
                      </td>
                      <td><span className={`admin-badge ${d.situation || 'waiting'}`}>{SITUATION_LABELS[d.situation] ?? d.situation}</span></td>
                      <td>
                        <button type="button" className="btn-sm" onClick={() => { setEditingDriver(d); setFormDriver({ name: d.name, phone: d.phone, status: d.status || 'pending', situation: d.situation || 'waiting' }) }}>수정</button>
                        <button type="button" className="btn-sm btn-danger" onClick={() => deleteDriver(d.id)}>삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {driversLoading && drivers.length === 0 && <p className="admin-loading">배송원 목록 로딩 중...</p>}
            </div>
          </div>
        </div>
      </section>
      )}

      {(activeMenu === 'dashboard' || activeMenu === 'orders') && (
      <section className="admin-section">
        <div className="admin-section-card">
          <div className="admin-section-header">
            <h2>배송건 관리</h2>
            <div className="admin-inline-filters">
              <select className="admin-filter" value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)}>
                <option value="all">전체</option>
                <option value="payment_pending">결제 대기</option>
                <option value="pending">접수 대기</option>
                <option value="assigned">픽업예정</option>
                <option value="picked_up">픽업완료</option>
                <option value="delivered">배송완료</option>
                <option value="cancel_requested">취소요청 중</option>
                <option value="cancelled">취소완료</option>
              </select>
              <input
                type="text"
                placeholder="주문/의뢰인/배송원/주소/묶음ID 검색"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="section-body">
            <p className="admin-bundle-hint">배송중인 배송원도 중복 배정 가능합니다. (휴무 배송원 제외)</p>
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--orders">
                <thead>
                  <tr>
                    <th>주문</th>
                    <th>상태</th>
                    <th>의뢰인</th>
                    <th>배송원</th>
                    <th>출발지</th>
                    <th>도착지</th>
                    <th>묶음</th>
                    <th>상세</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((order) => {
                    const oid = order.order_id || order.id
                    const status = order.status || 'pending'
                    const gid = String(order.bundle_group_id || '').trim()
                    const canAssign =
                      status !== 'delivered' &&
                      status !== 'cancelled' &&
                      status !== 'payment_pending' &&
                      status !== 'cancel_requested'
                    const isAssigning = assignOrderId === oid
                    return (
                      <tr key={oid}>
                        <td>#{oid}</td>
                        <td>
                          <span className={`admin-order-status ${status}`}>{ORDER_STATUS_LABELS[status] ?? status}</span>
                        </td>
                        <td>{[order.user_name, order.user_phone].filter(Boolean).join(' / ') || '-'}</td>
                        <td>{[order.driver_name, order.driver_phone].filter(Boolean).join(' / ') || '-'}</td>
                        <td>{order.origin_address || '-'}</td>
                        <td>{order.dest_address || '-'}</td>
                        <td>
                          {gid ? (
                            <span className="admin-bundle-pill">
                              {gid.slice(0, 8)} · {order.route_order != null ? `${order.route_order}번` : '순서 없음'}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td>
                          <div className="admin-order-actions">
                            <button type="button" className="btn-sm btn-outline" onClick={() => setDetailOrder(order)}>상세보기</button>
                            {canAssign &&
                              (!isAssigning ? (
                                <button type="button" className="btn-sm btn-primary" onClick={() => setAssignOrderId(oid)}>배송원 배정</button>
                              ) : (
                                <div className="admin-assign-select">
                                  <select
                                    onChange={(e) => {
                                      const id = e.target.value
                                      if (!id) return
                                      const driver = assignableDrivers.find((d) => String(d.id) === id)
                                      if (driver) assignDriver(oid, driver)
                                    }}
                                  >
                                    <option value="">배송원 선택</option>
                                    {assignableDrivers.map((d) => (
                                      <option key={d.id} value={d.id}>
                                        {d.name} ({d.phone}) · {SITUATION_LABELS[d.situation] ?? d.situation}
                                      </option>
                                    ))}
                                  </select>
                                  <button type="button" className="btn-sm" onClick={() => setAssignOrderId(null)}>취소</button>
                                </div>
                              ))}
                            {status === 'assigned' && <button type="button" className="btn-sm btn-success" onClick={() => markPickedUp(order)}>픽업완료</button>}
                            {(status === 'assigned' || status === 'picked_up') && <button type="button" className="btn-sm btn-success" onClick={() => completeOrder(order)}>배송완료</button>}
                            {status === 'cancel_requested' && (
                              <button type="button" className="btn-sm btn-warning" onClick={() => { if (window.confirm('취소를 승인하시겠습니까?')) approveCancel(order) }}>취소 승인</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {visibleOrders.length === 0 && <p className="muted">조건에 맞는 배송건이 없습니다.</p>}
          </div>
        </div>
      </section>
      )}

      {(activeMenu === 'dashboard' || activeMenu === 'silent') && (
      <section className="admin-section">
        <div className="admin-section-card">
          <div className="admin-section-header">
            <h2>묵음 배송관리</h2>
          </div>
          <div className="section-body">
            {silentOrders.length === 0 && <p className="muted">묵음 플래그가 잡힌 주문이 없습니다.</p>}
            <div className="admin-orders compact">
              {silentOrders.map((order) => {
                const oid = order.order_id || order.id
                return (
                  <div key={oid} className="admin-order-card">
                    <div className="admin-order-row">
                      <span className="admin-order-id">#{oid}</span>
                      <span className={`admin-order-status ${order.status || 'pending'}`}>{ORDER_STATUS_LABELS[order.status || 'pending']}</span>
                    </div>
                    <div className="admin-order-driver">의뢰인: {order.user_name || '-'} / {order.user_phone || '-'}</div>
                    <div className="admin-order-addr"><strong>요청메모</strong> {order.memo || order.request_note || '-'}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>
      )}

      {(activeMenu === 'dashboard' || activeMenu === 'driverHistory') && (
      <section className="admin-section">
        <div className="admin-section-card">
          <div className="admin-section-header">
            <h2>배송원별 배송이력</h2>
          </div>
          <div className="section-body">
            <div className="admin-inline-filters">
              <select value={historySituationFilter} onChange={(e) => setHistorySituationFilter(e.target.value)}>
                <option value="all">전체 현황</option>
                <option value="waiting">대기</option>
                <option value="delivering">배송중</option>
                <option value="off">휴무</option>
              </select>
              <input
                type="text"
                placeholder="배송원 이름/전화번호 검색"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
              />
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>배송원</th>
                    <th>전화번호</th>
                    <th>현황</th>
                    <th>완료</th>
                    <th>픽업예정</th>
                    <th>픽업완료</th>
                    <th>배송예정</th>
                    <th>최근 주문ID</th>
                  </tr>
                </thead>
                <tbody>
                  {driverHistoryRows.map(({ driver, completed, pickupScheduled, pickupDone, pending }) => {
                    const recent = [...completed, ...pickupDone, ...pickupScheduled, ...pending]
                      .slice(0, 5)
                      .map((o) => `#${o.order_id || o.id}`)
                      .join(', ')
                    return (
                      <tr key={driver.id}>
                        <td>{driver.name || '-'}</td>
                        <td>{driver.phone || '-'}</td>
                        <td>
                          <span className={`admin-badge ${driver.situation || 'waiting'}`}>
                            {SITUATION_LABELS[driver.situation] ?? driver.situation}
                          </span>
                        </td>
                        <td>{completed.length}</td>
                        <td>{pickupScheduled.length}</td>
                        <td>{pickupDone.length}</td>
                        <td>{pending.length}</td>
                        <td>{recent || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {driverHistoryRows.length === 0 && <p className="muted">조건에 맞는 배송원 이력이 없습니다.</p>}
          </div>
        </div>
      </section>
      )}

      {(activeMenu === 'dashboard' || activeMenu === 'requesterLookup') && (
      <section className="admin-section">
        <div className="admin-section-card">
          <div className="admin-section-header">
            <h2>배송건(의뢰인) 조회</h2>
          </div>
          <div className="section-body">
            <input
              className="admin-search"
              placeholder="주문번호 / 의뢰인명 / 전화번호 / 이메일 검색"
              value={requesterQuery}
              onChange={(e) => setRequesterQuery(e.target.value)}
            />
            <div className="admin-table-wrap requester-table">
              <table className="admin-table admin-table--timelines">
                <thead>
                  <tr>
                    <th>주문</th>
                    <th>의뢰인</th>
                    <th>연락처</th>
                    <th>상태</th>
                    <th>배송원</th>
                    <th>신청</th>
                    <th>결제</th>
                    <th>배정</th>
                    <th>픽업</th>
                    <th>배송완료</th>
                    <th>취소요청</th>
                    <th>취소완료</th>
                  </tr>
                </thead>
                <tbody>
                  {requesterFilteredOrders.map((o) => (
                    <tr key={o.order_id || o.id}>
                      <td>#{o.order_id || o.id}</td>
                      <td>{o.user_name || o.requester_name || '-'}</td>
                      <td>{o.user_phone || '-'} / {o.user_email || '-'}</td>
                      <td>{ORDER_STATUS_LABELS[o.status || 'pending'] || o.status || '-'}</td>
                      <td>{o.driver_name || '-'}</td>
                      <td className="admin-ts-cell">{fmtTs(o.created_at)}</td>
                      <td className="admin-ts-cell">{fmtTs(o.paid_at)}</td>
                      <td className="admin-ts-cell">{fmtTs(o.assigned_at)}</td>
                      <td className="admin-ts-cell">{fmtTs(o.picked_up_at)}</td>
                      <td className="admin-ts-cell">{fmtTs(o.delivered_at)}</td>
                      <td className="admin-ts-cell">{fmtTs(o.cancel_requested_at)}</td>
                      <td className="admin-ts-cell">{fmtTs(o.cancelled_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
      )}

      {(activeMenu === 'dashboard' || activeMenu === 'bundle') && (
      <section className="admin-section admin-bundle-section">
        <div className="admin-section-card">
          <div className="admin-section-header">
            <h2>묶음배송</h2>
            <span className="admin-bundle-badge">배송건 조정 → 루트 조정 → 배송원 지정 → 배송단가 조정</span>
          </div>
          <div className="section-body">
            <div className="bundle-step">
              <h3>1. 배송건 조정</h3>
              <p className="field-hint">대기 중인 주문을 선택해 묶음에 담으세요.</p>
              <div className="bundle-pending-list">
                {pendingOrders.length === 0 && <p className="muted">대기 중인 주문이 없습니다.</p>}
                {pendingOrders.map((order) => {
                  const oid = order.order_id || order.id
                  const inBundle = bundleOrderIds.includes(oid)
                  return (
                    <div key={oid} className="bundle-pending-item">
                      <label className="bundle-check">
                        <input
                          type="checkbox"
                          checked={inBundle}
                          onChange={(e) => (e.target.checked ? addToBundle([oid]) : removeFromBundle(oid))}
                        />
                        <span>#{oid}</span>
                      </label>
                      <span className="bundle-addr">{order.origin_address || '-'} → {order.dest_address || '-'}</span>
                      {order.origin_lat != null && order.dest_lat != null && (
                        <span className="bundle-latlng muted" title="출발·도착 좌표">
                          ({Number(order.origin_lat).toFixed(4)},{Number(order.origin_lng).toFixed(4)}) → (
                          {Number(order.dest_lat).toFixed(4)},{Number(order.dest_lng).toFixed(4)})
                        </span>
                      )}
                      {inBundle && <button type="button" className="btn-sm" onClick={() => removeFromBundle(oid)}>제거</button>}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="bundle-step">
              <h3>2. 루트 조정</h3>
              <p className="field-hint">배송 순서를 정한 뒤 순서 저장을 누르세요.</p>
              <div className="bundle-route-list">
                {bundleOrders.length === 0 && <p className="muted">묶음에 담긴 주문이 없습니다.</p>}
                {bundleOrders.map((order, idx) => {
                  const oid = order.order_id || order.id
                  return (
                    <div key={oid} className="bundle-route-item">
                      <span className="route-num">{idx + 1}</span>
                      <span className="route-addr">{order.origin_address || '-'} → {order.dest_address || '-'}</span>
                      {order.origin_lat != null && order.dest_lat != null && (
                        <span className="bundle-latlng muted">
                          ({Number(order.origin_lat).toFixed(4)},{Number(order.origin_lng).toFixed(4)}) → (
                          {Number(order.dest_lat).toFixed(4)},{Number(order.dest_lng).toFixed(4)})
                        </span>
                      )}
                      <div className="route-actions">
                        <button type="button" className="btn-sm" onClick={() => moveBundleOrder(idx, -1)} disabled={idx === 0}>▲</button>
                        <button type="button" className="btn-sm" onClick={() => moveBundleOrder(idx, 1)} disabled={idx === bundleOrders.length - 1}>▼</button>
                        <button type="button" className="btn-sm btn-outline" onClick={() => removeFromBundle(oid)}>제거</button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {bundleOrderIds.length > 0 && (
                <button type="button" className="btn-sm btn-primary" onClick={saveBundleRouteOrder} disabled={bundleSaving}>
                  {bundleSaving ? '저장 중…' : '순서 저장'}
                </button>
              )}
              {bundleRouteStops.length > 0 && (
                <div className="bundle-map-wrap">
                  <p className="field-hint">묶음 순서대로 출발 → 도착 지점을 연결한 경로(직선)입니다. 순서 저장 후 배송에 반영됩니다.</p>
                  <DangbaeKakaoMap appKey={mapAppKey} stops={bundleRouteStops} />
                </div>
              )}
            </div>

            <div className="bundle-step">
              <h3>3. 배송원 지정</h3>
              <p className="field-hint">묶음 전체에 배송원을 한 명 지정합니다.</p>
              <div className="bundle-assign-row">
                <select
                  value={bundleDriverSelect}
                  onChange={(e) => {
                    const id = e.target.value
                    setBundleDriverSelect(id)
                    if (!id) return
                    const driver = assignableDrivers.find((d) => String(d.id) === id)
                    if (driver) assignBundleDriver(driver)
                  }}
                  disabled={bundleOrderIds.length === 0 || bundleSaving}
                >
                  <option value="">배송원 선택</option>
                  {assignableDrivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.phone})</option>
                  ))}
                </select>
                <span className="muted">{bundleOrderIds.length > 0 ? `묶음 ${bundleOrderIds.length}건에 지정` : '먼저 묶음을 만드세요'}</span>
              </div>
            </div>

            <div className="bundle-step">
              <h3>4. 배송단가 조정</h3>
              <p className="field-hint">건별 실배송단가(원)를 입력 후 적용하세요.</p>
              <div className="bundle-fare-list">
                {bundleOrders.length === 0 && <p className="muted">묶음에 담긴 주문이 없습니다.</p>}
                {bundleOrders.map((order) => {
                  const oid = order.order_id || order.id
                  const est = order.estimated_fare != null ? Number(order.estimated_fare) : null
                  const val = bundleActualFares[oid] ?? order.actual_fare ?? ''
                  return (
                    <div key={oid} className="bundle-fare-item">
                      <span className="fare-oid">#{oid}</span>
                      <span className="fare-est">{est != null ? `견적 ${est.toLocaleString()}원` : '-'}</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="실배송단가"
                        value={val}
                        onChange={(e) => setBundleActualFares((f) => ({ ...f, [oid]: e.target.value }))}
                      />
                    </div>
                  )
                })}
              </div>
              {Object.keys(bundleActualFares).filter((id) => bundleActualFares[id] != null && bundleActualFares[id] !== '').length > 0 && (
                <button type="button" className="btn-sm btn-primary" onClick={saveBundleActualFares} disabled={bundleSaving}>
                  {bundleSaving ? '적용 중…' : '단가 적용'}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
      )}
        </div>
      </div>

      {detailOrder && (
        <div className="admin-detail-overlay" onClick={() => setDetailOrder(null)} role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
          <div className="admin-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-detail-header">
              <h2 id="order-detail-title">배송 요청 상세 #{detailOrder.order_id || detailOrder.id}</h2>
              <button type="button" className="admin-detail-close" onClick={() => setDetailOrder(null)} aria-label="닫기">×</button>
            </div>
            <div className="admin-detail-body">
              {(detailOrder.origin_lat != null && detailOrder.origin_lng != null) ||
              (detailOrder.dest_lat != null && detailOrder.dest_lng != null) ? (
                <div className="admin-detail-map-wrap">
                  <DangbaeKakaoMap
                    appKey={mapAppKey}
                    origin={
                      detailOrder.origin_lat != null && detailOrder.origin_lng != null
                        ? {
                            lat: Number(detailOrder.origin_lat),
                            lng: Number(detailOrder.origin_lng),
                            address: detailOrder.origin_address,
                          }
                        : null
                    }
                    dest={
                      detailOrder.dest_lat != null && detailOrder.dest_lng != null
                        ? {
                            lat: Number(detailOrder.dest_lat),
                            lng: Number(detailOrder.dest_lng),
                            address: detailOrder.dest_address,
                          }
                        : null
                    }
                  />
                </div>
              ) : null}
              {Array.isArray(detailOrder.item_images) && detailOrder.item_images.length > 0 && (
                <div className="admin-detail-images">
                  <h3 className="admin-detail-subtitle">물품 사진</h3>
                  <div className="admin-detail-image-grid">
                    {detailOrder.item_images.map((src, i) => (
                      <a key={i} href={orderItemImageSrc(src)} target="_blank" rel="noopener noreferrer">
                        <img src={orderItemImageSrc(src)} alt={`물품 ${i + 1}`} />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <dl className="admin-detail-dl">
                <dt>상태</dt>
                <dd><span className={`admin-badge ${detailOrder.status || 'pending'}`}>{ORDER_STATUS_LABELS[detailOrder.status] ?? detailOrder.status ?? '-'}</span></dd>

                <dt>출발지</dt>
                <dd>{detailOrder.origin_address || '-'}{detailOrder.origin_detail ? ` (${detailOrder.origin_detail})` : ''}</dd>
                {(detailOrder.origin_lat != null || detailOrder.origin_lng != null) && (
                  <>
                    <dt>출발 좌표</dt>
                    <dd>{[detailOrder.origin_lat, detailOrder.origin_lng].filter(Boolean).join(', ')}</dd>
                  </>
                )}

                <dt>도착지</dt>
                <dd>{detailOrder.dest_address || '-'}{detailOrder.dest_detail ? ` (${detailOrder.dest_detail})` : ''}</dd>
                {(detailOrder.dest_lat != null || detailOrder.dest_lng != null) && (
                  <>
                    <dt>도착 좌표</dt>
                    <dd>{[detailOrder.dest_lat, detailOrder.dest_lng].filter(Boolean).join(', ')}</dd>
                  </>
                )}

                <dt>물품명</dt>
                <dd>{detailOrder.item_title || '-'}</dd>
                {(detailOrder.item_size || detailOrder.item_weight_kg != null) && (
                  <>
                    <dt>물품 크기 / 무게</dt>
                    <dd>{[detailOrder.item_size && `크기: ${detailOrder.item_size}`, detailOrder.item_weight_kg != null && `무게: ${detailOrder.item_weight_kg}kg`].filter(Boolean).join(' · ') || '-'}</dd>
                  </>
                )}

                {(detailOrder.estimated_km != null || detailOrder.estimated_fare != null) && (
                  <>
                    <dt>예상 거리 / 배송비</dt>
                    <dd>
                      {[detailOrder.estimated_km != null && `${detailOrder.estimated_km} km`, detailOrder.estimated_fare != null && `${Number(detailOrder.estimated_fare).toLocaleString()}원`].filter(Boolean).join(' / ') || '-'}
                    </dd>
                  </>
                )}

                {(detailOrder.floor_count != null || detailOrder.has_elevator === false || detailOrder.has_elevator === true) && (
                  <>
                    <dt>층수 / 엘리베이터</dt>
                    <dd>
                      {[detailOrder.floor_count != null && `${detailOrder.floor_count}층`, detailOrder.has_elevator === true && '엘리베이터 있음', detailOrder.has_elevator === false && '엘리베이터 없음'].filter(Boolean).join(' · ') || '-'}
                    </dd>
                  </>
                )}
                {detailOrder.recipient_helps === true && (
                  <>
                    <dt>받는 사람 도움</dt>
                    <dd>직접 도움</dd>
                  </>
                )}

                <dt>연락처</dt>
                <dd>{detailOrder.user_phone || '-'}</dd>
                <dt>이메일</dt>
                <dd>{detailOrder.user_email || '-'}</dd>

                {(detailOrder.driver_name || detailOrder.driver_phone) && (
                  <>
                    <dt>배송원</dt>
                    <dd>{[detailOrder.driver_name, detailOrder.driver_phone].filter(Boolean).join(' · ') || '-'}</dd>
                  </>
                )}

                <dt>신청(접수)</dt>
                <dd>{fmtTs(detailOrder.created_at)}</dd>
                <dt>결제 완료</dt>
                <dd>{fmtTs(detailOrder.paid_at)}</dd>
                <dt>배송원 배정</dt>
                <dd>{fmtTs(detailOrder.assigned_at)}</dd>
                <dt>픽업 완료</dt>
                <dd>{fmtTs(detailOrder.picked_up_at)}</dd>
                <dt>배송 완료</dt>
                <dd>{fmtTs(detailOrder.delivered_at)}</dd>
                <dt>취소 요청</dt>
                <dd>{fmtTs(detailOrder.cancel_requested_at)}</dd>
                <dt>취소 완료</dt>
                <dd>{fmtTs(detailOrder.cancelled_at)}</dd>
                {detailOrder.cancel_reason ? (
                  <>
                    <dt>취소 사유</dt>
                    <dd>{detailOrder.cancel_reason}</dd>
                  </>
                ) : null}
              </dl>
            </div>
            <div className="admin-detail-footer">
              <button type="button" className="btn-sm" onClick={() => setDetailOrder(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DangbaeAdmin
