import React, { useCallback, useEffect, useRef, useState } from 'react'
import LeftPanelStack from './LeftPanelStack'
import SayuStatusBar from './shell/SayuStatusBar'
import SayuEditorColumn from './shell/SayuEditorColumn'
import SayuChatColumn from './shell/SayuChatColumn'
import SayuInlinePop from './shell/SayuInlinePop'
import { getOrCreateSseClientId } from '../sseClientId'
import { fetchLlmModelList, getStoredLlmModel, setStoredLlmModel, groupModelsByProvider } from '../llmModels'

const API = '/api/sayu'

async function sayuFetch(path, opts) {
  const r = await fetch(`${API}${path}`, opts)
  if (!r.ok) {
    const t = await r.text()
    throw new Error(t || r.statusText)
  }
  const ct = r.headers.get('content-type') || ''
  if (ct.includes('application/json')) return r.json()
  return r.text()
}

function isModKey(e) {
  return e.metaKey || e.ctrlKey
}

/**
 * LLM이 response에 JSON 문자열로 반환하는 경우:
 * { "assistant_message": "...", "document_edit": { "file": "...", "content": "..." } }
 * 펜스(```json)로 감싸진 경우도 시도.
 */
function parseLlmResponseBody(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) {
    return { displayText: '', insertMarkdown: '', documentEditFile: null }
  }
  let toParse = trimmed
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed)
  if (fence) {
    toParse = fence[1].trim()
  }
  try {
    const o = JSON.parse(toParse)
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const am = o.assistant_message
      const de = o.document_edit
      const hasAm = typeof am === 'string'
      const fromEdit = de && typeof de.content === 'string' ? de.content : ''
      const fileHint = de && typeof de.file === 'string' ? de.file : null
      if (hasAm || fromEdit) {
        const displayText = hasAm ? am : fromEdit
        const insertMarkdown = fromEdit || (hasAm ? am : trimmed)
        return {
          displayText: displayText || trimmed,
          insertMarkdown: insertMarkdown || trimmed,
          documentEditFile: fileHint,
        }
      }
    }
  } catch {
    /* 일반 텍스트 */
  }
  return { displayText: trimmed, insertMarkdown: trimmed, documentEditFile: null }
}

function newMsgId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const LS_LEFT_W = 'sayu-panel-left-w'
const LS_RIGHT_W = 'sayu-panel-right-w'

const PREVIEW_MERGE_MESSAGE = `프리뷰로 열어둔 문서(아래 "활성 컨텍스트")를 지금 편집 중인 본문("현재 본문(마크다운)")에 자연스럽게 합쳐 주세요.
톤·제목 수준·목록을 맞추고, 중복 문단은 합치며, 모순은 편집 중인 문서를 우선합니다.
반드시 JSON 한 객체만 응답(코드펜스 사용 금지):
{"assistant_message": "짧은 한 줄 요약","document_edit": {"file": null, "content": "합쳐진 본문 전체 마크다운"}}
content에는 병합된 전체 문서만 넣습니다.`

