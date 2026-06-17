import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import DangbaeKakaoMap from './DangbaeKakaoMap'
import DangbaeAccountTab from './account/DangbaeAccountTab'
import DangbaeAuthPanel from './account/DangbaeAuthPanel'
import DangbaePaymentPage from './account/DangbaePaymentPage'
import './account/DangbaeAccountTab.css'
import {
  DANGBAE_AUTH_TOKEN_KEY,
  DANGBAE_AUTH_CHANGED_EVENT,
  getEmailFromAccessToken,
  notifyDangbaeAuthChanged,
} from './account/authConstants'
import {
  writePendingPayment,
  clearPendingPayment,
  writeLastPaymentPrepare,
  readLastPaymentPrepare,
  clearLastPaymentPrepare,
} from './account/paymentContext'
import { getOrCreateSseClientId } from '../sseClientId'
import './DangbaeWidget.css'

const OAUTH_POPUP_FLAG = 'dangbae_oauth_use_popup'
const ITEM_EDITOR_VLM_MAX_IMAGES = 12
const DANGBAE_LAST_PHONE_KEY = 'dangbae_last_phone'

function orderItemImageSrc(stored) {
  if (!stored) return ''
  const s = String(stored).trim()
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:') || s.startsWith('/')) return s
  return `/api/dangbae-order-item-image?p=${encodeURIComponent(s)}`
}

function paymentOrderNameFromPayload(payload) {
  const on = (payload?.order_name || '').trim()
  if (on) return on
  const item = (payload?.item_title || payload?.item_name || '물품').trim()
  const oa = (payload?.origin_address || payload?.origin_detail || '').trim()
  const da = (payload?.dest_address || payload?.dest_detail || '').trim()
  if (oa || da) return `${item}(${oa || '-'}, ${da || '-'})`
  const oid = payload?.order_id != null ? String(payload.order_id) : ''
  return oid ? `당배 배송 #${oid}` : '당배 배송비'
}

/** 내 배송 현황에서 결제 재개 시 sessionStorage · 금액 산정용 */
function buildResumePaymentPayload(order, lastFareFallback, phoneFallback) {
  const oid = String(order.order_id || order.id || '').trim()
  const fareNum = Number(order.estimated_fare ?? order.amount ?? lastFareFallback ?? 0)
  const amount =
    Number.isFinite(fareNum) && fareNum > 0
      ? Math.round(fareNum)
      : Math.max(0, Math.round(Number(lastFareFallback) || 0)) || 1000
  return {
    order_id: oid,
    amount,
    order_name: paymentOrderNameFromPayload(order),
    user_email: String(order.user_email || '').trim(),
    user_phone: String(order.user_phone || phoneFallback || '').trim(),
  }
}

const USER_ORDER_STATUS_LABELS = {
  payment_pending: '결제 대기',
  pending: '접수 대기',
  assigned: '배송원 배정',
  picked_up: '픽업 완료',
  delivered: '배송 완료',
  cancel_requested: '취소요청 중',
  cancelled: '취소완료',
}

function fmtStatusTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('ko-KR')
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('이미지 파일을 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}

/** 배송 신청 — 엘리베이터·직접 도움 등 불린 옵션 (있음/없음 토글) */
function LocationBoolToggle({
  id,
  label,
  checked,
  onChange,
  onText = '있음',
  offText = '없음',
  helper,
}) {
  const labelId = id ? `${id}-label` : undefined
  return (
    <div className={`location-toggle-wrap${helper ? ' location-toggle-wrap--with-hint' : ''}`}>
      <div className="location-toggle-row" role="group" aria-labelledby={labelId}>
        {labelId ? (
          <span id={labelId} className="location-toggle-label">
            {label}
          </span>
        ) : (
          <span className="location-toggle-label">{label}</span>
        )}
        <div className="location-toggle-track">
          <button
            type="button"
            className={`location-toggle-seg${checked ? ' is-selected' : ''}`}
            aria-pressed={checked}
            onClick={() => onChange(true)}
          >
            {onText}
          </button>
          <button
            type="button"
            className={`location-toggle-seg${!checked ? ' is-selected' : ''}`}
            aria-pressed={!checked}
            onClick={() => onChange(false)}
          >
            {offText}
          </button>
        </div>
      </div>
      {helper ? <p className="location-toggle-hint">{helper}</p> : null}
    </div>
  )
}

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

function useMatchMedia(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const mq = window.matchMedia(query)
    const handler = () => setMatches(mq.matches)
    handler()
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [query])
  return matches
}

/** 출발지/목적지 층수 (엘리베이터 없을 때 층당 요금 반영) */
const FLOOR_COUNT_MIN = 1
const FLOOR_COUNT_MAX = 200

function formatItemSizeKr(s) {
  if (!s) return '—'
  if (s === 'small') return '소'
  if (s === 'medium') return '중'
  if (s === 'large') return '대'
  return String(s)
}

