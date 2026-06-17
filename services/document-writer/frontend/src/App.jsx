import React, { useCallback, useEffect, useState } from 'react'
import SayuWidget from './components/SayuWidget'
import { getOrCreateSseClientId } from './sseClientId'

function App() {
  const [interfaceDef, setInterfaceDef] = useState(null)
  const [serviceInfo, setServiceInfo] = useState(null)
  const [config, setConfig] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [retryKey, setRetryKey] = useState(0)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [serviceRes, interfacesRes, configRes] = await Promise.all([
        fetch('/api/service'),
        fetch('/api/interfaces'),
        fetch('/api/config'),
      ])
      if (!serviceRes.ok || !interfacesRes.ok) throw new Error('서비스 정보를 불러오지 못했습니다.')
      const service = await serviceRes.json()
      const interfaces = await interfacesRes.json()
      setServiceInfo(service)
      setInterfaceDef(interfaces[0] || null)
      if (configRes.ok) {
        const c = await configRes.json()
        setConfig(c && typeof c === 'object' ? c : {})
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, retryKey])

  const handleEvent = async (eventName, payload) => {
    if (!interfaceDef?.events) return
    const eventType = interfaceDef.events[eventName] || eventName
    if (!eventType) return
    const sseCid = getOrCreateSseClientId()
    const body = { type: eventType, payload: payload || {} }
    if (sseCid) body.sse_client_ids = [sseCid]
    await fetch('/api/events/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  if (loading) {
    return (
      <div className="app-shell app-shell--loading" role="status" aria-live="polite" aria-busy="true">
        <div className="app-shell__inner">
          <div className="app-shell__logo" aria-hidden>
            Sa-Yu
          </div>
          <div className="app-shell__spinner" aria-hidden />
          <p className="app-shell__title">문서 작업 환경을 준비하는 중입니다</p>
          <p className="app-shell__sub">서비스·인터페이스 정의를 불러옵니다</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="app-shell app-shell--error" role="alert">
        <div className="app-shell__inner">
          <p className="app-shell__title">시작할 수 없습니다</p>
          <p className="app-shell__error-msg">{error}</p>
          <button
            type="button"
            className="sayu-btn"
            onClick={() => {
              setRetryKey((k) => k + 1)
            }}
          >
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  if (!interfaceDef) {
    return (
      <div className="app-shell app-shell--error" role="alert">
        <div className="app-shell__inner">
          <p className="app-shell__title">인터페이스 정의가 없습니다</p>
          <p className="app-shell__sub">서비스 설정과 `service.yaml`의 interfaces 항목을 확인하세요.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-sayu-root" style={{ height: '100%' }}>
      <SayuWidget
        serviceName={serviceInfo?.name || 'Sa-Yu'}
        defaultModel={config?.default_model}
        events={interfaceDef.events || {}}
        onAction={handleEvent}
      />
    </div>
  )
}

export default App
