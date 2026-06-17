import React, { useEffect, useState } from 'react'
import QrDrawingManagerWidget from './components/QrDrawingManagerWidget'
import { pwaFetchJson } from './pwa/api'
import './App.css'

function App() {
  const [sseClientId] = useState(() => {
    const key = 'sagohub_sse_client_id'
    try {
      const existing = sessionStorage.getItem(key)
      if (existing) return existing
      const v =
        (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
        `sid_${Date.now()}_${Math.random().toString(16).slice(2)}`
      sessionStorage.setItem(key, v)
      return v
    } catch (_) {
      return `sid_${Date.now()}_${Math.random().toString(16).slice(2)}`
    }
  })

  const [interfaceDef, setInterfaceDef] = useState(null)
  const [serviceInfo, setServiceInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [offlineDataMode, setOfflineDataMode] = useState(false)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [{ data: service, fromCache: serviceFromCache }, { data: interfaces, fromCache: interfacesFromCache }] = await Promise.all([
          pwaFetchJson('/api/service'),
          pwaFetchJson('/api/interfaces'),
        ])
        setOfflineDataMode(Boolean(serviceFromCache || interfacesFromCache))
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

  const handleEvent = async (eventName, payload) => {
    if (!interfaceDef?.events) return
    const eventType = interfaceDef.events[eventName]
    if (!eventType) return
    try {
      await fetch('/api/events/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: eventType,
          payload: payload || {},
          // 같은 브라우저 세션에서 발생한 이벤트만 SSE로 받기 위함
          sse_client_ids: [sseClientId],
        }),
      })
    } catch (err) {
      console.error('Failed to publish event:', err)
    }
  }

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>로딩 중...</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="app-error">
        <h2>오류</h2>
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

  return (
    <div className="app">
      {offlineDataMode && (
        <div className="app-offline-banner">오프라인 모드: 최근 동기화된 로컬 데이터를 표시 중입니다.</div>
      )}
      <main className="app-main">
        <QrDrawingManagerWidget onAction={handleEvent} events={interfaceDef.events} />
      </main>
    </div>
  )
}

export default App