function DangbaeWidget({
  base_fare = 3000,
  per_km = 500,
  default_item_size = 'medium',
  kakao_map_appkey = '',
  onAction,
  events = {},
  /** 해시 라우트와 동기화: user | status | mypage | payment | login | driver */
  page: activePageProp = 'user',
}) {
  const mapAppKey =
    (kakao_map_appkey && String(kakao_map_appkey).trim()) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_KAKAO_MAP_APPKEY) ||
    ''

  const getEventName = (key) => events[key] || key

  const [activePage, setActivePage] = useState(activePageProp)
  const activePageRef = React.useRef(activePageProp)
  const [origin, setOrigin] = useState(null)
  const [dest, setDest] = useState(null)
  const [originSearch, setOriginSearch] = useState('')
  const [destSearch, setDestSearch] = useState('')
  const [searchLoading, setSearchLoading] = useState({ origin: false, dest: false })
  const [searchResults, setSearchResults] = useState({ origin: [], dest: [] })
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeInfo, setRouteInfo] = useState(null)
  const [estimatedFare, setEstimatedFare] = useState(null)
  const [fareBreakdown, setFareBreakdown] = useState(null)
  const [itemEntries, setItemEntries] = useState([])
  const [itemSize, setItemSize] = useState(default_item_size)
  const [itemWeight, setItemWeight] = useState(0)
  const [itemEditorOpen, setItemEditorOpen] = useState(false)
  const itemEditorOpenRef = useRef(false)
  const [itemEditorEditIndex, setItemEditorEditIndex] = useState(null)
  const [itemEditorDraft, setItemEditorDraft] = useState({
    name: '',
    size: default_item_size || 'medium',
    weight: 0,
    note: '',
    images: [],
  })
  const [itemEditorAiBusy, setItemEditorAiBusy] = useState(false)
  const [itemEditorImageBusy, setItemEditorImageBusy] = useState(false)
  const [imageLightboxSrc, setImageLightboxSrc] = useState(null)
  const itemEditorGalleryInputRef = useRef(null)
  const itemEditorCameraInputRef = useRef(null)
  const [phonePromptModalOpen, setPhonePromptModalOpen] = useState(false)
  const [promptPhone, setPromptPhone] = useState('')
  const [originFloorCount, setOriginFloorCount] = useState(1)
  const [originFloorCountText, setOriginFloorCountText] = useState('1')
  const [originFloorError, setOriginFloorError] = useState('')
  const [destFloorCountText, setDestFloorCountText] = useState('1')
  const [destFloorError, setDestFloorError] = useState('')

  const handleOriginFloorChange = (e) => {
    const val = e.target.value
    setOriginFloorCountText(val)

    const trimmed = val.trim()
    if (!trimmed) {
      setOriginFloorError('출발지 층수를 입력해주세요.')
      return
    }
    const num = Number(trimmed)
    if (!/^\d+$/.test(trimmed) || isNaN(num)) {
      setOriginFloorError('숫자만 입력할 수 있습니다.')
      return
    }
    if (num < FLOOR_COUNT_MIN || num > FLOOR_COUNT_MAX) {
      setOriginFloorError(`층수는 ${FLOOR_COUNT_MIN}층에서 ${FLOOR_COUNT_MAX}층 사이여야 합니다.`)
      return
    }

    setOriginFloorError('')
    setOriginFloorCount(num)
  }

  const handleDestFloorChange = (e) => {
    const val = e.target.value
    setDestFloorCountText(val)

    const trimmed = val.trim()
    if (!trimmed) {
      setDestFloorError('목적지 층수를 입력해주세요.')
      return
    }
    const num = Number(trimmed)
    if (!/^\d+$/.test(trimmed) || isNaN(num)) {
      setDestFloorError('숫자만 입력할 수 있습니다.')
      return
    }
    if (num < FLOOR_COUNT_MIN || num > FLOOR_COUNT_MAX) {
      setDestFloorError(`층수는 ${FLOOR_COUNT_MIN}층에서 ${FLOOR_COUNT_MAX}층 사이여야 합니다.`)
      return
    }
    setDestFloorError('')
    setDestFloorCount(num)
  }

  const handleOriginFloorBlur = () => {
    const trimmed = originFloorCountText.trim()
    const num = Number(trimmed)
    if (!trimmed || !/^\d+$/.test(trimmed) || isNaN(num) || num < FLOOR_COUNT_MIN || num > FLOOR_COUNT_MAX) {
      setOriginFloorError(`올바른 출발지 층수를 입력해주세요. (${FLOOR_COUNT_MIN}~${FLOOR_COUNT_MAX})`)
    } else {
      setOriginFloorError('')
      setOriginFloorCount(num)
    }
  }

  const handleDestFloorBlur = () => {
    const trimmed = destFloorCountText.trim()
    const num = Number(trimmed)
    if (!trimmed || !/^\d+$/.test(trimmed) || isNaN(num) || num < FLOOR_COUNT_MIN || num > FLOOR_COUNT_MAX) {
      setDestFloorError(`올바른 목적지 층수를 입력해주세요. (${FLOOR_COUNT_MIN}~${FLOOR_COUNT_MAX})`)
    } else {
      setDestFloorError('')
      setDestFloorCount(num)
    }
  }

  const checkFloorValidation = () => {
    const trimmed = originFloorCountText.trim()
    const num = Number(trimmed)
    if (!trimmed || !/^\d+$/.test(trimmed) || isNaN(num) || num < FLOOR_COUNT_MIN || num > FLOOR_COUNT_MAX) {
      alert(`올바른 출발지 층수를 입력해주세요. (${FLOOR_COUNT_MIN}~${FLOOR_COUNT_MAX} 사이의 숫자)`)
      return false
    }
    return true
  }

  useEffect(() => {
    setOriginFloorCountText(String(originFloorCount))
    setOriginFloorError('')
  }, [originFloorCount])
  const [destFloorCount, setDestFloorCount] = useState(1)
  const [originHasElevator, setOriginHasElevator] = useState(true)
  const [destHasElevator, setDestHasElevator] = useState(true)
  const [originDirectHelp, setOriginDirectHelp] = useState(false)
  const [destDirectHelp, setDestDirectHelp] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [userPhone, setUserPhone] = useState('')
  /** 배송 신청 시 설정하는 6자리 숫자 비밀번호 (조회용) */
  const [orderAccessPin, setOrderAccessPin] = useState('')
  /** 기본 알뜰 견적; true면 1:1 신속 기준 견적 */
  const [wantExpress, setWantExpress] = useState(false)
  const mapInRouteSection = useMatchMedia('(max-width: 768px)')
  const [orders, setOrders] = useState([])
  const [driverOrders, setDriverOrders] = useState([])
  const [driverPhone, setDriverPhone] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverLookupDone, setDriverLookupDone] = useState(false)
  const [driverLookupLoading, setDriverLookupLoading] = useState(false)
  const [driverConfirm, setDriverConfirm] = useState(null)
  const [acceptEta, setAcceptEta] = useState('')
  const [acceptNote, setAcceptNote] = useState('')
  const [payoutOrderIds, setPayoutOrderIds] = useState([])
  const [payoutMemo, setPayoutMemo] = useState('')
  const [myOrdersPhone, setMyOrdersPhone] = useState(() => {
    if (typeof window === 'undefined') return ''
    // 로그인 상태면 이전에 저장한 전화번호 자동 불러오기
    const token = localStorage.getItem(DANGBAE_AUTH_TOKEN_KEY) || ''
    if (token) return localStorage.getItem(DANGBAE_LAST_PHONE_KEY) || ''
    return ''
  })
  const [myOrdersPin, setMyOrdersPin] = useState('')
  const [myGuestName, setMyGuestName] = useState('')
  const [myOrdersLoading, setMyOrdersLoading] = useState(false)
  const [statusQueryError, setStatusQueryError] = useState(null)
  const [statusLookupDone, setStatusLookupDone] = useState(false)
  const [statusDetailOrder, setStatusDetailOrder] = useState(null)
  const [cancelRequestTarget, setCancelRequestTarget] = useState(null)
  const [cancelRequestReason, setCancelRequestReason] = useState('')
  const [highlightOrderId, setHighlightOrderId] = useState(null)
  const [searchError, setSearchError] = useState({ origin: null, dest: null })
  const [alttulDetailModalOpen, setAlttulDetailModalOpen] = useState(false)
  const [guestApplyModalOpen, setGuestApplyModalOpen] = useState(false)
  const [guestPhone, setGuestPhone] = useState('')
  const [guestPin, setGuestPin] = useState('')
  const [memberApplyModalOpen, setMemberApplyModalOpen] = useState(false)
  const [memberEmail, setMemberEmail] = useState('')
  const [memberPassword, setMemberPassword] = useState('')
  const [memberSubmitAfterLogin, setMemberSubmitAfterLogin] = useState(false)
  const [memberAuthLoading, setMemberAuthLoading] = useState(false)
  const [memberAuthMode, setMemberAuthMode] = useState('login')
  const memberSubmitAfterLoginRef = useRef(false)
  const memberEmailRef = useRef('')
  const [profileName, setProfileName] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profilePassword, setProfilePassword] = useState('')
  const [profilePasswordConfirm, setProfilePasswordConfirm] = useState('')
  const [profileUpdateLoading, setProfileUpdateLoading] = useState(false)
  const [profileUpdateMsg, setProfileUpdateMsg] = useState('')
  const [profileUpdateStatus, setProfileUpdateStatus] = useState('') // 'success' or 'error'
  const submitDeliveryRequestRef = useRef(() => { })
  const imageAnalyzeTargetRef = useRef('main')
  const [accountMsg, setAccountMsg] = useState('')
  const [sessionToken, setSessionToken] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(DANGBAE_AUTH_TOKEN_KEY) || '' : ''
  )
  const [lastPrepare, setLastPrepare] = useState(null)
  const accountLogRef = useRef(() => { })
  const lastSearchForRef = useRef('origin')
  const expectingOrderCreatedRef = useRef(false)
  const lastRequestPhoneRef = useRef('')
  const lastRequestPinRef = useRef('')
  const driverPhoneRef = useRef('')
  const driverNameRef = useRef('')
  const awaitingDriverQueryRef = useRef(false)
  const eventSourceRef = useRef(null)
  const onActionRef = useRef(onAction)
  const eventsRef = useRef(events)
  const baseFareRef = useRef(base_fare)
  const perKmRef = useRef(per_km)
  const itemSizeRef = useRef(itemSize)
  const itemWeightRef = useRef(itemWeight)
  const originFloorCountRef = useRef(originFloorCount)
  const destFloorCountRef = useRef(destFloorCount)
  const originHasElevatorRef = useRef(originHasElevator)
  const destHasElevatorRef = useRef(destHasElevator)
  const originDirectHelpRef = useRef(originDirectHelp)
  const destDirectHelpRef = useRef(destDirectHelp)
  onActionRef.current = onAction
  eventsRef.current = events
  baseFareRef.current = base_fare
  perKmRef.current = per_km
  itemSizeRef.current = itemSize
  itemWeightRef.current = itemWeight
  originFloorCountRef.current = originFloorCount
  destFloorCountRef.current = destFloorCount
  originHasElevatorRef.current = originHasElevator
  destHasElevatorRef.current = destHasElevator
  originDirectHelpRef.current = originDirectHelp
  destDirectHelpRef.current = destDirectHelp
  driverPhoneRef.current = driverPhone
  driverNameRef.current = driverName
  const wantExpressRef = useRef(wantExpress)
  wantExpressRef.current = wantExpress
  const itemEntriesRef = useRef(itemEntries)
  itemEntriesRef.current = itemEntries
  const lastEstimatedFareRef = useRef(null)
  lastEstimatedFareRef.current = estimatedFare
  const totalFloorCount = useMemo(
    () => Math.max(FLOOR_COUNT_MIN, Number(originFloorCount || 0) + Number(destFloorCount || 0)),
    [originFloorCount, destFloorCount]
  )

  const memberEmailFromToken = useMemo(() => getEmailFromAccessToken(sessionToken), [sessionToken])

  useEffect(() => {
    const parse = () => {
      try {
        const h = window.location.hash || ''
        const q = h.includes('?') ? h.split('?')[1] : ''
        const p = new URLSearchParams(q)
        const o = p.get('order')
        setHighlightOrderId(o ? String(o) : null)
      } catch {
        setHighlightOrderId(null)
      }
    }
    parse()
    window.addEventListener('hashchange', parse)
    return () => window.removeEventListener('hashchange', parse)
  }, [])

  useEffect(() => {
    itemEditorOpenRef.current = itemEditorOpen
  }, [itemEditorOpen])

  const resolvedItemTitles = useMemo(
    () => itemEntries.map((v) => String(v?.name || '').trim()).filter(Boolean),
    [itemEntries]
  )
  const aggregatedItemWeight = useMemo(
    () => itemEntries.reduce((sum, it) => sum + (Number(it.weight) || 0) * Math.max(1, Number(it.qty) || 1), 0),
    [itemEntries]
  )
  const aggregatedItemSize = useMemo(() => {
    if (!itemEntries.length) return itemSize
    const rank = { small: 1, medium: 2, large: 3 }
    let max = ''
    itemEntries.forEach((it) => {
      const s = String(it.size || '')
      if (!max || (rank[s] || 0) > (rank[max] || 0)) max = s
    })
    return max || itemSize
  }, [itemEntries, itemSize])
  itemSizeRef.current = aggregatedItemSize
  itemWeightRef.current = aggregatedItemWeight

  const resolvePrimaryItemTitle = useCallback(() => {
    if (resolvedItemTitles.length) return resolvedItemTitles.join(', ')
    return '물품'
  }, [resolvedItemTitles])

  accountLogRef.current = (text) => {
    setAccountMsg((m) => (m ? `${m}\n${text}` : text))
  }

  useEffect(() => {
    memberSubmitAfterLoginRef.current = memberSubmitAfterLogin
  }, [memberSubmitAfterLogin])
  useEffect(() => {
    memberEmailRef.current = memberEmail
  }, [memberEmail])

  useEffect(() => {
    const t = activePageProp
    if (
      t === 'user' ||
      t === 'status' ||
      t === 'mypage' ||
      t === 'login' ||
      t === 'payment' ||
      t === 'driver'
    ) {
      setActivePage(t)
      activePageRef.current = t
    }
  }, [activePageProp])

  useEffect(() => {
    if (activePage !== 'payment') return
    setLastPrepare((prev) => {
      if (prev?.merchant_uid) return prev
      const snap = readLastPaymentPrepare()
      return snap || prev
    })
  }, [activePage])

  // 로그인 상태에서 마이페이지/배송현황 진입 시 자동 조회
  const sessionTokenRef = useRef(sessionToken)
  sessionTokenRef.current = sessionToken
  const activePageRef2 = useRef(activePage)
  activePageRef2.current = activePage

  // activePage가 status로 바뀔 때 (페이지 이동)
  useEffect(() => {
    if (activePage !== 'status') return
    const token = sessionTokenRef.current
    if (!token) return
    const action = onActionRef.current
    const ev = eventsRef.current
    const getEv = (key) => (ev && ev[key]) || key
    if (!action) return

    setStatusQueryError(null)
    setStatusLookupDone(false)
    setMyOrdersLoading(true)
    action(getEv('onMyOrdersQuery'), {
      user_token: token,
    }).finally(() => setMyOrdersLoading(false)).catch(() => setMyOrdersLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage])

  // 로그인 직후(sessionToken 새로 생성) 현재 status에 있으면 자동 조회
  useEffect(() => {
    if (!sessionToken) return
    const page = activePageRef2.current
    if (page !== 'status') return
    const action = onActionRef.current
    const ev = eventsRef.current
    const getEv = (key) => (ev && ev[key]) || key
    if (!action) return

    setStatusQueryError(null)
    setStatusLookupDone(false)
    setMyOrdersLoading(true)
    action(getEv('onMyOrdersQuery'), {
      user_token: sessionToken,
    }).finally(() => setMyOrdersLoading(false)).catch(() => setMyOrdersLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken])

  useEffect(() => {
    const syncSession = () => {
      const t = typeof window !== 'undefined' ? localStorage.getItem(DANGBAE_AUTH_TOKEN_KEY) || '' : ''
      setSessionToken(t)
    }
    window.addEventListener(DANGBAE_AUTH_CHANGED_EVENT, syncSession)
    window.addEventListener('storage', syncSession)
    return () => {
      window.removeEventListener(DANGBAE_AUTH_CHANGED_EVENT, syncSession)
      window.removeEventListener('storage', syncSession)
    }
  }, [])

  useEffect(() => {
    if (activePage !== 'mypage' || !sessionToken) return
    const action = onActionRef.current
    const ev = eventsRef.current
    const getEv = (key) => (ev && ev[key]) || key
    if (!action) return
    action(getEv('onAuthGetUser'), { user_token: sessionToken })
  }, [activePage, sessionToken])

  const searchLocation = useCallback(
    async (query, forWhich) => {
      if (!query?.trim()) return
      lastSearchForRef.current = forWhich
      setSearchLoading((s) => ({ ...s, [forWhich]: true }))
      setSearchError((s) => ({ ...s, [forWhich]: null }))
      setSearchResults((s) => ({ ...s, [forWhich]: [] }))
      try {
        await onAction(getEventName('onLocationSearch'), { query: query.trim() })
      } finally {
        setSearchLoading((s) => ({ ...s, [forWhich]: false }))
      }
    },
    [onAction, getEventName]
  )

  const getMyLocation = useCallback(
    (forWhich = 'origin') => {
      const done = () =>
        setSearchLoading((s) => ({ ...s, [forWhich]: false }))
      const serverOnly = async () => {
        setSearchLoading((s) => ({ ...s, [forWhich]: true }))
        try {
          await onAction(getEventName('onGetMyLocation'), { target: forWhich })
        } finally {
          done()
        }
      }
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        setSearchLoading((s) => ({ ...s, [forWhich]: true }))
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              await onAction(getEventName('onGetMyLocation'), {
                target: forWhich,
                client_lat: pos.coords.latitude,
                client_lng: pos.coords.longitude,
              })
            } catch (_) {
              try {
                await onAction(getEventName('onGetMyLocation'), { target: forWhich })
              } catch (_) { }
            } finally {
              done()
            }
          },
          () => {
            serverOnly()
          },
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
        )
        return
      }
      serverOnly()
    },
    [onAction, getEventName]
  )

  useEffect(() => {
    if (!alttulDetailModalOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setAlttulDetailModalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [alttulDetailModalOpen])

  useEffect(() => {
    const subs = eventsRef.current?.subscribe
    const action = onActionRef.current
    if (!subs || !action) return
    if (eventSourceRef.current) return
    const cid = getOrCreateSseClientId()
    const url =
      cid && typeof encodeURIComponent !== 'undefined'
        ? `/api/events/stream?client_id=${encodeURIComponent(cid)}&targeted_only=1`
        : '/api/events/stream'
    const es = new EventSource(url)
    eventSourceRef.current = es
    console.log('SSE URL:', url)
    es.onmessage = (e) => {
      console.log('SSE message:', e.data)
      try {
        const data = JSON.parse(e.data)
        const type = data.type || data.event_type
        if (type === 'SSE_CONNECTED') return
        const payload = data.payload || data
        const ev = eventsRef.current
        const getEv = (key) => (ev && ev[key]) || key

        if (type === 'LOCATION_SEARCH_RESULT') {
          const forWhich = lastSearchForRef.current || 'origin'
          console.log('LOCATION_SEARCH_RESULT:', payload)
          setSearchResults((prev) => ({ ...prev, [forWhich]: payload.results || [] }))
          //results가 빈 배열인 경우 검색 결과가 없음을 표시
          if (payload.results?.length === 0) {
            setSearchError((prev) => ({ ...prev, [forWhich]: '검색 결과가 없습니다.' }))
          }
        }
        if (type === 'LOCATION_SEARCH_ERROR') {
          const forWhich = lastSearchForRef.current || 'origin'
          const message =
            payload?.error ||
            '위치 검색에 실패했습니다. 검색어를 바꾸거나 잠시 후 다시 시도해 주세요.'
          setSearchError((prev) => ({ ...prev, [forWhich]: message }))
        }
        if (type === 'MY_LOCATION_RESULT' && payload.lat != null) {
          const tw = payload.target === 'dest' ? 'dest' : 'origin'
          const point = {
            lat: Number(payload.lat),
            lng: Number(payload.lng),
            address: payload.address || '',
          }
          if (tw === 'dest') {
            setDest(point)
            setDestSearch(point.address || '내 위치')
          } else {
            setOrigin(point)
            setOriginSearch(point.address || '내 위치')
          }
          setSearchResults((prev) => ({ ...prev, [tw]: [] }))
        }
        if (type === 'ROUTE_CALCULATED') {
          setRouteLoading(false)
          console.log('ROUTE_CALCULATED:', payload)
          const path = payload.route?.path
          setRouteInfo({
            distance_km: payload.distance_km,
            distance_m: payload.distance_m,
            duration_sec: payload.duration_sec,
            note: payload.note,
            path: Array.isArray(path) && path.length >= 2 ? path : null,
          })
          const onAct = onActionRef.current
          if (payload.distance_km != null && itemSizeRef.current && onAct) {
            onAct(getEv('onFareCalculate'), {
              distance_km: payload.distance_km,
              duration_sec: payload.duration_sec,
              item_size: itemSizeRef.current,
              item_weight_kg: itemWeightRef.current,
              item_list: (itemEntriesRef.current || []).map((it) => ({
                name: it.name || '',
                size: it.size || 'medium',
                weight_kg: Number(it.weight) || 0,
                qty: Math.max(1, Number(it.qty) || 1),
                note: it.note || '',
              })),
              floor_count: Math.max(
                FLOOR_COUNT_MIN,
                Number(originFloorCountRef.current || 0) + Number(destFloorCountRef.current || 0)
              ),
              floor_count_origin: originFloorCountRef.current,
              floor_count_dest: destFloorCountRef.current,
              has_elevator_origin: originHasElevatorRef.current,
              has_elevator_dest: destHasElevatorRef.current,
              direct_help_origin: originDirectHelpRef.current,
              direct_help_dest: destDirectHelpRef.current,
              has_elevator: originHasElevatorRef.current && destHasElevatorRef.current,
              recipient_helps: destDirectHelpRef.current,
              express_1to1: wantExpressRef.current,
            })
          }
        }
        if (type === 'FARE_CALCULATE') {
          setEstimatedFare(null)
        }

        if (type === 'FARE_CALCULATED') {
          const total = payload.estimated_fare ?? payload.breakdown?.total_fare ?? null
          setEstimatedFare(total)
          setFareBreakdown(payload.breakdown || null)
        }
        if (type === 'IMAGE_ANALYZE_RESULT') {
          const info = payload.result || payload.item_info || payload
          if (imageAnalyzeTargetRef.current === 'editor') {
            setItemEditorImageBusy(false)
            setItemEditorDraft((d) => ({
              ...d,
              size: info.estimated_size || d.size,
              weight:
                info.estimated_weight_kg != null ? Number(info.estimated_weight_kg) : d.weight,
              name: info.item_name ? String(info.item_name) : d.name,
              note: info.note != null ? String(info.note) : d.note,
            }))
            return
          }
          setItemEditorImageBusy(false)
        }
        if (type === 'ITEM_ESTIMATE_RESULT') {
          const info = payload
          if (itemEditorOpenRef.current) {
            setItemEditorAiBusy(false)
            setItemEditorDraft((d) => ({
              ...d,
              size: info.estimated_size || d.size,
              weight:
                info.estimated_weight_kg != null ? Number(info.estimated_weight_kg) : d.weight,
              name: info.item_name ? String(info.item_name) : d.name,
              note: info.note != null ? String(info.note) : d.note,
            }))
            return
          }
          if (info.estimated_size) setItemSize(info.estimated_size)
          if (info.estimated_weight_kg != null) setItemWeight(info.estimated_weight_kg)
          if (info.suggested_floor_count != null)
            setDestFloorCount(
              Math.max(
                FLOOR_COUNT_MIN,
                Math.min(FLOOR_COUNT_MAX, Number(info.suggested_floor_count) || 1)
              )
            )
          if (typeof info.has_elevator === 'boolean') {
            setOriginHasElevator(info.has_elevator)
            setDestHasElevator(info.has_elevator)
          }
          if (typeof info.recipient_helps === 'boolean') {
            setOriginDirectHelp(info.recipient_helps)
            setDestDirectHelp(info.recipient_helps)
          }
        }
        if (type === 'IMAGE_ANALYZE_ERROR') {
          if (imageAnalyzeTargetRef.current === 'editor') {
            setItemEditorImageBusy(false)
          }
        }
        if (type === 'DANGBAE_ORDER_CREATED' || type === 'ORDER_CREATED') {
          if (expectingOrderCreatedRef.current) {
            lastRequestPhoneRef.current = payload?.user_phone || ''
            expectingOrderCreatedRef.current = false
            const oid = payload?.order_id != null ? String(payload.order_id) : ''
            const fareNum = Number(payload?.estimated_fare ?? lastEstimatedFareRef.current)
            const amount =
              Number.isFinite(fareNum) && fareNum > 0
                ? Math.round(fareNum)
                : Math.max(0, Math.round(Number(lastEstimatedFareRef.current) || 0)) || 1000
            writePendingPayment({
              order_id: oid,
              amount,
              order_name: paymentOrderNameFromPayload(payload),
              user_email: (payload?.user_email && String(payload.user_email)) || '',
              user_phone: (payload?.user_phone && String(payload.user_phone)) || '',
            })
            window.location.hash = '#/payment'
          } else {
            setOrders((prev) => [...prev, payload])
          }
        }
        if (type === 'ORDER_UPDATED') {
          const oid = payload?.order_id
          if (oid != null) {
            setOrders((prev) =>
              prev.map((o) => (String(o.order_id || o.id) === String(oid) ? { ...o, ...payload } : o))
            )
            setStatusDetailOrder((cur) =>
              cur && String(cur.order_id || cur.id) === String(oid) ? { ...cur, ...payload } : cur
            )
          }
        }
        if (type === 'ORDER_QUERIED') {
          if (payload.query_error) {
            setStatusQueryError(payload.query_error)
            setOrders([])
            setStatusLookupDone(true)
          } else {
            setStatusQueryError(null)
            if (Array.isArray(payload.orders)) {
              setOrders(payload.orders)
              if (awaitingDriverQueryRef.current) {
                const phone = driverPhoneRef.current.trim()
                const name = driverNameRef.current.trim()
                const filtered = payload.orders.filter((o) => {
                  const dPhone = String(o.driver_phone || '').trim()
                  const dName = String(o.driver_name || '').trim()
                  return (phone && dPhone === phone) || (name && dName === name)
                })
                setDriverOrders(filtered)
                setDriverLookupDone(true)
                setDriverLookupLoading(false)
                awaitingDriverQueryRef.current = false
              }
              setStatusLookupDone(true)
            }
          }
        }
        if (type === 'DANGBAE_DRIVER_ASSIGNED' || type === 'DRIVER_ASSIGNED') {
          setDriverOrders((prev) => [...prev, payload])
        }
        const log = accountLogRef.current
        if (type === 'AUTH_SIGN_UP_RESULT') {
          setMemberAuthLoading(false)
          if (payload.ok) {
            log('회원가입 성공 (이메일 확인이 필요하면 메일함을 확인하세요)')
            if (payload.access_token) {
              setSessionToken(payload.access_token)
              localStorage.setItem(DANGBAE_AUTH_TOKEN_KEY, payload.access_token)
              notifyDangbaeAuthChanged()
            }
            if (memberSubmitAfterLoginRef.current && payload.access_token) {
              memberSubmitAfterLoginRef.current = false
              setMemberSubmitAfterLogin(false)
              submitDeliveryRequestRef.current({ emailOverride: memberEmailRef.current })
              setMemberApplyModalOpen(false)
            }
            // login 페이지에서 회원가입 성공 → 배송 신청 페이지로 이동
            if (activePageRef.current === 'login') {
              try { window.location.hash = '#/request' } catch (_) { }
            }
          } else log(`회원가입 실패: ${payload.error || 'unknown'}`)
        }
        if (type === 'AUTH_SIGN_IN_RESULT') {
          setMemberAuthLoading(false)
          if (payload.ok) {
            log('로그인 성공')
            if (payload.access_token) {
              setSessionToken(payload.access_token)
              localStorage.setItem(DANGBAE_AUTH_TOKEN_KEY, payload.access_token)
              notifyDangbaeAuthChanged()
            }
            if (memberSubmitAfterLoginRef.current) {
              memberSubmitAfterLoginRef.current = false
              setMemberSubmitAfterLogin(false)
              submitDeliveryRequestRef.current({ emailOverride: memberEmailRef.current })
              setMemberApplyModalOpen(false)
            }
            // login 페이지에서 로그인 성공 → 배송 신청 페이지로 이동
            if (activePageRef.current === 'login') {
              try { window.location.hash = '#/request' } catch (_) { }
            }
          } else log(`로그인 실패: ${payload.error || 'unknown'}`)
        }
        if (type === 'AUTH_GET_USER_RESULT') {
          if (payload.ok && payload.user) {
            const u = payload.user
            const meta = u.user_metadata || {}
            setProfileName(meta.name || meta.nickname || '')
            setProfilePhone(meta.phone || u.phone || '')
          }
        }
        if (type === 'AUTH_UPDATE_USER_RESULT') {
          setProfileUpdateLoading(false)
          if (payload.ok) {
            setProfileUpdateStatus('success')
            setProfileUpdateMsg('개인 정보가 성공적으로 수정되었습니다.')
            setProfilePassword('')
            setProfilePasswordConfirm('')
            if (payload.access_token) {
              setSessionToken(payload.access_token)
              localStorage.setItem(DANGBAE_AUTH_TOKEN_KEY, payload.access_token)
              notifyDangbaeAuthChanged()
            }
          } else {
            setProfileUpdateStatus('error')
            setProfileUpdateMsg(`수정 실패: ${payload.error || '알 수 없는 오류'}`)
          }
        }
        if (type === 'AUTH_OAUTH_URL_RESULT') {
          if (payload.ok && payload.url) {
            let usePopup = false
            try {
              usePopup = sessionStorage.getItem('dangbae_oauth_use_popup') === '1'
            } catch (_) { }
            if (usePopup) {
              try {
                sessionStorage.removeItem('dangbae_oauth_use_popup')
              } catch (_) { }
              const w = window.open(
                payload.url,
                'dangbae_oauth',
                'width=480,height=720,scrollbars=yes,resizable=yes'
              )
              window.dispatchEvent(
                new CustomEvent('dangbae-oauth-popup-opened', { detail: { ok: !!w } })
              )
              if (w) {
                log('간편 로그인 창이 열렸습니다. 완료되면 창이 닫힙니다.')
              } else {
                log('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.')
              }
            } else {
              log('OAuth 페이지로 이동합니다…')
              window.location.href = payload.url
            }
          } else {
            log(`OAuth URL 실패: ${payload.error || 'unknown'}`)
            try {
              window.dispatchEvent(new CustomEvent('dangbae-oauth-url-failed'))
            } catch (_) { }
          }
        }
        if (type === 'PAYMENT_PREPARE_RESULT') {
          if (payload.ok) {
            setLastPrepare(payload)
            writeLastPaymentPrepare(payload)
            log(
              `결제 준비 완료: merchant_uid=${payload.merchant_uid}, amount=${payload.amount}`
            )
          } else log(`결제 준비 실패: ${payload.error || 'unknown'}`)
        }
        if (type === 'PAYMENT_CONFIRM_RESULT') {
          log(`결제 확인: ${JSON.stringify(payload)}`)
          if (payload.ok) clearLastPaymentPrepare()
        }
        if (type === 'ORDER_UPDATE_REJECTED') {
          log(
            `주문 상태 변경 불가: ${payload?.message || payload?.error || JSON.stringify(payload)}`
          )
        }
      } catch (_) { }
    }
    es.onerror = () => { }
    return () => {
      es.close()
      eventSourceRef.current = null
    }
    // 빈 deps: 마운트 시 한 번만 연결. onmessage는 ref로 최신 onAction/events 참조.
  }, [])

  useEffect(() => {
    if (!origin?.lat || !dest?.lat) {
      setRouteInfo(null)
      setEstimatedFare(null)
      setFareBreakdown(null)
      return
    }
    const action = onActionRef.current
    const ev = eventsRef.current
    const getEv = (key) => (ev && ev[key]) || key
    if (!action) return
    setRouteLoading(true)
    setRouteInfo(null)
    action(getEv('onRouteCalculate'), {
      origin_address: origin.address || '',
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      dest_address: dest.address || '',
      dest_lat: dest.lat,
      dest_lng: dest.lng,
    })
  }, [origin?.lat, origin?.lng, dest?.lat, dest?.lng])

  const selectSearchResult = (forWhich, result) => {
    const point = { lat: result.lat, lng: result.lng, address: result.address || result.name }
    if (forWhich === 'origin') {
      setOrigin(point)
      setOriginSearch(result.name)
      setSearchResults((s) => ({ ...s, origin: [] }))
    } else {
      setDest(point)
      setDestSearch(result.name)
      setSearchResults((s) => ({ ...s, dest: [] }))
    }
  }

  const emptyItemDraft = useCallback(
    () => ({
      name: '',
      size: default_item_size || 'medium',
      weight: 0,
      qty: 1,
      note: '',
      images: [],
    }),
    [default_item_size]
  )

  const openItemEditor = useCallback(
    (index) => {
      if (index == null) {
        setItemEditorDraft(emptyItemDraft())
        setItemEditorEditIndex(null)
      } else {
        const e = itemEntries[index] || {}
        setItemEditorDraft({
          name: String(e.name || ''),
          size: e.size || default_item_size || 'medium',
          weight: Number(e.weight) || 0,
          qty: Number(e.qty) || 1,
          note: String(e.note || ''),
          images: [...(e.images || [])],
        })
        setItemEditorEditIndex(index)
      }
      setItemEditorAiBusy(false)
      setItemEditorImageBusy(false)
      setItemEditorOpen(true)
    },
    [default_item_size, emptyItemDraft, itemEntries]
  )

  const closeItemEditor = useCallback(() => {
    setItemEditorOpen(false)
    setItemEditorEditIndex(null)
    setItemEditorAiBusy(false)
    setItemEditorImageBusy(false)
  }, [])

  useEffect(() => {
    if (!itemEditorOpen && !imageLightboxSrc) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (imageLightboxSrc) setImageLightboxSrc(null)
      else closeItemEditor()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [itemEditorOpen, imageLightboxSrc, closeItemEditor])

  const saveItemEditor = useCallback(() => {
    const name = String(itemEditorDraft.name || '').trim()
    if (!name) return
    const entry = {
      name,
      size: itemEditorDraft.size || default_item_size,
      weight: Number(itemEditorDraft.weight) || 0,
      qty: Math.max(1, Number(itemEditorDraft.qty) || 1),
      note: String(itemEditorDraft.note || '').trim(),
      images: [...(itemEditorDraft.images || [])],
    }
    if (itemEditorEditIndex != null) {
      setItemEntries((prev) => prev.map((p, i) => (i === itemEditorEditIndex ? entry : p)))
    } else {
      setItemEntries((prev) => [...prev, entry])
    }
    closeItemEditor()
  }, [closeItemEditor, default_item_size, itemEditorDraft, itemEditorEditIndex])

  const removeItemFromList = useCallback((index) => {
    setItemEntries((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleEditorGalleryUpload = async (e) => {
    const input = e.target
    const files = Array.from(input?.files || []).filter((file) => String(file?.type || '').startsWith('image/'))
    if (!files.length) {
      if (input) input.value = ''
      return
    }
    setItemEditorImageBusy(true)
    try {
      const newImages = await Promise.all(files.map((file) => readFileAsDataUrl(file)))
      setItemEditorDraft((prev) => {
        const next = [...(prev.images || []), ...newImages]
        if (next.length && onAction) {
          imageAnalyzeTargetRef.current = 'editor'
          onAction(getEventName('onImageAnalyze'), {
            image_base64_list: next.slice(0, ITEM_EDITOR_VLM_MAX_IMAGES),
          })
        } else {
          setItemEditorImageBusy(false)
        }
        return { ...prev, images: next }
      })
    } catch {
      setItemEditorImageBusy(false)
    } finally {
      if (input) input.value = ''
    }
  }

  const removeEditorImage = (idx) => {
    setItemEditorDraft((prev) => {
      const next = (prev.images || []).filter((_, i) => i !== idx)
      if (next.length && onAction) {
        imageAnalyzeTargetRef.current = 'editor'
        setItemEditorImageBusy(true)
        onAction(getEventName('onImageAnalyze'), {
          image_base64_list: next.slice(0, ITEM_EDITOR_VLM_MAX_IMAGES),
        })
      } else {
        setItemEditorImageBusy(false)
      }
      return { ...prev, images: next }
    })
  }

  const estimateEditorItemFromAi = () => {
    const text = String(itemEditorDraft.name || '').trim()
    if (!text || !onAction) return
    setItemEditorAiBusy(true)
    onAction(getEventName('onItemEstimate'), { item_title: text })
  }

  useEffect(() => {
    if (!routeInfo?.distance_km || !aggregatedItemSize || !onActionRef.current) return
    const ev = eventsRef.current
    const getEv = (key) => (ev && ev[key]) || key
    onActionRef.current(getEv('onFareCalculate'), {
      distance_km: routeInfo.distance_km,
      duration_sec: routeInfo.duration_sec,
      item_size: aggregatedItemSize,
      item_weight_kg: aggregatedItemWeight || 0,
      item_list: itemEntries.map((it) => ({
        name: it.name || '',
        size: it.size || 'medium',
        weight_kg: Number(it.weight) || 0,
        qty: Math.max(1, Number(it.qty) || 1),
        note: it.note || '',
      })),
      floor_count: totalFloorCount,
      floor_count_origin: originFloorCount,
      floor_count_dest: destFloorCount,
      has_elevator_origin: originHasElevator,
      has_elevator_dest: destHasElevator,
      direct_help_origin: originDirectHelp,
      direct_help_dest: destDirectHelp,
      has_elevator: originHasElevator && destHasElevator,
      recipient_helps: destDirectHelp,
      express_1to1: wantExpress,
    })
  }, [
    routeInfo?.distance_km,
    routeInfo?.duration_sec,
    aggregatedItemSize,
    aggregatedItemWeight,
    itemEntries,
    totalFloorCount,
    originFloorCount,
    destFloorCount,
    originHasElevator,
    destHasElevator,
    originDirectHelp,
    destDirectHelp,
    wantExpress,
  ])

  const resetRequestForm = useCallback(() => {
    setOrigin(null)
    setDest(null)
    setOriginSearch('')
    setDestSearch('')
    setSearchResults({ origin: [], dest: [] })
    setSearchError({ origin: null, dest: null })
    setRouteInfo(null)
    setRouteLoading(false)
    setEstimatedFare(null)
    setFareBreakdown(null)
    setItemEntries([])
    setItemSize(default_item_size)
    setItemWeight(0)
    setOriginFloorCount(1)
    setDestFloorCount(1)
    setOriginHasElevator(true)
    setDestHasElevator(true)
    setOriginDirectHelp(false)
    setDestDirectHelp(false)
    setUserPhone('')
    setUserEmail('')
    setOrderAccessPin('')
    setWantExpress(false)
    setItemEditorOpen(false)
    setItemEditorEditIndex(null)
    setItemEditorDraft(emptyItemDraft())
    setItemEditorAiBusy(false)
    setItemEditorImageBusy(false)
    setImageLightboxSrc(null)
    setGuestApplyModalOpen(false)
    setGuestPhone('')
    setGuestPin('')
    setMemberApplyModalOpen(false)
    setMemberEmail('')
    setMemberPassword('')
    setMemberSubmitAfterLogin(false)
    memberSubmitAfterLoginRef.current = false
    setMemberAuthMode('login')
    setMemberAuthLoading(false)
  }, [default_item_size, emptyItemDraft])

  const goToStatusAfterPayment = useCallback(() => {
    clearPendingPayment()
    const phone = lastRequestPhoneRef.current
    const pin = lastRequestPinRef.current
    setMyOrdersPhone(phone)
    setMyOrdersPin(pin)
    window.location.hash = '#/status'
    if (phone && pin?.length === 6 && onAction) {
      setStatusQueryError(null)
      onAction(getEventName('onMyOrdersQuery'), { user_phone: phone, user_pin: pin })
    }
  }, [onAction, getEventName])

  const queryDriverOrders = useCallback(async () => {
    if (!onAction) return
    if (!driverPhone.trim() && !driverName.trim()) {
      accountLogRef.current('배송원 연락처 또는 이름을 입력해 주세요.')
      return
    }
    setDriverLookupLoading(true)
    setDriverLookupDone(false)
    setDriverOrders([])
    awaitingDriverQueryRef.current = true
    try {
      await onAction(getEventName('onAdminOrdersQuery'), {})
    } catch (_) {
      setDriverLookupLoading(false)
      awaitingDriverQueryRef.current = false
    }
  }, [onAction, getEventName, driverPhone, driverName])

  const updateDriverOrder = useCallback((order, nextStatus, extra = {}) => {
    if (!onAction) return
    const oid = order.order_id || order.id
    onAction(getEventName('onOrderUpdate'), {
      order_id: oid,
      status: nextStatus,
      driver_name: order.driver_name || driverName || undefined,
      driver_phone: order.driver_phone || driverPhone || undefined,
      ...extra,
    })
    setTimeout(() => {
      queryDriverOrders()
    }, 280)
  }, [onAction, getEventName, driverName, driverPhone, queryDriverOrders])

  const driverOrderStats = useMemo(() => {
    const toAmount = (o) => {
      const n = Number(o.actual_fare ?? o.estimated_fare ?? 0)
      return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
    }
    const completed = driverOrders.filter((o) => (o.status || 'pending') === 'delivered')
    const inProgress = driverOrders.filter((o) => ['assigned', 'picked_up'].includes(o.status || 'pending'))
    const scheduled = driverOrders.filter((o) => (o.status || 'pending') === 'pending')
    const totalEarned = completed.reduce((sum, o) => sum + toAmount(o), 0)
    const weekly = {}
    completed.forEach((o) => {
      const raw = o.delivered_at || o.updated_at || o.created_at
      const d = raw ? new Date(raw) : new Date()
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const key = `${year}-${month}-${day}`
      const prev = weekly[key] || { count: 0, amount: 0 }
      weekly[key] = { count: prev.count + 1, amount: prev.amount + toAmount(o) }
    })
    const weeklyRows = Object.entries(weekly)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 14)
    return { completed, inProgress, scheduled, totalEarned, weeklyRows, toAmount }
  }, [driverOrders])

  const payoutAmount = useMemo(
    () =>
      driverOrders
        .filter((o) => payoutOrderIds.includes(String(o.order_id || o.id)))
        .reduce((sum, o) => sum + driverOrderStats.toAmount(o), 0),
    [driverOrders, payoutOrderIds, driverOrderStats]
  )

  const payoutSelectableIds = useMemo(
    () => driverOrderStats.completed.map((o) => String(o.order_id || o.id)),
    [driverOrderStats.completed]
  )
  const allPayoutSelected =
    payoutSelectableIds.length > 0 &&
    payoutSelectableIds.every((id) => payoutOrderIds.includes(id))
  const somePayoutSelected = payoutSelectableIds.some((id) => payoutOrderIds.includes(id))

  const handleUpdateProfile = useCallback((e) => {
    e.preventDefault()
    if (profilePassword) {
      if (profilePassword.length < 8) {
        setProfileUpdateStatus('error')
        setProfileUpdateMsg('비밀번호는 8자 이상이어야 합니다.')
        return
      }
      if (profilePassword !== profilePasswordConfirm) {
        setProfileUpdateStatus('error')
        setProfileUpdateMsg('비밀번호가 일치하지 않습니다.')
        return
      }
    }
    setProfileUpdateLoading(true)
    setProfileUpdateMsg('')
    setProfileUpdateStatus('')

    const updatePayload = {
      user_token: sessionToken,
      metadata: {
        name: profileName,
        phone: profilePhone,
      }
    }
    if (profilePassword) {
      updatePayload.password = profilePassword
    }

    if (onAction) {
      onAction(getEventName('onAuthUpdateUser'), updatePayload)
    }
  }, [sessionToken, profileName, profilePhone, profilePassword, profilePasswordConfirm, onAction, getEventName])

  const updateProfilePhoneOnly = (newPhone) => {
    if (!sessionToken || !onAction) return
    onAction(getEventName('onAuthUpdateUser'), {
      user_token: sessionToken,
      metadata: {
        name: profileName,
        phone: newPhone,
      }
    })
  }

  const submitDeliveryRequest = ({
    phoneOverride,
    pinOverride,
    emailOverride,
  } = {}) => {
    if (!origin?.lat || !dest?.lat) return
    const rawPhone = phoneOverride != null ? phoneOverride : userPhone
    const rawPin = pinOverride != null ? pinOverride : orderAccessPin
    const phone = String(rawPhone || '').trim()
    const pin = String(rawPin || '').replace(/\D/g, '').slice(0, 6)
    expectingOrderCreatedRef.current = true
    lastRequestPinRef.current = pin
    const delivery_mode = wantExpress ? 'express' : 'alttul'
    onAction(getEventName('onDeliveryRequest'), {
      origin_address: origin.address || '',
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      origin_detail: '',
      dest_address: dest.address || '',
      dest_lat: dest.lat,
      dest_lng: dest.lng,
      dest_detail: '',
      item_title: resolvePrimaryItemTitle(),
      item_titles: resolvedItemTitles,
      item_size: aggregatedItemSize,
      item_weight_kg: aggregatedItemWeight || itemWeight,
      item_items:
        itemEntries.length > 0
          ? itemEntries.map((it) => ({
            name: it.name,
            item_size: it.size || undefined,
            item_weight_kg: Number(it.weight) || 0,
            item_note: it.note || undefined,
          }))
          : undefined,
      item_images: itemEntries.flatMap((it) => it.images || []),
      floor_count: totalFloorCount,
      floor_count_origin: originFloorCount,
      floor_count_dest: destFloorCount,
      has_elevator_origin: originHasElevator,
      has_elevator_dest: destHasElevator,
      direct_help_origin: originDirectHelp,
      direct_help_dest: destDirectHelp,
      has_elevator: originHasElevator && destHasElevator,
      recipient_helps: destDirectHelp,
      estimated_km: routeInfo?.distance_km ?? 0,
      estimated_fare: estimatedFare ?? 0,
      user_email: emailOverride != null ? emailOverride : userEmail,
      user_phone: phone || undefined,
      order_access_pin: pin.length === 6 ? pin : undefined,
      delivery_mode,
      want_alttul: !wantExpress,
      want_express: wantExpress,
    })
  }

  useEffect(() => {
    submitDeliveryRequestRef.current = submitDeliveryRequest
  }, [submitDeliveryRequest])

  const handleMemberModalSignIn = useCallback(
    (ev) => {
      ev.preventDefault()
      if (!onAction) return
      const em = String(memberEmail || '').trim()
      if (!em || !memberPassword) return
      setMemberAuthLoading(true)
      memberSubmitAfterLoginRef.current = true
      setMemberSubmitAfterLogin(true)
      onAction(getEventName('onAuthSignIn'), { email: em, password: memberPassword })
    },
    [onAction, getEventName, memberEmail, memberPassword]
  )

  const handleMemberModalSignUp = useCallback(
    (ev) => {
      ev.preventDefault()
      if (!onAction) return
      const em = String(memberEmail || '').trim()
      if (!em || !memberPassword) return
      setMemberAuthLoading(true)
      memberSubmitAfterLoginRef.current = true
      setMemberSubmitAfterLogin(true)
      onAction(getEventName('onAuthSignUp'), { email: em, password: memberPassword })
    },
    [onAction, getEventName, memberEmail, memberPassword]
  )

  const handleMemberOAuthPick = useCallback(
    (provider) => {
      if (!onAction) return
      memberSubmitAfterLoginRef.current = true
      setMemberSubmitAfterLogin(true)
      try {
        sessionStorage.setItem(OAUTH_POPUP_FLAG, '1')
      } catch (_) { }
      const origin =
        typeof window !== 'undefined' &&
          (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            window.location.hostname.startsWith('192.168.'))
          ? window.location.origin
          : 'https://dangbae.bs-soft.co.kr'
      const redirectTo = `${origin}/oauth-callback.html`
      onAction(getEventName('onAuthOAuthUrl'), { provider, redirect_to: redirectTo })
    },
    [onAction, getEventName]
  )

  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== 'DANGBAE_OAUTH') return
      const { access_token, error } = parseOAuthPayload(e.data.hash, e.data.search)
      if (error) {
        accountLogRef.current(`OAuth: ${error}`)
        return
      }
      if (!access_token) return
      setSessionToken(access_token)
      localStorage.setItem(DANGBAE_AUTH_TOKEN_KEY, access_token)
      notifyDangbaeAuthChanged()
      if (memberSubmitAfterLoginRef.current) {
        memberSubmitAfterLoginRef.current = false
        setMemberSubmitAfterLogin(false)
        const emailFromToken = getEmailFromAccessToken(access_token) || memberEmailRef.current
        submitDeliveryRequestRef.current({ emailOverride: emailFromToken })
        setMemberApplyModalOpen(false)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  return (
    <div className={`dangbae-widget${activePage === 'user' ? ' dangbae-widget--request' : ''}`}>
      {activePage === 'user' && (
        <div className="dangbae-request">
          <div className="form-pane form-pane-scroll">

            <div className="request-section request-section--location-stack">
              <div className="form-block location-block">
                <h3>출발지</h3>
                <p className="field-hint">픽업할 장소를 검색하거나 내 위치를 사용하세요.</p>
                <div className="search-row">
                  <input
                    type="text"
                    placeholder="주소 또는 장소 검색"
                    value={originSearch}
                    onChange={(e) => setOriginSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchLocation(originSearch, 'origin')}
                  />
                  <button
                    type="button"
                    onClick={() => searchLocation(originSearch, 'origin')}
                    disabled={searchLoading.origin}
                  >
                    {searchLoading.origin ? '검색 중…' : '검색'}
                  </button>
                  <button
                    type="button"
                    onClick={() => getMyLocation('origin')}
                    disabled={searchLoading.origin}
                  >
                    내 위치
                  </button>
                </div>
                {searchResults.origin?.length > 0 && (
                  <ul className="search-results">
                    {searchResults.origin.map((r, i) => (
                      <li
                        key={i}
                        onClick={() => selectSearchResult('origin', r)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && selectSearchResult('origin', r)}
                      >
                        {r.name || r.address} {r.address && r.name !== r.address ? `(${r.address})` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {searchError.origin && (
                  <p className="search-error-text">{searchError.origin}</p>
                )}
                <p className="address-display">
                  {origin?.address || (origin ? `${origin.lat?.toFixed(5)}, ${origin.lng?.toFixed(5)}` : '')}
                </p>
                <div className="location-options location-options--row-inline">
                  <label className="location-inline-floor">
                    <span>출발지 층수</span>
                    <input
                      type="text"
                      className={originFloorError ? 'input-error' : ''}
                      value={originFloorCountText}
                      onChange={handleOriginFloorChange}
                      onBlur={handleOriginFloorBlur}
                    />
                    {originFloorError && (
                      <span className="floor-error-msg">{originFloorError}</span>
                    )}
                  </label>
                  <LocationBoolToggle
                    id="origin-elevator"
                    label="출발지 엘리베이터"
                    checked={originHasElevator}
                    onChange={setOriginHasElevator}
                  />
                  <LocationBoolToggle
                    id="origin-direct-help"
                    label="출발지 직접 도움"
                    checked={originDirectHelp}
                    onChange={setOriginDirectHelp}
                  />
                </div>
              </div>

              <div className="location-section-divider" aria-hidden />

              <div className="form-block location-block">
                <h3>목적지</h3>
                <p className="field-hint">배송받을 주소를 검색하거나 내 위치를 사용하세요.</p>
                <div className="search-row">
                  <input
                    type="text"
                    placeholder="주소 또는 장소 검색"
                    value={destSearch}
                    onChange={(e) => setDestSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchLocation(destSearch, 'dest')}
                  />
                  <button
                    type="button"
                    onClick={() => searchLocation(destSearch, 'dest')}
                    disabled={searchLoading.dest}
                  >
                    {searchLoading.dest ? '검색 중…' : '검색'}
                  </button>
                  <button
                    type="button"
                    onClick={() => getMyLocation('dest')}
                    disabled={searchLoading.dest}
                  >
                    내 위치
                  </button>
                </div>
                {searchResults.dest?.length > 0 && (
                  <ul className="search-results">
                    {searchResults.dest.map((r, i) => (
                      <li
                        key={i}
                        onClick={() => selectSearchResult('dest', r)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && selectSearchResult('dest', r)}
                      >
                        {r.name || r.address} {r.address && r.name !== r.address ? `(${r.address})` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {searchError.dest && (
                  <p className="search-error-text">{searchError.dest}</p>
                )}
                <p className="address-display">
                  {dest?.address || (dest ? `${dest.lat?.toFixed(5)}, ${dest.lng?.toFixed(5)}` : '')}
                </p>
                <div className="location-options location-options--row-inline">
                  <label className="location-inline-floor">
                    <span>목적지 층수</span>
                    <input
                      type="text"
                      className={destFloorError ? 'input-error' : ''}
                      value={destFloorCountText}
                      onChange={handleDestFloorChange}
                      onBlur={handleDestFloorBlur}
                    />
                    {destFloorError && (
                      <span className="floor-error-msg">{destFloorError}</span>
                    )}
                  </label>

                  <LocationBoolToggle
                    id="dest-elevator"
                    label="목적지 엘리베이터"
                    checked={destHasElevator}
                    onChange={setDestHasElevator}
                  />
                  <LocationBoolToggle
                    id="dest-direct-help"
                    label="목적지 직접 도움"
                    checked={destDirectHelp}
                    onChange={setDestDirectHelp}
                  />
                </div>
              </div>

              <div className="location-section-divider" aria-hidden />

              <div className="form-block route-block location-route-block">
                <h3>이동 거리</h3>
                {routeLoading && <p className="route-status">거리 추정 중…</p>}
                {!routeLoading && routeInfo && (
                  <>
                    <p className="route-distance">
                      예상 거리: <strong>{routeInfo.distance_km} km</strong>
                      {routeInfo.duration_sec != null && routeInfo.duration_sec > 0 && (
                        <span className="route-duration-inline">
                          {' '}
                          · 소요{' '}
                          <strong>
                            {Math.max(1, Math.round(Number(routeInfo.duration_sec) / 60))}분
                          </strong>
                        </span>
                      )}
                    </p>
                    {routeInfo.note && <p className="route-note">{routeInfo.note}</p>}
                  </>
                )}
                {!routeLoading && !routeInfo && origin && dest && (
                  <p className="route-status">출발지와 목적지를 설정하면 이동 거리가 추정됩니다.</p>
                )}
                {mapInRouteSection && (
                  <div className="route-map-embed" aria-label="출발지·목적지 지도">
                    <DangbaeKakaoMap
                      appKey={mapAppKey}
                      origin={origin}
                      dest={dest}
                      routePath={routeInfo?.path}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="request-section">
              <div className="form-block">
                <h3>물품</h3>
                <p className="field-hint">
                  <strong>추가</strong>를 눌러 물품명·크기·무게·사진·비고를 입력하세요. 물품명 옆 <strong>AI</strong>로
                  크기·무게·배송 주의사항을 자동 채울 수 있습니다.
                </p>
                <div className="item-add-toolbar">
                  <button type="button" className="btn-estimate btn-item-add" onClick={() => openItemEditor(null)}>
                    추가
                  </button>
                </div>
                {itemEntries.length > 0 && (
                  <ul className="item-summary-list" aria-label="등록된 물품">
                    {itemEntries.map((entry, idx) => {
                      const imgs = entry.images || []
                      const thumbLimit = 6
                      const extra = imgs.length > thumbLimit ? imgs.length - thumbLimit : 0
                      return (
                        <li key={`${entry.name}-${idx}`} className="item-summary-row">
                          {imgs.length > 0 && (
                            <div className="item-summary-thumbs" role="group" aria-label="물품 사진 미리보기">
                              {imgs.slice(0, thumbLimit).map((src, ti) => (
                                <button
                                  type="button"
                                  key={`${idx}-thumb-${ti}`}
                                  className="item-summary-thumb"
                                  onClick={() => setImageLightboxSrc(src)}
                                  aria-label={`사진 ${ti + 1} 확대`}
                                >
                                  <img src={src} alt="" />
                                </button>
                              ))}
                              {extra > 0 && (
                                <span className="item-summary-thumb-more" aria-hidden>
                                  +{extra}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="item-summary-main">
                            <span className="item-summary-name">{entry.name}</span>
                            <span className="item-summary-meta">
                              {formatItemSizeKr(entry.size)} · {Number(entry.weight) || 0}kg · {Number(entry.qty) || 1}개
                              {imgs.length > 0 && (
                                <span className="item-summary-photos"> · 사진 {imgs.length}장</span>
                              )}
                            </span>
                            {entry.note ? <p className="item-summary-note">{entry.note}</p> : null}
                          </div>
                          <div className="item-summary-actions">
                            <button type="button" className="btn-item-edit" onClick={() => openItemEditor(idx)}>
                              편집
                            </button>
                            <button
                              type="button"
                              className="item-chip-remove"
                              onClick={() => removeItemFromList(idx)}
                              aria-label={`${entry.name} 삭제`}
                            >
                              삭제
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

            </div>

            <div className="request-section">
              <div className="form-block fare-block">
                <h3 className="fare-mode-title">배송 방식 선택</h3>
                <div className="fare-mode-toggle" role="group" aria-label="배송 방식 선택">
                  <button
                    type="button"
                    className={`fare-mode-btn${!wantExpress ? ' fare-mode-btn--active fare-mode-btn--alttul' : ''}`}
                    onClick={() => setWantExpress(false)}
                    aria-pressed={!wantExpress}
                  >
                    <span className="fare-mode-btn-icon">💰</span>
                    <span className="fare-mode-btn-label">알뜰배송</span>
                    <span className="fare-mode-btn-desc">다른 배송 건과 묶음 배송</span>
                  </button>
                  <button
                    type="button"
                    className={`fare-mode-btn${wantExpress ? ' fare-mode-btn--active fare-mode-btn--express' : ''}`}
                    onClick={() => setWantExpress(true)}
                    aria-pressed={wantExpress}
                  >
                    <span className="fare-mode-btn-icon">⚡</span>
                    <span className="fare-mode-btn-label">신속배송</span>
                    <span className="fare-mode-btn-desc">1:1 즉시 배송</span>
                  </button>
                </div>
                {!wantExpress && (
                  <button
                    type="button"
                    className="fare-alttul-info-row"
                    onClick={() => setAlttulDetailModalOpen(true)}
                    aria-label="알뜰배송 상세 안내 열기"
                  >
                    <span className="btn-alttul-info-mark" aria-hidden>!</span>
                    <span>알뜰배송이란?</span>
                  </button>
                )}
                {fareBreakdown?.alttul_note && <p className="alttul-note">{fareBreakdown.alttul_note}</p>}
                <p className="estimated-fare">{estimatedFare != null ? `${estimatedFare.toLocaleString()}원` : '거리·물품 입력 후 자동 산정'}</p>
                {fareBreakdown?.original_1to1_fare != null &&
                  fareBreakdown.original_1to1_fare > (estimatedFare ?? 0) &&
                  !wantExpress && (
                    <p className="original-1to1">1:1 즉시 배송 시 약 {Number(fareBreakdown.original_1to1_fare).toLocaleString()}원</p>
                  )}
                {fareBreakdown && (
                  <div className="fare-breakdown">
                    <p className="breakdown-line">
                      <span>운송수단</span>
                      <span>{fareBreakdown.vehicle_type === 'motorcycle' ? '오토바이' : '차량'}</span>
                    </p>
                    {fareBreakdown.vehicle_base != null && (
                      <p className="breakdown-line">
                        <span>기본료</span>
                        <span>{Number(fareBreakdown.vehicle_base).toLocaleString()}원</span>
                      </p>
                    )}
                    {fareBreakdown.distance_fee != null && fareBreakdown.distance_fee > 0 && (
                      <p className="breakdown-line">
                        <span>거리 요금</span>
                        <span>{Number(fareBreakdown.distance_fee).toLocaleString()}원</span>
                      </p>
                    )}
                    {fareBreakdown.time_fee != null && fareBreakdown.time_fee > 0 && (
                      <p className="breakdown-line">
                        <span>시간 요금</span>
                        <span>{Number(fareBreakdown.time_fee).toLocaleString()}원</span>
                      </p>
                    )}
                    {fareBreakdown.worker_fee != null && fareBreakdown.worker_fee > 0 && (
                      <p className="breakdown-line">
                        <span>추가 인부</span>
                        <span>{Number(fareBreakdown.worker_fee).toLocaleString()}원</span>
                      </p>
                    )}
                    {fareBreakdown.floor_fee != null && fareBreakdown.floor_fee > 0 && (
                      <p className="breakdown-line">
                        <span>층수 요금</span>
                        <span>{Number(fareBreakdown.floor_fee).toLocaleString()}원</span>
                      </p>
                    )}
                    {fareBreakdown.cargo_fee != null && fareBreakdown.cargo_fee > 0 && (
                      <p className="breakdown-line">
                        <span>화물 요금</span>
                        <span>{Number(fareBreakdown.cargo_fee).toLocaleString()}원</span>
                      </p>
                    )}
                    {fareBreakdown.urgent_fee != null && fareBreakdown.urgent_fee > 0 && (
                      <p className="breakdown-line">
                        <span>긴급</span>
                        <span>{Number(fareBreakdown.urgent_fee).toLocaleString()}원</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="apply-actions">
                {sessionToken ? (
                  <button
                    type="button"
                    className="btn-submit"
                    onClick={() => {
                      if (!checkFloorValidation()) return
                      const emailFromToken = getEmailFromAccessToken(sessionToken) || userEmail
                      if (!profilePhone || !profilePhone.trim()) {
                        setPromptPhone('')
                        setPhonePromptModalOpen(true)
                      } else {
                        submitDeliveryRequest({
                          phoneOverride: profilePhone.trim(),
                          emailOverride: emailFromToken
                        })
                      }
                    }}
                    disabled={!origin?.lat || !dest?.lat}
                  >
                    신청
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-submit"
                      onClick={() => {
                        if (!checkFloorValidation()) return
                        setGuestPhone(userPhone || '')
                        setGuestPin(orderAccessPin || '')
                        setGuestApplyModalOpen(true)
                      }}
                      disabled={!origin?.lat || !dest?.lat}
                    >
                      비회원 신청
                    </button>
                    <button
                      type="button"
                      className="btn-submit btn-submit-member"
                      onClick={() => {
                        if (!checkFloorValidation()) return
                        setMemberEmail(userEmail || '')
                        setMemberPassword('')
                        setMemberApplyModalOpen(true)
                      }}
                      disabled={!origin?.lat || !dest?.lat}
                    >
                      회원 신청
                    </button>
                  </>
                )}
              </div>
              {!origin?.lat || !dest?.lat ? (
                <p className="submit-hint">출발지와 목적지를 먼저 설정해 주세요.</p>
              ) : null}
            </div>
          </div>
          {!mapInRouteSection && (
            <div className="map-pane">
              <DangbaeKakaoMap
                appKey={mapAppKey}
                origin={origin}
                dest={dest}
                routePath={routeInfo?.path}
              />
            </div>
          )}
        </div>
      )}

      {(activePage === 'status' || activePage === 'mypage') && (
        <div className="dangbae-status">
          <div className="status-hero">
            <h2>{activePage === 'mypage' ? '마이페이지' : '내 배송 현황'}</h2>
            {activePage === 'status' && sessionToken ? (
              <>
                <p className="mypage-account-email">
                  {memberEmailFromToken ? (
                    <>
                      로그인 계정 <strong>{memberEmailFromToken}</strong>
                    </>
                  ) : (
                    <>회원으로 로그인된 상태입니다.</>
                  )}
                </p>
                <p>로그인 계정으로 신청한 배송 내역을 자동으로 불러옵니다.</p>
              </>
            ) : activePage === 'mypage' && sessionToken ? (
              <>
                <p className="mypage-account-email">
                  {memberEmailFromToken ? (
                    <>
                      로그인 계정 <strong>{memberEmailFromToken}</strong>
                    </>
                  ) : (
                    <>회원으로 로그인된 상태입니다.</>
                  )}
                </p>
              </>
            ) : activePage === 'mypage' && !sessionToken ? (
              <p>개인 정보를 확인하고 수정하려면 먼저 로그인하세요.</p>
            ) : (
              <p>배송 신청 시 입력한 연락처와 6자리 비밀번호로 조회하세요.</p>
            )}
          </div>

          {activePage === 'mypage' && sessionToken && (
            <div className="profile-edit-card">
              <h3 className="profile-edit-title">개인 정보 수정</h3>
              <form onSubmit={handleUpdateProfile} className="profile-edit-form">
                <div className="profile-edit-group">
                  <label htmlFor="profile-email">이메일</label>
                  <input
                    id="profile-email"
                    type="email"
                    value={memberEmailFromToken || ''}
                    disabled
                  />
                </div>
                <div className="profile-edit-group">
                  <label htmlFor="profile-name">이름 (닉네임)</label>
                  <input
                    id="profile-name"
                    type="text"
                    placeholder="이름 또는 닉네임 입력"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                  />
                </div>
                <div className="profile-edit-group">
                  <label htmlFor="profile-phone">연락처</label>
                  <input
                    id="profile-phone"
                    type="tel"
                    placeholder="연락처 입력 (예: 010-1234-5678)"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                  />
                </div>
                <div className="profile-edit-group">
                  <label htmlFor="profile-new-password">새 비밀번호</label>
                  <input
                    id="profile-new-password"
                    type="password"
                    placeholder="변경할 때만 입력 (8자 이상)"
                    value={profilePassword}
                    onChange={(e) => setProfilePassword(e.target.value)}
                  />
                </div>
                <div className="profile-edit-group">
                  <label htmlFor="profile-new-password-confirm">새 비밀번호 확인</label>
                  <input
                    id="profile-new-password-confirm"
                    type="password"
                    placeholder="새 비밀번호 다시 입력"
                    value={profilePasswordConfirm}
                    onChange={(e) => setProfilePasswordConfirm(e.target.value)}
                  />
                </div>
                <div className="profile-edit-actions profile-edit-group--full">
                  <button
                    type="submit"
                    className="btn-profile-save"
                    disabled={profileUpdateLoading}
                  >
                    {profileUpdateLoading ? '수정 중…' : '정보 수정'}
                  </button>
                </div>
              </form>
              {profileUpdateMsg && (
                <p className={`profile-update-msg ${profileUpdateStatus}`}>
                  {profileUpdateMsg}
                </p>
              )}
            </div>
          )}

          {activePage === 'mypage' && !sessionToken && (
            <div className="query-card">
              <DangbaeAccountTab
                getEventName={getEventName}
                onAction={onAction}
                sessionToken={sessionToken}
                accountMsg={accountMsg}
                onOAuthResult={(r) => {
                  if (r.ok && r.access_token) {
                    setSessionToken(r.access_token)
                    localStorage.setItem(DANGBAE_AUTH_TOKEN_KEY, r.access_token)
                    notifyDangbaeAuthChanged()
                  }
                }}
              />
            </div>
          )}

          {/* 내 배송 현황 조회 폼 */}
          {activePage === 'status' && !sessionToken && (
            <div className="query-card">
              <div className="query-row query-row-stack">
                <input
                  type="tel"
                  placeholder="연락처 (예: 010-1234-5678)"
                  value={myOrdersPhone}
                  onChange={(e) => setMyOrdersPhone(e.target.value)}
                />
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="비밀번호 6자리"
                  value={myOrdersPin}
                  onChange={(e) =>
                    setMyOrdersPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                />
                <button
                  type="button"
                  className="btn-query"
                  disabled={
                    !myOrdersPhone.trim() ||
                    myOrdersPin.replace(/\D/g, '').length !== 6 ||
                    myOrdersLoading
                  }
                  onClick={async () => {
                    if (!myOrdersPhone.trim() || !onAction) return
                    const pin = myOrdersPin.replace(/\D/g, '')
                    if (pin.length !== 6) return
                    setMyOrdersLoading(true)
                    setStatusQueryError(null)
                    setStatusLookupDone(false)
                    try {
                      await onAction(getEventName('onMyOrdersQuery'), {
                        user_phone: myOrdersPhone.trim(),
                        user_pin: pin,
                      })
                    } finally {
                      setMyOrdersLoading(false)
                    }
                  }}
                >
                  {myOrdersLoading ? '조회 중…' : '조회'}
                </button>
              </div>
            </div>
          )}

          {/* 내 배송 현황 + 로그인 시 로딩 표시 */}
          {activePage === 'status' && sessionToken && myOrdersLoading && (
            <p className="status-empty">배송 내역을 불러오는 중…</p>
          )}
          {activePage === 'status' && statusQueryError && <p className="status-query-error">{statusQueryError}</p>}
          {activePage === 'status' && orders.length === 0 && !statusQueryError && !statusLookupDone && !myOrdersLoading && (
            <p className="status-empty">
              {sessionToken
                ? '로그인 계정으로 신청한 배송 내역이 없거나 불러오는 중입니다.'
                : '연락처와 비밀번호를 입력한 뒤 조회해 주세요.'}
            </p>
          )}
          {activePage === 'status' && orders.length === 0 && !statusQueryError && statusLookupDone && (
            <p className="status-empty">
              {sessionToken
                ? '이 계정으로 신청한 배송 내역이 없습니다. 배송 신청 시 로그인된 상태여야 계정에 연결됩니다.'
                : '일치하는 배송이 없습니다. 연락처와 비밀번호를 확인해 주세요.'}
            </p>
          )}
          {activePage === 'status' && orders.length > 0 && (() => {
            const displayOrders = orders
            return (
              <>
                <ul className="status-list">
                  {displayOrders.map((o, i) => {
                    const st = o.status || 'pending'
                    const oidStr = String(o.order_id || o.id || i)
                    const isHi = highlightOrderId && String(highlightOrderId) === oidStr
                    const canDirectCancel = st === 'pending'
                    const canRequestCancel = st === 'assigned' || st === 'picked_up'
                    const needsPayment = st === 'payment_pending'
                    const label = USER_ORDER_STATUS_LABELS[st] || st
                    const refetch = () => {
                      if (myOrdersPhone.trim() && onAction) {
                        if (sessionToken) {
                          onAction(getEventName('onMyOrdersQuery'), {
                            user_phone: myOrdersPhone.trim(),
                            user_token: sessionToken,
                          })
                        } else {
                          const pin = myOrdersPin.replace(/\D/g, '')
                          if (pin.length === 6) {
                            onAction(getEventName('onMyOrdersQuery'), {
                              user_phone: myOrdersPhone.trim(),
                              user_pin: pin,
                            })
                          }
                        }
                      }
                    }
                    return (
                      <li
                        key={o.order_id || i}
                        className={`status-order-card${isHi ? ' status-order-card--highlight' : ''}`}
                      >
                        <div className="card-header">
                          <div className="card-header-titles">
                            <span className="card-id">주문 #{o.order_id}</span>
                            {(o.delivery_mode || o.want_express != null) && (
                              <span className="card-mode">
                                {o.delivery_mode === 'both' || (o.want_express && o.want_alttul)
                                  ? '알뜰+신속'
                                  : o.delivery_mode === 'express' || o.want_express
                                    ? '신속 1:1'
                                    : '알뜰'}
                              </span>
                            )}
                          </div>
                          <span className={`status-badge ${st}`}>{label}</span>
                        </div>
                        <div className="card-route">
                          <strong>출발</strong> {o.origin_address || o.origin_detail || '-'}
                        </div>
                        <div className="card-route">
                          <strong>도착</strong> {o.dest_address || o.dest_detail || '-'}
                        </div>
                        <div className="card-actions">
                          <button
                            type="button"
                            className="btn-status-detail"
                            onClick={() => setStatusDetailOrder(o)}
                          >
                            상세보기
                          </button>
                          {needsPayment && (
                            <button
                              type="button"
                              className="btn-status-pay"
                              onClick={() => {
                                writePendingPayment(
                                  buildResumePaymentPayload(o, lastEstimatedFareRef.current, myOrdersPhone)
                                )
                                window.location.hash = '#/payment'
                              }}
                            >
                              결제
                            </button>
                          )}
                          {canDirectCancel && (
                            <button
                              type="button"
                              className="btn-status-cancel"
                              onClick={() => {
                                if (!window.confirm('이 배송을 취소하시겠습니까?')) return
                                onAction(getEventName('onOrderUpdate'), { order_id: o.order_id, status: 'cancelled' })
                                refetch()
                              }}
                            >
                              취소
                            </button>
                          )}
                          {canRequestCancel && (
                            <button
                              type="button"
                              className="btn-status-cancel-request"
                              onClick={() => {
                                setCancelRequestTarget(o)
                                setCancelRequestReason('')
                              }}
                            >
                              취소 요청
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )
          })()}
        </div>
      )}

      {statusDetailOrder && (
        <div
          className="status-detail-overlay"
          onClick={() => setStatusDetailOrder(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-detail-title"
        >
          <div className="status-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="status-detail-head">
              <h2 id="status-detail-title">배송 상세 #{statusDetailOrder.order_id}</h2>
              <button
                type="button"
                className="status-detail-close"
                onClick={() => setStatusDetailOrder(null)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            {(statusDetailOrder.origin_lat != null && statusDetailOrder.origin_lng != null) ||
              (statusDetailOrder.dest_lat != null && statusDetailOrder.dest_lng != null) ? (
              <div className="status-detail-map">
                <DangbaeKakaoMap
                  appKey={mapAppKey}
                  origin={
                    statusDetailOrder.origin_lat != null && statusDetailOrder.origin_lng != null
                      ? {
                        lat: Number(statusDetailOrder.origin_lat),
                        lng: Number(statusDetailOrder.origin_lng),
                        address: statusDetailOrder.origin_address,
                      }
                      : null
                  }
                  dest={
                    statusDetailOrder.dest_lat != null && statusDetailOrder.dest_lng != null
                      ? {
                        lat: Number(statusDetailOrder.dest_lat),
                        lng: Number(statusDetailOrder.dest_lng),
                        address: statusDetailOrder.dest_address,
                      }
                      : null
                  }
                />
              </div>
            ) : null}
            {Array.isArray(statusDetailOrder.item_images) && statusDetailOrder.item_images.length > 0 && (
              <div className="status-detail-images">
                <h3>물품 사진</h3>
                <div className="status-detail-image-grid">
                  {statusDetailOrder.item_images.map((src, idx) => (
                    <a key={idx} href={orderItemImageSrc(src)} target="_blank" rel="noopener noreferrer">
                      <img src={orderItemImageSrc(src)} alt={`물품 ${idx + 1}`} />
                    </a>
                  ))}
                </div>
              </div>
            )}
            <dl className="status-detail-dl">
              <dt>상태</dt>
              <dd>{USER_ORDER_STATUS_LABELS[statusDetailOrder.status || 'pending'] || statusDetailOrder.status}</dd>
              <dt>출발</dt>
              <dd>{statusDetailOrder.origin_address || statusDetailOrder.origin_detail || '—'}</dd>
              <dt>도착</dt>
              <dd>{statusDetailOrder.dest_address || statusDetailOrder.dest_detail || '—'}</dd>
              <dt>신청</dt>
              <dd>{fmtStatusTime(statusDetailOrder.created_at)}</dd>
              <dt>결제</dt>
              <dd>{fmtStatusTime(statusDetailOrder.paid_at)}</dd>
              <dt>배정</dt>
              <dd>{fmtStatusTime(statusDetailOrder.assigned_at)}</dd>
              <dt>픽업</dt>
              <dd>{fmtStatusTime(statusDetailOrder.picked_up_at)}</dd>
              <dt>배송 완료</dt>
              <dd>{fmtStatusTime(statusDetailOrder.delivered_at)}</dd>
              <dt>취소 요청</dt>
              <dd>{fmtStatusTime(statusDetailOrder.cancel_requested_at)}</dd>
              <dt>취소 완료</dt>
              <dd>{fmtStatusTime(statusDetailOrder.cancelled_at)}</dd>
            </dl>
            <div className="status-detail-foot">
              {(statusDetailOrder.status || 'pending') === 'payment_pending' && (
                <button
                  type="button"
                  className="btn-query btn-status-pay"
                  onClick={() => {
                    writePendingPayment(
                      buildResumePaymentPayload(
                        statusDetailOrder,
                        lastEstimatedFareRef.current,
                        myOrdersPhone
                      )
                    )
                    setStatusDetailOrder(null)
                    window.location.hash = '#/payment'
                  }}
                >
                  결제
                </button>
              )}
              <button type="button" className="btn-query" onClick={() => setStatusDetailOrder(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelRequestTarget && (
        <div
          className="status-detail-overlay"
          onClick={() => setCancelRequestTarget(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="status-detail-modal status-detail-modal--narrow" onClick={(e) => e.stopPropagation()}>
            <div className="status-detail-head">
              <h2>취소 요청 #{cancelRequestTarget.order_id}</h2>
              <button
                type="button"
                className="status-detail-close"
                onClick={() => setCancelRequestTarget(null)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <p className="status-cancel-hint">배송 진행 중에는 사유를 남겨 취소 요청합니다. 관리자 승인 후 취소 완료됩니다.</p>
            <textarea
              className="status-cancel-reason"
              rows={4}
              placeholder="취소 사유를 입력해 주세요."
              value={cancelRequestReason}
              onChange={(e) => setCancelRequestReason(e.target.value)}
            />
            <div className="status-detail-foot">
              <button type="button" className="btn-query btn-query-secondary" onClick={() => setCancelRequestTarget(null)}>
                닫기
              </button>
              <button
                type="button"
                className="btn-query"
                onClick={() => {
                  if (!cancelRequestReason.trim()) {
                    window.alert('취소 사유를 입력해 주세요.')
                    return
                  }
                  onAction(getEventName('onOrderUpdate'), {
                    order_id: cancelRequestTarget.order_id,
                    status: 'cancel_requested',
                    cancel_reason: cancelRequestReason.trim(),
                  })
                  setCancelRequestTarget(null)
                  setCancelRequestReason('')
                  const pin = myOrdersPin.replace(/\D/g, '')
                  if (myOrdersPhone.trim() && pin.length === 6) {
                    onAction(getEventName('onMyOrdersQuery'), {
                      user_phone: myOrdersPhone.trim(),
                      user_pin: pin,
                    })
                  }
                }}
              >
                요청 보내기
              </button>
            </div>
          </div>
        </div>
      )}

      {activePage === 'payment' && (
        <DangbaePaymentPage
          getEventName={getEventName}
          onAction={onAction}
          estimatedFare={estimatedFare}
          userEmail={userEmail}
          accountMsg={accountMsg}
          lastPrepare={lastPrepare}
          onAppendLog={(text) => accountLogRef.current(text)}
          onGoToStatus={goToStatusAfterPayment}
          onBackToRequest={() => {
            window.location.hash = '#/request'
          }}
        />
      )}

      {activePage === 'driver' && (
        <div className="dangbae-driver">

          <div className="query-card">
            <div className="query-row query-row-stack">
              <input
                type="tel"
                placeholder="배송원 연락처"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
              />
              <input
                type="text"
                placeholder="배송원 이름 (선택)"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              />
              <button
                type="button"
                className="btn-query"
                disabled={driverLookupLoading || (!driverPhone.trim() && !driverName.trim())}
                onClick={queryDriverOrders}
              >
                {driverLookupLoading ? '조회 중…' : '내 배송건 조회'}
              </button>
            </div>
          </div>
          {driverLookupDone && (
            <section className="driver-summary-grid">
              <div className="driver-summary-card">
                <strong>{driverOrders.length}</strong>
                <span>전체 배송건</span>
              </div>
              <div className="driver-summary-card">
                <strong>{driverOrderStats.scheduled.length}</strong>
                <span>배송예정</span>
              </div>
              <div className="driver-summary-card">
                <strong>{driverOrderStats.inProgress.length}</strong>
                <span>진행중</span>
              </div>
              <div className="driver-summary-card">
                <strong>{driverOrderStats.completed.length}</strong>
                <span>배송완료</span>
              </div>
              <div className="driver-summary-card driver-summary-card--wide">
                <strong>{driverOrderStats.totalEarned.toLocaleString()}원</strong>
                <span>누적 적립 금액</span>
              </div>
            </section>
          )}
          {driverLookupDone && driverOrderStats.weeklyRows.length > 0 && (
            <section className="driver-weekly-card">
              <h3>주별/일자별 누적 비용</h3>
              <ul>
                {driverOrderStats.weeklyRows.map(([day, row]) => (
                  <li key={day}>
                    <span>{day}</span>
                    <span>{row.count}건</span>
                    <strong>{row.amount.toLocaleString()}원</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!driverLookupDone && (
            <p className="status-empty">연락처(또는 이름)를 입력한 뒤 배송건을 조회하세요.</p>
          )}
          {driverLookupDone && driverOrders.length === 0 && (
            <p className="status-empty">현재 배정된 배송건이 없습니다.</p>
          )}
          {driverOrders.length > 0 && (
            <div className="driver-orders-table-wrap">
              <table className="driver-orders-table">
                <thead>
                  <tr>
                    <th scope="col">주문</th>
                    <th scope="col">단계</th>
                    <th scope="col">상태</th>
                    <th scope="col">출발</th>
                    <th scope="col">도착</th>
                    <th scope="col">비용</th>
                    <th scope="col">예정</th>
                    <th scope="col">비고</th>
                    <th scope="col">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {driverOrders.map((o, i) => {
                    const st = o.status || 'pending'
                    const oid = o.order_id || o.id || i
                    const isAssignedToMe =
                      (driverPhone.trim() && String(o.driver_phone || '').trim() === driverPhone.trim()) ||
                      (driverName.trim() && String(o.driver_name || '').trim() === driverName.trim())
                    const stageLabel =
                      st === 'payment_pending'
                        ? '결제대기'
                        : st === 'pending'
                          ? '배송준비'
                          : st === 'assigned'
                            ? '픽업예정'
                            : st === 'picked_up'
                              ? '픽업완료'
                              : st === 'delivered'
                                ? '배송완료'
                                : st
                    return (
                      <tr key={oid}>
                        <td className="driver-orders-col-id">#{oid}</td>
                        <td className="driver-orders-col-stage">{stageLabel}</td>
                        <td>
                          <span className={`status-badge ${st}`}>
                            {st === 'payment_pending' && '결제대기'}
                            {st === 'pending' && '배송예정'}
                            {st === 'assigned' && '픽업예정'}
                            {st === 'picked_up' && '픽업완료'}
                            {st === 'delivered' && '배송완료'}
                            {!['payment_pending', 'pending', 'assigned', 'picked_up', 'delivered'].includes(st) && st}
                          </span>
                        </td>
                        <td className="driver-orders-col-addr">{o.origin_address || '—'}</td>
                        <td className="driver-orders-col-addr">{o.dest_address || '—'}</td>
                        <td className="driver-orders-col-amt">
                          {driverOrderStats.toAmount(o).toLocaleString()}원
                        </td>
                        <td className="driver-orders-col-meta">{o.pickup_eta || '—'}</td>
                        <td className="driver-orders-col-meta">{o.driver_note || '—'}</td>
                        <td className="driver-orders-col-actions">
                          <div className="driver-action-row">
                            {st === 'pending' && !isAssignedToMe && (
                              <>
                                <button
                                  type="button"
                                  className="btn-sm btn-primary"
                                  onClick={() => {
                                    setAcceptEta('')
                                    setAcceptNote('')
                                    setDriverConfirm({ type: 'accept', order: o })
                                  }}
                                >
                                  수락
                                </button>
                                <button
                                  type="button"
                                  className="btn-sm btn-danger"
                                  onClick={() => setDriverConfirm({ type: 'reject', order: o })}
                                >
                                  거절
                                </button>
                              </>
                            )}
                            {(st === 'assigned' || st === 'picked_up') && isAssignedToMe && (
                              <>
                                {st === 'assigned' && (
                                  <button
                                    type="button"
                                    className="btn-sm"
                                    onClick={() => setDriverConfirm({ type: 'pickup', order: o })}
                                  >
                                    픽업
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn-sm btn-success"
                                  onClick={() => setDriverConfirm({ type: 'delivered', order: o })}
                                >
                                  배송완료
                                </button>
                              </>
                            )}
                            {isAssignedToMe && st !== 'delivered' && (
                              <span className="driver-parallel-hint">병렬 진행 가능</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {driverLookupDone && driverOrderStats.completed.length > 0 && (
            <section className="driver-payout-card">
              <h3>적립금 지급 신청</h3>
              <p>배송완료 건을 선택하면 지급 신청 금액이 자동 집계됩니다.</p>
              <div className="driver-payout-table-wrap">
                <table className="driver-payout-table">
                  <thead>
                    <tr>
                      <th scope="col" className="driver-payout-col-check">
                        <input
                          type="checkbox"
                          aria-label="전체 선택"
                          checked={allPayoutSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = somePayoutSelected && !allPayoutSelected
                          }}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPayoutOrderIds([...payoutSelectableIds])
                            } else {
                              setPayoutOrderIds([])
                            }
                          }}
                        />
                      </th>
                      <th scope="col">주문번호</th>
                      <th scope="col">적립금액</th>
                      <th scope="col">배송완료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverOrderStats.completed.map((o) => {
                      const oid = String(o.order_id || o.id)
                      const checked = payoutOrderIds.includes(oid)
                      return (
                        <tr key={oid}>
                          <td className="driver-payout-col-check">
                            <input
                              type="checkbox"
                              checked={checked}
                              aria-label={`주문 ${oid} 선택`}
                              onChange={(e) =>
                                setPayoutOrderIds((prev) =>
                                  e.target.checked
                                    ? Array.from(new Set([...prev, oid]))
                                    : prev.filter((id) => id !== oid)
                                )
                              }
                            />
                          </td>
                          <td>#{oid}</td>
                          <td className="driver-payout-amt">
                            <strong>{driverOrderStats.toAmount(o).toLocaleString()}원</strong>
                          </td>
                          <td className="driver-payout-date">{fmtStatusTime(o.delivered_at || o.updated_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <textarea
                className="driver-payout-memo"
                rows={3}
                placeholder="지급 요청 메모 (계좌, 요청사항 등)"
                value={payoutMemo}
                onChange={(e) => setPayoutMemo(e.target.value)}
              />
              <div className="driver-payout-actions">
                <span>신청 금액: <strong>{payoutAmount.toLocaleString()}원</strong></span>
                <button
                  type="button"
                  className="btn-sm btn-primary"
                  disabled={payoutOrderIds.length === 0}
                  onClick={() => {
                    const payload = {
                      driver_name: driverName || undefined,
                      driver_phone: driverPhone || undefined,
                      order_ids: payoutOrderIds,
                      amount: payoutAmount,
                      memo: payoutMemo || undefined,
                    }
                    onAction?.(getEventName('onDriverPayoutRequest'), payload)
                    accountLogRef.current(`지급 신청 접수: ${payoutAmount.toLocaleString()}원 (${payoutOrderIds.length}건)`)
                    setPayoutOrderIds([])
                    setPayoutMemo('')
                  }}
                >
                  지급 신청
                </button>
              </div>
            </section>
          )}
        </div>
      )}

      {activePage === 'login' && (
        <DangbaeAccountTab
          standalone
          getEventName={getEventName}
          onAction={onAction}
          sessionToken={sessionToken}
          accountMsg={accountMsg}
          onOAuthResult={(r) => {
            if (r.ok && r.access_token) {
              setSessionToken(r.access_token)
              localStorage.setItem(DANGBAE_AUTH_TOKEN_KEY, r.access_token)
              notifyDangbaeAuthChanged()
              accountLogRef.current('간편 로그인에 성공했습니다.')
            } else if (r.error) {
              accountLogRef.current(r.error)
            }
          }}
        />
      )}

      {phonePromptModalOpen && (
        <div className="dangbae-modal-overlay" role="presentation" onClick={() => setPhonePromptModalOpen(false)}>
          <div
            className="dangbae-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="phone-prompt-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="phone-prompt-modal-title" className="dangbae-modal-title">연락처 등록</h2>
            <p className="dangbae-modal-desc">배송 신청을 위해 연락처를 입력해 주세요. 회원 정보에 자동으로 업데이트됩니다.</p>
            <div className="apply-modal-form">
              <label>
                연락처
                <input
                  type="tel"
                  value={promptPhone}
                  onChange={(e) => setPromptPhone(e.target.value)}
                  placeholder="예: 010-1234-5678"
                  autoFocus
                />
              </label>
            </div>
            <div className="item-camera-modal-actions">
              <button type="button" className="dangbae-modal-btn dangbae-modal-btn-secondary" onClick={() => setPhonePromptModalOpen(false)}>
                취소
              </button>
              <button
                type="button"
                className="dangbae-modal-btn"
                disabled={!promptPhone.trim()}
                onClick={() => {
                  const cleanedPhone = promptPhone.trim()
                  setProfilePhone(cleanedPhone)
                  updateProfilePhoneOnly(cleanedPhone)
                  const emailFromToken = getEmailFromAccessToken(sessionToken) || userEmail
                  submitDeliveryRequest({
                    phoneOverride: cleanedPhone,
                    emailOverride: emailFromToken
                  })
                  setPhonePromptModalOpen(false)
                }}
              >
                등록 후 신청
              </button>
            </div>
          </div>
        </div>
      )}

      {guestApplyModalOpen && (
        <div className="dangbae-modal-overlay" role="presentation" onClick={() => setGuestApplyModalOpen(false)}>
          <div
            className="dangbae-modal dangbae-apply-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guest-apply-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="guest-apply-modal-title" className="dangbae-modal-title">비회원 신청 정보 입력</h2>
            <p className="dangbae-modal-desc">연락처와 조회 비밀번호(6자리)를 입력하면 비회원으로 신청됩니다.</p>
            <div className="apply-modal-form">
              <label>
                연락처
                <input
                  type="tel"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="예: 010-1234-5678"
                />
              </label>
              <label>
                조회 비밀번호 (숫자 6자리)
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={guestPin}
                  onChange={(e) => setGuestPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6자리 숫자"
                />
              </label>
            </div>
            <div className="item-camera-modal-actions">
              <button type="button" className="dangbae-modal-btn dangbae-modal-btn-secondary" onClick={() => setGuestApplyModalOpen(false)}>
                취소
              </button>
              <button
                type="button"
                className="dangbae-modal-btn"
                disabled={!guestPhone.trim() || guestPin.length !== 6}
                onClick={() => {
                  setUserPhone(guestPhone.trim())
                  setOrderAccessPin(guestPin)
                  submitDeliveryRequest({ phoneOverride: guestPhone.trim(), pinOverride: guestPin })
                  setGuestApplyModalOpen(false)
                }}
              >
                확인 후 신청
              </button>
            </div>
          </div>
        </div>
      )}

      {memberApplyModalOpen && (
        <div className="dangbae-modal-overlay" role="presentation" onClick={() => setMemberApplyModalOpen(false)}>
          <div
            className="dangbae-modal dangbae-apply-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="member-apply-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="member-apply-modal-title" className="dangbae-modal-title">회원 신청</h2>
            <p className="dangbae-modal-desc">로그인 후 배송 신청을 진행합니다.</p>
            <div className="apply-modal-form apply-modal-form--auth">
              <DangbaeAuthPanel
                email={memberEmail}
                password={memberPassword}
                authMode={memberAuthMode}
                onEmailChange={setMemberEmail}
                onPasswordChange={setMemberPassword}
                onAuthModeChange={setMemberAuthMode}
                onSignIn={handleMemberModalSignIn}
                onSignUp={handleMemberModalSignUp}
                onPickProvider={handleMemberOAuthPick}
                authBusy={memberAuthLoading}
                loginSubmitLabel={memberAuthLoading ? '처리 중…' : '로그인 후 신청'}
                signupSubmitLabel={memberAuthLoading ? '처리 중…' : '회원가입 후 신청'}
              />
            </div>
            <div className="item-camera-modal-actions">
              <button type="button" className="dangbae-modal-btn dangbae-modal-btn-secondary" onClick={() => setMemberApplyModalOpen(false)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {itemEditorOpen && (
        <div
          className="dangbae-modal-overlay item-editor-overlay"
          role="presentation"
          onClick={() => closeItemEditor()}
        >
          <div
            className="dangbae-modal dangbae-modal-item-editor item-editor-v2"
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-editor-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div className="ied-header">
              <h2 id="item-editor-modal-title" className="ied-title">
                📦 물품 {itemEditorEditIndex != null ? '편집' : '추가'}
              </h2>
              <button
                type="button"
                className="ied-close-btn"
                aria-label="닫기"
                onClick={closeItemEditor}
              >
                ×
              </button>
            </div>

            {/* 사진 섹션 */}
            <div className="ied-photo-section">
              <div className="ied-photo-header">
                <span className="ied-section-label">📷 사진</span>
                <div className="ied-photo-btns">
                  <button
                    type="button"
                    className="ied-photo-btn ied-photo-btn--gallery"
                    onClick={() => itemEditorGalleryInputRef.current?.click()}
                    disabled={itemEditorImageBusy}
                    title="갤러리에서 여러 장 선택"
                  >
                    🖼 갤러리
                  </button>
                  <button
                    type="button"
                    className="ied-photo-btn ied-photo-btn--camera"
                    onClick={() => itemEditorCameraInputRef.current?.click()}
                    disabled={itemEditorImageBusy}
                    title="카메라 촬영"
                  >
                    📸 촬영
                  </button>
                </div>
              </div>

              <input
                ref={itemEditorGalleryInputRef}
                type="file"
                accept="image/*"
                multiple
                className="visually-hidden-file"
                onChange={handleEditorGalleryUpload}
              />
              <input
                ref={itemEditorCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden-file"
                onChange={handleEditorGalleryUpload}
              />

              {/* 사진 썸네일 그리드 */}
              <div className="ied-thumbs-grid">
                {(itemEditorDraft.images || []).map((src, i) => (
                  <div key={i} className="ied-thumb-item">
                    <button
                      type="button"
                      className="ied-thumb-btn"
                      onClick={() => setImageLightboxSrc(src)}
                      aria-label={`사진 ${i + 1} 확대`}
                    >
                      <img src={src} alt={`물품 사진 ${i + 1}`} />
                    </button>
                    <button
                      type="button"
                      className="ied-thumb-remove"
                      onClick={() => removeEditorImage(i)}
                      aria-label="사진 삭제"
                    >×</button>
                  </div>
                ))}
                {/* + 추가 버튼 */}
                <button
                  type="button"
                  className="ied-thumb-add"
                  onClick={() => itemEditorGalleryInputRef.current?.click()}
                  disabled={itemEditorImageBusy}
                  aria-label="사진 추가"
                >
                  <span className="ied-thumb-add__plus">+</span>
                  <span className="ied-thumb-add__label">사진 추가</span>
                </button>
              </div>

              {itemEditorImageBusy && (
                <div className="ied-vlm-status">
                  <span className="ied-vlm-spinner" aria-hidden="true">⟳</span>
                  VLM이 사진을 분석 중입니다…
                </div>
              )}
            </div>

            {/* 물품 정보 폼 */}
            <div className="ied-fields">
              {/* 물품명 + 자동입력 */}
              <div className="ied-field-row ied-name-row">
                <label className="ied-field-label" htmlFor="ied-name">물품명 <span className="ied-required">*</span></label>
                <div className="ied-name-input-wrap">
                  <input
                    id="ied-name"
                    type="text"
                    className="ied-input"
                    value={itemEditorDraft.name}
                    onChange={(e) => setItemEditorDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="예: 이사 박스, 냉장고, 소파"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="ied-auto-btn"
                    onClick={estimateEditorItemFromAi}
                    disabled={itemEditorAiBusy || !String(itemEditorDraft.name || '').trim()}
                    title="물품명으로 크기·무게·주의사항 자동 입력"
                  >
                    {itemEditorAiBusy ? (
                      <><span className="ied-auto-spinner">⟳</span> 분석 중…</>
                    ) : (
                      <>✨ 자동입력</>
                    )}
                  </button>
                </div>
              </div>

              {/* 크기 · 무게 · 갯수 */}
              <div className="ied-row-3col">
                <div className="ied-field-group">
                  <label className="ied-field-label" htmlFor="ied-size">크기</label>
                  <select
                    id="ied-size"
                    className="ied-select"
                    value={itemEditorDraft.size || 'medium'}
                    onChange={(e) => setItemEditorDraft((d) => ({ ...d, size: e.target.value }))}
                  >
                    <option value="small">소형 (박스·소형가전)</option>
                    <option value="medium">중형 (세탁기·소파)</option>
                    <option value="large">대형 (냉장고·피아노)</option>
                  </select>
                </div>
                <div className="ied-field-group">
                  <label className="ied-field-label" htmlFor="ied-weight">무게 (kg)</label>
                  <input
                    id="ied-weight"
                    type="number"
                    className="ied-input"
                    min="0"
                    step="0.5"
                    value={itemEditorDraft.weight ?? 0}
                    onChange={(e) =>
                      setItemEditorDraft((d) => ({ ...d, weight: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div className="ied-field-group">
                  <label className="ied-field-label" htmlFor="ied-qty">갯수</label>
                  <input
                    id="ied-qty"
                    type="number"
                    className="ied-input"
                    min="1"
                    max="999"
                    step="1"
                    value={itemEditorDraft.qty ?? 1}
                    onChange={(e) =>
                      setItemEditorDraft((d) => ({ ...d, qty: Math.max(1, parseInt(e.target.value) || 1) }))
                    }
                  />
                </div>
              </div>

              {/* 비고 */}
              <div className="ied-field-group ied-note-group">
                <label className="ied-field-label" htmlFor="ied-note">비고 (주의사항)</label>
                <textarea
                  id="ied-note"
                  className="ied-textarea"
                  rows={3}
                  value={itemEditorDraft.note}
                  onChange={(e) => setItemEditorDraft((d) => ({ ...d, note: e.target.value }))}
                  placeholder="취급 주의, 깨지기 쉬운 물건, 특이사항 등"
                />
              </div>
            </div>

            {/* 하단 액션 */}
            <div className="ied-footer">
              <button
                type="button"
                className="ied-btn ied-btn--cancel"
                onClick={closeItemEditor}
              >
                취소
              </button>
              <button
                type="button"
                className="ied-btn ied-btn--save"
                disabled={!String(itemEditorDraft.name || '').trim()}
                onClick={saveItemEditor}
              >
                {itemEditorEditIndex != null ? '✓ 수정 완료' : '✓ 물품 추가'}
              </button>
            </div>
          </div>
        </div>
      )}

      {imageLightboxSrc && (
        <div
          className="dangbae-lightbox"
          role="presentation"
          onClick={() => setImageLightboxSrc(null)}
        >
          <button
            type="button"
            className="dangbae-lightbox-close"
            aria-label="닫기"
            onClick={(e) => {
              e.stopPropagation()
              setImageLightboxSrc(null)
            }}
          >
            ×
          </button>
          <img src={imageLightboxSrc} alt="확대 보기" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {alttulDetailModalOpen && (
        <div
          className="dangbae-modal-overlay"
          role="presentation"
          onClick={() => setAlttulDetailModalOpen(false)}
        >
          <div
            className="dangbae-modal dangbae-modal-alttul-info"
            role="dialog"
            aria-modal="true"
            aria-labelledby="alttul-info-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="alttul-info-modal-title" className="dangbae-modal-title">
              알뜰배송 안내
            </h2>
            <ul className="alttul-info-modal-list">
              <li>
                알뜰배송은 여러건의 배송을 일괄하여 순차적 배송을 통해 배송비를 절감하는 방법 입니다.
              </li>
              <li>일반적으로 배송경로 설정을 통해 1~2일의 시간이 소요됩니다.</li>
              <li>알뜰배송을 신청하시면 배송기사와 일정을 배정하여 알려드립니다.</li>
            </ul>
            <button
              type="button"
              className="dangbae-modal-btn dangbae-modal-btn-secondary"
              onClick={() => setAlttulDetailModalOpen(false)}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {driverConfirm && (
        <div className="dangbae-modal-overlay" role="presentation" onClick={() => setDriverConfirm(null)}>
          <div
            className="dangbae-modal dangbae-driver-confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="dangbae-modal-title">
              {driverConfirm.type === 'accept' && '배송건 수락'}
              {driverConfirm.type === 'reject' && '배송건 거절'}
              {driverConfirm.type === 'pickup' && '픽업 처리'}
              {driverConfirm.type === 'delivered' && '배송완료 처리'}
            </h2>
            {driverConfirm.type === 'accept' ? (
              <div className="driver-confirm-form">
                <label>
                  예정일시
                  <input type="datetime-local" value={acceptEta} onChange={(e) => setAcceptEta(e.target.value)} />
                </label>
                <label>
                  비고사항
                  <textarea value={acceptNote} onChange={(e) => setAcceptNote(e.target.value)} rows={3} />
                </label>
              </div>
            ) : (
              <p className="driver-confirm-text">주문 #{driverConfirm.order?.order_id || driverConfirm.order?.id} 처리하시겠습니까?</p>
            )}
            <div className="driver-confirm-actions">
              <button type="button" className="dangbae-modal-btn dangbae-modal-btn-secondary" onClick={() => setDriverConfirm(null)}>
                취소
              </button>
              <button
                type="button"
                className="dangbae-modal-btn"
                onClick={() => {
                  const order = driverConfirm.order
                  if (!order) return
                  if (driverConfirm.type === 'accept') {
                    updateDriverOrder(order, 'assigned', {
                      driver_name: driverName || order.driver_name || undefined,
                      driver_phone: driverPhone || order.driver_phone || undefined,
                      pickup_eta: acceptEta || undefined,
                      driver_note: acceptNote || undefined,
                    })
                  } else if (driverConfirm.type === 'reject') {
                    updateDriverOrder(order, 'pending', {
                      rejected_by_driver: driverName || driverPhone || 'driver',
                    })
                  } else if (driverConfirm.type === 'pickup') {
                    updateDriverOrder(order, 'picked_up')
                  } else if (driverConfirm.type === 'delivered') {
                    updateDriverOrder(order, 'delivered')
                  }
                  setDriverConfirm(null)
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DangbaeWidget
