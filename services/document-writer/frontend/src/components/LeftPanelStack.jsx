import React, { useCallback, useEffect, useRef, useState } from 'react'
import { VaultFileTree } from './VaultFileTree'
import { parseMarkdownToHtml } from '../markdownRender'

const LS_KEY = 'sayu-left-accordion-v1'
const HDR = 32
const GRIP = 4
const MIN_B = 56

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function readStored() {
  if (typeof localStorage === 'undefined') {
    return { open: { tree: true, search: true, preview: true }, body: { tree: 200, search: 160 } }
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) throw new Error('empty')
    const j = JSON.parse(raw)
    const open = {
      tree: j.open?.tree !== false,
      search: j.open?.search !== false,
      preview: j.open?.preview !== false,
    }
    return {
      open,
      body: {
        tree: Number.isFinite(j.body?.tree) ? j.body.tree : 200,
        search: Number.isFinite(j.body?.search) ? j.body.search : 160,
      },
    }
  } catch {
    return { open: { tree: true, search: true, preview: true }, body: { tree: 200, search: 160 } }
  }
}

/**
 * 왼쪽 패널: 자료 / 검색 스니펫 / 프리뷰 — 아코디언 + 높이 드래그
 * (프리뷰 본문은 lower 영역에서 flex로 나머지를 채움)
 */
