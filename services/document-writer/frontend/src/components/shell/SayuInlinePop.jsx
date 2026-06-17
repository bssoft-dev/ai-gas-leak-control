import React from 'react'

export default function SayuInlinePop({
  inlineOpen,
  inlineText,
  setInlineText,
  inlineRef,
  chatBusy,
  previewMergeBusy,
  sendChat,
  cancelCurrentChat,
  cancelPreviewMerge,
  setInlineOpen,
}) {
  if (!inlineOpen) return null
  return (
    <div className="sayu-inline-pop" style={{ bottom: 100, right: 24, top: 'auto', left: 'auto' }}>
      <p className="sayu-inline-pop__title">인라인 AI (⌘/Ctrl+J)</p>
      <textarea
        ref={inlineRef}
        value={inlineText}
        onChange={(e) => setInlineText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return
          if (e.isComposing || (e.nativeEvent && e.nativeEvent.isComposing)) return
          e.preventDefault()
          if (chatBusy || previewMergeBusy || !inlineText.trim()) return
          void sendChat(inlineText, { fromInline: true })
        }}
        placeholder="Enter로 보내기 · Shift+Enter로 줄바꿈"
      />
      <div className="sayu-inline-pop__actions">
        {chatBusy && (
          <button type="button" className="sayu-btn secondary" onClick={cancelCurrentChat} title="응답 생성 취소">
            응답 취소
          </button>
        )}
        {previewMergeBusy && !chatBusy && (
          <button type="button" className="sayu-btn secondary" onClick={cancelPreviewMerge} title="프리뷰 합병 취소">
            합병 취소
          </button>
        )}
        <button type="button" className="sayu-btn secondary" onClick={() => setInlineOpen(false)} disabled={chatBusy || previewMergeBusy}>
          닫기
        </button>
        <button
          type="button"
          className="sayu-btn"
          disabled={chatBusy || previewMergeBusy || !inlineText.trim()}
          onClick={() => sendChat(inlineText, { fromInline: true })}
        >
          보내기
        </button>
      </div>
    </div>
  )
}
