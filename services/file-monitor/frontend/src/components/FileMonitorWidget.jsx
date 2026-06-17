import React, { useState, useEffect, useRef } from 'react'
import './FileMonitorWidget.css'

function FileMonitorWidget({ 
  target_folder = './obsidian',
  watch_pattern = '**/*',
  show_content = false,
  is_logging = true,
  onAction,
  events
}) {
  const [config, setConfig] = useState({
    target_folder,
    watch_pattern,
    show_content,
    is_logging
  })
  const [fileEvents, setFileEvents] = useState([])
  const [isWatching, setIsWatching] = useState(false)
  const eventSourceRef = useRef(null)

  // SSE (Server-Sent Events): 서버에서 푸시되는 이벤트 수신
  useEffect(() => {
    const subscribeTypes = events?.subscribe
    console.log('subscribeTypes:', subscribeTypes)
    if (!Array.isArray(subscribeTypes) || subscribeTypes.length === 0) return

    const eventSource = new EventSource('/api/events/stream')
    eventSourceRef.current = eventSource

    eventSource.onmessage = (e) => {
      console.log('SSE message:', e.data)
      try {
        const ev = JSON.parse(e.data)
        const eventType = ev.type
        if (!eventType || !subscribeTypes.includes(eventType)) return
        const payload = ev.payload || {}
        setFileEvents(prev => [...prev, {
          type: eventType,
          path: payload.path ?? payload.file_path ?? payload.target ?? '-',
          time: ev.timestamp ?? payload.timestamp ?? payload.time ?? new Date().toISOString(),
        }].slice(-200))
      } catch (_) {}
    }

    eventSource.onerror = () => {
      eventSource.close()
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [events?.subscribe])

  useEffect(() => {
    // 설정이 변경되면 서버에 저장
    const saveConfig = async () => {
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        })
        if (response.ok && onAction && events?.onSave) {
          // PATH_SET 이벤트 발행
          onAction('onSave', {
            path: config.target_folder,
            watch_pattern: config.watch_pattern
          })
        }
      } catch (err) {
        console.error('Failed to save config:', err)
      }
    }

    // 초기 로드가 아닐 때만 저장
    if (config.target_folder !== target_folder) {
      saveConfig()
    }
  }, [config, target_folder, onAction, events])

  const handleStartWatching = () => {
    if (onAction && events?.onSave) {
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

  return (
    <div className="file-monitor-widget">
      <div className="widget-card">
        <h2 className="widget-title">파일 모니터 설정</h2>
        
        <div className="config-section">
          <div className="config-item">
            <label className="config-label">
              감시할 폴더
            </label>
            <input
              type="text"
              className="config-input"
              value={config.target_folder}
              onChange={(e) => handleConfigChange('target_folder', e.target.value)}
              placeholder="./obsidian"
            />
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
              placeholder="**/*"
            />
            <small className="config-hint">예: **/*.md, **/*.txt</small>
          </div>

          <div className="config-item">
            <label className="config-checkbox">
              <input
                type="checkbox"
                checked={config.show_content}
                onChange={(e) => handleConfigChange('show_content', e.target.checked)}
              />
              파일 내용 출력
            </label>
          </div>

          <div className="config-item">
            <label className="config-checkbox">
              <input
                type="checkbox"
                checked={config.is_logging}
                onChange={(e) => handleConfigChange('is_logging', e.target.checked)}
              />
              로그 파일 저장
            </label>
          </div>
        </div>

        <div className="action-section">
          {!isWatching ? (
            <button 
              className="btn btn-primary"
              onClick={handleStartWatching}
            >
              모니터링 시작
            </button>
          ) : (
            <button 
              className="btn btn-secondary"
              onClick={handleStopWatching}
            >
              모니터링 중지
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

      {(fileEvents.length > 0 || events?.subscribe?.length) && (
        <div className="widget-card">
          <h2 className="widget-title">
            파일 변경 이벤트
            {events?.subscribe?.length > 0 && (
              <span className="sse-badge">실시간 (SSE)</span>
            )}
          </h2>
          <div className="events-list">
            {fileEvents.length === 0 ? (
              <p className="events-placeholder">이벤트 대기 중… (SSE 연결됨)</p>
            ) : (
              fileEvents.map((event, index) => (
                <div key={`${event.time}-${index}`} className="event-item">
                  <span className="event-type">{event.type}</span>
                  <span className="event-path">{event.path}</span>
                  <span className="event-time">{event.time}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default FileMonitorWidget
