import React, { useState, useEffect } from 'react'
import './MeetingEmailWidget.css'

function MeetingEmailWidget({
  target_folder = './obsidian',
  llm_model = 'openai/gpt-oss-120b',
  auto_send = false,
  onAction,
  events
}) {
  const [config, setConfig] = useState({
    target_folder,
    llm_model,
    auto_send
  })
  const [drafts, setDrafts] = useState([])
  const [isActive, setIsActive] = useState(false)

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
        if (response.ok && onAction && events?.onSave) {
          onAction('onSave', config)
        }
      } catch (err) {
        console.error('Failed to save config:', err)
      }
    }

    if (config.target_folder !== target_folder) {
      saveConfig()
    }
  }, [config, target_folder, onAction, events])

  const handleStartService = () => {
    setIsActive(true)
    // 서비스 시작 이벤트 발행 (필요시)
  }

  const handleStopService = () => {
    setIsActive(false)
  }

  const handleConfigChange = (key, value) => {
    setConfig(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const handleApproveDraft = (draftId) => {
    if (onAction && events?.onApprove) {
      onAction('onApprove', { draft_id: draftId })
    }
  }

  const handleRejectDraft = (draftId) => {
    if (onAction && events?.onReject) {
      onAction('onReject', { draft_id: draftId })
    }
  }

  return (
    <div className="meeting-email-widget">
      <div className="widget-card">
        <h2 className="widget-title">서비스 설정</h2>
        
        <div className="config-section">
          <div className="config-item">
            <label className="config-label">
              감시할 회의록 폴더
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
              LLM 모델
            </label>
            <select
              className="config-select"
              value={config.llm_model}
              onChange={(e) => handleConfigChange('llm_model', e.target.value)}
            >
              <option value="openai/gpt-oss-120b">openai/gpt-oss-120b</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="claude-3-opus">claude-3-opus</option>
            </select>
          </div>

          <div className="config-item">
            <label className="config-checkbox">
              <input
                type="checkbox"
                checked={config.auto_send}
                onChange={(e) => handleConfigChange('auto_send', e.target.checked)}
              />
              자동 발송 (승인 없이)
            </label>
            <small className="config-hint">초안 작성 후 자동으로 발송합니다 (비권장)</small>
          </div>
        </div>

        <div className="action-section">
          {!isActive ? (
            <button 
              className="btn btn-primary"
              onClick={handleStartService}
            >
              서비스 시작
            </button>
          ) : (
            <button 
              className="btn btn-secondary"
              onClick={handleStopService}
            >
              서비스 중지
            </button>
          )}
        </div>

        {isActive && (
          <div className="status-section">
            <div className="status-indicator">
              <span className="status-dot active"></span>
              <span>서비스 실행 중: {config.target_folder}</span>
            </div>
          </div>
        )}
      </div>

      <div className="widget-card">
        <h2 className="widget-title">이메일 초안 목록</h2>
        
        {drafts.length === 0 ? (
          <div className="empty-state">
            <p>생성된 이메일 초안이 없습니다.</p>
            <p className="empty-hint">회의록 파일이 생성되면 자동으로 초안이 작성됩니다.</p>
          </div>
        ) : (
          <div className="drafts-list">
            {drafts.map((draft) => (
              <div key={draft.id} className="draft-item">
                <div className="draft-header">
                  <h3 className="draft-subject">{draft.subject}</h3>
                  <span className="draft-time">{draft.created_at}</span>
                </div>
                <div className="draft-meta">
                  <span className="draft-to">받는이: {draft.to}</span>
                  <span className="draft-source">출처: {draft.source_file}</span>
                </div>
                <div className="draft-body">
                  {draft.body}
                </div>
                {!config.auto_send && (
                  <div className="draft-actions">
                    <button 
                      className="btn btn-success"
                      onClick={() => handleApproveDraft(draft.id)}
                    >
                      승인 및 발송
                    </button>
                    <button 
                      className="btn btn-danger"
                      onClick={() => handleRejectDraft(draft.id)}
                    >
                      거부
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default MeetingEmailWidget
