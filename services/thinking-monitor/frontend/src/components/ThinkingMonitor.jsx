import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import './ThinkingMonitor.css'

function genId() {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function ThinkingMonitor({ onAction, events }) {
  const [contextTabs, setContextTabs] = useState([
    { id: genId(), name: '컨텍스트 1', content: '' },
  ])
  const [activeContextTabId, setActiveContextTabId] = useState(null)
  const [systemPrompts, setSystemPrompts] = useState([
    { id: genId(), name: '시스템 1', content: '', model: '' },
  ])
  const [activeSystemTabId, setActiveSystemTabId] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState([])
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const responseEndRef = useRef(null)
  const eventSourceRef = useRef(null)
  const loadFileInputRef = useRef(null)
  const [expandModal, setExpandModal] = useState(null)
  const [modelList, setModelList] = useState([])

  const activeContextTabIdResolved = activeContextTabId ?? contextTabs[0]?.id ?? null
  const activeContextTab = contextTabs.find((t) => t.id === activeContextTabIdResolved) ?? contextTabs[0]
  const mergedContextAllTabs = contextTabs.map((t) => t.content?.trim()).filter(Boolean).join('\n\n')

  const activeTabId = activeSystemTabId ?? systemPrompts[0]?.id ?? null
  const activeTab = systemPrompts.find((t) => t.id === activeTabId) ?? systemPrompts[0]

  const subscribeTypes = events?.subscribe || []

  useEffect(() => {
    if (!Array.isArray(subscribeTypes) || subscribeTypes.length === 0) return
    const eventSource = new EventSource('/api/events/stream')
    eventSourceRef.current = eventSource
    eventSource.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        if (!ev.type || !subscribeTypes.includes(ev.type)) return
        if (ev.type === 'LLM_PROMPT_RESPONSE') {
          const payload = ev.payload || {}
          if (payload.success && payload.response != null) {
            setResponse(String(payload.response))
            setError(null)
          } else if (payload.success === false && payload.error) {
            setError(payload.error)
          }
          setLoading(false)
        }
      } catch (err) {
        console.error('SSE parse error:', err)
      }
    }
    eventSource.onerror = () => {
      setLoading(false)
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [subscribeTypes.join(',')])

  useEffect(() => {
    responseEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [response])

  useEffect(() => {
    let cancelled = false
    fetch('/api/models')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data) ? data : (data?.data ?? data?.models ?? [])
        setModelList(list)
      })
      .catch((err) => {
        if (!cancelled) console.warn('모델 목록 로드 실패:', err)
      })
    return () => { cancelled = true }
  }, [])

  const setActiveTabContent = (content) => {
    setSystemPrompts((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, content } : t))
    )
  }

  const addSystemTab = () => {
    const newTab = { id: genId(), name: `시스템 ${systemPrompts.length + 1}`, content: '', model: '' }
    setSystemPrompts((prev) => [...prev, newTab])
    setActiveSystemTabId(newTab.id)
  }

  const removeSystemTab = (id) => {
    if (systemPrompts.length <= 1) return
    setSystemPrompts((prev) => prev.filter((t) => t.id !== id))
    if (activeTabId === id) {
      const rest = systemPrompts.filter((t) => t.id !== id)
      setActiveSystemTabId(rest[0]?.id ?? null)
    }
  }

  const setActiveTabName = (name) => {
    setSystemPrompts((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, name } : t))
    )
  }

  const setActiveTabModel = (model) => {
    setSystemPrompts((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, model: model ?? '' } : t))
    )
  }

  const addContextTab = () => {
    const newTab = { id: genId(), name: `컨텍스트 ${contextTabs.length + 1}`, content: '' }
    setContextTabs((prev) => [...prev, newTab])
    setActiveContextTabId(newTab.id)
  }

  const removeContextTab = (id) => {
    if (contextTabs.length <= 1) return
    setContextTabs((prev) => prev.filter((t) => t.id !== id))
    if (activeContextTabIdResolved === id) {
      const rest = contextTabs.filter((t) => t.id !== id)
      setActiveContextTabId(rest[0]?.id ?? null)
    }
  }

  const setActiveContextTabContent = (content) => {
    setContextTabs((prev) =>
      prev.map((t) => (t.id === activeContextTabIdResolved ? { ...t, content } : t))
    )
  }

  const setActiveContextTabName = (name) => {
    setContextTabs((prev) =>
      prev.map((t) => (t.id === activeContextTabIdResolved ? { ...t, name } : t))
    )
  }

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    Promise.all(
      files.map((file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve({ name: file.name, content: reader.result })
          reader.onerror = reject
          reader.readAsText(file, 'UTF-8')
        })
      )
    ).then((results) => {
      setAttachments((prev) => [...prev, ...results])
    }).catch((err) => {
      console.error('File read error:', err)
      setError('파일을 읽는 중 오류가 발생했습니다.')
    })
    e.target.value = ''
  }

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const getStateForSave = () => ({
    version: 1,
    contextTabs,
    activeContextTabId: activeContextTabIdResolved,
    systemPrompts,
    activeSystemTabId: activeTabId,
    userPrompt: prompt,
  })

  const saveToFile = () => {
    const state = getStateForSave()
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `thinking-monitor-state-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const loadFromFile = () => {
    loadFileInputRef.current?.click()
  }

  const handleLoadFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const state = JSON.parse(reader.result)
        if (state.version !== 1 || !Array.isArray(state.systemPrompts) || state.systemPrompts.length === 0) {
          setError('올바른 저장 파일이 아닙니다.')
          return
        }
        if (Array.isArray(state.contextTabs) && state.contextTabs.length > 0) {
          setContextTabs(state.contextTabs.map((t) => ({
            id: t.id || genId(),
            name: t.name || '컨텍스트',
            content: t.content ?? '',
          })))
          const firstCtxId = state.contextTabs[0]?.id
          setActiveContextTabId(
            state.activeContextTabId && state.contextTabs.some((t) => t.id === state.activeContextTabId)
              ? state.activeContextTabId
              : firstCtxId
          )
        } else if (state.context != null) {
          setContextTabs([{ id: genId(), name: '컨텍스트 1', content: state.context ?? '' }])
          setActiveContextTabId(null)
        }
        setSystemPrompts(state.systemPrompts.map((t) => ({
          id: t.id || genId(),
          name: t.name || '시스템',
          content: t.content ?? '',
          model: t.model ?? '',
        })))
        const firstId = state.systemPrompts[0]?.id
        setActiveSystemTabId(state.activeSystemTabId && state.systemPrompts.some((t) => t.id === state.activeSystemTabId)
          ? state.activeSystemTabId
          : firstId)
        setPrompt(state.userPrompt ?? '')
        setError(null)
      } catch (err) {
        setError('파일을 읽는 중 오류가 발생했습니다.')
      }
    }
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  const openExpandModal = (type, title, content) => {
    setExpandModal({ type, title, content: content ?? '' })
  }

  const closeExpandModal = () => {
    setExpandModal(null)
  }

  const handleSubmit = () => {
    const trimmed = (prompt || '').trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    const systemPromptText = activeTab?.content?.trim() || ''
    const contextText = mergedContextAllTabs || undefined
    const modelValue = (activeTab?.model ?? '').trim() || undefined
    if (attachments.length > 0 && events?.onPromptWithAttachments) {
      onAction('onPromptWithAttachments', {
        context: contextText,
        system_prompt: systemPromptText || undefined,
        prompt: trimmed,
        attachments: attachments.map((a) => ({ name: a.name, content: a.content })),
        model: modelValue,
      })
    } else if (events?.onPrompt) {
      const mergedContext = [systemPromptText, contextText].filter(Boolean).join('\n\n')
      onAction('onPrompt', {
        context: mergedContext || undefined,
        prompt: trimmed,
        model: modelValue,
      })
    }
  }

  return (
    <div className="thinking-monitor">
      {/* 상단: 컨텍스트(왼쪽) / 시스템 프롬프트 탭(오른쪽) */}
      <section className="tm-top">
        <div className="tm-panel tm-context-panel">
          <div className="tm-label-row">
            <span className="tm-label">
              컨텍스트
              <span className="tm-label-badge">전송 시 모든 탭 포함</span>
            </span>
            <div className="tm-panel-actions">
              <button
                type="button"
                className="tm-btn tm-btn-expand"
                onClick={() => openExpandModal('context', '컨텍스트 (전체)', mergedContextAllTabs)}
                title="확대 보기 (모든 탭 합친 내용)"
                aria-label="확대"
              >
                ⛶
              </button>
              <button type="button" className="tm-btn tm-btn-save" onClick={saveToFile} title="파일로 저장">
                저장
              </button>
              <button type="button" className="tm-btn tm-btn-load" onClick={loadFromFile} title="파일에서 불러오기">
                불러오기
              </button>
              <input
                ref={loadFileInputRef}
                type="file"
                accept=".json"
                onChange={handleLoadFile}
                style={{ display: 'none' }}
              />
            </div>
          </div>
          <div className="tm-tabs-actions tm-context-tabs">
            {contextTabs.map((t) => (
              <div
                key={t.id}
                className={`tm-tab ${t.id === activeContextTabIdResolved ? 'tm-tab-active' : ''}`}
              >
                <button
                  type="button"
                  className="tm-tab-btn"
                  onClick={() => setActiveContextTabId(t.id)}
                  title={t.name}
                >
                  {t.name}
                </button>
                {contextTabs.length > 1 && (
                  <button
                    type="button"
                    className="tm-tab-close"
                    onClick={(ev) => { ev.stopPropagation(); removeContextTab(t.id); }}
                    aria-label="탭 닫기"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="tm-tab-add" onClick={addContextTab} title="탭 추가">
              +
            </button>
          </div>
          {activeContextTab && (
            <>
              <div className="tm-tab-title-row">
                <input
                  type="text"
                  className="tm-tab-title-input"
                  value={activeContextTab.name}
                  onChange={(e) => setActiveContextTabName(e.target.value)}
                  placeholder="탭 이름"
                />
                <button
                  type="button"
                  className="tm-btn tm-btn-expand tm-btn-expand-inline"
                  onClick={() => openExpandModal('context', `컨텍스트: ${activeContextTab.name}`, activeContextTab.content)}
                  title="확대 보기"
                  aria-label="확대"
                >
                  ⛶
                </button>
              </div>
              <textarea
                className="tm-textarea tm-scroll"
                placeholder="추가 컨텍스트를 입력하세요..."
                value={activeContextTab.content}
                onChange={(e) => setActiveContextTabContent(e.target.value)}
                rows={5}
              />
            </>
          )}
        </div>
        <div className="tm-panel tm-system-panel">
          <div className="tm-label-row">
            <span className="tm-label">
              시스템 프롬프트
              <span className="tm-label-badge">활성 탭만 전송에 사용</span>
            </span>
            <div className="tm-tabs-actions">
              {systemPrompts.map((t) => (
                <div
                  key={t.id}
                  className={`tm-tab ${t.id === activeTabId ? 'tm-tab-active' : ''}`}
                >
                  <button
                    type="button"
                    className="tm-tab-btn"
                    onClick={() => setActiveSystemTabId(t.id)}
                    title={t.name}
                  >
                    {t.name}
                  </button>
                  {systemPrompts.length > 1 && (
                    <button
                      type="button"
                      className="tm-tab-close"
                      onClick={(ev) => { ev.stopPropagation(); removeSystemTab(t.id); }}
                      aria-label="탭 닫기"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="tm-tab-add" onClick={addSystemTab} title="탭 추가">
                +
              </button>
            </div>
          </div>
          {activeTab && (
            <>
              <div className="tm-tab-title-row">
                <input
                  type="text"
                  className="tm-tab-title-input"
                  value={activeTab.name}
                  onChange={(e) => setActiveTabName(e.target.value)}
                  placeholder="탭 이름"
                />
                <button
                  type="button"
                  className="tm-btn tm-btn-expand tm-btn-expand-inline"
                  onClick={() => openExpandModal('system', `시스템 프롬프트: ${activeTab.name}`, activeTab.content)}
                  title="확대 보기"
                  aria-label="확대"
                >
                  ⛶
                </button>
              </div>
              <div className="tm-system-model-row">
                <label className="tm-model-label">
                  모델 (이 탭)
                  <select
                    className="tm-model-select"
                    value={activeTab.model ?? ''}
                    onChange={(e) => setActiveTabModel(e.target.value)}
                    title="이 시스템 프롬프트 탭에서 사용할 모델"
                  >
                    <option value="">기본 (서버 설정)</option>
                    {modelList.map((m) => {
                      const id = typeof m === 'string' ? m : (m?.id ?? m?.model_id ?? m?.name ?? '')
                      const label =
                        typeof m === 'string'
                          ? m
                          : (m?.provider ? `${m?.name ?? id} (${m.provider})` : (m?.name ?? m?.id ?? m?.model_id ?? id))
                      if (!id) return null
                      return (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </label>
              </div>
              <textarea
                className="tm-textarea tm-scroll"
                placeholder="시스템/역할 지시를 입력하세요..."
                value={activeTab.content}
                onChange={(e) => setActiveTabContent(e.target.value)}
                rows={5}
              />
            </>
          )}
        </div>
      </section>

      {/* 하단: 프롬프트+첨부(왼쪽) / 응답(오른쪽) */}
      <section className="tm-bottom">
        <div className="tm-panel tm-input-panel">
          <div className="tm-label-row">
            <label className="tm-label">프롬프트 (유저)</label>
            <div className="tm-panel-actions-right">
              <button
                type="button"
                className="tm-btn tm-btn-expand"
                onClick={() => openExpandModal('user', '프롬프트 (유저)', prompt)}
                title="확대 보기"
                aria-label="확대"
              >
                ⛶
              </button>
              <span className="tm-label-hint">저장/불러오기에 포함</span>
            </div>
          </div>
          <div className="tm-input-wrap">
            <textarea
              className="tm-textarea tm-scroll tm-prompt-input"
              placeholder="질문이나 지시를 입력하세요... (⌘+Enter 또는 Ctrl+Enter로 전송)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              rows={8}
              disabled={loading}
            />
            <div className="tm-attachments">
              <input
                type="file"
                id="tm-file-input"
                multiple
                accept=".txt,.md,.json,.csv,.log"
                onChange={handleFileSelect}
                className="tm-file-input"
              />
              <label htmlFor="tm-file-input" className="tm-file-label">
                파일 첨부
              </label>
              {attachments.length > 0 && (
                <ul className="tm-attachment-list">
                  {attachments.map((a, i) => (
                    <li key={i} className="tm-attachment-item">
                      <span className="tm-attachment-name">{a.name}</span>
                      <button
                        type="button"
                        className="tm-attachment-remove"
                        onClick={() => removeAttachment(i)}
                        aria-label="제거"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              className="tm-submit"
              onClick={handleSubmit}
              disabled={loading || !prompt.trim()}
            >
              {loading ? '처리 중...' : '전송'}
            </button>
          </div>
        </div>
        <div className="tm-panel tm-response-panel">
          <div className="tm-label-row">
            <label className="tm-label">응답</label>
            <button
              type="button"
              className="tm-btn tm-btn-expand"
              onClick={() => openExpandModal('response', '응답', response)}
              title="확대 보기"
              aria-label="확대"
            >
              ⛶
            </button>
          </div>
          <div className="tm-response-wrap tm-scroll">
            {error && <div className="tm-response-error">{error}</div>}
            {response ? (
              <div className="tm-markdown">
                <ReactMarkdown>{response}</ReactMarkdown>
                <div ref={responseEndRef} />
              </div>
            ) : (
              <div className="tm-response-placeholder">
                응답이 여기에 마크다운으로 표시됩니다.
              </div>
            )}
          </div>
        </div>
      </section>

      {expandModal && (
        <div className="tm-modal-overlay" onClick={closeExpandModal} role="dialog" aria-modal="true" aria-label={expandModal.title}>
          <div className="tm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tm-modal-header">
              <h3 className="tm-modal-title">{expandModal.title}</h3>
              <button type="button" className="tm-modal-close" onClick={closeExpandModal} aria-label="닫기">
                ×
              </button>
            </div>
            <div className="tm-modal-body">
              <pre className="tm-modal-content">{expandModal.content || '(비어 있음)'}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ThinkingMonitor