export default function LeftPanelStack({
  files,
  treeFilter,
  onTreeFilterChange,
  searchHits,
  previewPath,
  previewMd,
  onFileClick,
  onFileDoubleClick,
  panelOpen,
  onPreviewApply,
  onCancelPreviewMerge,
  previewMergeBusy,
  chatBusy,
}) {
  const [acc, setAcc] = useState(() => readStored())
  const { open, body } = acc
  const stackRef = useRef(null)
  const lowerRef = useRef(null)
  const [resizing, setResizing] = useState(false)
  const bodyRef = useRef(body)

  useEffect(() => {
    bodyRef.current = body
  }, [body])

  const persist = useCallback((next) => {
    setAcc((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ open: resolved.open, body: resolved.body }))
      } catch {
        /* */
      }
      return resolved
    })
  }, [])

  const setSectionOpen = (key) => {
    persist((prev) => {
      const o = { ...prev.open, [key]: !prev.open[key] }
      return { ...prev, open: o }
    })
  }

  const fitBodiesInLower = useCallback(() => {
    const lower = lowerRef.current
    if (!lower || !open.search || !open.preview) return
    const lowerH = lower.clientHeight
    if (lowerH < 20) return
    const maxS = lowerH - HDR * 2 - GRIP - MIN_B
    if (maxS < MIN_B) return
    const s = bodyRef.current.search
    if (s > maxS) {
      persist((prev) => ({ ...prev, body: { ...prev.body, search: maxS } }))
    } else if (s < MIN_B) {
      persist((prev) => ({ ...prev, body: { ...prev.body, search: MIN_B } }))
    }
  }, [open.search, open.preview, persist])

  useEffect(() => {
    if (!panelOpen) return
    const stack = stackRef.current
    const lower = lowerRef.current
    if (!stack) return
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(fitBodiesInLower)
    })
    ro.observe(stack)
    if (lower) ro.observe(lower)
    fitBodiesInLower()
    return () => ro.disconnect()
  }, [panelOpen, open.tree, open.search, open.preview, fitBodiesInLower])

  const onGrip1Down = (e) => {
    e.preventDefault()
    if (e.button !== 0) return
    if (!open.tree) return
    const y0 = e.clientY
    const t0 = bodyRef.current.tree
    setResizing(true)
    const onMove = (ev) => {
      const H = stackRef.current?.clientHeight || 0
      const g1 = GRIP
      const lowerMin = 160
      const maxT = H > 0 ? Math.max(MIN_B, H - g1 - lowerMin) : 900
      const dy = ev.clientY - y0
      const b = Math.round(clamp(t0 + dy, MIN_B, maxT))
      persist((prev) => ({ ...prev, body: { ...prev.body, tree: b } }))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const onGrip2Down = (e) => {
    e.preventDefault()
    if (e.button !== 0) return
    if (!open.search || !open.preview) return
    const y0 = e.clientY
    const s0 = bodyRef.current.search
    setResizing(true)
    const onMove = (ev) => {
      const lower = lowerRef.current
      if (!lower) return
      const lowerH = lower.clientHeight
      const g2 = GRIP
      const maxS = lowerH - HDR * 2 - g2 - MIN_B
      const dy = ev.clientY - y0
      const b = Math.round(clamp(s0 + dy, MIN_B, maxS))
      persist((prev) => ({ ...prev, body: { ...prev.body, search: b } }))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const showG1 = open.tree
  const showG2 = open.search && open.preview
  const chev = (is) => (is ? '▼' : '▶')

  return (
    <div className={`sayu-left-inner${resizing ? ' sayu-left-inner--resizing' : ''}`}>
      <div className="sayu-left-stack" ref={stackRef}>
        <section className="sayu-left-acc" aria-label="자료 목록">
          <button
            type="button"
            className="sayu-left-acc-hd"
            onClick={() => setSectionOpen('tree')}
            aria-expanded={open.tree}
            aria-controls="sayu-left-tree-body"
            id="sayu-left-tree-h"
          >
            <span className="sayu-left-acc-chev" aria-hidden>
              {chev(open.tree)}
            </span>
            <span>자료 목록</span>
          </button>
          {open.tree && (
            <div
              className="sayu-left-acc-body sayu-left-acc-body--tree"
              id="sayu-left-tree-body"
              role="region"
              aria-labelledby="sayu-left-tree-h"
            >
              <div className="sayu-left-tree-body-inner" style={{ height: body.tree, minHeight: MIN_B }}>
                <input
                  type="search"
                  className="sayu-tree-filter"
                  value={treeFilter}
                  onChange={(e) => onTreeFilterChange(e.target.value)}
                  placeholder="경로·파일명 필터 (공백=모두 일치)"
                  aria-label="자료 트리 필터"
                />
                <div className="sayu-file-list sayu-file-list-tree sayu-left-tree-scroll">
                  <VaultFileTree
                    filePaths={files}
                    filterText={treeFilter}
                    previewPath={previewPath}
                    onFileClick={onFileClick}
                    onFileDoubleClick={onFileDoubleClick}
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {showG1 && (
          <div
            className="sayu-h-grip"
            role="separator"
            aria-orientation="horizontal"
            aria-label="자료 영역·아래 영역의 높이 조절"
            onMouseDown={onGrip1Down}
          />
        )}

        <div className="sayu-left-lower" ref={lowerRef}>
          <section className="sayu-left-acc" aria-label="검색 스니펫">
            <button
              type="button"
              className="sayu-left-acc-hd"
              onClick={() => setSectionOpen('search')}
              aria-expanded={open.search}
              aria-controls="sayu-left-search-body"
              id="sayu-left-search-h"
            >
              <span className="sayu-left-acc-chev" aria-hidden>
                {chev(open.search)}
              </span>
              <span>검색 스니펫</span>
            </button>
            {open.search && (
              <div
                className="sayu-left-acc-body sayu-left-search-hits"
                id="sayu-left-search-body"
                role="region"
                aria-labelledby="sayu-left-search-h"
                style={
                  open.preview
                    ? { height: body.search, minHeight: MIN_B, flex: '0 0 auto' }
                    : { flex: '1 1 0', minHeight: MIN_B, overflow: 'auto' }
                }
              >
                {searchHits.length > 0 ? (
                  searchHits.slice(0, 8).map((h) => (
                    <button
                      type="button"
                      key={`${h.path}-${h.section}`}
                      className="sayu-snippet"
                      onClick={() => onFileClick(h.path)}
                      title="프리뷰로 열기"
                    >
                      <strong style={{ color: 'var(--accent)' }}>{h.path}</strong>
                      <span className="sayu-citation"> {h.citation || ''}</span>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{(h.snippet || '').slice(0, 200)}</div>
                    </button>
                  ))
                ) : (
                  <p className="sayu-left-empty">채팅 질의 후 이전과 같은 로컬 검색 결과가 여기에 표시됩니다.</p>
                )}
              </div>
            )}
          </section>

          {showG2 && (
            <div
              className="sayu-h-grip"
              role="separator"
              aria-orientation="horizontal"
              aria-label="검색·프리뷰 영역의 높이 조절"
              onMouseDown={onGrip2Down}
            />
          )}

          <section className="sayu-left-acc sayu-left-acc--preview" aria-label="문서 프리뷰">
            <button
              type="button"
              className="sayu-left-acc-hd"
              onClick={() => setSectionOpen('preview')}
              aria-expanded={open.preview}
              aria-controls="sayu-left-preview-body"
              id="sayu-left-preview-h"
            >
              <span className="sayu-left-acc-chev" aria-hidden>
                {chev(open.preview)}
              </span>
              <span>프리뷰</span>
            </button>
            {open.preview && (
              <div
                className="sayu-left-acc-body sayu-left-preview"
                id="sayu-left-preview-body"
                role="region"
                aria-labelledby="sayu-left-preview-h"
                style={{ flex: '1 1 0', minHeight: MIN_B, minWidth: 0, overflow: 'auto' }}
              >
                {previewPath ? (
                  <>
                    <h2 className="sayu-left-preview-title">· {previewPath}</h2>
                    <div className="sayu-left-preview-apply">
                      <button
                        type="button"
                        className="sayu-btn sayu-btn-compact"
                        onClick={() => onPreviewApply && onPreviewApply()}
                        disabled={
                          !previewMd?.trim() || previewMergeBusy || chatBusy
                        }
                        title="LLM이 프리뷰 문서를 편집 중인 본문에 자연스럽게 합칩니다"
                      >
                        {previewMergeBusy ? '합병 중…' : '적용'}
                      </button>
                      {previewMergeBusy && (
                        <button
                          type="button"
                          className="sayu-btn secondary sayu-btn-compact"
                          onClick={() => onCancelPreviewMerge && onCancelPreviewMerge()}
                          title="합병 취소"
                        >
                          취소
                        </button>
                      )}
                    </div>
                    <div className="sayu-tiptap-wrap sayu-tiptap-wrap--preview">
                      <div
                        className="tiptap ProseMirror"
                        dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(previewMd || '') }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="sayu-left-empty" style={{ margin: 0 }}>
                    트리에서 파일을 클릭(프리뷰)하거나, 검색 스니펫을 클릭하세요.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
