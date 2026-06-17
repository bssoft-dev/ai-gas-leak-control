import React, { useState, useEffect, useRef } from 'react'
import FileExplorer from './FileExplorer'
import './SagoNoteWidget.css'

function SagoNoteWidget({ 
  vault_root = './obsidian',
  watch_pattern = '**/*.md',
  hide_thinking_process = false,
  include_pdf = true,
  onAction,
  events
}) {
  const [config, setConfig] = useState({
    vault_root,
    watch_pattern,
    hide_thinking_process,
    include_pdf
  })
  const [isWatching, setIsWatching] = useState(false)
  const [selectedPath, setSelectedPath] = useState(vault_root)
  const [selectedPattern, setSelectedPattern] = useState(watch_pattern)
  const [eventsList, setEventsList] = useState([])
  const [stats, setStats] = useState({
    filesChanged: 0,
    analysesDone: 0,
    linksFound: 0,
    reportsWritten: 0
  })
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
        
        // 이벤트 리스트에 추가
        setEventsList(prev => [{
          type: eventType,
          file_path: payload.file_path || payload.path || '-',
          relative_path: payload.relative_path || '-',
          timestamp: ev.timestamp || new Date().toISOString(),
          payload: payload
        }, ...prev].slice(0, 100)) // 최대 100개 유지
        
        // 통계 업데이트
        setStats(prev => {
          const newStats = { ...prev }
          switch(eventType) {
            case 'EVT_FILE_CHANGE':
              newStats.filesChanged++
              break
            case 'EVT_ANALYSIS_DONE':
              newStats.analysesDone++
              break
            case 'EVT_LINK_FOUND':
              newStats.linksFound++
              break
            case 'EVT_WRITE_COMPLETE':
              newStats.reportsWritten++
              break
          }
          return newStats
        })
      } catch (err) {
        console.error('Failed to parse SSE message:', err)
      }
    }

    eventSource.onerror = () => {
      console.error('SSE connection error')
      eventSource.close()
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [events?.subscribe])

  useEffect(() => {
    // 설정이 변경되면 서버에 저장 (이벤트 발행 없이)
    const saveConfig = async () => {
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        })
        // 설정만 저장하고 PATH_SET 이벤트는 발행하지 않음
        // PATH_SET은 모니터링 시작 버튼을 눌렀을 때만 발행됨
      } catch (err) {
        console.error('Failed to save config:', err)
      }
    }

    // 초기 로드가 아닐 때만 저장
    if (config.vault_root !== vault_root || config.watch_pattern !== watch_pattern || config.hide_thinking_process !== hide_thinking_process || config.include_pdf !== include_pdf) {
      saveConfig()
    }
  }, [config, vault_root, watch_pattern, hide_thinking_process, include_pdf])

  const handleStartWatching = async () => {
    // 설정을 먼저 저장
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      })
    } catch (err) {
      console.error('Failed to save config:', err)
      return
    }

    // PATH_SET 이벤트 발행 (모니터링 시작)
    const eventPayload = {
      watch_dir: config.vault_root,
      path: config.vault_root,
      include_pdf: config.include_pdf
    }
    
    if (onAction && events?.onSave) {
      // events.onSave를 통해 PATH_SET 이벤트 발행
      onAction('onSave', eventPayload)
      setIsWatching(true)
    } else if (onAction) {
      // events.onSave가 없으면 직접 PATH_SET 이벤트 발행
      try {
        await fetch('/api/events/publish', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'PATH_SET',
            payload: eventPayload,
          }),
        })
        setIsWatching(true)
      } catch (err) {
        console.error('Failed to publish PATH_SET event:', err)
      }
    }
  }

  const handleStopWatching = () => {
    setIsWatching(false)
    // 모니터링 중지 시 이벤트 발행은 선택적 (필요시 구현)
  }

  const [reportGenerating, setReportGenerating] = useState(false)
  const [formatGenerating, setFormatGenerating] = useState(false)
  const [showFormatModal, setShowFormatModal] = useState(false)
  const [formatUseDefault, setFormatUseDefault] = useState(true)
  const [formatTargetFile, setFormatTargetFile] = useState(null)
  const [formatBrowsePath, setFormatBrowsePath] = useState('')
  const [formatBrowseItems, setFormatBrowseItems] = useState([])
  const [formatBrowseLoading, setFormatBrowseLoading] = useState(false)

  const buildEventPayload = (extra = {}) => ({
    watch_dir: config.vault_root,
    vault_root: config.vault_root,
    hide_thinking_process: config.hide_thinking_process,
    ...extra,
  })

  const publishOutputIndexRequest = async (eventPayload) => {
    if (onAction && events?.onIndexGenerate) {
      await onAction('onIndexGenerate', eventPayload)
      return
    }
    const res = await fetch('/api/events/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'EVT_OUTPUT_INDEX_REQUEST',
        payload: eventPayload,
      }),
    })
    if (!res.ok) throw new Error(res.statusText)
  }

  const publishOutputReportRequest = async (eventPayload) => {
    if (onAction && events?.onReportGenerate) {
      await onAction('onReportGenerate', eventPayload)
      return
    }
    const res = await fetch('/api/events/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'EVT_OUTPUT_REPORT_REQUEST',
        payload: eventPayload,
      }),
    })
    if (!res.ok) throw new Error(res.statusText)
  }

  const loadFormatBrowseItems = async (path) => {
    if (!path) return
    setFormatBrowseLoading(true)
    try {
      const res = await fetch(`/api/files/list?path=${encodeURIComponent(path)}&pattern=${encodeURIComponent('**/*.md')}`)
      if (!res.ok) throw new Error(res.statusText)
      const data = await res.json()
      const items = (data.items || []).slice().sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1
        if (!a.is_dir && b.is_dir) return 1
        return (a.name || '').localeCompare(b.name || '')
      })
      setFormatBrowseItems(items)
    } catch (err) {
      console.error('Failed to load file list:', err)
      setFormatBrowseItems([])
    } finally {
      setFormatBrowseLoading(false)
    }
  }

  useEffect(() => {
    if (showFormatModal && formatBrowsePath) loadFormatBrowseItems(formatBrowsePath)
  }, [showFormatModal, formatBrowsePath])

  const openFormatModal = () => {
    setFormatUseDefault(true)
    setFormatTargetFile(null)
    setFormatBrowsePath(config.vault_root || '')
    setShowFormatModal(true)
  }

  const getRelativePath = (fullPath) => {
    const root = (config.vault_root || '').replace(/\/$/, '')
    if (!root || !fullPath || !fullPath.startsWith(root)) return fullPath
    return fullPath.slice(root.length).replace(/^\/+/, '')
  }

  const handleFormatFileSelect = (item) => {
    if (item.is_dir) {
      setFormatBrowsePath(item.path)
      return
    }
    if (item.path && (item.name || '').toLowerCase().endsWith('.md')) {
      setFormatTargetFile(getRelativePath(item.path))
      setFormatUseDefault(false)
    }
  }

  const handleFormatConfirm = async () => {
    const payload = formatUseDefault || !formatTargetFile
      ? buildEventPayload()
      : buildEventPayload({ target_file: formatTargetFile })
    setShowFormatModal(false)
    try {
      setFormatGenerating(true)
      await publishOutputIndexRequest(payload)
    } catch (err) {
      console.error('Failed to publish EVT_OUTPUT_INDEX_REQUEST:', err)
    } finally {
      setFormatGenerating(false)
    }
  }

  const handleFormatGenerate = () => {
    openFormatModal()
  }

  const handleReportGenerate = async () => {
    const eventPayload = buildEventPayload()
    try {
      setReportGenerating(true)
      await publishOutputReportRequest(eventPayload)
    } catch (err) {
      console.error('Failed to publish EVT_OUTPUT_REPORT_REQUEST:', err)
    } finally {
      setReportGenerating(false)
    }
  }

  const handleConfigChange = (key, value) => {
    setConfig(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const handlePathSelect = (path) => {
    // 경로가 이미 디렉토리인 경우 그대로 사용
    setSelectedPath(path)
    handleConfigChange('vault_root', path)
  }

  const handlePatternSelect = (pattern) => {
    setSelectedPattern(pattern)
    handleConfigChange('watch_pattern', pattern)
  }

  const getEventTypeLabel = (type) => {
    const labels = {
      'EVT_FILE_CHANGE': '파일 변경',
      'EVT_ANALYSIS_DONE': '분석 완료',
      'EVT_LINK_FOUND': '연결 발견',
      'EVT_WRITE_COMPLETE': '리포트 작성 완료'
    }
    return labels[type] || type
  }

  const getEventTypeColor = (type) => {
    const colors = {
      'EVT_FILE_CHANGE': '#2196F3',
      'EVT_ANALYSIS_DONE': '#4CAF50',
      'EVT_LINK_FOUND': '#FF9800',
      'EVT_WRITE_COMPLETE': '#9C27B0'
    }
    return colors[type] || '#757575'
  }

  return (
    <div className="sago-note-widget">
      {/* 설정 카드 */}
      <div className="widget-card">
        <h2 className="widget-title">설정</h2>
        
        <div className="config-section">
          <div className="config-item">
            <label className="config-label">
              옵시디언 보관소 루트 폴더
            </label>
            <FileExplorer
              initialPath={config.vault_root}
              onPathSelect={handlePathSelect}
              onPatternSelect={handlePatternSelect}
              selectedPattern={config.watch_pattern}
            />
            <small className="config-hint">파일 탐색기에서 폴더를 선택하거나 경로를 직접 입력하세요</small>
          </div>

          <div className="config-item">
            <label className="config-checkbox">
              <input
                type="checkbox"
                checked={config.hide_thinking_process}
                onChange={(e) => handleConfigChange('hide_thinking_process', e.target.checked)}
              />
              사고 과정 폴더 숨기기
            </label>
            <small className="config-hint">
              활성화하면 sago 폴더와 하위 폴더들이 숨김 처리됩니다 (.sago, .founds 등)
            </small>
          </div>

          <div className="config-item">
            <label className="config-checkbox">
              <input
                type="checkbox"
                checked={config.include_pdf}
                onChange={(e) => handleConfigChange('include_pdf', e.target.checked)}
              />
              PDF 파일 포함
            </label>
            <small className="config-hint">
              감시/스캔 시 PDF 파일을 포함하여 분석합니다. 해제하면 .md 파일만 처리합니다.
            </small>
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
          <button
            className="btn btn-format"
            onClick={handleFormatGenerate}
            disabled={formatGenerating || !config.vault_root}
            title="목차 추출 대상을 선택한 뒤 output_index(양식)를 생성합니다"
          >
            {formatGenerating ? '생성 중…' : '양식 생성'}
          </button>
          <button
            className="btn btn-report"
            onClick={handleReportGenerate}
            disabled={reportGenerating || !config.vault_root}
            title="분석·관심사·TODO 결과를 종합해 output_index와 output_report를 생성합니다"
          >
            {reportGenerating ? '생성 중…' : '리포트 생성'}
          </button>
        </div>

        {isWatching && (
          <div className="status-section">
            <div className="status-indicator">
              <span className="status-dot active"></span>
              <span>모니터링 중: {config.vault_root}</span>
            </div>
            <div className="status-pattern">
              <span>파일 패턴: {config.watch_pattern}</span>
            </div>
          </div>
        )}
      </div>

      {/* 통계 카드 */}
      <div className="widget-card">
        <h2 className="widget-title">통계</h2>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-value">{stats.filesChanged}</div>
            <div className="stat-label">파일 변경</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.analysesDone}</div>
            <div className="stat-label">분석 완료</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.linksFound}</div>
            <div className="stat-label">연결 발견</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.reportsWritten}</div>
            <div className="stat-label">리포트 작성</div>
          </div>
        </div>
      </div>

      {/* 양식 생성 모달: 목차 추출 대상 파일 선택 */}
      {showFormatModal && (
        <div className="modal-overlay" onClick={() => setShowFormatModal(false)}>
          <div className="modal-content format-modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">양식 생성 – 목차 추출 대상</h3>
            <div className="format-source-options">
              <label className="format-option">
                <input
                  type="radio"
                  name="formatSource"
                  checked={formatUseDefault}
                  onChange={() => { setFormatUseDefault(true); setFormatTargetFile(null) }}
                />
                <span>기본 파일 사용 (analysis_result.md)</span>
              </label>
              <label className="format-option">
                <input
                  type="radio"
                  name="formatSource"
                  checked={!formatUseDefault}
                  onChange={() => setFormatUseDefault(false)}
                />
                <span>파일 선택</span>
              </label>
            </div>
            {!formatUseDefault && (
              <div className="format-file-picker">
                <div className="format-browse-path">
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => setFormatBrowsePath(config.vault_root)}
                    title="루트로"
                  >
                    ↶ 루트
                  </button>
                  <span className="format-browse-path-value">{formatBrowsePath || config.vault_root}</span>
                </div>
                <div className="format-file-list">
                  {formatBrowseLoading && <div className="format-loading">로딩 중…</div>}
                  {!formatBrowseLoading && formatBrowseItems.length === 0 && (
                    <div className="format-empty">폴더가 비어 있거나 접근할 수 없습니다.</div>
                  )}
                  {!formatBrowseLoading && formatBrowseItems.map((item, i) => (
                    <div
                      key={`${item.path}-${i}`}
                      className={`format-file-item ${item.is_dir ? 'dir' : 'file'}`}
                      onClick={() => handleFormatFileSelect(item)}
                      title={item.path}
                    >
                      <span className="format-file-icon">{item.is_dir ? '📁' : '📄'}</span>
                      <span className="format-file-name">{item.name}</span>
                    </div>
                  ))}
                </div>
                {formatTargetFile && (
                  <div className="format-selected">
                    선택된 파일: <strong>{formatTargetFile}</strong>
                  </div>
                )}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowFormatModal(false)}>
                취소
              </button>
              <button
                type="button"
                className="btn btn-format"
                onClick={handleFormatConfirm}
                disabled={formatGenerating || (!formatUseDefault && !formatTargetFile)}
                title={!formatUseDefault && !formatTargetFile ? '파일을 선택하세요' : ''}
              >
                양식 생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이벤트 로그 카드 */}
      {(eventsList.length > 0 || events?.subscribe?.length) && (
        <div className="widget-card">
          <h2 className="widget-title">
            진행 상황
            {events?.subscribe?.length > 0 && (
              <span className="sse-badge">실시간 (SSE)</span>
            )}
          </h2>
          <div className="events-list">
            {eventsList.length === 0 ? (
              <p className="events-placeholder">이벤트 대기 중… (SSE 연결됨)</p>
            ) : (
              eventsList.map((event, index) => (
                <div key={`${event.timestamp}-${index}`} className="event-item">
                  <div className="event-header">
                    <span 
                      className="event-type"
                      style={{ backgroundColor: getEventTypeColor(event.type) }}
                    >
                      {getEventTypeLabel(event.type)}
                    </span>
                    <span className="event-time">
                      {new Date(event.timestamp).toLocaleTimeString('ko-KR')}
                    </span>
                  </div>
                  <div className="event-body">
                    <div className="event-path">{event.relative_path || event.file_path}</div>
                    {event.type === 'EVT_ANALYSIS_DONE' && event.payload?.analysis && (
                      <div className="event-details">
                        <strong>주제:</strong> {event.payload.analysis.topic || 'N/A'}
                        {event.payload.analysis.summary && (
                          <>
                            <br />
                            <strong>요약:</strong> {event.payload.analysis.summary.substring(0, 100)}...
                          </>
                        )}
                      </div>
                    )}
                    {event.type === 'EVT_LINK_FOUND' && event.payload?.related_files && (
                      <div className="event-details">
                        <strong>관련 파일:</strong> {event.payload.related_files.length}개 발견
                      </div>
                    )}
                    {event.type === 'EVT_WRITE_COMPLETE' && event.payload?.report_path && (
                      <div className="event-details">
                        <strong>리포트:</strong> {event.payload.relative_path || event.payload.report_path}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SagoNoteWidget
