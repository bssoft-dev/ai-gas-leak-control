import React, { useEffect, useState } from 'react'
import SagoNoteWidget from './components/SagoNoteWidget'
import './App.css'

function App() {
  const [interfaceDef, setInterfaceDef] = useState(null)
  const [serviceInfo, setServiceInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    // 서비스 정보 및 인터페이스 정의 가져오기
    const loadData = async () => {
      console.log('loadData')
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
        setInterfaceDef(interfaces[0] || null) // 첫 번째 인터페이스 사용
        console.log('interfaces:', interfaces)
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: eventType,
          payload: payload,
        }),
      })
    } catch (err) {
      console.error('Failed to publish event:', err)
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>{serviceInfo?.name || 'Sago-Note'}</h1>
        <p className="app-description">{interfaceDef.description}</p>
      </header>
      <main className="app-main">
        <SagoNoteWidget
          {...interfaceDef.props}
          onAction={handleEvent}
          events={interfaceDef.events}
        />
      </main>
    </div>
  )
}

export default App