function readStoredPanelWidth(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const n = parseInt(localStorage.getItem(key) || '', 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function toHistoryPayload(msgs) {
  return msgs
    .filter((x) => x.role === 'user' || x.role === 'assistant')
    .map((x) => ({
      role: x.role === 'user' ? 'user' : 'assistant',
      content: x.text || '',
    }))
}

export default function SayuWidget({ serviceName, defaultModel, events, onAction }) {
  const [leftOpen, setLeftOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(true)
  const [inlineOpen, setInlineOpen] = useState(false)
  const [inlineText, setInlineText] = useState('')

  const [vaultPath, setVaultPath] = useState('')
  const [indexState, setIndexState] = useState({ status: 'idle', file_count: 0, chunk_count: 0 })
  const [files, setFiles] = useState([])
  const [previewPath, setPreviewPath] = useState('')
  const [previewMd, setPreviewMd] = useState('')

  const [activeDoc, setActiveDoc] = useState({ id: 'session', md: '' })
  const [editorMd, setEditorMd] = useState('')
  const editorRef = useRef(null)
  const chatInputRef = useRef(null)
  const inlineRef = useRef(null)

  const [messages, setMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [previewMergeBusy, setPreviewMergeBusy] = useState(false)
  const [lastInsertMd, setLastInsertMd] = useState('')
  const [searchHits, setSearchHits] = useState([])
  const [treeFilter, setTreeFilter] = useState('')
  const [chatListExpanded, setChatListExpanded] = useState(true)
  const [llmModels, setLlmModels] = useState([])
  const [llmModelsError, setLlmModelsError] = useState(null)
  const [selectedModel, setSelectedModel] = useState(() => getStoredLlmModel(defaultModel || 'openai/gpt-oss-120b'))

  const [leftPanelWidth, setLeftPanelWidth] = useState(() => readStoredPanelWidth(LS_LEFT_W, 380))
  const [rightPanelWidth, setRightPanelWidth] = useState(() => readStoredPanelWidth(LS_RIGHT_W, 400))
  const [layoutNarrow, setLayoutNarrow] = useState(false)
  const [panelResizing, setPanelResizing] = useState(false)
  const mainRef = useRef(null)
  const lastLeftWRef = useRef(leftPanelWidth)
  const lastRightWRef = useRef(rightPanelWidth)

  const pendingIdRef = useRef(null)
  const previewMergePendingIdRef = useRef(null)
  const mergeRunRef = useRef(null)
  const cancelledRequestIdsRef = useRef(new Set())
  const chatRunRef = useRef(null)
  const eventsRef = useRef(events)
  const onActionRef = useRef(onAction)
  const messagesRef = useRef(messages)
  const previewPathRef = useRef(previewPath)
  const previewMdRef = useRef('')
  const editorMdRef = useRef(editorMd)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  useEffect(() => {
    previewPathRef.current = previewPath
  }, [previewPath])
  useEffect(() => {
    previewMdRef.current = previewMd
  }, [previewMd])
  useEffect(() => {
    editorMdRef.current = editorMd
  }, [editorMd])

  useEffect(() => {
    eventsRef.current = events
    onActionRef.current = onAction
  }, [events, onAction])

  useEffect(() => {
    if (defaultModel) {
      setSelectedModel((cur) => cur || defaultModel)
    }
  }, [defaultModel])

  useEffect(() => {
    setStoredLlmModel(selectedModel)
  }, [selectedModel])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLlmModelsError(null)
      try {
        const list = await fetchLlmModelList()
        if (cancel) return
        setLlmModels(list)
        setSelectedModel((cur) => {
          if (list.some((x) => x && x.name === cur)) return cur
          if (defaultModel && list.some((x) => x && x.name === defaultModel)) return defaultModel
          return list[0] && list[0].name ? list[0].name : cur
        })
      } catch (e) {
        if (!cancel) setLlmModelsError(e.message || String(e))
      }
    })()
    return () => {
      cancel = true
    }
  }, [defaultModel])

  useEffect(() => {
    lastLeftWRef.current = leftPanelWidth
  }, [leftPanelWidth])
  useEffect(() => {
    lastRightWRef.current = rightPanelWidth
  }, [rightPanelWidth])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 900px)')
    const update = () => setLayoutNarrow(!!mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const onLeftPanelGripDown = useCallback(
    (e) => {
      if (e.button !== 0 || layoutNarrow) return
      e.preventDefault()
      const startX = e.clientX
      const startW = leftPanelWidth
      setPanelResizing(true)
      const onMove = (ev) => {
        const mw = mainRef.current?.getBoundingClientRect().width ?? 1200
        const maxW = Math.min(800, Math.floor(mw * 0.5))
        const w = Math.round(clamp(startW + (ev.clientX - startX), 200, maxW))
        setLeftPanelWidth(w)
        lastLeftWRef.current = w
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        setPanelResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        try {
          localStorage.setItem(LS_LEFT_W, String(lastLeftWRef.current))
        } catch {
          /* ignore */
        }
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [leftPanelWidth, layoutNarrow]
  )

  const onRightPanelGripDown = useCallback(
    (e) => {
      if (e.button !== 0 || layoutNarrow) return
      e.preventDefault()
      const startX = e.clientX
      const startW = rightPanelWidth
      setPanelResizing(true)
      const onMove = (ev) => {
        const mw = mainRef.current?.getBoundingClientRect().width ?? 1200
        const maxW = Math.min(900, Math.floor(mw * 0.55))
        // 그립이 패널 왼쪽 경계이므로, 마우스를 왼쪽으로 끌면 패널이 넓어짐(오른쪽이면 좁아짐)
        const w = Math.round(clamp(startW - (ev.clientX - startX), 280, maxW))
        setRightPanelWidth(w)
        lastRightWRef.current = w
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        setPanelResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        try {
          localStorage.setItem(LS_RIGHT_W, String(lastRightWRef.current))
        } catch {
          /* ignore */
        }
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [rightPanelWidth, layoutNarrow]
  )

  const refreshConfig = useCallback(async () => {
    try {
      const j = await sayuFetch('/config')
      setVaultPath(j.vault_path || '')
      setIndexState(j.index || { status: 'unknown' })
    } catch (e) {
      setVaultPath('')
      setIndexState({ status: 'error', detail: String(e.message || e) })
    }
  }, [])

  const refreshTree = useCallback(async () => {
    try {
      const j = await sayuFetch('/tree')
      setFiles(Array.isArray(j.files) ? j.files : [])
    } catch {
      setFiles([])
    }
  }, [])

  useEffect(() => {
    refreshConfig()
    refreshTree()
    const t = setInterval(refreshConfig, 8000)
    return () => clearInterval(t)
  }, [refreshConfig, refreshTree])

  useEffect(() => {
    const cid = getOrCreateSseClientId()
    const url =
      cid && typeof encodeURIComponent !== 'undefined'
        ? `/api/events/stream?client_id=${encodeURIComponent(cid)}&targeted_only=1`
        : '/api/events/stream'
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const type = data.type || data.event_type
        if (type === 'SSE_CONNECTED') return
        const payload = data.payload !== undefined ? data.payload : data
        if (type === 'CHAT_RESPONSE') {
          const rid = payload?.request_id || payload?.requestId
          if (rid && cancelledRequestIdsRef.current.has(rid)) {
            cancelledRequestIdsRef.current.delete(rid)
            return
          }
          const isPreviewMerge =
            rid &&
            previewMergePendingIdRef.current &&
            rid === previewMergePendingIdRef.current
          if (isPreviewMerge) {
            previewMergePendingIdRef.current = null
            mergeRunRef.current = null
            setPreviewMergeBusy(false)
            if (payload?.success === false) {
              const err = payload?.error || '응답 실패'
              setMessages((m) => [
                ...m,
                { id: newMsgId(), role: 'assistant', text: `프리뷰 합병 실패: ${err}`, asMarkdown: false },
              ])
              return
            }
            const raw = (payload?.response ?? '').toString()
            const { displayText, insertMarkdown } = parseLlmResponseBody(raw)
            const md = (insertMarkdown || displayText || '').trim()
            if (md) {
              setActiveDoc({ id: `merged-${newMsgId()}`, md })
              setEditorMd(md)
              setLastInsertMd(md)
            }
            setMessages((m) => [
              ...m,
              {
                id: newMsgId(),
                role: 'assistant',
                text:
                  md && displayText
                    ? `**프리뷰 본문 합병** — ${displayText}`
                    : md
                      ? '프리뷰 내용을 편집기 본문에 합쳤습니다.'
                      : '합병 결과가 비어 있습니다. 응답 형식(JSON)을 확인하세요.',
                asMarkdown: true,
              },
            ])
            return
          }
          if (pendingIdRef.current == null) {
            return
          }
          if (rid && rid !== pendingIdRef.current) {
            return
          }
          pendingIdRef.current = null
          setChatBusy(false)
          if (payload?.success === false) {
            const err = payload?.error || '응답 실패'
            setMessages((m) => [
              ...m,
              { id: newMsgId(), role: 'assistant', text: `오류: ${err}`, asMarkdown: false },
            ])
            return
          }
          const raw = (payload?.response ?? '').toString()
          const { displayText, insertMarkdown, documentEditFile } = parseLlmResponseBody(raw)
          setLastInsertMd(insertMarkdown)
          setMessages((m) => [
            ...m,
            {
              id: newMsgId(),
              role: 'assistant',
              text: displayText,
              asMarkdown: true,
              documentEditFile,
            },
          ])
        }
      } catch {
        /* */
      }
    }
    return () => es.close()
  }, [])

  const openFilePreview = useCallback(async (relPath) => {
    setLeftOpen(true)
    setPreviewPath(relPath)
    try {
      const j = await sayuFetch(`/file?path=${encodeURIComponent(relPath)}`)
      setPreviewMd(j.content || '')
    } catch {
      setPreviewMd('*파일을 불러오지 못했습니다.*')
    }
  }, [])

  const openFileInEditor = useCallback(async (relPath) => {
    try {
      const j = await sayuFetch(`/file?path=${encodeURIComponent(relPath)}`)
      const content = j.content || ''
      setActiveDoc({ id: relPath, md: content })
      setEditorMd(content)
      setPreviewPath(relPath)
      setPreviewMd(content)
    } catch {
      /* */
    }
  }, [])

  const createNewDocument = useCallback(() => {
    const current =
      (typeof editorRef.current?.getMarkdown === 'function' && editorRef.current.getMarkdown()) || editorMd || ''
    if (current.trim()) {
      const ok = typeof window !== 'undefined' && window.confirm('작성 중인 내용이 있습니다. 새 문서로 전환하시겠습니까?')
      if (!ok) return
    }
    setActiveDoc({ id: `new-${newMsgId()}`, md: '' })
    setEditorMd('')
    setPreviewPath('')
    setPreviewMd('')
  }, [editorMd])

  useEffect(() => {
    const t = setTimeout(() => {
      if (editorRef.current && typeof editorRef.current.focus === 'function') {
        editorRef.current.focus()
      }
    }, 0)
    return () => clearTimeout(t)
  }, [activeDoc.id])

  const throwIfChatCancelled = (run) => {
    if (run?.cancelled) {
      const e = new Error('cancelled')
      e.code = 'CHAT_CANCEL'
      throw e
    }
  }

  const buildContextFromSearch = async (userMessage, run) => {
    const lines = [
      '다음은 로컬 볼트 하이브리드 검색으로 수집한 발췌입니다. 답변 시 사실은 이 인용에 근거하고, 출처는 반드시 [[파일명#섹션]] 형식의 옵시디언 링크로 표기하세요.',
    ]
    throwIfChatCancelled(run)
    const s = await sayuFetch(`/search?q=${encodeURIComponent(userMessage)}&limit=12`)
    throwIfChatCancelled(run)
    const hits = s.hits || []
    setSearchHits(hits)
    for (const h of hits) {
      lines.push(
        `---\n파일: ${h.path}\n섹션: ${h.section || '(제목 없음)'}\n점수: ${h.score != null ? Number(h.score).toFixed(4) : h.score}\n`,
      )
      lines.push((h.snippet || '').slice(0, 4000))
    }
    if (hits.length === 0) {
      lines.push('(검색 결과 없음 — 일반 지식으로만 답할 경우 그 사실을 밝히세요.)')
    }
    try {
      const it = await sayuFetch(`/intent?q=${encodeURIComponent(userMessage)}`)
      throwIfChatCancelled(run)
      if (it && (it.file_hint || it.section_hint)) {
        lines.push(`\n[추출된 의도 힌트] ${JSON.stringify(it, null, 0)}`)
      }
    } catch (e) {
      if (e && e.code === 'CHAT_CANCEL') throw e
      /* intent 실패는 무시 */
    }
    return lines.join('\n')
  }

  const cancelCurrentChat = useCallback(() => {
    if (!pendingIdRef.current) return
    const run = chatRunRef.current
    if (run) run.cancelled = true
    const id = pendingIdRef.current
    cancelledRequestIdsRef.current.add(id)
    pendingIdRef.current = null
    setChatBusy(false)
    setMessages((m) => [
      ...m,
      { id: newMsgId(), role: 'assistant', text: '요청이 취소되었습니다.', asMarkdown: false },
    ])
  }, [])

  const cancelPreviewMerge = useCallback(() => {
    const id = previewMergePendingIdRef.current
    if (!id) return
    const r = mergeRunRef.current
    if (r) r.cancelled = true
    cancelledRequestIdsRef.current.add(id)
    previewMergePendingIdRef.current = null
    setPreviewMergeBusy(false)
    setMessages((m) => [
      ...m,
      { id: newMsgId(), role: 'assistant', text: '프리뷰 합병이 취소되었습니다.', asMarkdown: false },
    ])
  }, [])

  const applyPreviewMerge = useCallback(async () => {
    if (!onActionRef.current) return
    if (chatBusy || previewMergeBusy) return
    const p = previewPathRef.current
    const previewBody = (previewMdRef.current || '').trim()
    if (!p) return
    if (!previewBody) {
      if (typeof window !== 'undefined') window.alert('프리뷰에 가져올 내용이 없습니다. 트리에서 파일을 먼저 열어 주세요.')
      return
    }
    const editor_content = editorRef.current?.getMarkdown?.() || editorMdRef.current || ''
    const requestId = newMsgId()
    const run = { cancelled: false }
    mergeRunRef.current = run
    previewMergePendingIdRef.current = requestId
    setPreviewMergeBusy(true)
    const context_content = `## 합병에 사용할 프리뷰 문서: ${p}\n\n${previewBody}`
    try {
      await onActionRef.current('onChatMessage', {
        message: PREVIEW_MERGE_MESSAGE,
        request_id: requestId,
        requestId,
        editor_content,
        context_content,
        document_title: p,
        model: (selectedModel || defaultModel || '').trim() || undefined,
        history: [],
        client_op: 'preview_merge',
      })
    } catch {
      setPreviewMergeBusy(false)
      previewMergePendingIdRef.current = null
      mergeRunRef.current = null
    }
    if (run.cancelled) {
      if (requestId) cancelledRequestIdsRef.current.add(requestId)
      setPreviewMergeBusy(false)
      previewMergePendingIdRef.current = null
    }
  }, [chatBusy, previewMergeBusy, defaultModel, selectedModel])

  const publishChatCore = async (userText, historyBuilt) => {
    if (previewMergeBusy) return
    if (!onActionRef.current) return
    const run = { cancelled: false }
    chatRunRef.current = run
    setChatBusy(true)
    const requestId = newMsgId()
    pendingIdRef.current = requestId
    let context_content = ''
    try {
      context_content = await buildContextFromSearch(userText, run)
    } catch (e) {
      if (e && e.code === 'CHAT_CANCEL') {
        setChatBusy(false)
        pendingIdRef.current = null
        return
      }
      context_content = `로컬 검색 컨텍스트 수집 실패: ${e.message || e}`
    }
    if (run.cancelled) {
      setChatBusy(false)
      pendingIdRef.current = null
      return
    }
    const editor_content = editorRef.current?.getMarkdown?.() || editorMdRef.current
    try {
      await onActionRef.current('onChatMessage', {
        message: userText,
        request_id: requestId,
        requestId,
        editor_content,
        context_content,
        document_title: previewPathRef.current || 'Sa-Yu',
        model: (selectedModel || defaultModel || '').trim() || undefined,
        history: historyBuilt,
      })
    } catch {
      setChatBusy(false)
      pendingIdRef.current = null
      return
    }
    if (run.cancelled) {
      if (requestId) cancelledRequestIdsRef.current.add(requestId)
      setChatBusy(false)
      pendingIdRef.current = null
    }
  }

  const sendChat = async (raw, { fromInline } = {}) => {
    if (previewMergeBusy) return
    const message = (raw || '').trim()
    if (!message) return
    const prior = messagesRef.current
    const historyBuilt = [...toHistoryPayload(prior).slice(-19), { role: 'user', content: message }]
    const userMsg = { id: newMsgId(), role: 'user', text: message, asMarkdown: false }
    setMessages([...prior, userMsg])
    if (!fromInline) setChatInput('')
    else {
      setInlineText('')
      setInlineOpen(false)
    }
    await publishChatCore(message, historyBuilt)
  }

  const deleteMessageAt = (index) => {
    if (chatBusy || previewMergeBusy) return
    setMessages((m) => m.filter((_, j) => j !== index))
  }

  const retryUserMessageAt = async (index) => {
    if (chatBusy || previewMergeBusy) return
    const cur = messagesRef.current
    const m = cur[index]
    if (!m || m.role !== 'user') return
    const t = m.text
    const before = cur.slice(0, index)
    const userMsg = { id: newMsgId(), role: 'user', text: t, asMarkdown: false }
    setMessages([...before, userMsg])
    const historyBuilt = [...toHistoryPayload(before).slice(-19), { role: 'user', content: t }]
    await publishChatCore(t, historyBuilt)
  }

  const lastMessageOneLine = () => {
    if (messages.length === 0) return '대화 없음'
    const last = messages[messages.length - 1]
    const t = (last.text || '').split(/\n/)[0].trim()
    return t.length > 90 ? `${t.slice(0, 90)}…` : t || '(빈 메시지)'
  }

  const modelGroups = groupModelsByProvider(llmModels)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'k' && isModKey(e)) {
        e.preventDefault()
        setChatOpen((o) => !o)
        queueMicrotask(() => chatInputRef.current?.focus?.())
        return
      }
      if (e.key === '\\' && isModKey(e)) {
        e.preventDefault()
        setLeftOpen((o) => !o)
        return
      }
      if (e.key === 'j' && isModKey(e)) {
        e.preventDefault()
        setInlineOpen((o) => !o)
        queueMicrotask(() => inlineRef.current?.focus?.())
        return
      }
      if (e.key === 'Enter' && isModKey(e)) {
        e.preventDefault()
        if (lastInsertMd && editorRef.current?.insertFromMarkdown) {
          editorRef.current.insertFromMarkdown(`\n\n${lastInsertMd}\n\n`)
        }
        return
      }
      if (e.key === 'Escape') {
        setInlineOpen(false)
        setChatOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lastInsertMd])

  const statusLabel =
    indexState.status === 'indexing'
      ? '인덱싱 중'
      : indexState.status === 'ready'
        ? '준비됨'
        : indexState.status === 'error'
          ? '인덱스 오류'
          : '대기'

  return (
    <div className="app-sayu">
      <SayuStatusBar
        serviceName={serviceName}
        vaultPath={vaultPath}
        indexState={indexState}
        statusLabel={statusLabel}
      />

      <div
        className={`sayu-main${panelResizing ? ' sayu-main--resizing' : ''}`}
        ref={mainRef}
      >
        <aside
          className={`sayu-left ${leftOpen ? 'open' : ''}`}
          style={
            !leftOpen
              ? { width: 0 }
              : !layoutNarrow
                ? { width: leftPanelWidth }
                : undefined
          }
        >
          <LeftPanelStack
            files={files}
            treeFilter={treeFilter}
            onTreeFilterChange={setTreeFilter}
            searchHits={searchHits}
            previewPath={previewPath}
            previewMd={previewMd}
            onFileClick={openFilePreview}
            onFileDoubleClick={openFileInEditor}
            panelOpen={leftOpen}
            onPreviewApply={applyPreviewMerge}
            onCancelPreviewMerge={cancelPreviewMerge}
            previewMergeBusy={previewMergeBusy}
            chatBusy={chatBusy}
          />
        </aside>

        {!layoutNarrow && leftOpen && (
          <div
            className="sayu-panel-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label="자료 패널 너비 조절"
            onMouseDown={onLeftPanelGripDown}
          />
        )}

        <SayuEditorColumn
          activeDoc={activeDoc}
          editorRef={editorRef}
          onChange={setEditorMd}
          previewPath={previewPath}
          onNewDocument={createNewDocument}
        />

        {!layoutNarrow && chatOpen && (
          <div
            className="sayu-panel-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label="채팅 패널 너비 조절"
            onMouseDown={onRightPanelGripDown}
          />
        )}

        <aside
          className={`sayu-right ${chatOpen ? 'open' : ''}`}
          style={
            !chatOpen
              ? { width: 0 }
              : !layoutNarrow
                ? { width: rightPanelWidth }
                : undefined
          }
        >
          <SayuChatColumn
            messages={messages}
            chatListExpanded={chatListExpanded}
            setChatListExpanded={setChatListExpanded}
            chatInputRef={chatInputRef}
            chatInput={chatInput}
            setChatInput={setChatInput}
            chatBusy={chatBusy}
            previewMergeBusy={previewMergeBusy}
            lastInsertMd={lastInsertMd}
            editorRef={editorRef}
            modelGroups={modelGroups}
            llmModels={llmModels}
            llmModelsError={llmModelsError}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            sendChat={sendChat}
            deleteMessageAt={deleteMessageAt}
            retryUserMessageAt={retryUserMessageAt}
            cancelCurrentChat={cancelCurrentChat}
            cancelPreviewMerge={cancelPreviewMerge}
            lastMessageOneLine={lastMessageOneLine}
            setChatOpen={setChatOpen}
          />
        </aside>
      </div>

      <SayuInlinePop
        inlineOpen={inlineOpen}
        inlineText={inlineText}
        setInlineText={setInlineText}
        inlineRef={inlineRef}
        chatBusy={chatBusy}
        previewMergeBusy={previewMergeBusy}
        sendChat={sendChat}
        cancelCurrentChat={cancelCurrentChat}
        cancelPreviewMerge={cancelPreviewMerge}
        setInlineOpen={setInlineOpen}
      />

      <footer className="sayu-app-footer" role="contentinfo" aria-label="단축키 안내">
        <div className="sayu-kbd-hints">
          <span>
            <kbd className="sayu-kbd">⌘</kbd>
            <kbd className="sayu-kbd">K</kbd> 채팅
          </span>
          <span className="sayu-kbd-sep" aria-hidden>
            ·
          </span>
          <span>
            <kbd className="sayu-kbd">⌘</kbd>
            <kbd className="sayu-kbd">\</kbd> 왼쪽 패널
          </span>
          <span className="sayu-kbd-sep" aria-hidden>
            ·
          </span>
          <span>
            <kbd className="sayu-kbd">⌘</kbd>
            <kbd className="sayu-kbd">J</kbd> 인라인
          </span>
          <span className="sayu-kbd-sep" aria-hidden>
            ·
          </span>
          <span>
            <kbd className="sayu-kbd">⌘</kbd>
            <kbd className="sayu-kbd">Enter</kbd> 본문 삽입
          </span>
        </div>
        <span className="sayu-app-footer__note">Ctrl 키도 동일</span>
      </footer>
    </div>
  )
}
