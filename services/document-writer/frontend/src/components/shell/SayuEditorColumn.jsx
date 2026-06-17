import React, { useEffect, useState } from 'react'
import TiptapEditor from '../TiptapEditor'

const LS_VIEW = 'sayu-editor-view-mode'

/**
 * @typedef {'continuous' | 'paged'} EditorViewMode
 */

/**
 * 중앙 편집 영역: 툴바 + 스크롤 + Tiptap
 */
export default function SayuEditorColumn({ activeDoc, editorRef, onChange, previewPath, onNewDocument }) {
  const [viewMode, setViewMode] = useState(/** @type {EditorViewMode} */ ('continuous'))

  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_VIEW)
      if (v === 'continuous' || v === 'paged') setViewMode(v)
    } catch {
      /* ignore */
    }
  }, [])

  const setMode = (m) => {
    setViewMode(m)
    try {
      localStorage.setItem(LS_VIEW, m)
    } catch {
      /* ignore */
    }
  }

  return (
    <main className="sayu-center" id="main-editor" role="main" aria-label="문서 편집">
      <div className="sayu-center-inner sayu-doc-workspace">
        <div className="sayu-editor-hint-row">
          <p className="sayu-editor-hint">
            중앙 에디터 ·{' '}
            {previewPath ? `작업 중: ${previewPath}` : '새 메모 (저장: PUT /api/sayu/file)'}
          </p>
          <div className="sayu-editor-hint__actions">
            <div
              className="sayu-viewmode"
              role="group"
              aria-label="에디터 보기 모드"
            >
              <button
                type="button"
                className={'sayu-viewmode__btn' + (viewMode === 'continuous' ? ' sayu-viewmode__btn--active' : '')}
                onClick={() => setMode('continuous')}
                title="한 영역에 이어서 표시 (세로·가로 스크롤)"
                aria-pressed={viewMode === 'continuous'}
              >
                연속
              </button>
              <button
                type="button"
                className={'sayu-viewmode__btn' + (viewMode === 'paged' ? ' sayu-viewmode__btn--active' : '')}
                onClick={() => setMode('paged')}
                title="A4 폭·용지·여백을 적용한 페이지 보기 (스크롤로 이어짐)"
                aria-pressed={viewMode === 'paged'}
              >
                페이지
              </button>
            </div>
            <button
              type="button"
              className="sayu-btn secondary sayu-btn-compact"
              onClick={onNewDocument}
              title="빈 문서로 초기화"
            >
              새 문서
            </button>
          </div>
        </div>
        <div
          className={
            'sayu-editor-surface' + (viewMode === 'paged' ? ' sayu-editor-surface--paged' : ' sayu-editor-surface--continuous')
          }
        >
          <div className="sayu-editor-scroll" data-sayu-scroll="editor">
            <TiptapEditor
              key={activeDoc.id}
              ref={editorRef}
              viewMode={viewMode}
              initialMarkdown={activeDoc.md}
              onChange={onChange}
              placeholder="내용을 입력하거나, 오른쪽 질의로 초안을 받아 보세요…"
            />
          </div>
        </div>
      </div>
    </main>
  )
}
