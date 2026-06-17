import React, { useEffect, useRef, useCallback } from 'react'

function loadKakaoMapScript(appKey) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('no window'))
      return
    }
    if (window.kakao?.maps) {
      resolve()
      return
    }
    const id = 'kakao-maps-sdk-dangbae'
    if (document.getElementById(id)) {
      const t = setInterval(() => {
        if (window.kakao?.maps) {
          clearInterval(t)
          resolve()
        }
      }, 50)
      setTimeout(() => {
        clearInterval(t)
        if (!window.kakao?.maps) reject(new Error('timeout'))
      }, 15000)
      return
    }
    const script = document.createElement('script')
    script.id = id
    script.async = true
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=${encodeURIComponent(appKey)}`
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('script load failed'))
    document.head.appendChild(script)
  })
}

/**
 * 출발지·목적지 마커 표시 (카카오맵 JavaScript 키 필요)
 * stops: [{ lat, lng }] 순서대로 마커·폴리라인 (묶음 루트 등). 있으면 origin/dest 대신 우선.
 */
export default function DangbaeKakaoMap({ appKey, origin, dest, routePath, stops }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const polylineRef = useRef(null)
  const originRef = useRef(origin)
  const destRef = useRef(dest)
  const routePathRef = useRef(routePath)
  const stopsRef = useRef(stops)
  originRef.current = origin
  destRef.current = dest
  routePathRef.current = routePath
  stopsRef.current = stops

  const redraw = useCallback(() => {
    const kakao = window.kakao
    if (!kakao?.maps || !mapRef.current || !containerRef.current) return

    const o = originRef.current
    const d = destRef.current
    const rp = routePathRef.current
    const st = stopsRef.current

    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current = []
    if (polylineRef.current) {
      polylineRef.current.setMap(null)
      polylineRef.current = null
    }

    const bounds = new kakao.maps.LatLngBounds()
    let has = false

    const stopList = Array.isArray(st) ? st : []
    const validStops = stopList
      .map((p) => {
        const lat = Number(p?.lat)
        const lng = Number(p?.lng)
        if (Number.isNaN(lat) || Number.isNaN(lng)) return null
        return { lat, lng }
      })
      .filter(Boolean)

    if (validStops.length > 0) {
      validStops.forEach((p) => {
        const pos = new kakao.maps.LatLng(p.lat, p.lng)
        const m = new kakao.maps.Marker({ position: pos, map: mapRef.current })
        markersRef.current.push(m)
        bounds.extend(pos)
        has = true
      })
      if (validStops.length >= 2) {
        const linePoints = validStops.map((p) => new kakao.maps.LatLng(p.lat, p.lng))
        const poly = new kakao.maps.Polyline({
          path: linePoints,
          strokeWeight: 5,
          strokeColor: '#2d6cdf',
          strokeOpacity: 0.92,
          strokeStyle: 'solid',
        })
        poly.setMap(mapRef.current)
        polylineRef.current = poly
        linePoints.forEach((p) => bounds.extend(p))
      }
    } else {
      if (o?.lat != null && o?.lng != null) {
        const pos = new kakao.maps.LatLng(o.lat, o.lng)
        const m = new kakao.maps.Marker({ position: pos, map: mapRef.current })
        markersRef.current.push(m)
        bounds.extend(pos)
        has = true
      }
      if (d?.lat != null && d?.lng != null) {
        const pos = new kakao.maps.LatLng(d.lat, d.lng)
        const m = new kakao.maps.Marker({
          position: pos,
          map: mapRef.current,
        })
        markersRef.current.push(m)
        bounds.extend(pos)
        has = true
      }

      /** 이동 경로: 서버 도로 좌표 또는 출발·도착 직선 */
      let linePoints = []
      if (Array.isArray(rp) && rp.length >= 2) {
        linePoints = rp
          .map((pair) => {
            if (!Array.isArray(pair) || pair.length < 2) return null
            const lat = Number(pair[0])
            const lng = Number(pair[1])
            if (Number.isNaN(lat) || Number.isNaN(lng)) return null
            return new kakao.maps.LatLng(lat, lng)
          })
          .filter(Boolean)
      }
      if (linePoints.length < 2 && o?.lat != null && o?.lng != null && d?.lat != null && d?.lng != null) {
        linePoints = [
          new kakao.maps.LatLng(o.lat, o.lng),
          new kakao.maps.LatLng(d.lat, d.lng),
        ]
      }
      if (linePoints.length >= 2) {
        const poly = new kakao.maps.Polyline({
          path: linePoints,
          strokeWeight: 5,
          strokeColor: '#ff6b35',
          strokeOpacity: 0.92,
          strokeStyle: 'solid',
        })
        poly.setMap(mapRef.current)
        polylineRef.current = poly
        linePoints.forEach((p) => bounds.extend(p))
        has = true
      }
    }

    if (has) {
      mapRef.current.setBounds(bounds)
    } else {
      mapRef.current.setCenter(new kakao.maps.LatLng(37.5665, 126.978))
      mapRef.current.setLevel(6)
    }
  }, [])

  useEffect(() => {
    if (!appKey?.trim() || !containerRef.current) return undefined

    let cancelled = false
    ;(async () => {
      try {
        await loadKakaoMapScript(appKey.trim())
        if (cancelled || !containerRef.current) return
        window.kakao.maps.load(() => {
          if (cancelled || !containerRef.current) return
          const o0 = originRef.current
          const center =
            o0?.lat != null && o0?.lng != null
              ? new window.kakao.maps.LatLng(o0.lat, o0.lng)
              : new window.kakao.maps.LatLng(37.5665, 126.978)
          mapRef.current = new window.kakao.maps.Map(containerRef.current, {
            center,
            level: 5,
          })
          redraw()
        })
      } catch (e) {
        console.warn('[DangbaeKakaoMap]', e)
      }
    })()

    return () => {
      cancelled = true
      markersRef.current.forEach((m) => m.setMap(null))
      markersRef.current = []
      if (polylineRef.current) {
        polylineRef.current.setMap(null)
        polylineRef.current = null
      }
      mapRef.current = null
    }
  }, [appKey])

  useEffect(() => {
    redraw()
  }, [origin, dest, routePath, stops, redraw])

  if (!appKey?.trim()) {
    return (
      <div className="kakao-map-container kakao-map-placeholder">
        <p>카카오맵 앱 키가 설정되면 이 영역에 지도가 표시됩니다.</p>
        <p className="map-placeholder-hint">서비스 설정의「카카오맵 JavaScript 앱 키」를 입력하세요.</p>
      </div>
    )
  }

  return (
    <div className="kakao-map-container" ref={containerRef} role="presentation" aria-label="배송 경로 지도" />
  )
}
