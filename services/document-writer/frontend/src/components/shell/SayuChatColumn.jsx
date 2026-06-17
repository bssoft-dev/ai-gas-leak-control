import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * 우측 질의·응답 패널
 */
export default function SayuChatColumn({
  messages,
  chatListExpanded,
  setChatListExpanded,
  chatInputRef,
  chatInput,
  setChatInput,
  chatBusy,
  previewMergeBusy,
  lastInsertMd,
  editorRef,
  modelGroups,
  llmModels,
  llmModelsError,
  selectedModel,
  setSelectedModel,
  sendChat,
  deleteMessageAt,
  retryUserMessageAt,
  cancelCurrentChat,
  cancelPreviewMerge,
  lastMessageOneLine,
  setChatOpen,
}) {
  return (
    <div className="sayu-right-inner">
      <div className="sayu-chat-header">
        <h2>채팅 (⌘/Ctrl+K)</h2>
        {messages.length > 0 && (
          <button
            type="button"
            className="sayu-chat-list-toggle"
            onClick={() => setChatListExpanded((v) => !v)}
            title={chatListExpanded ? '대화 창 1줄로 줄이기' : '대화 전체 보기'}
          >
            {chatListExpanded ? '1줄' : '펼침'}
          </button>
        )}
      </div>
      {chatListExpanded ? (
        <div className="sayu-chat-messages" aria-live="polite">
          {messages.map((msg, i) => (
            <div key={msg.id || `msg-${i}`} className="sayu-msg-wrap">
              <div className="sayu-msg-tools">
                <button
                  type="button"
                  className="sayu-msg-tool"
                  onClick={() => deleteMessageAt(i)}
                  disabled={chatBusy || previewMergeBusy}
                  title="이 말풍선 삭제"
                  aria-label="삭제"
                >
                  삭제
                </button>
                {msg.role === 'user' && (
                  <button
                    type="button"
                    className="sayu-msg-tool"
                    onClick={() => void retryUserMessageAt(i)}
                    disabled={chatBusy || previewMergeBusy}
                    title="이 질의만 다시 전송(이하 대화는 제거)"
                  >
                    재요청
                  </button>
                )}
              </div>
              <div className={`sayu-msg ${msg.role}`}>
                {msg.role === 'assistant' && msg.asMarkdown !== false ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text || ''}</ReactMarkdown>
                ) : (
                  msg.text
                )}
                {msg.role === 'assistant' && msg.documentEditFile ? (
                  <div className="sayu-doc-edit-hint" style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    document_edit: {msg.documentEditFile}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {chatBusy && (
            <div className="sayu-chat-pending" role="status" aria-label="응답 생성 중">
              <span className="sayu-chat-pending-l">
                <span className="sayu-chat-spinner" aria-hidden />
                <span>응답 생성 중…</span>
              </span>
              <button
                type="button"
                className="sayu-btn secondary sayu-btn-compact"
                onClick={cancelCurrentChat}
                title="응답 생성 취소"
              >
                취소
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="sayu-chat-collapsed-row">
          <button
            type="button"
            className={
              'sayu-chat-messages sayu-chat-messages--collapsed' + (chatBusy ? ' sayu-chat-messages--busy' : '')
            }
            onClick={() => setChatListExpanded(true)}
            title="클릭하여 전체 대화 보기"
          >
            {chatBusy && <span className="sayu-chat-spinner" aria-hidden />}
            <span className="sayu-chat-collapsed-n">{chatBusy ? '처리 중' : `${messages.length}개`}</span>
            <span className="sayu-chat-collapsed-preview">
              {chatBusy ? '응답을 기다리는 중…' : lastMessageOneLine()}
            </span>
          </button>
          {chatBusy && (
            <button
              type="button"
              className="sayu-btn secondary sayu-btn-compact sayu-chat-collapsed-cancel"
              onClick={(e) => {
                e.stopPropagation()
                cancelCurrentChat()
              }}
              title="응답 생성 취소"
            >
              취소
            </button>
          )}
        </div>
      )}
      <div className="sayu-chat-input-row">
        <div className="sayu-model-select-row">
          <label htmlFor="sayu-llm-model" className="sayu-model-select-label">
            질의 모델
          </label>
          <select
            id="sayu-llm-model"
            className="sayu-llm-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={chatBusy || previewMergeBusy}
          >
            {llmModels.length === 0 && !llmModelsError && (
              <option value={selectedModel}>{selectedModel} (목록 로딩…)</option>
            )}
            {llmModelsError && llmModels.length === 0 && (
              <option value={selectedModel}>
                {selectedModel} (목록을 불러오지 못함 — {llmModelsError.slice(0, 40)}…)
              </option>
            )}
            {modelGroups.map(([provider, rows]) => (
              <optgroup key={provider} label={provider}>
                {rows.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <textarea
          ref={chatInputRef}
          className="sayu-chat-input"
          placeholder="Enter로 보내기 · Shift+Enter로 줄바꿈"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return
            if (e.isComposing || (e.nativeEvent && e.nativeEvent.isComposing)) return
            e.preventDefault()
            if (chatBusy || previewMergeBusy || !chatInput.trim()) return
            void sendChat(chatInput)
          }}
          disabled={chatBusy || previewMergeBusy}
        />
        <div className="sayu-chat-actions">
          {chatBusy && (
            <button type="button" className="sayu-btn secondary" onClick={cancelCurrentChat} title="응답 생성 취소">
              응답 취소
            </button>
          )}
          {previewMergeBusy && !chatBusy && (
            <button
              type="button"
              className="sayu-btn secondary"
              onClick={cancelPreviewMerge}
              title="프리뷰 합병 취소"
            >
              합병 취소
            </button>
          )}
          <button
            type="button"
            className="sayu-btn secondary"
            onClick={() => setChatOpen(false)}
            disabled={chatBusy || previewMergeBusy}
          >
            닫기
          </button>
          <button
            type="button"
            className="sayu-btn"
            disabled={chatBusy || previewMergeBusy || !chatInput.trim()}
            onClick={() => sendChat(chatInput)}
          >
            {chatBusy ? '응답 대기…' : previewMergeBusy ? '프리뷰 합병 중…' : '질의 보내기'}
          </button>
          <button
            type="button"
            className="sayu-btn ghost"
            title="맨 마지막 AI 답변을 에디터에 삽입 (⌘/Ctrl+Enter)"
            disabled={!lastInsertMd}
            onClick={() => {
              if (lastInsertMd && editorRef.current?.insertFromMarkdown) {
                editorRef.current.insertFromMarkdown(`\n\n${lastInsertMd}\n\n`)
              }
            }}
          >
            본문 삽입
          </button>
        </div>
      </div>
    </div>
  )
}
