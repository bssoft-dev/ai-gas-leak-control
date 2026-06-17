import React, { useEffect, useState } from 'react'
import AuthPaymentWidget from './components/AuthPaymentWidget'
import { getOrCreateSseClientId } from './sseClientId'
import './App.css'

function App() {
  const [interfaceDef, setInterfaceDef] = useState(null)
  const [serviceInfo, setServiceInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [serviceRes, interfacesRes] = await Promise.all([
          fetch('/api/service'),
          fetch('/api/interfaces'),
        ])
        if (!serviceRes.ok || !interfacesRes.ok) throw new Error('서비스 정보를 불러오지 못했습니다.')
        const service = await serviceRes.json()
        const interfaces = await interfacesRes.json()
        setServiceInfo(service)
        setInterfaceDef(interfaces[0] || null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

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
      <div className="app-loading">
        <p>로딩 중…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="app-error">
        <p>{error}</p>
      </div>
    )
  }
  if (!interfaceDef) {
    return (
      <div className="app-error">
        <p>인터페이스 정의가 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="app-wrap">
      <AuthPaymentWidget
        serviceName={serviceInfo?.name || '인증·결제'}
        events={interfaceDef.events || {}}
        onAction={handleEvent}
      />
    </div>
  )
}

export default App
