import React, { useState, useEffect, useRef } from 'react'
import './ThinkingOSWidget.css'

function ThinkingOSWidget({ 
  target_folder = '~/obsidian',
  watch_pattern = '**/*.md',
  onAction,
  events: eventConfig
}) {
  const [config, setConfig] = useState({
    target_folder,
    watch_pattern
  })
  const [isWatching, setIsWatching] = useState(false)
  const [events, setEvents] = useState([])
  const [stats, setStats] = useState({
    originalFiles: 0,
    supplementFiles: 0,
    requestsExtracted: 0,
    supplementsCreated: 0,
    questionsAnswered: 0,
    applied: 0,
    deleted: 0
  })
  const eventSourceRef = useRef(null)

  // SSE 이벤트 수신
  useEffect(() => {
    const subscribeTypes = eventConfig?.subscribe || []
    if (!Array.isArray(subscribeTypes) || subscribeTypes.length === 0) return

    const eventSource = new EventSource('/api/events/stream')
    eventSourceRef.current = eventSource

    eventSource.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        const eventType = ev.type
        if (!eventType || !subscribeTypes.includes(eventType)) return
        
        const payload = ev.payload || {}
        const newEvent = {
          type: eventType,
          path: payload.path || payload.original_path || payload.supplement_path || '-',
          time: ev.timestamp || new Date().toISOString(),
          payload: payload
        }
        
        setEvents(prev => [newEvent, ...prev].slice(0, 100))
        
        // 통계 업데이트
        updateStats(eventType, payload)
      } catch (err) {
        console.error('Failed to parse SSE event:', err)
      }
    }

    eventSource.onerror = () => {
      eventSource.close()
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [eventConfig?.subscribe])

  const updateStats = (eventType, payload) => {
    setStats(prev => {
      const newStats = { ...prev }
      switch (eventType) {
        case 'E_OriginalFileDetected':
          newStats.originalFiles++
          break
        case 'E_SupplementFileDetected':
          newStats.supplementFiles++
          break
        case 'E_RequestExtracted':
          newStats.requestsExtracted += (payload.requests?.length || 0)
          break
        case 'E_SupplementFileCreated':
          newStats.supplementsCreated += (payload.created_files?.length || 0)
          break
        case 'E_QuestionAnswered':
          newStats.questionsAnswered++
          break
        case 'E_SupplementApplied':
          newStats.applied++
          break
        case 'E_SupplementFileDeleted':
          newStats.deleted++
          break
      }
      return newStats
    })
  }

  useEffect(() => {
    const saveConfig = async () => {
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        })
        if (response.ok && onAction && eventConfig?.onSave) {
          onAction('onSave', {
            path: config.target_folder,
            watch_pattern: config.watch_pattern
          })
        }
      } catch (err) {
        console.error('Failed to save config:', err)
      }
    }

    if (config.target_folder !== target_folder) {
      saveConfig()
    }
  }, [onAction, eventConfig?.onSave])

  const handleStartWatching = () => {
    if (onAction && eventConfig?.onSave) {
      onAction('onSave', {
        path: config.target_folder,
        watch_pattern: config.watch_pattern
      })
      setIsWatching(true)
    }
  }

  const handleStopWatching = () => {
    setIsWatching(false)
  }

  const handleConfigChange = (key, value) => {
    setConfig(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const getEventIcon = (eventType) => {
    if (eventType.includes('Original')) return '📄'
    if (eventType.includes('Supplement')) return '📝'
    if (eventType.includes('Request')) return '🔍'
    if (eventType.includes('Question')) return '❓'
    if (eventType.includes('Applied')) return '✅'
    if (eventType.includes('Deleted')) return '🗑️'
    return '📌'
  }

  const getEventColor = (eventType) => {
    if (eventType.includes('Original')) return '#3498db'
    if (eventType.includes('Supplement')) return '#9b59b6'
    if (eventType.includes('Request')) return '#f39c12'
    if (eventType.includes('Question')) return '#e67e22'
    if (eventType.includes('Applied')) return '#27ae60'
    if (eventType.includes('Deleted')) return '#e74c3c'
    return '#95a5a6'
  }

  return (
    <div className="thinkingos-widget">
      <div className="widget-card">
        <h2 className="widget-title">📚 Obsidian 폴더 설정</h2>
        
        <div className="config-section">
          <div className="config-item">
            <label className="config-label">
              Obsidian 폴더 경로
            </label>
            <input
              type="text"
              className="config-input"
              value={config.target_folder}
              onChange={(e) => handleConfigChange('target_folder', e.target.value)}
              placeholder="~/obsidian"
            />
            <small className="config-hint">감시할 Obsidian 루트 폴더 경로</small>
          </div>

          <div className="config-item">
            <label className="config-label">
              파일 패턴 (Glob)
            </label>
            <input
              type="text"
              className="config-input"
              value={config.watch_pattern}
              onChange={(e) => handleConfigChange('watch_pattern', e.target.value)}
              placeholder="**/*.md"
            />
            <small className="config-hint">감시할 파일 패턴 (기본: **/*.md)</small>
          </div>
        </div>

        <div className="action-section">
          {!isWatching ? (
            <button 
              className="btn btn-primary"
              onClick={handleStartWatching}
            >
              🚀 모니터링 시작
            </button>
          ) : (
            <button 
              className="btn btn-secondary"
              onClick={handleStopWatching}
            >
              ⏸️ 모니터링 중지
            </button>
          )}
        </div>

        {isWatching && (
          <div className="status-section">
            <div className="status-indicator">
              <span className="status-dot active"></span>
              <span>모니터링 중: {config.target_folder}</span>
            </div>
          </div>
        )}
      </div>

      <div className="widget-card">
        <h2 className="widget-title">📊 처리 통계</h2>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-value">{stats.originalFiles}</div>
            <div className="stat-label">원본 파일 감지</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.requestsExtracted}</div>
            <div className="stat-label">요청사항 추출</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.supplementsCreated}</div>
            <div className="stat-label">보충 파일 생성</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.questionsAnswered}</div>
            <div className="stat-label">질문 답변</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.applied}</div>
            <div className="stat-label">반영 완료</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.deleted}</div>
            <div className="stat-label">삭제 완료</div>
          </div>
        </div>
      </div>

      {(events.length > 0 || eventConfig?.subscribe?.length) && (
        <div className="widget-card">
          <h2 className="widget-title">
            🔔 실시간 이벤트
            {eventConfig?.subscribe?.length > 0 && (
              <span className="sse-badge">실시간 (SSE)</span>
            )}
          </h2>
          <div className="events-list">
            {events.length === 0 ? (
              <p className="events-placeholder">이벤트 대기 중… (SSE 연결됨)</p>
            ) : (
              events.map((event, index) => (
                <div key={`${event.time}-${index}`} className="event-item">
                  <span className="event-icon">{getEventIcon(event.type)}</span>
                  <span 
                    className="event-type"
                    style={{ background: getEventColor(event.type) }}
                  >
                    {event.type}
                  </span>
                  <span className="event-path">{event.path}</span>
                  <span className="event-time">
                    {new Date(event.time).toLocaleTimeString('ko-KR')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ThinkingOSWidget
