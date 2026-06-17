import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import qrcodeReact from 'qrcode.react'
import QRScanner from './QRScanner'
import { pwaFetchJson } from '../pwa/api'
import {
  buildTsplQrLabelCommands,
  jspmGetPrinters,
  jspmSendRawTspl,
} from '../utils/tscTspl'
import {
  getAuthorizedUsbPrinters,
  isWebUsbSupported,
  pairWebUsbLabelPrinter,
  sendTsplViaWebUSB,
} from '../utils/webUsbTspl'
import './QrDrawingManagerWidget.css'

const QRCodeSVG = qrcodeReact.QRCodeSVG || qrcodeReact

const QR_PREFIX = 'DQ'
const QR_VERSION = '1'

const SSE_CLIENT_ID_KEY = 'sagohub_sse_client_id'

function getOrCreateSseClientId() {
  try {
    const existing = sessionStorage.getItem(SSE_CLIENT_ID_KEY)
    if (existing) return existing
    const v =
      (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
      `sid_${Date.now()}_${Math.random().toString(16).slice(2)}`
    sessionStorage.setItem(SSE_CLIENT_ID_KEY, v)
    return v
  } catch (_) {
    return `sid_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function ImageZoomPanel({
  title,
  pages,
  selectedPageId,
  showFullViewButton = false,
  onFullView,
  simpleImageMode = false,
}) {
  if (!pages?.length) {
    return (
      <div className="qdg-panel qdg-panel--empty">
        <h3>{title}</h3>
        <p className="qdg-muted">표시할 도면이 없습니다.</p>
      </div>
    )
  }

  const transformRef = useRef(null)

  const active =
    (selectedPageId
      ? pages.find((p) => String(p.id || p.page_id) === String(selectedPageId))
      : null) || pages[0]

  const handleFullView = () => {
    const activeId = active?.id || active?.page_id
    if (onFullView && activeId) {
      onFullView(activeId)
      return
    }
    // onFullView가 없으면 "레이아웃 초기화" 정도로 동작
    const api = transformRef.current
    try {
      api?.resetTransform?.()
      api?.centerView?.(undefined, 1)
    } catch (_) {
      // 메서드가 없으면 무시
    }
  }

  return (
    <div className="qdg-panel">
      <div className="qdg-panel__header">
        <h3 className="qdg-panel__title">{title}</h3>
        <div className="qdg-panel__meta">
          페이지 {active.page_number} {active.upload_id ? <span className="qdg-tag">업로드 {active.upload_id.slice(0, 8)}…</span> : null}
        </div>
        {!simpleImageMode && showFullViewButton && (
          <button type="button" className="qdg-fullview-btn" onClick={handleFullView}>
            전체보기
          </button>
        )}
      </div>

      <div className="qdg-page-block">
        {simpleImageMode ? (
          <div className="qdg-simple-image-wrap">
            <img
              title={`img-${active.id || active.page_id}`}
              src={active.image_url || active.file_url}
              className="qdg-image-img qdg-simple-image-clickable"
              alt={`drawing-${active.page_number || ''}`}
              onClick={() => {
                const activeId = active?.id || active?.page_id
                if (activeId) handleFullView()
              }}
              onError={(e) => {
                const img = e.currentTarget
                img.onerror = null
                img.src = active.file_url
              }}
            />
          </div>
        ) : (
          <TransformWrapper
            ref={transformRef}
            initialScale={1}
            minScale={0.25}
            maxScale={4}
            centerOnInit
            wheel={{ step: 0.1 }}
          >
            <TransformComponent wrapperClass="qdg-zoom-wrap" contentClass="qdg-zoom-inner">
              <img
                title={`img-${active.id || active.page_id}`}
                src={active.image_url || active.file_url}
                className="qdg-image-img"
                alt={`drawing-${active.page_number || ''}`}
                onError={(e) => {
                  const img = e.currentTarget
                  img.onerror = null
                  img.src = active.file_url
                }}
              />
            </TransformComponent>
          </TransformWrapper>
        )}
      </div>
    </div>
  )
}

function UploadPagesPicker({ pages, selectedId, onSelect }) {
  if (!pages?.length) return null
  return (
    <div className="qdg-picker">
      {pages.map((p) => {
        const active = String(p.page_id) === String(selectedId)
        return (
          <button
            key={p.page_id}
            type="button"
            className={`qdg-picker-btn ${active ? 'qdg-picker-btn--active' : ''}`}
            onClick={() => onSelect?.(p.page_id)}
          >
            {p.page_number}
          </button>
        )
      })}
    </div>
  )
}

function GroupPagesPicker({ pages, selectedId, onSelect }) {
  if (!pages?.length) return null
  return (
    <div className="qdg-picker qdg-picker--group">
      {pages.map((p) => {
        const active = String(p.id) === String(selectedId)
        return (
          <button
            key={p.id}
            type="button"
            className={`qdg-picker-btn ${active ? 'qdg-picker-btn--active' : ''}`}
            onClick={() => onSelect?.(p.id)}
          >
            {p.page_number}
          </button>
        )
      })}
    </div>
  )
}

function parseDrawingQr(text) {
  if (!text || typeof text !== 'string') return null
  const s = text.trim()
  const parts = s.split('|')
  if (parts.length === 3 && parts[0] === 'DQ' && parts[1] === '1') {
    return parts[2]
  }
  return null
}

/** 서버(SSE/HTTP)에서 온 페이지 항목을 화면용으로 통일 */
function normalizeUploadPage(p) {
  if (!p || typeof p !== 'object') return null
  const pageId = p.page_id || p.id
  if (!pageId) return null
  const qs = (p.qr_string || '').trim()
  return {
    page_id: pageId,
    page_number: p.page_number ?? 0,
    qr_string: qs,
    file_url: p.file_url || `/api/drawing-qr/pages/${pageId}/file`,
    image_url: p.image_url || p.image_file_url || `/api/drawing-qr/pages/${pageId}/image`,
  }
}

function normalizeUploadPages(arr) {
  if (!Array.isArray(arr)) return []
  return arr.map(normalizeUploadPage).filter(Boolean)
}

function openPrintQrWindow(qrString) {
  if (!qrString) return
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(
    `<!DOCTYPE html><html><head><title>QR 인쇄</title></head><body style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif"><div style="text-align:center"><div id="q"></div><p style="margin-top:16px;font-size:12px;word-break:break-all;max-width:400px">${qrString}</p></div><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script><script>new QRCode(document.getElementById("q"),{text:${JSON.stringify(
      qrString
    )},width:256,height:256});setTimeout(function(){window.print();window.close()},300)</script></body></html>`
  )
  w.document.close()
}

function openPrintProjectDrawingsWindow({ projectName, pages }) {
  if (!Array.isArray(pages) || pages.length === 0) return
  const w = window.open('', '_blank')
  if (!w) return

  const prepared = pages
    .map((p, i) => {
      const pageId = p.page_id || p.id
      const pageNumber = p.page_number ?? i + 1
      const qrString = (p.qr_string || '').trim() || (pageId ? `${QR_PREFIX}|${QR_VERSION}|${pageId}` : '')
      const imageUrl = p.image_url || p.file_url || ''
      return {
        pageNumber,
        qrString,
        imageUrl,
      }
    })
    .filter((p) => p.pageNumber != null)

  const printItemsHtml = prepared
    .map(
      (p, i) => `
    <section class="print-item">
      <div class="print-drawing">
        <div class="print-label">P${p.pageNumber}</div>
        <img class="print-img" src=${JSON.stringify(p.imageUrl)} alt="drawing-${p.pageNumber}" />
      </div>
      <div class="print-qr">
        <div class="print-qr-box" id="q-${i}"></div>
        <div class="print-qr-text">${p.qrString || ''}</div>
      </div>
    </section>
  `
    )
    .join('\n')

  w.document.write(`<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${projectName ? String(projectName) : '도면 인쇄'}</title>
      <style>
        @media print {
          .print-item { page-break-after: always; }
        }
        body { font-family: sans-serif; margin: 0; padding: 12mm; color: #111827; }
        h2 { margin: 0 0 10mm 0; font-size: 16px; }
        .print-item { display: flex; gap: 12px; align-items: flex-start; }
        .print-drawing { flex: 1; min-width: 0; }
        .print-label { font-weight: 800; margin-bottom: 6px; }
        .print-img { width: 100%; max-width: 1200px; max-height: 180mm; object-fit: contain; border: 1px solid #d1d5db; border-radius: 6px; }
        .print-qr { width: 170px; }
        .print-qr-box { width: 128px; height: 128px; border: 1px solid #d1d5db; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
        .print-qr-text { margin-top: 8px; font-size: 10px; word-break: break-all; }
      </style>
    </head>
    <body>
      <h2>${projectName ? String(projectName) : '프로젝트 도면'} (도면 + QR)</h2>
      ${printItemsHtml}
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
      <script>
        const pages = ${JSON.stringify(
          prepared.map((p) => ({ qrString: p.qrString || '', pageNumber: p.pageNumber }))
        )};

        function waitForAllImages() {
          const imgs = Array.from(document.querySelectorAll('.print-img'));
          if (imgs.length === 0) return Promise.resolve();
          return Promise.all(
            imgs.map((img) => {
              if (img.complete) return Promise.resolve();
              return new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
              });
            })
          );
        }

        async function startPrint() {
          pages.forEach((p, idx) => {
            const el = document.getElementById('q-' + idx);
            if (!el || !p.qrString) return;
            new QRCode(el, { text: p.qrString, width: 128, height: 128 });
          });

          await waitForAllImages();
          // 레이아웃 반영 여유
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          window.print();
        }

        window.addEventListener('afterprint', function () {
          window.close();
        });

        startPrint();
      </script>
    </body>
  </html>`)
  w.document.close()
}

function UploadResultPage({ page }) {
  const { page_number, qr_string, file_url, image_url } = page
  const copyPayload = () => {
    if (!qr_string || !navigator.clipboard?.writeText) return
    navigator.clipboard.writeText(qr_string).catch(() => {})
  }
  return (
    <div className="qdg-upload-page">
      <div className="qdg-upload-page__preview">
        <div className="qdg-upload-page__label">페이지 {page_number}</div>
        <div className="qdg-upload-page__iframe-wrap">
          <img
            title={`도면 ${page_number}`}
            src={image_url || file_url}
            className="qdg-upload-page__iframe"
            alt={`drawing-${page_number}`}
            onError={(e) => {
              const img = e.currentTarget
              img.onerror = null
              img.src = file_url
            }}
          />
        </div>
      </div>
      <div className="qdg-upload-page__qr">
        <div className="qdg-upload-page__label">이 페이지 QR</div>
        {qr_string ? (
          <div className="qdg-upload-page__qr-svg">
            <QRCodeSVG value={qr_string} size={168} level="M" includeMargin />
          </div>
        ) : (
          <p className="qdg-muted">QR 문자열 없음</p>
        )}
        <p className="qdg-upload-page__payload" title={qr_string}>
          {qr_string}
        </p>
        <div className="qdg-upload-page__actions">
          <button type="button" className="qdg-btn qdg-btn--ghost qdg-btn--sm" onClick={() => openPrintQrWindow(qr_string)} disabled={!qr_string}>
            QR 인쇄
          </button>
          <button type="button" className="qdg-btn qdg-btn--ghost qdg-btn--sm" onClick={copyPayload} disabled={!qr_string}>
            페이로드 복사
          </button>
        </div>
      </div>
    </div>
  )
}

function QrDrawingManagerWidget({ onAction, events }) {
  const [message, setMessage] = useState(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadPages, setUploadPages] = useState([])
  const [lastUploadId, setLastUploadId] = useState(null)
  const [selectedUploadPageId, setSelectedUploadPageId] = useState(null)

  const [resolved, setResolved] = useState(null)
  // stopWhen=true 이면 카메라가 시작되지 않도록 QRScanner가 제어합니다.
  const [scanStop, setScanStop] = useState(true)
  const [manualQr, setManualQr] = useState('')

  const [groupName, setGroupName] = useState('')
  const [groupSpecsText, setGroupSpecsText] = useState('{}')
  const [createKind, setCreateKind] = useState('production')

  const [addMode, setAddMode] = useState(null)
  const [activeGroup, setActiveGroup] = useState(null)
  const [scannerKey, setScannerKey] = useState(0)
  const [selectedProdPageId, setSelectedProdPageId] = useState(null)
  const [selectedInstPageId, setSelectedInstPageId] = useState(null)

  const pendingRef = useRef({})
  const fileRef = useRef(null)
  const eventSourceRef = useRef(null)

  const [sseClientId] = useState(() => getOrCreateSseClientId())

  const subscribeTypes = events?.subscribe || []

  // 탭 활성화 조건/상태 인지용 파생 값
  const prodPages = resolved?.production_pages || []
  const instPages = resolved?.installation_pages || []

  const hasUploaded = uploadPages.length > 0
  const hasResolvedPage = !!resolved?.page?.id
  const hasGroup = !!resolved?.group?.id
  const hasViewer =
    !!resolved &&
    (hasGroup || (prodPages?.length || 0) > 0 || (instPages?.length || 0) > 0)

  const [activeTab, setActiveTab] = useState('upload')

  useEffect(() => {
    const enabled = {
      upload: true,
      scan: hasUploaded,
      group: hasResolvedPage,
      viewer: hasViewer,
    }
    if (enabled[activeTab]) return
    const order = ['upload', 'scan', 'group', 'viewer']
    const next = order.find((t) => enabled[t]) || 'upload'
    setActiveTab(next)
  }, [activeTab, hasUploaded, hasResolvedPage, hasViewer])

  const setMsg = (text, type = 'info') => setMessage(text ? { text, type } : null)

  const emit = useCallback(
    async (key, payload) => {
      const rid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
      pendingRef.current[rid] = key
      await onAction(key, { ...(payload || {}), request_id: rid })
      return rid
    },
    [onAction]
  )

  useEffect(() => {
    if (!Array.isArray(subscribeTypes) || subscribeTypes.length === 0) return
    const es = new EventSource(
      `/api/events/stream?targeted_only=1&client_id=${encodeURIComponent(sseClientId)}`
    )
    console.log('SSE connected')
    eventSourceRef.current = es
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        console.log('SSE message:', ev)
        if (!ev.type || !subscribeTypes.includes(ev.type)) return
        const payload = ev.payload || {}
        const rid = payload.request_id

        if (ev.type === 'DRAWING_QR_ERROR') {
          setMsg(payload.message || '오류가 발생했습니다.', 'error')
          setUploadBusy(false)
          return
        }

        if (ev.type === 'DRAWING_QR_PDF_UPLOAD_DONE') {
          // request_id는 multipart/타이밍 이슈로 pendingRef와 어긋날 수 있어 DONE은 항상 반영
          setUploadBusy(false)
          if (rid) delete pendingRef.current[rid]
          setUploadPages(normalizeUploadPages(payload.pages))
          setLastUploadId(payload.upload_id)
          setMsg(`업로드 완료: ${(payload.pages || []).length}페이지`, 'success')
          return
        }

        if (ev.type === 'DRAWING_QR_PAGE_RESOLVED') {
          if (rid && pendingRef.current[rid] !== 'onResolvePage') return
          setResolved(payload)
          setActiveGroup(payload.group || null)
          setScanStop(true)
          setAddMode(null)
          setMsg(null)
          return
        }

        if (ev.type === 'DRAWING_QR_GROUP_SAVED') {
          if (rid && !['onGroupCreate', 'onGroupAddPage', 'onGroupUpdate'].includes(pendingRef.current[rid])) return
          setActiveGroup(payload.group || null)
          setResolved((prev) => {
            const pid = prev?.page?.id
            const prod = payload.production_pages || []
            const inst = payload.installation_pages || []
            let page = prev?.page
            if (pid) {
              page = prod.find((x) => x.id === pid) || inst.find((x) => x.id === pid) || page
            }
            return {
              ...(prev || {}),
              page,
              group: payload.group,
              production_pages: prod,
              installation_pages: inst,
              pending_classification: false,
              view_mode:
                page?.kind === 'installation'
                  ? 'scan_installation'
                  : page?.kind === 'production'
                    ? 'scan_production'
                    : prev?.view_mode,
            }
          })
          setMsg('그룹이 저장되었습니다.', 'success')
          setUploadBusy(false)
          return
        }

        if (ev.type === 'DRAWING_QR_QR_STRING_READY') {
          /* optional */
        }
      } catch (_) {
        setMsg('서버와의 연결이 끊어졌습니다.', 'error')
      }
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [JSON.stringify(subscribeTypes)])

  useEffect(() => {
    if (activeGroup) {
      setGroupName(activeGroup.name || '')
      setGroupSpecsText(JSON.stringify(activeGroup.specs || {}, null, 2))
    }
  }, [activeGroup?.id])

  useEffect(() => {
    if (!Array.isArray(uploadPages) || uploadPages.length === 0) {
      setSelectedUploadPageId(null)
      return
    }
    // 업로드 직후 자동으로 1페이지를 선택
    setSelectedUploadPageId((prev) => {
      const exists = prev && uploadPages.some((p) => String(p.page_id) === String(prev))
      return exists ? prev : uploadPages[0].page_id
    })
  }, [uploadPages])

  useEffect(() => {
    if (!resolved) return
    const prod = resolved.production_pages || []
    const inst = resolved.installation_pages || []
    setSelectedProdPageId((prev) => {
      if (prev && prod.some((p) => p.id === prev)) return prev
      return prod[0]?.id || null
    })
    setSelectedInstPageId((prev) => {
      if (prev && inst.some((p) => p.id === prev)) return prev
      return inst[0]?.id || null
    })
  }, [
    resolved?.page?.id,
    resolved?.group?.id,
    (resolved?.production_pages || []).length,
    (resolved?.installation_pages || []).length,
  ])

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file || file.type !== 'application/pdf') {
      setMsg('PDF 파일만 업로드할 수 있습니다.', 'error')
      return
    }
    const rid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
    pendingRef.current[rid] = 'onUploadPdf'
    setUploadBusy(true)
    setMsg(null)
    const form = new FormData()
    form.append('file', file)
    form.append('request_id', rid)
    // SSE 분리를 위해 이벤트 발행 시 same client_id로 태그합니다.
    form.append('client_id', sseClientId)
    fetch('/api/drawing-qr/upload', { method: 'POST', body: form })
      .then(async (res) => {
        if (!res.ok) {
          let msg = res.statusText
          try {
            const err = await res.json()
            if (typeof err.detail === 'string') msg = err.detail
            else if (Array.isArray(err.detail)) msg = err.detail.map((d) => d.msg || d).join(', ')
          } catch (_) {}
          setMsg(msg, 'error')
          setUploadBusy(false)
          delete pendingRef.current[rid]
          return
        }
        try {
          const data = await res.json()
          const pages = data.pages
          if (Array.isArray(pages) && pages.length > 0) {
            delete pendingRef.current[rid]
            setUploadBusy(false)
            setUploadPages(normalizeUploadPages(pages))
            if (data.upload_id) setLastUploadId(data.upload_id)
            setMsg(`업로드 완료: ${pages.length}페이지`, 'success')
          } else {
            // 결과는 SSE DRAWING_QR_PDF_UPLOAD_DONE에서 채움
            setUploadBusy(false)
          }
        } catch (_) {
          setUploadBusy(false)
        }
      })
      .catch((err) => {
        setMsg(err.message || '업로드 실패', 'error')
        setUploadBusy(false)
      })
    e.target.value = ''
  }

  const handleScan = async (text) => {
    const pageId = parseDrawingQr(text)
    if (!pageId) {
      setMsg('도면 QR(DQ|1|…) 형식이 아닙니다.', 'error')
      return
    }

    if (addMode && activeGroup?.id) {
      await emit('onGroupAddPage', {
        group_id: activeGroup.id,
        page_id: pageId,
        kind: addMode.kind,
      })
      setAddMode(null)
      setScanStop(true)
      return
    }

    // 수동/카메라 모두에서 QR 인식 처리가 끝나면 카메라를 끕니다.
    // (중요) 여기서 setScanStop(false)로 켜지면 "스캔 버튼" 없이 카메라가 켜질 수 있습니다.
    setScanStop(true)
    await emit('onResolvePage', { qr_string: text.trim() })
  }

  const handleManualResolve = async () => {
    const t = manualQr.trim()
    if (!t) return
    await handleScan(t)
    setManualQr('')
  }

  const parseSpecs = () => {
    try {
      const o = JSON.parse(groupSpecsText || '{}')
      return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : {}
    } catch {
      throw new Error('사양은 JSON 객체 형식이어야 합니다.')
    }
  }

  const handleGroupCreate = async () => {
    if (!resolved?.page?.id) return
    let specs
    try {
      specs = parseSpecs()
    } catch (e) {
      setMsg(e.message, 'error')
      return
    }
    await emit('onGroupCreate', {
      page_id: resolved.page.id,
      kind: createKind,
      name: groupName.trim() || '도면 그룹',
      specs,
    })
  }

  const handleGroupUpdate = async () => {
    if (!activeGroup?.id) return
    let specs
    try {
      specs = parseSpecs()
    } catch (e) {
      setMsg(e.message, 'error')
      return
    }
    await emit('onGroupUpdate', {
      group_id: activeGroup.id,
      name: groupName.trim() || activeGroup.name,
      specs,
    })
  }

  const startAdd = (kind) => {
    if (!activeGroup?.id) {
      setMsg('먼저 그룹을 생성하거나, 그룹에 속한 도면을 스캔하세요.', 'error')
      return
    }
    setAddMode({ kind })
    // "스캔 시작" 버튼으로 사용자가 직접 카메라를 켜게 합니다.
    setScanStop(true)
    setMsg(
      kind === 'production'
        ? '제작도면 QR을 인식하려면 먼저 "스캔 시작"을 클릭한 뒤 QR을 스캔하세요.'
        : '설치도면 QR을 인식하려면 먼저 "스캔 시작"을 클릭한 뒤 QR을 스캔하세요.',
      'info'
    )
  }

  const showPanels = resolved && (resolved.group || prodPages.length || instPages.length)

  return (
    <div className="qdg">
      <div className="qdg-topbar">
        <div className="qdg-topbar__title">QR기반 도면 관리</div>
        <div className="qdg-topbar__status">
          {uploadPages?.length ? (
            <span>업로드 완료: {uploadPages.length}페이지</span>
          ) : (
            <span>대기 중</span>
          )}
          {resolved?.page?.id ? <span className="qdg-dot-sep">·</span> : null}
          {resolved?.page?.id ? (
            <span>
              스캔됨: {resolved.page.page_number}
              {' · '}
              {resolved.page.kind === 'production' ? '제작' : resolved.page.kind === 'installation' ? '설치' : '미지정'}
            </span>
          ) : null}
        </div>
      </div>

      <div className="qdg-layout">
        <aside className="qdg-sidebar">
          <button
            type="button"
            className={`qdg-tab-btn ${activeTab === 'upload' ? 'qdg-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            <span>업로드</span>
            {hasUploaded ? <span className="qdg-tab-badge">{uploadPages.length}</span> : null}
          </button>

          <button
            type="button"
            className={`qdg-tab-btn ${activeTab === 'scan' ? 'qdg-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('scan')}
            disabled={!hasUploaded}
          >
            <span>스캔</span>
          </button>

          <button
            type="button"
            className={`qdg-tab-btn ${activeTab === 'group' ? 'qdg-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('group')}
            disabled={!hasResolvedPage}
          >
            <span>그룹</span>
          </button>

          <button
            type="button"
            className={`qdg-tab-btn ${activeTab === 'viewer' ? 'qdg-tab-btn--active' : ''}`}
            onClick={() => setActiveTab('viewer')}
            disabled={!hasViewer}
          >
            <span>보기</span>
          </button>
        </aside>

        <main className="qdg-content">
          {message && (
            <div className={`qdg-banner qdg-banner--${message.type}`}>
              {message.text}
              <button type="button" className="qdg-banner-close" onClick={() => setMessage(null)}>
                ×
              </button>
            </div>
          )}

          {activeTab === 'upload' && (
            <>
              <section className="qdg-section">
                <h2>PDF 업로드</h2>
                <p className="qdg-muted">PDF를 페이지별로 분할 저장하고, 각 페이지에 고유 QR을 부여합니다.</p>
                <input ref={fileRef} type="file" accept="application/pdf" className="qdg-hidden" onChange={handleFile} />
                <button type="button" className="qdg-btn qdg-btn--primary" disabled={uploadBusy} onClick={() => fileRef.current?.click()}>
                  {uploadBusy ? '처리 중…' : 'PDF 선택'}
                </button>
                {lastUploadId && <span className="qdg-muted qdg-ml">업로드 ID: {lastUploadId}</span>}
              </section>

              {uploadPages.length > 0 && (
                <section className="qdg-section">
                  <h2>업로드된 페이지</h2>
                  <p className="qdg-muted">한 번에 한 페이지씩 미리보기/QR 인쇄가 가능합니다. (모바일 최적화)</p>
                  <UploadPagesPicker pages={uploadPages} selectedId={selectedUploadPageId} onSelect={setSelectedUploadPageId} />
                  {(() => {
                    const page = uploadPages.find((p) => String(p.page_id) === String(selectedUploadPageId)) || uploadPages[0]
                    return page ? <UploadResultPage page={page} /> : null
                  })()}
                </section>
              )}
            </>
          )}

          {activeTab === 'scan' && (
            <section className="qdg-section">
              <h2>QR 인식</h2>
              <div className="qdg-row">
                <div className="qdg-scan-col">
                  <QRScanner
                    key={scannerKey}
                    elementId={`qdg-qr-${scannerKey}`}
                    stopWhen={scanStop}
                    onScan={(t) => handleScan(t)}
                    onError={() => {}}
                  />
                  <div className="qdg-scan-actions">
                    <div className="qdg-scan-hint">
                      상태: <span className="qdg-pill">{scanStop ? '카메라 대기' : '스캔 중'}</span>
                    </div>
                    <button
                      type="button"
                      className={`qdg-btn ${scanStop ? 'qdg-btn--primary' : 'qdg-btn--secondary'}`}
                      onClick={() => {
                        if (scanStop) {
                          setScanStop(false)
                          setScannerKey((k) => k + 1)
                        } else {
                          setScanStop(true)
                        }
                      }}
                    >
                      {scanStop ? '스캔 시작' : '스캔 중지'}
                    </button>
                  </div>
                </div>
                <div className="qdg-manual">
                  <label className="qdg-label">수동 입력 (QR 텍스트)</label>
                  <textarea
                    className="qdg-textarea"
                    rows={3}
                    value={manualQr}
                    onChange={(e) => setManualQr(e.target.value)}
                    placeholder="DQ|1|xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                  <button type="button" className="qdg-btn qdg-btn--secondary" onClick={handleManualResolve}>
                    조회
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'group' && resolved?.page && (
            <section className="qdg-section">
              <h2>도면 정보 & 그룹</h2>
              {resolved.page && !showPanels && (
                <div className="qdg-preview qdg-mb">
                  <ImageZoomPanel title="스캔한 도면" pages={[resolved.page]} selectedPageId={resolved.page?.id} />
                </div>
              )}
              <div className="qdg-info">
                <div>
                  페이지 {resolved.page.page_number} · 분류{' '}
                  {resolved.page.kind === 'production'
                    ? '제작도면'
                    : resolved.page.kind === 'installation'
                      ? '설치도면'
                      : '미지정'}
                </div>
                {resolved.group && (
                  <div>
                    그룹: <strong>{resolved.group.name}</strong>
                  </div>
                )}
              </div>

              {resolved.pending_classification && (
                <div className="qdg-card qdg-mt">
                  <h3>그룹 생성</h3>
                  <p className="qdg-muted">그룹 이름·사양을 입력한 뒤, 이 도면을 제작도면 또는 설치도면으로 등록합니다.</p>
                  <div className="qdg-field">
                    <label>그룹 이름</label>
                    <input className="qdg-input" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="예: 선박 A구역 배관" />
                  </div>
                  <div className="qdg-field">
                    <label>사양 (JSON, 추후 항목 확장)</label>
                    <textarea className="qdg-textarea" rows={4} value={groupSpecsText} onChange={(e) => setGroupSpecsText(e.target.value)} />
                  </div>
                  <div className="qdg-field qdg-radio-row">
                    <label>
                      <input type="radio" name="ck" checked={createKind === 'production'} onChange={() => setCreateKind('production')} />
                      제작도면으로 등록
                    </label>
                    <label>
                      <input type="radio" name="ck" checked={createKind === 'installation'} onChange={() => setCreateKind('installation')} />
                      설치도면으로 등록
                    </label>
                  </div>
                  <button type="button" className="qdg-btn qdg-btn--primary" onClick={handleGroupCreate}>
                    그룹 만들기 및 도면 연결
                  </button>
                </div>
              )}

              {resolved.group && (
                <div className="qdg-card qdg-mt">
                  <h3>그룹 이름·사양 수정</h3>
                  <div className="qdg-field">
                    <label>그룹 이름</label>
                    <input className="qdg-input" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                  </div>
                  <div className="qdg-field">
                    <label>사양 (JSON)</label>
                    <textarea className="qdg-textarea" rows={4} value={groupSpecsText} onChange={(e) => setGroupSpecsText(e.target.value)} />
                  </div>
                  <button type="button" className="qdg-btn qdg-btn--secondary" onClick={handleGroupUpdate}>
                    저장
                  </button>
                </div>
              )}

              {resolved.group && (
                <div className="qdg-actions qdg-mt">
                  <button type="button" className="qdg-btn qdg-btn--primary" onClick={() => startAdd('production')}>
                    제작도면 추가 (QR 스캔)
                  </button>
                  <button type="button" className="qdg-btn qdg-btn--primary" onClick={() => startAdd('installation')}>
                    설치도면 추가 (QR 스캔)
                  </button>
                  {addMode && <span className="qdg-muted">→ 카메라로 QR을 인식하세요 ({addMode.kind === 'production' ? '제작' : '설치'})</span>}
                </div>
              )}
            </section>
          )}

          {activeTab === 'viewer' && showPanels && (
            <section className="qdg-section qdg-viewer-section">
              <h2>그룹 도면 보기</h2>
              <p className="qdg-muted">패널에서 확대·축소·드래그로 이동할 수 있습니다 (휠 또는 제스처).</p>
              <div className="qdg-split">
                <div className="qdg-viewer-col">
                  <GroupPagesPicker pages={prodPages} selectedId={selectedProdPageId} onSelect={setSelectedProdPageId} />
                  <ImageZoomPanel title="제작도면" pages={prodPages} selectedPageId={selectedProdPageId} />
                </div>
                <div className="qdg-viewer-col">
                  <GroupPagesPicker pages={instPages} selectedId={selectedInstPageId} onSelect={setSelectedInstPageId} />
                  <ImageZoomPanel title="설치도면" pages={instPages} selectedPageId={selectedInstPageId} />
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

// (기존 실험용 UI 컴포넌트) export는 아래 Commercial 컴포넌트로 교체됩니다.

// -----------------------------------------------------------------------------
// 상용화 수준: 프로젝트 기반 좌/중/우 패널 + 슬라이드 사이드바 UI
// -----------------------------------------------------------------------------

function QrDrawingManagerWidgetCommercial({ onAction, events }) {
  const [sseClientId] = useState(() => getOrCreateSseClientId())

  const [projects, setProjects] = useState([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [projectsDesktopOpen, setProjectsDesktopOpen] = useState(true)
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia && window.matchMedia('(min-width: 901px)').matches
  })

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(min-width: 901px)')
    const handler = () => setIsDesktop(mq.matches)
    handler()
    // Safari 지원용
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [])

  const [activeProjectId, setActiveProjectId] = useState(null)
  const [projectDrawings, setProjectDrawings] = useState([])
  const [projectGroups, setProjectGroups] = useState([])
  // 데스크톱(프로젝트 사이드바) 서브메뉴용 캐시
  const [projectPagesCache, setProjectPagesCache] = useState({})
  // project_id -> true/false (서브메뉴 펼침 여부)
  const [expandedProjectIds, setExpandedProjectIds] = useState({})
  const [selectedDrawingId, setSelectedDrawingId] = useState(null)

  // 모바일: 도면 목록을 오른쪽 슬라이딩 드로어로 표시
  const [drawingsPanelOpen, setDrawingsPanelOpen] = useState(false)
  // 모바일: 도면 정보(우측 패널) 슬라이드
  const [infoPanelOpen, setInfoPanelOpen] = useState(false)

  useEffect(() => {
    if (isDesktop) setInfoPanelOpen(false)
  }, [isDesktop])

  useEffect(() => {
    if (!activeProjectId) setInfoPanelOpen(false)
  }, [activeProjectId])

  // 전체화면 보기(모달)
  const [fullViewOpen, setFullViewOpen] = useState(false)
  const [fullViewPageId, setFullViewPageId] = useState(null)

  const [scanOverlayOpen, setScanOverlayOpen] = useState(false)
  const [scanStop, setScanStop] = useState(true) // QRScanner는 stopWhen=true면 카메라를 시작하지 않음
  const [scannerKey, setScannerKey] = useState(0)

  const [manualQr, setManualQr] = useState('')
  const [message, setMessage] = useState(null)
  // "도면 추가" 업로드 진행 상태 (DONE 이벤트 수신 전까지 유지)
  const [projectUploadBusy, setProjectUploadBusy] = useState(false)

  const [addMode, setAddMode] = useState(null) // { mode: 'related', anchorPageId }

  const [groupName, setGroupName] = useState('')
  const [groupSpecsText, setGroupSpecsText] = useState('{}')
  const [relatedByPage, setRelatedByPage] = useState(null)

  // 도면 메타: 도면 번호(DWG No)
  const [dwgNoText, setDwgNoText] = useState('')
  const [pageDeleteModal, setPageDeleteModal] = useState({
    open: false,
    mode: 'single',
    pageId: null,
    pageIds: [],
  })
  /** 프로젝트별 사이드바에서 다중 선택된 page_id */
  const [selectedPageIdsByProject, setSelectedPageIdsByProject] = useState({})

  const [deleteModal, setDeleteModal] = useState({ open: false, uploadId: null })

  /** TSC 라벨 프린터: jspm = Neodynamic JSPrintManager, webusb = WebUSB raw TSPL */
  const [tscOutputMode, setTscOutputMode] = useState('jspm')
  /** WebUSB: 이 출처에서 이미 허가된 USB 장치가 있는지(UI 표시용) */
  const [webUsbAuthorized, setWebUsbAuthorized] = useState(false)
  const [tscUseDefaultPrinter, setTscUseDefaultPrinter] = useState(true)
  const [tscPrinterName, setTscPrinterName] = useState('')
  const [tscPrinters, setTscPrinters] = useState([])
  const [tscPrintBusy, setTscPrintBusy] = useState(false)

  const fileInputRef = useRef(null)
  const projectUploadInputRef = useRef(null)

  const pendingRef = useRef({})
  const pendingProjectUploadRidRef = useRef(null)

  const setMsg = (text, type = 'info') => setMessage(text ? { text, type } : null)

  useEffect(() => {
    if (!message) return
    const timeout = setTimeout(() => setMessage(null), 3200)
    return () => clearTimeout(timeout)
  }, [message])

  const subscribeTypes = events?.subscribe || []

  const emit = useCallback(
    async (key, payload) => {
      const rid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
      pendingRef.current[rid] = key
      await onAction(key, { ...(payload || {}), request_id: rid })
      return rid
    },
    [onAction]
  )

  const _projectName = useCallback(() => {
    const p = projects.find((x) => String(x.project_id) === String(activeProjectId))
    return p?.name || ''
  }, [projects, activeProjectId])

  const closePageDeleteModal = useCallback(() => {
    setPageDeleteModal({ open: false, mode: 'single', pageId: null, pageIds: [] })
  }, [])

  const toggleAllPagesInProject = useCallback((projectId, pages) => {
    const ids = (pages || []).map((d) => String(d.page_id)).filter(Boolean)
    setSelectedPageIdsByProject((prev) => {
      const cur = (prev[projectId] || []).map(String)
      const allSelected = ids.length > 0 && ids.every((id) => cur.includes(id))
      return { ...prev, [projectId]: allSelected ? [] : ids }
    })
  }, [])

  const togglePageSelected = useCallback((projectId, pageId, checked) => {
    setSelectedPageIdsByProject((prev) => {
      const cur = prev[projectId] || []
      const s = new Set(cur.map(String))
      if (checked) s.add(String(pageId))
      else s.delete(String(pageId))
      return { ...prev, [projectId]: Array.from(s) }
    })
  }, [])

  const selectedCountForProject = useCallback(
    (projectId) => (selectedPageIdsByProject[projectId] || []).length,
    [selectedPageIdsByProject]
  )

  const isAllSelectedForProject = useCallback(
    (projectId, pages) => {
      const ids = (pages || []).map((d) => String(d.page_id)).filter(Boolean)
      if (!ids.length) return false
      const cur = (selectedPageIdsByProject[projectId] || []).map(String)
      return ids.every((id) => cur.includes(id))
    },
    [selectedPageIdsByProject]
  )

  const refreshProjects = useCallback(async () => {
    try {
      const { data } = await pwaFetchJson('/api/drawing-qr/projects')
      setProjects(Array.isArray(data) ? data : [])
    } catch (_) {
      setMsg('서버와의 연결이 끊어졌습니다.', 'error')
    }
  }, [])

  const refreshProject = useCallback(
    async (uploadId) => {
      if (!uploadId) return
      try {
        const [{ data: pData }, { data: gData }] = await Promise.all([
          pwaFetchJson(`/api/drawing-qr/projects/${encodeURIComponent(uploadId)}`),
          pwaFetchJson(`/api/drawing-qr/projects/${encodeURIComponent(uploadId)}/groups`),
        ])
        const drawings = pData?.drawings || []
        setProjectDrawings(Array.isArray(drawings) ? drawings : [])
        const groups = gData?.groups || []
        setProjectGroups(Array.isArray(groups) ? groups : [])
        // 서브메뉴 캐시에 반영
        setProjectPagesCache((prev) => ({ ...prev, [uploadId]: Array.isArray(drawings) ? drawings : [] }))

        // 선택 유지 / 없으면 첫 페이지 선택
        setSelectedDrawingId((prev) => {
          if (prev && drawings.some((d) => String(d.page_id) === String(prev))) return prev
          return drawings[0]?.page_id || null
        })
      } catch (_) {
        setMsg('서버와의 연결이 끊어졌습니다.', 'error')
      }
    },
    [setProjectDrawings, setProjectGroups]
  )

  const ensureProjectPagesLoaded = useCallback(
    async (projectId) => {
      if (!projectId) return
      if (projectPagesCache[projectId]) return
      try {
        const { data } = await pwaFetchJson(`/api/drawing-qr/projects/${encodeURIComponent(projectId)}`)
        const drawings = data?.drawings || []
        setProjectPagesCache((prev) => ({
          ...prev,
          [projectId]: Array.isArray(drawings) ? drawings : [],
        }))
      } catch (_) {
        setMsg('서버와의 연결이 끊어졌습니다.', 'error')
      }
    },
    [projectPagesCache]
  )

  useEffect(() => {
    setSelectedPageIdsByProject((prev) => {
      let changed = false
      const next = { ...prev }
      for (const projectId of Object.keys(next)) {
        const pages = projectPagesCache[projectId]
        if (!Array.isArray(pages)) continue
        const valid = new Set(pages.map((d) => String(d.page_id)))
        const filtered = (next[projectId] || []).filter((id) => valid.has(String(id)))
        if (filtered.length !== (next[projectId] || []).length) {
          next[projectId] = filtered
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [projectPagesCache])

  /** 이벤트 버스 없이 catalog에 분류 반영 (POST /api/drawing-qr/pages/.../kind) */
  const setPageKindRemote = useCallback(
    async (pageId, kind) => {
      if (!pageId) return
      setMsg(null)
      try {
        const res = await fetch(`/api/drawing-qr/pages/${encodeURIComponent(pageId)}/kind`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind }),
        })
        if (!res.ok) {
          let msg = res.statusText
          try {
            const err = await res.json()
            const d = err.detail
            if (typeof d === 'string') msg = d
            else if (Array.isArray(d)) msg = d.map((x) => (typeof x === 'string' ? x : x.msg || '')).filter(Boolean).join(', ')
          } catch (_) {}
          setMsg(msg, 'error')
          return
        }
        if (activeProjectId) await refreshProject(activeProjectId)
        setMsg('도면 분류가 저장되었습니다.', 'success')
      } catch (err) {
        setMsg(err.message || '분류 저장 실패', 'error')
      }
    },
    [activeProjectId, refreshProject]
  )

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  useEffect(() => {
    if (!activeProjectId) return
    setDrawingsPanelOpen(false)
    setExpandedProjectIds((prev) => ({ ...prev, [activeProjectId]: true }))
    refreshProject(activeProjectId)
  }, [activeProjectId, refreshProject, isDesktop])

  useEffect(() => {
    if (!activeProjectId) setDrawingsPanelOpen(false)
  }, [activeProjectId])

  useEffect(() => {
    if (!fullViewOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [fullViewOpen])

  useEffect(() => {
    if (!fullViewOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setFullViewOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fullViewOpen])

  useEffect(() => {
    if (!Array.isArray(subscribeTypes) || subscribeTypes.length === 0) return
    const es = new EventSource(
      `/api/events/stream?targeted_only=1&client_id=${encodeURIComponent(sseClientId)}`
    )
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        if (!ev.type || !subscribeTypes.includes(ev.type)) return
        const payload = ev.payload || {}

        if (ev.type === 'DRAWING_QR_ERROR') {
          setMsg(payload.message || '오류가 발생했습니다.', 'error')
          setScanOverlayOpen(false)
          setScanStop(true)
          return
        }

        if (ev.type === 'DRAWING_QR_PDF_UPLOAD_DONE') {
          if (payload.request_id && pendingProjectUploadRidRef.current === payload.request_id) {
            pendingProjectUploadRidRef.current = null
            setProjectUploadBusy(false)
          }
          const uploadId = payload.upload_id
          if (uploadId) {
            ;(async () => {
              try {
                const r = await fetch(`/api/drawing-qr/projects/by-upload/${encodeURIComponent(uploadId)}`)
                if (!r.ok) return
                const data = await r.json()
                const pid = data?.project_id
                if (!pid) return
                setActiveProjectId(pid)
                setSelectedDrawingId(payload.pages?.[0]?.page_id || null)
                setDrawingsPanelOpen(true)
                refreshProject(pid)
              } catch (_) {}
            })()
          }
          setScanOverlayOpen(false)
          setScanStop(true)
          setMsg(`업로드 완료: ${(payload.pages || []).length}페이지`, 'success')
          return
        }

        if (ev.type === 'DRAWING_QR_PAGE_RESOLVED') {
          const page = payload.page
          if (page?.upload_id) {
            ;(async () => {
              try {
                const uid = page.upload_id
                const r = await fetch(`/api/drawing-qr/projects/by-upload/${encodeURIComponent(uid)}`)
                if (!r.ok) return
                const data = await r.json()
                const pid = data?.project_id
                if (!pid) return
                setActiveProjectId(pid)
                setSelectedDrawingId(page.id || null)
                setDrawingsPanelOpen(true)
                refreshProject(pid)
              } catch (_) {}
            })()
          }
          setAddMode(null)
          setScanOverlayOpen(false)
          setScanStop(true)
          return
        }

        if (ev.type === 'DRAWING_QR_GROUP_SAVED') {
          const upId =
            payload.production_pages?.[0]?.upload_id ||
            payload.installation_pages?.[0]?.upload_id ||
            activeProjectId
          if (upId) {
            ;(async () => {
              try {
                const r = await fetch(`/api/drawing-qr/projects/by-upload/${encodeURIComponent(upId)}`)
                if (!r.ok) return
                const data = await r.json()
                const pid = data?.project_id
                if (!pid) return
                setActiveProjectId(pid)
                setDrawingsPanelOpen(true)
                refreshProject(pid)
              } catch (_) {}
            })()
          }
          setAddMode(null)
          setScanOverlayOpen(false)
          setScanStop(true)
          setMsg('관련 도면이 저장되었습니다.', 'success')
          return
        }

        if (ev.type === 'DRAWING_QR_PAGE_UPDATED') {
          // 분류 변경 등 페이지 메타 업데이트 → 현재 프로젝트 리프레시
          if (activeProjectId) refreshProject(activeProjectId)
          const pid = payload.page?.id || payload.page?.page_id
          if (pid) setSelectedDrawingId(pid)
          setMsg('도면 정보가 업데이트되었습니다.', 'success')
          return
        }
      } catch (_) {}
    }
    return () => es.close()
  }, [subscribeTypes, sseClientId, refreshProject, activeProjectId])

  const selectedDrawing = useMemo(
    () =>
      projectDrawings.find((d) => String(d.page_id ?? d.id) === String(selectedDrawingId)) || null,
    [projectDrawings, selectedDrawingId]
  )

  /** 화면 QR과 TSC 인쇄 TSPL이 반드시 같은 문자열을 쓰도록 단일 소스 */
  const selectedPageQrPayload = useMemo(
    () => String(selectedDrawing?.qr_string ?? '').trim(),
    [selectedDrawing?.qr_string, selectedDrawing?.page_id, selectedDrawing?.id]
  )

  useEffect(() => {
    if (tscOutputMode !== 'jspm' || tscUseDefaultPrinter || !selectedDrawing?.qr_string) return
    let cancelled = false
    ;(async () => {
      try {
        const list = await jspmGetPrinters()
        if (cancelled) return
        setTscPrinters(Array.isArray(list) ? list : [])
        setTscPrinterName((prev) => {
          const arr = Array.isArray(list) ? list : []
          if (prev && arr.includes(prev)) return prev
          return arr[0] || ''
        })
      } catch (_) {
        if (!cancelled) setTscPrinters([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tscOutputMode, tscUseDefaultPrinter, selectedDrawing?.page_id, selectedDrawing?.qr_string])

  const refreshWebUsbAuthorization = useCallback(async () => {
    if (!isWebUsbSupported()) {
      setWebUsbAuthorized(false)
      return
    }
    try {
      const list = await getAuthorizedUsbPrinters()
      setWebUsbAuthorized(Array.isArray(list) && list.length > 0)
    } catch (_) {
      setWebUsbAuthorized(false)
    }
  }, [])

  useEffect(() => {
    void refreshWebUsbAuthorization()
  }, [refreshWebUsbAuthorization])

  useEffect(() => {
    if (tscOutputMode === 'webusb') void refreshWebUsbAuthorization()
  }, [tscOutputMode, refreshWebUsbAuthorization])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.usb || typeof navigator.usb.addEventListener !== 'function') {
      return
    }
    const onDisc = () => {
      void refreshWebUsbAuthorization()
    }
    navigator.usb.addEventListener('disconnect', onDisc)
    return () => navigator.usb.removeEventListener('disconnect', onDisc)
  }, [refreshWebUsbAuthorization])

  const fullViewPage =
    fullViewPageId ? projectDrawings.find((d) => String(d.page_id || d.id) === String(fullViewPageId)) || null : null

  const selectedGroupEntry = useMemo(() => {
    if (!selectedDrawing?.group_id) return null
    return projectGroups.find((g) => String(g.group?.id) === String(selectedDrawing.group_id)) || null
  }, [selectedDrawing?.group_id, projectGroups])

  const relatedDisplay = useMemo(() => {
    if (!selectedDrawing) return null
    if (relatedByPage) {
      return {
        production_pages: relatedByPage.production_pages || [],
        installation_pages: relatedByPage.installation_pages || [],
        unclassified_pages: relatedByPage.unclassified_pages || [],
      }
    }
    if (selectedGroupEntry) {
      return {
        production_pages: selectedGroupEntry.production_pages || [],
        installation_pages: selectedGroupEntry.installation_pages || [],
        unclassified_pages: selectedGroupEntry.unclassified_pages || [],
      }
    }
    const pid = selectedDrawing.page_id
    const kind = selectedDrawing.kind
    const base = {
      id: pid,
      page_id: pid,
      page_number: selectedDrawing.page_number,
      image_url: selectedDrawing.image_url,
      file_url: selectedDrawing.file_url,
    }
    return {
      production_pages: kind === 'production' ? [base] : [],
      installation_pages: kind === 'installation' ? [base] : [],
      unclassified_pages: !kind ? [base] : [],
    }
  }, [selectedDrawing, selectedGroupEntry, relatedByPage])

  useEffect(() => {
    if (!selectedDrawing?.page_id || !activeProjectId) {
      setRelatedByPage(null)
      return
    }
    ;(async () => {
      try {
        const r = await fetch(
          `/api/drawing-qr/pages/${encodeURIComponent(selectedDrawing.page_id)}/related?project_id=${encodeURIComponent(activeProjectId)}`
        )
        if (!r.ok) {
          setRelatedByPage(null)
          return
        }
        const data = await r.json()
        setRelatedByPage({
          production_pages: data?.production_pages || [],
          installation_pages: data?.installation_pages || [],
          unclassified_pages: data?.unclassified_pages || [],
        })
      } catch (_) {
        setRelatedByPage(null)
      }
    })()
  }, [selectedDrawing?.page_id, activeProjectId, projectDrawings])

  useEffect(() => {
    setDwgNoText(selectedDrawing?.dwg_no || '')
  }, [selectedDrawing?.page_id])

  const relatedGallerySections = useMemo(() => {
    if (!relatedDisplay) return []
    const mk = (title, pages) => ({
      title,
      pages: (pages || []).map((p) => ({
        id: p.id || p.page_id,
        page_number: p.page_number,
        image_url: p.image_url || p.file_url,
      })),
    })
    return [
      mk('제작도면', relatedDisplay.production_pages),
      mk('설치도면', relatedDisplay.installation_pages),
      mk('미분류', relatedDisplay.unclassified_pages),
    ].filter((s) => s.pages.length > 0)
  }, [relatedDisplay])

  useEffect(() => {
    if (!selectedGroupEntry?.group?.id) {
      setGroupName('')
      setGroupSpecsText('{}')
      return
    }
    setGroupName(selectedGroupEntry.group.name || '')
    setGroupSpecsText(JSON.stringify(selectedGroupEntry.group.specs || {}, null, 2))
  }, [selectedGroupEntry?.group?.id])

  const parseSpecs = () => {
    try {
      const o = JSON.parse(groupSpecsText || '{}')
      return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : {}
    } catch {
      throw new Error('사양은 JSON 객체 형식이어야 합니다.')
    }
  }

  const startScanOverlay = () => {
    setScanOverlayOpen(true)
    setScanStop(false) // 카메라 ON
    setScannerKey((k) => k + 1)
  }

  const stopScanOverlay = () => {
    setScanOverlayOpen(false)
    setScanStop(true) // 카메라 OFF
  }

  const handleScanText = async (text) => {
    const pageId = parseDrawingQr(text)
    if (!pageId) {
      setMsg('도면 QR(DQ|1|…) 형식이 아닙니다.', 'error')
      return
    }

    // (1) 관련 도면 연결: 추가되는 도면의 분류(catalog kind)를 따름
    if (addMode?.mode === 'related' && addMode.anchorPageId) {
      const r = await fetch(`/api/drawing-qr/pages/${encodeURIComponent(addMode.anchorPageId)}/related`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: pageId }),
      })
      if (!r.ok) {
        let msg = r.statusText
        try {
          const err = await r.json()
          if (typeof err.detail === 'string') msg = err.detail
        } catch (_) {}
        setMsg(msg, 'error')
        return
      }
      if (activeProjectId) await refreshProject(activeProjectId)
      setMsg('관련 도면이 저장되었습니다.', 'success')
      setAddMode(null)
      stopScanOverlay()
      return
    }

    // (2) 일반 모드: QR 인식 -> 해당 프로젝트로 이동
    await emit('onResolvePage', { qr_string: text.trim() })
    stopScanOverlay()
  }

  const handleUploadClick = () => fileInputRef.current?.click()

  const handleCreateProject = async () => {
    const name = window.prompt('프로젝트 이름을 입력하세요', '새 프로젝트')
    if (!name) return
    if (!onAction) {
      setMsg('서비스 연결이 아직 준비되지 않았습니다.', 'error')
      return
    }
    try {
      const form = new FormData()
      form.append('name', name)
      const res = await fetch('/api/drawing-qr/projects', { method: 'POST', body: form })
      if (!res.ok) {
        let msg = res.statusText
        try {
          const err = await res.json()
          if (typeof err.detail === 'string') msg = err.detail
        } catch (_) {}
        setMsg(msg, 'error')
        return
      }
      const data = await res.json()
      if (data?.project_id) {
        setActiveProjectId(data.project_id)
        setSelectedDrawingId(null)
        setDrawingsPanelOpen(true)
        await refreshProjects()
        refreshProject(data.project_id)
        setMsg('프로젝트 생성 완료', 'success')
      }
    } catch (err) {
      setMsg(err.message || '프로젝트 생성 실패', 'error')
    }
  }

  const handleUploadFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file || file.type !== 'application/pdf') {
      setMsg('PDF 파일만 업로드할 수 있습니다.', 'error')
      return
    }
    const rid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
    const form = new FormData()
    form.append('file', file)
    form.append('request_id', rid)
    form.append('client_id', sseClientId)
    setMsg(null)
    try {
      const res = await fetch('/api/drawing-qr/upload', { method: 'POST', body: form })
      if (!res.ok) {
        let msg = res.statusText
        try {
          const err = await res.json()
          if (typeof err.detail === 'string') msg = err.detail
        } catch (_) {}
        setMsg(msg, 'error')
        return
      }
      const data = await res.json()
      const pid = data?.project_id
      if (pid) {
        setActiveProjectId(pid)
        refreshProject(pid)
        setSelectedDrawingId(data.pages?.[0]?.page_id || null)
        setMsg(`업로드 완료`, 'success')
      } else if (data?.upload_id) {
        // 혹시 구버전 응답이거나 project_id가 없는 경우라도 복구
        const uid = data.upload_id
        const r = await fetch(`/api/drawing-qr/projects/by-upload/${encodeURIComponent(uid)}`)
        if (r.ok) {
          const d = await r.json()
          if (d?.project_id) {
            setActiveProjectId(d.project_id)
            refreshProject(d.project_id)
            setSelectedDrawingId(data.pages?.[0]?.page_id || null)
            setMsg(`업로드 완료`, 'success')
          }
        }
      }
    } catch (err) {
      setMsg(err.message || '업로드 실패', 'error')
    } finally {
      e.target.value = ''
    }
  }

  const handleUploadFileToActiveProject = async (e) => {
    const file = e.target.files?.[0]
    if (!file || file.type !== 'application/pdf') {
      setMsg('PDF 파일만 업로드할 수 있습니다.', 'error')
      return
    }
    if (!activeProjectId) {
      setMsg('프로젝트가 선택되지 않았습니다.', 'error')
      return
    }

    const rid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
    const form = new FormData()
    form.append('file', file)
    form.append('request_id', rid)
    form.append('client_id', sseClientId)
    setMsg(null)
    pendingProjectUploadRidRef.current = rid
    setProjectUploadBusy(true)

    try {
      const res = await fetch(`/api/drawing-qr/projects/${encodeURIComponent(activeProjectId)}/upload`, { method: 'POST', body: form })
      if (!res.ok) {
        let msg = res.statusText
        try {
          const err = await res.json()
          if (typeof err.detail === 'string') msg = err.detail
        } catch (_) {}
        setMsg(msg, 'error')
        pendingProjectUploadRidRef.current = null
        setProjectUploadBusy(false)
        return
      }
      const data = await res.json()
      if (Array.isArray(data?.pages) && data.pages[0]?.page_id) {
        setSelectedDrawingId(data.pages[0].page_id)
      }
      refreshProject(activeProjectId)
      setMsg('PDF 업로드 처리 중...', 'info')
    } catch (err) {
      pendingProjectUploadRidRef.current = null
      setProjectUploadBusy(false)
      setMsg(err.message || '업로드 실패', 'error')
    } finally {
      e.target.value = ''
    }
  }

  const handleDeleteProject = async (uploadId) => {
    try {
      const r = await fetch(`/api/drawing-qr/projects/${encodeURIComponent(uploadId)}`, { method: 'DELETE' })
      if (r.ok) {
        await refreshProjects()
        if (String(activeProjectId) === String(uploadId)) {
          setActiveProjectId(null)
          setProjectDrawings([])
          setProjectGroups([])
          setSelectedDrawingId(null)
        }
        setMsg('프로젝트가 삭제되었습니다.', 'success')
      } else {
        setMsg('프로젝트 삭제 실패', 'error')
      }
    } catch (_) {
      setMsg('프로젝트 삭제 실패', 'error')
    } finally {
      setDeleteModal({ open: false, uploadId: null })
    }
  }

  const handlePrintCurrentProject = () => {
    if (!activeProjectId) return
    if (!Array.isArray(projectDrawings) || projectDrawings.length === 0) {
      setMsg('인쇄할 도면이 없습니다.', 'error')
      return
    }
    openPrintProjectDrawingsWindow({ projectName: _projectName(), pages: projectDrawings })
  }

  const handleRenameProject = async (projectId, currentName) => {
    const nextName = window.prompt('프로젝트 이름을 수정하세요', currentName || '')
    if (nextName == null) return
    const name = String(nextName).trim()
    if (!name) {
      setMsg('프로젝트 이름을 입력하세요.', 'error')
      return
    }
    try {
      const form = new FormData()
      form.append('name', name)
      const r = await fetch(`/api/drawing-qr/projects/${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        body: form,
      })
      if (!r.ok) {
        let msg = '프로젝트 이름 수정 실패'
        try {
          const err = await r.json()
          if (typeof err.detail === 'string') msg = err.detail
        } catch (_) {}
        setMsg(msg, 'error')
        return
      }
      await refreshProjects()
      setMsg('프로젝트 이름이 수정되었습니다.', 'success')
    } catch (_) {
      setMsg('프로젝트 이름 수정 실패', 'error')
    }
  }

  const handleSaveDwgNo = async () => {
    if (!selectedDrawing?.page_id || !activeProjectId) return
    const pageId = selectedDrawing.page_id
    try {
      const res = await fetch(`/api/drawing-qr/pages/${encodeURIComponent(pageId)}/dwg_no`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dwg_no: dwgNoText.trim() || null }),
      })
      if (!res.ok) {
        let msg = res.statusText
        try {
          const err = await res.json()
          if (typeof err.detail === 'string') msg = err.detail
        } catch (_) {}
        setMsg(msg, 'error')
        return
      }
      await refreshProject(activeProjectId)
      setMsg('도면 번호가 저장되었습니다.', 'success')
    } catch (_) {
      setMsg('도면 번호 저장 실패', 'error')
    }
  }

  const handleWebUsbPairPrinter = async () => {
    if (!isWebUsbSupported()) return
    setMsg(null)
    try {
      await pairWebUsbLabelPrinter()
      await refreshWebUsbAuthorization()
      setMsg('USB 프린터가 등록되었습니다. 이후 인쇄 시에는 장치 선택 창이 나오지 않습니다.', 'success')
    } catch (e) {
      const m = e && e.message ? String(e.message) : ''
      if (m === 'WEBUSB_CANCELLED' || (e && e.name === 'NotFoundError')) {
        setMsg('USB 장치 선택이 취소되었습니다.', 'error')
      } else if (m === 'WEBUSB_ACCEPT_ALL_UNSUPPORTED') {
        setMsg(
          '브라우저가 전체 USB 목록 선택을 지원하지 않습니다. .env에 VITE_WEBUSB_VENDOR_ID(16진)를 설정하세요.',
          'error'
        )
      } else if (m === 'WEBUSB_UNSUPPORTED') {
        setMsg('WebUSB를 지원하지 않는 환경입니다.', 'error')
      } else {
        setMsg(m || 'USB 프린터 등록에 실패했습니다.', 'error')
      }
    }
  }

  const handleTscPrintSelectedQr = async () => {
    if (!selectedDrawingId) {
      setMsg('도면을 선택하세요.', 'error')
      return
    }
    const qrPayload = selectedPageQrPayload
    if (!qrPayload) {
      setMsg('QR 문자열이 없습니다.', 'error')
      return
    }
    const pageUuid = String(selectedDrawing?.page_id ?? selectedDrawing?.id ?? '').trim()
    if (pageUuid && !qrPayload.includes(pageUuid)) {
      setMsg('선택한 페이지와 QR 데이터가 일치하지 않습니다. 목록을 새로고침한 뒤 다시 시도하세요.', 'error')
      return
    }
    setTscPrintBusy(true)
    setMsg(null)
    try {
      const drawingNameForLabel =
        dwgNoText.trim() ||
        (selectedDrawing?.dwg_no && String(selectedDrawing.dwg_no).trim()) ||
        _projectName() ||
        ''
      const pageLabel = `P${selectedDrawing?.page_number ?? '?'}`
      const categoryLabel =
        selectedDrawing?.kind === 'production'
          ? 'PROD'
          : selectedDrawing?.kind === 'installation'
            ? 'INST'
            : 'PENDING'

      const cmds = buildTsplQrLabelCommands({
        qrString: qrPayload,
        drawingName: drawingNameForLabel,
        pageLabel,
        categoryLabel,
        direction: 1,
      })

      if (tscOutputMode === 'webusb') {
        if (!isWebUsbSupported()) {
          setMsg('이 브라우저는 WebUSB를 지원하지 않습니다. Chrome/Edge 최신 버전을 사용하세요.', 'error')
          return
        }
        if (typeof window !== 'undefined' && window.isSecureContext === false) {
          setMsg('WebUSB는 HTTPS(또는 localhost)에서만 사용할 수 있습니다.', 'error')
          return
        }
        await sendTsplViaWebUSB(cmds)
        void refreshWebUsbAuthorization()
        setMsg('WebUSB로 TSC에 전송했습니다.', 'success')
        return
      }

      let printerName = tscPrinterName
      if (!tscUseDefaultPrinter) {
        const list = tscPrinters.length ? tscPrinters : await jspmGetPrinters()
        setTscPrinters(list)
        if (!list.length) {
          setMsg('사용 가능한 프린터가 없습니다. JSPrintManager를 확인하세요.', 'error')
          return
        }
        if (!printerName || !list.includes(printerName)) {
          printerName = list[0]
          setTscPrinterName(printerName)
        }
      }
      await jspmSendRawTspl({
        commands: cmds,
        useDefaultPrinter: tscUseDefaultPrinter,
        printerName,
      })
      setMsg('TSC 프린터로 전송했습니다.', 'success')
    } catch (e) {
      const m = e && e.message ? String(e.message) : ''
      if (m.includes('load fail') || m.includes('JSPrintManager.js')) {
        setMsg(
          'JSPrintManager.js를 배포하세요. Neodynamic에서 받은 파일을 public/js/에 두고 빌드합니다.',
          'error'
        )
      } else if (m === 'JSPM_PLACEHOLDER') {
        setMsg(
          '현재는 플레이스홀더 JSPrintManager.js입니다. Neodynamic 정품 JSPrintManager.js로 public/js/ 파일을 교체한 뒤 빌드·배포하세요.',
          'error'
        )
      } else if (m === 'JSPM_TIMEOUT') {
        setMsg('JSPrintManager 연결 시간이 초과되었습니다. 클라이언트 앱 실행 여부를 확인하세요.', 'error')
      } else if (m === 'JSPM_BLOCKED') {
        setMsg('JSPrintManager가 이 사이트를 차단했습니다.', 'error')
      } else if (m === 'WEBUSB_UNSUPPORTED') {
        setMsg('WebUSB를 지원하지 않는 환경입니다.', 'error')
      } else if (m === 'WEBUSB_CANCELLED') {
        setMsg('USB 장치 선택이 취소되었습니다.', 'error')
      } else if (m === 'WEBUSB_NO_BULK_OUT') {
        setMsg(
          'USB 장치에서 Bulk OUT 엔드포인트를 찾지 못했습니다. TSC 전용 드라이버/모드이거나 WebUSB 미지원 장치일 수 있습니다.',
          'error'
        )
      } else if (m === 'WEBUSB_ACCEPT_ALL_UNSUPPORTED') {
        setMsg(
          '브라우저가 전체 USB 목록 선택을 지원하지 않습니다. .env에 VITE_WEBUSB_VENDOR_ID(16진)를 설정하세요.',
          'error'
        )
      } else if (m.startsWith('WEBUSB_TRANSFER_')) {
        setMsg('USB 전송에 실패했습니다. 케이블·프린터 전원을 확인한 뒤 다시 시도하세요.', 'error')
      } else if (m === 'SecurityError' || (e && e.name === 'SecurityError')) {
        setMsg('WebUSB 보안 제한입니다. HTTPS로 접속했는지 확인하세요.', 'error')
      } else {
        setMsg(
          m ||
            'TSC 인쇄에 실패했습니다. PC에 JSPrintManager 설치 후 실행하세요. (https://neodynamic.com/downloads/jspm)',
          'error'
        )
      }
    } finally {
      setTscPrintBusy(false)
    }
  }

  const handleDeletePage = async () => {
    if (!activeProjectId) return

    if (pageDeleteModal.mode === 'bulk') {
      const ids = pageDeleteModal.pageIds || []
      if (!ids.length) return
      try {
        const res = await fetch(
          `/api/drawing-qr/projects/${encodeURIComponent(activeProjectId)}/pages/bulk-delete`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page_ids: ids }),
          }
        )
        if (!res.ok) {
          let msg = res.statusText
          try {
            const err = await res.json()
            if (typeof err.detail === 'string') msg = err.detail
          } catch (_) {}
          setMsg(msg, 'error')
          closePageDeleteModal()
          return
        }
        closePageDeleteModal()
        setSelectedPageIdsByProject((prev) => ({ ...prev, [activeProjectId]: [] }))
        await refreshProject(activeProjectId)
        setMsg(`${ids.length}개의 도면이 삭제되었습니다.`, 'success')
      } catch (_) {
        setMsg('서버와의 연결이 끊어졌습니다.', 'error')
        closePageDeleteModal()
      }
      return
    }

    if (!pageDeleteModal.pageId) return
    const pageId = pageDeleteModal.pageId
    try {
      const res = await fetch(`/api/drawing-qr/pages/${encodeURIComponent(pageId)}`, { method: 'DELETE' })
      if (!res.ok) {
        let msg = res.statusText
        try {
          const err = await res.json()
          if (typeof err.detail === 'string') msg = err.detail
        } catch (_) {}
        setMsg(msg, 'error')
        return
      }
      setSelectedPageIdsByProject((prev) => ({
        ...prev,
        [activeProjectId]: (prev[activeProjectId] || []).filter((id) => String(id) !== String(pageId)),
      }))
      await refreshProject(activeProjectId)
      setMsg('도면이 삭제되었습니다.', 'success')
    } catch (_) {
      setMsg('서버와의 연결이 끊어졌습니다.', 'error')
    } finally {
      closePageDeleteModal()
    }
  }

  const handleUngroupPage = async (pageId) => {
    if (!pageId || !activeProjectId || !selectedDrawing?.page_id) return
    try {
      const res = await fetch(
        `/api/drawing-qr/pages/${encodeURIComponent(selectedDrawing.page_id)}/related/${encodeURIComponent(pageId)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        let msg = res.statusText
        try {
          const err = await res.json()
          if (typeof err.detail === 'string') msg = err.detail
        } catch (_) {}
        setMsg(msg, 'error')
        return
      }
      await refreshProject(activeProjectId)
      setRelatedByPage((prev) => {
        if (!prev) return prev
        const filt = (arr) => (arr || []).filter((p) => String(p.id || p.page_id) !== String(pageId))
        return {
          production_pages: filt(prev.production_pages),
          installation_pages: filt(prev.installation_pages),
          unclassified_pages: filt(prev.unclassified_pages),
        }
      })
      setMsg('그룹에서 도면이 제거되었습니다.', 'success')
    } catch (_) {
      setMsg('그룹 해제 실패', 'error')
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  const initial = !activeProjectId && !scanOverlayOpen

  return (
    <div className="qdg qdg-commercial">
      <header className="app-header">
        <div className="qdg-commerce-header-left">
          <button
            type="button"
            className="qdg-commerce-hamburger"
            onClick={() => {
              if (isDesktop) {
                setProjectsDesktopOpen((v) => !v)
              } else {
                setSidebarOpen(true)
              }
            }}
            aria-label="메뉴 열기"
          >
            ☰
          </button>

          {/* <button
            type="button"
            className="qdg-drawings-toggle"
            onClick={() => {
              setSidebarOpen(true)
              setInfoPanelOpen(false)
            }}
            aria-label="도면 목록"
          >
            도면
          </button> */}
        </div>

        <div className="app-header__title">{activeProjectId ? _projectName() : 'QR기반 도면 관리'}</div>

        <div className="qdg-commerce-header-right">
          {activeProjectId && (
            <>
              <button type="button" className="qdg-commerce-scan-top-btn" onClick={startScanOverlay}>
                QR코드 스캔
              </button>
              <button
                type="button"
                className="qdg-commerce-print-top-btn"
                onClick={handlePrintCurrentProject}
              >
                인쇄
              </button>
            </>
          )}
        </div>
      </header>

      <input
        ref={projectUploadInputRef}
        type="file"
        accept="application/pdf"
        className="qdg-hidden"
        onChange={handleUploadFileToActiveProject}
      />

      <div className="qdg-commerce-desktop-wrap">
        <aside
          className={`qdg-projects-sidebar-desktop ${projectsDesktopOpen ? '' : 'qdg-projects-sidebar-desktop--closed'}`}
          aria-label="프로젝트 목록"
        >
          <div className="qdg-projects-sidebar__header">
            <div className="qdg-projects-sidebar__title">프로젝트</div>
          </div>

          <div className="qdg-projects-sidebar__section">
            <input ref={fileInputRef} type="file" accept="application/pdf" className="qdg-hidden" onChange={handleUploadFile} />
            <button type="button" className="qdg-btn qdg-btn--primary qdg-btn--full" onClick={handleCreateProject}>
              프로젝트 추가
            </button>
          </div>

          <div className="qdg-projects-sidebar__list">
            {projects.length ? (
              projects.map((p) => {
                const pid = p.project_id
                const expanded = !!expandedProjectIds[pid]
                const pages = projectPagesCache[pid]
                const isActiveProject = String(activeProjectId) === String(pid)

                return (
                  <div key={pid} className="qdg-project-item">
                    <div className="qdg-project-row">
                      <button
                        type="button"
                        className="qdg-project-row__main"
                        onClick={() => {
                          setActiveProjectId(pid)
                          setSelectedDrawingId(null)
                          setExpandedProjectIds((prev) => ({
                            ...prev,
                            [pid]: isActiveProject ? !prev[pid] : true,
                          }))
                          if (!projectPagesCache[pid]) ensureProjectPagesLoaded(pid)
                          setInfoPanelOpen(false)
                        }}
                      >
                        <div className="qdg-project-row__top">
                          <span className={`qdg-project-expander ${expanded ? 'qdg-project-expander--open' : ''}`}>▸</span>
                          <div className="qdg-project-row__name">{p.name}</div>
                        </div>
                        <div className="qdg-project-row__meta">{p.page_count} pages</div>
                      </button>
                      <div className="qdg-project-row__actions">
                        <button
                          type="button"
                          className="qdg-project-row__edit"
                          aria-label="수정"
                          onClick={() => handleRenameProject(pid, p.name)}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="qdg-project-row__del"
                          aria-label="삭제"
                          onClick={() => setDeleteModal({ open: true, uploadId: pid })}
                        >
                          삭제
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="qdg-project-submenu">
                        {isActiveProject && (
                          <div className="qdg-project-submenu__upload">
                            <button
                              type="button"
                              className="qdg-btn qdg-btn--secondary qdg-btn--full"
                              disabled={projectUploadBusy}
                              onClick={() => projectUploadInputRef.current?.click()}
                            >
                              {projectUploadBusy ? (
                                <span className="qdg-inline-busy">
                                  <span className="qdg-inline-spinner" />
                                  처리 중...
                                </span>
                              ) : (
                                '도면 추가'
                              )}
                            </button>
                          </div>
                        )}
                        {Array.isArray(pages) && pages.length > 0 && (
                          <div
                            className="qdg-project-submenu__bulk-toolbar"
                            role="group"
                            aria-label="도면 다중 선택"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="qdg-btn qdg-btn--ghost qdg-btn--compact"
                              onClick={() => toggleAllPagesInProject(pid, pages)}
                            >
                              {isAllSelectedForProject(pid, pages) ? '전체 해제' : '전체 선택'}
                            </button>
                            <button
                              type="button"
                              className="qdg-btn qdg-btn--secondary qdg-btn--compact"
                              disabled={selectedCountForProject(pid) === 0}
                              onClick={() => {
                                const ids = selectedPageIdsByProject[pid] || []
                                if (!ids.length) return
                                setActiveProjectId(pid)
                                setPageDeleteModal({ open: true, mode: 'bulk', pageId: null, pageIds: [...ids] })
                              }}
                            >
                              선택 삭제 ({selectedCountForProject(pid)})
                            </button>
                          </div>
                        )}
                        {Array.isArray(pages) ? (
                          <div className="qdg-project-submenu__list">
                            {pages.map((d) => {
                              const active = String(selectedDrawingId) === String(d.page_id)
                              const checked = (selectedPageIdsByProject[pid] || []).some(
                                (x) => String(x) === String(d.page_id)
                              )
                              return (
                                <button
                                  key={d.page_id}
                                  type="button"
                                  className={`qdg-project-subpage-btn ${active ? 'qdg-project-subpage-btn--active' : ''}`}
                                  onClick={() => {
                                    setActiveProjectId(pid)
                                    setSelectedDrawingId(d.page_id)
                                    setExpandedProjectIds((prev) => ({ ...prev, [pid]: true }))
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    className="qdg-project-subpage-check"
                                    checked={checked}
                                    onChange={(e) => {
                                      e.stopPropagation()
                                      togglePageSelected(pid, d.page_id, e.target.checked)
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    aria-label="도면 선택"
                                  />
                                  <span className="qdg-project-subpage-btn__num">P{d.page_number}</span>
                                  <div className="qdg-project-subpage-btn__right">
                                    <span className="qdg-project-subpage-btn__kind">
                                      {d.kind === 'production' ? '제작' : d.kind === 'installation' ? '설치' : '미분류'}
                                    </span>
                                    <span
                                      className="qdg-project-subpage-btn__del"
                                      role="button"
                                      tabIndex={0}
                                      title="도면 삭제"
                                      aria-label="도면 삭제"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setActiveProjectId(pid)
                                        setPageDeleteModal({
                                          open: true,
                                          mode: 'single',
                                          pageId: d.page_id,
                                          pageIds: [],
                                        })
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          setActiveProjectId(pid)
                                          setPageDeleteModal({
                                            open: true,
                                            mode: 'single',
                                            pageId: d.page_id,
                                            pageIds: [],
                                          })
                                        }
                                      }}
                                    >
                                      ×
                                    </span>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="qdg-muted" style={{ padding: 10 }}>
                            도면 불러오는 중...
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            ) : (
              <p className="qdg-muted" style={{ padding: 12 }}>프로젝트가 없습니다.</p>
            )}
          </div>
        </aside>

        <div className="qdg-commerce-desktop-content">
          {/* 초기 화면: 스캔 버튼만 가운데 */}
          {initial && (
            <div className="qdg-commerce-initial">
              <button type="button" className="qdg-btn qdg-btn--primary" onClick={startScanOverlay}>
                QR코드 스캔
              </button>
              {projects?.length ? (
                <p className="qdg-muted" style={{ marginTop: 10, textAlign: 'center' }}>
                  또는 왼쪽 프로젝트에서 선택/추가할 수 있습니다.
                </p>
              ) : null}
            </div>
          )}

          {/* 프로젝트 선택 화면 */}
          {!initial && activeProjectId && (
            <div className="qdg-commerce-layout">
          {/* 좌측: (모바일) 도면 목록 */}
          {false && (
          <aside className={`qdg-commerce-left ${drawingsPanelOpen ? 'qdg-commerce-left--open' : ''}`}>
            <div className="qdg-commerce-left__header">
              <span>도면 목록</span>
              <div className="qdg-commerce-left__header-right">
                <span className="qdg-commerce-left__count">{projectDrawings.length}</span>
                <button
                  type="button"
                  className="qdg-btn qdg-btn--secondary qdg-btn--sm"
                  onClick={() => projectUploadInputRef.current?.click()}
                >
                  도면 추가
                </button>
              </div>
            </div>
            <input
              ref={projectUploadInputRef}
              type="file"
              accept="application/pdf"
              className="qdg-hidden"
              onChange={handleUploadFileToActiveProject}
            />
            <div className="qdg-commerce-drawings">
              {projectDrawings.map((d) => {
                const active = String(d.page_id) === String(selectedDrawingId)
                return (
                  <button
                    key={d.page_id}
                    type="button"
                    className={`qdg-thumb-btn ${active ? 'qdg-thumb-btn--active' : ''}`}
                    onClick={() => {
                      setSelectedDrawingId(d.page_id)
                      setDrawingsPanelOpen(false) // 모바일에서 도면 선택 후 드로어 닫기
                      setInfoPanelOpen(false)
                    }}
                  >
                    <div className="qdg-thumb">
                      <img src={d.image_url} alt={`p-${d.page_number}`} className="qdg-thumb__img" />
                    </div>
                    <div className="qdg-thumb__meta">
                      <div className="qdg-thumb__num">P{d.page_number}</div>
                      <div className="qdg-thumb__kind">
                        {d.kind === 'production' ? '제작' : d.kind === 'installation' ? '설치' : '미분류'}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>
          )}

          {/* 중앙: 도면 상세 */}
          <main className="qdg-commerce-center">
            <div className="qdg-commerce-center__viewer">
                  <ImageZoomPanel
                    title="도면상세"
                    pages={projectDrawings}
                    selectedPageId={selectedDrawingId}
                    showFullViewButton={false}
                    simpleImageMode
                    onFullView={(pageId) => {
                      setFullViewPageId(pageId)
                      setFullViewOpen(true)
                    }}
                  />
            </div>

            {relatedGallerySections.length > 0 && (
              <div className="qdg-related-gallery">
                <div className="qdg-related-gallery__title">관련 도면</div>
                {relatedGallerySections.map((section) => (
                  <div key={section.title} className="qdg-related-gallery__section">
                    <div className="qdg-related-gallery__section-title">{section.title}</div>
                    <div className="qdg-related-gallery__list">
                      {section.pages.map((p) => (
                        <button
                          key={`${section.title}-${p.id}`}
                          type="button"
                          className={`qdg-related-thumb-btn ${String(selectedDrawingId) === String(p.id) ? 'qdg-related-thumb-btn--active' : ''}`}
                          onClick={() => setSelectedDrawingId(p.id)}
                        >
                          {selectedGroupEntry && (
                            <span
                              className="qdg-related-thumb-remove"
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleUngroupPage(p.id)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  void handleUngroupPage(p.id)
                                }
                              }}
                              title="그룹에서 제거"
                              aria-label="그룹에서 제거"
                            >
                              ×
                            </span>
                          )}
                          <div className="qdg-related-thumb">
                            <img src={p.image_url} alt={`related-${p.page_number}`} className="qdg-related-thumb__img" />
                          </div>
                          <div className="qdg-related-thumb__meta">P{p.page_number}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="qdg-commerce-info-bar">
              <button
                type="button"
                className="qdg-btn qdg-btn--primary qdg-btn--full"
                onClick={() => {
                  setInfoPanelOpen(true)
                  setDrawingsPanelOpen(false)
                }}
              >
                도면 정보
              </button>
            </div>
          </main>

          {/* 우측: 도면/그룹 정보 */}
          <aside className={`qdg-commerce-right ${infoPanelOpen ? 'qdg-commerce-right--open' : ''}`}>
            <div className="qdg-commerce-right__mobile-header">
              <span className="qdg-commerce-right__mobile-title">도면 정보</span>
              <button type="button" className="qdg-commerce-close" onClick={() => setInfoPanelOpen(false)} aria-label="닫기">
                ×
              </button>
            </div>
            <div className="qdg-commerce-right__section">
              <div className="qdg-commerce-right__title">도면 정보</div>
              {selectedDrawing ? (
                <>
                  <div className="qdg-commerce-qr-top">
                    <div className="qdg-commerce-qr-top__label">선택 도면 QR</div>
                    {selectedPageQrPayload ? (
                      <>
                        <div className="qdg-commerce-qr-top__svg" title={selectedPageQrPayload}>
                          <QRCodeSVG
                            key={selectedPageQrPayload}
                            value={selectedPageQrPayload}
                            size={128}
                            level="M"
                            includeMargin
                          />
                        </div>
                        {selectedPageQrPayload}
                        <div className="qdg-commerce-qr-top__tsc">
                          <div className="qdg-tsc-mode-row" role="radiogroup" aria-label="TSC 출력 방식">
                            <label className="qdg-tsc-mode-option">
                              <input
                                type="radio"
                                name="qdg-tsc-out"
                                checked={tscOutputMode === 'jspm'}
                                onChange={() => setTscOutputMode('jspm')}
                              />
                              JSPrintManager
                            </label>
                            <label
                              className={`qdg-tsc-mode-option${!isWebUsbSupported() ? ' qdg-tsc-mode-option--disabled' : ''}`}
                              title={
                                !isWebUsbSupported()
                                  ? 'Chrome/Edge 등 WebUSB 지원 브라우저에서 사용할 수 있습니다.'
                                  : undefined
                              }
                            >
                              <input
                                type="radio"
                                name="qdg-tsc-out"
                                checked={tscOutputMode === 'webusb'}
                                disabled={!isWebUsbSupported()}
                                onChange={() => setTscOutputMode('webusb')}
                              />
                              WebUSB
                            </label>
                          </div>
                          {tscOutputMode === 'webusb' && (
                            <div className="qdg-tsc-webusb-row">
                              <span className="qdg-tsc-webusb-status">
                                {webUsbAuthorized ? 'USB 프린터: 등록됨' : 'USB 프린터: 미등록 · 아래에서 한 번 연결하세요'}
                              </span>
                              <button
                                type="button"
                                className="qdg-btn qdg-btn--secondary qdg-tsc-webusb-pair-btn"
                                onClick={() => void handleWebUsbPairPrinter()}
                              >
                                USB 프린터 연결
                              </button>
                            </div>
                          )}
                          {tscOutputMode === 'jspm' && (
                            <>
                              <label className="qdg-tsc-default-row">
                                <input
                                  type="checkbox"
                                  checked={tscUseDefaultPrinter}
                                  onChange={(e) => setTscUseDefaultPrinter(e.target.checked)}
                                />
                                기본 프린터로 출력
                              </label>
                              {!tscUseDefaultPrinter && (
                                <select
                                  className="qdg-input qdg-tsc-printer-select"
                                  value={tscPrinterName}
                                  onChange={(e) => setTscPrinterName(e.target.value)}
                                  onFocus={() => {
                                    void (async () => {
                                      try {
                                        const list = await jspmGetPrinters()
                                        setTscPrinters(Array.isArray(list) ? list : [])
                                      } catch (_) {}
                                    })()
                                  }}
                                >
                                  {tscPrinters.length === 0 ? (
                                    <option value="">프린터 목록을 불러오는 중…</option>
                                  ) : (
                                    tscPrinters.map((name) => (
                                      <option key={name} value={name}>
                                        {name}
                                      </option>
                                    ))
                                  )}
                                </select>
                              )}
                            </>
                          )}
                          <button
                            type="button"
                            className="qdg-btn qdg-btn--secondary qdg-btn--full qdg-tsc-print-btn"
                            disabled={tscPrintBusy}
                            onClick={() => void handleTscPrintSelectedQr()}
                          >
                            {tscPrintBusy
                              ? '출력 중…'
                              : tscOutputMode === 'webusb'
                                ? 'TSC QR 인쇄 (WebUSB·TSPL)'
                                : 'TSC QR 인쇄 (TSPL)'}
                          </button>
                          {tscOutputMode === 'jspm' ? (
                            <p className="qdg-tsc-hint qdg-muted">
                              Neodynamic JSPrintManager + TSC TSPL. 클라이언트에 JSPM 설치, 배포 시{' '}
                              <code>public/js/JSPrintManager.js</code> 포함.
                            </p>
                          ) : (
                            <p className="qdg-tsc-hint qdg-muted">
                              WebUSB로 TSC에 TSPL 전송. HTTPS(또는 localhost) 필요. 처음 한 번「USB 프린터 연결」로
                              장치를 등록하면 이후 인쇄 시 선택 창이 뜨지 않습니다. 용지·방향은{' '}
                              <code>VITE_TSPL_LABEL_*</code>, <code>VITE_TSPL_DIRECTION</code> 등으로 조정합니다.
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="qdg-muted" style={{ marginTop: 8 }}>
                        QR 문자열 없음
                      </p>
                    )}
                  </div>
                  <div className="qdg-commerce-right__row">
                    <span className="qdg-muted">페이지</span>
                    <span>P{selectedDrawing.page_number}</span>
                  </div>
                  <div className="qdg-commerce-right__row">
                    <span className="qdg-muted">분류</span>
                    <span>
                      {selectedDrawing.kind === 'production'
                        ? '제작도면'
                        : selectedDrawing.kind === 'installation'
                          ? '설치도면'
                          : '분류대기'}
                    </span>
                  </div>

                  <div className="qdg-commerce-card">
                    <div className="qdg-commerce-card__title">도면 번호(DWG No)</div>
                    <div className="qdg-field">
                      <label>도면 NO</label>
                      <input className="qdg-input" value={dwgNoText} onChange={(e) => setDwgNoText(e.target.value)} placeholder="예: DWG-0001" />
                    </div>
                    <button type="button" className="qdg-btn qdg-btn--primary qdg-btn--full" onClick={handleSaveDwgNo}>
                      저장
                    </button>
                    <button
                      type="button"
                      className="qdg-btn qdg-btn--secondary qdg-btn--full"
                      style={{ marginTop: 10 }}
                      onClick={() =>
                        setPageDeleteModal({
                          open: true,
                          mode: 'single',
                          pageId: selectedDrawing.page_id,
                          pageIds: [],
                        })
                      }
                    >
                      도면 삭제
                    </button>
                  </div>

                  <div className="qdg-commerce-card qdg-commerce-card--kind">
                    <div className="qdg-commerce-card__title">도면 분류 설정</div>
                    <div className="qdg-field qdg-radio-row">
                      <label>
                        <input
                          type="radio"
                          name="kindSel"
                          checked={selectedDrawing.kind === 'production'}
                          onChange={() => void setPageKindRemote(selectedDrawing.page_id, 'production')}
                        />
                        제작도면
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="kindSel"
                          checked={selectedDrawing.kind === 'installation'}
                          onChange={() => void setPageKindRemote(selectedDrawing.page_id, 'installation')}
                        />
                        설치도면
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="kindSel"
                          checked={!selectedDrawing.kind}
                          onChange={() => void setPageKindRemote(selectedDrawing.page_id, null)}
                        />
                        미분류
                      </label>
                    </div>
                  </div>

                  <div className="qdg-commerce-card qdg-commerce-card--group">
                    <div className="qdg-commerce-card__title">관련 도면</div>
                    <p className="qdg-muted qdg-related-hint">
                      연결할 도면은 미리 QR로 인쇄·등록되어 있어야 합니다. 스캔 시 해당 도면에 저장된 분류(제작/설치)대로 그룹에 추가됩니다.
                    </p>
                    {!selectedDrawing.kind && (
                      <p className="qdg-muted qdg-related-hint">
                        첫 연결 시 그룹을 만들려면, 위에서 현재 도면도 제작/설치 중 하나로 분류해 주세요.
                      </p>
                    )}
                    {selectedGroupEntry && (
                      <>
                        <div className="qdg-field">
                          <label>그룹 이름</label>
                          <input className="qdg-input" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                        </div>
                        <div className="qdg-field">
                          <label>사양 (JSON)</label>
                          <textarea className="qdg-textarea" rows={4} value={groupSpecsText} onChange={(e) => setGroupSpecsText(e.target.value)} />
                        </div>
                        <button
                          type="button"
                          className="qdg-btn qdg-btn--secondary"
                          onClick={async () => {
                            try {
                              const specs = parseSpecs()
                              await emit('onGroupUpdate', {
                                group_id: selectedGroupEntry.group.id,
                                name: groupName.trim() || selectedGroupEntry.group.name,
                                specs,
                              })
                            } catch (e) {
                              setMsg(e.message, 'error')
                            }
                          }}
                        >
                          저장
                        </button>
                      </>
                    )}

                    {relatedDisplay && (
                      <div className="qdg-commerce-group-pages">
                        <div className="qdg-commerce-group-pages__col">
                          <div className="qdg-muted">제작도면</div>
                          <div className="qdg-commerce-group-pages__list">
                            {relatedDisplay.production_pages.map((p) => (
                              <button
                                key={p.id || p.page_id}
                                type="button"
                                className={`qdg-page-btn ${String(selectedDrawingId) === String(p.id || p.page_id) ? 'qdg-page-btn--active' : ''}`}
                                onClick={() => setSelectedDrawingId(p.id || p.page_id)}
                              >
                                P{p.page_number}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="qdg-commerce-group-pages__col">
                          <div className="qdg-muted">설치도면</div>
                          <div className="qdg-commerce-group-pages__list">
                            {relatedDisplay.installation_pages.map((p) => (
                              <button
                                key={p.id || p.page_id}
                                type="button"
                                className={`qdg-page-btn ${String(selectedDrawingId) === String(p.id || p.page_id) ? 'qdg-page-btn--active' : ''}`}
                                onClick={() => setSelectedDrawingId(p.id || p.page_id)}
                              >
                                P{p.page_number}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="qdg-commerce-group-pages__col">
                          <div className="qdg-muted">미분류</div>
                          <div className="qdg-commerce-group-pages__list">
                            {relatedDisplay.unclassified_pages.map((p) => (
                              <button
                                key={p.id || p.page_id}
                                type="button"
                                className={`qdg-page-btn ${String(selectedDrawingId) === String(p.id || p.page_id) ? 'qdg-page-btn--active' : ''}`}
                                onClick={() => setSelectedDrawingId(p.id || p.page_id)}
                              >
                                P{p.page_number}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      className="qdg-btn qdg-btn--primary qdg-btn--full"
                      onClick={() => {
                        if (!selectedDrawing?.page_id) return
                        setAddMode({ mode: 'related', anchorPageId: selectedDrawing.page_id })
                        startScanOverlay()
                      }}
                    >
                      관련 도면 추가 (QR)
                    </button>
                  </div>
                </>
              ) : (
                <p className="qdg-muted">도면을 선택하세요.</p>
              )}
            </div>

            {/* 우측 패널은 프로젝트/도면/그룹 정보만 표시 */}
          </aside>
        </div>
      )}

        </div>
      </div>

      {/* 전체보기(도면상세) 모달 */}
      {fullViewOpen && fullViewPage && (
        <div
          className="qdg-fullscreen-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setFullViewOpen(false)}
        >
          <div className="qdg-fullscreen-panel" onClick={(e) => e.stopPropagation()}>
            <div className="qdg-fullscreen-topbar">
              <div className="qdg-fullscreen-title">
                도면상세 · P{fullViewPage.page_number}
              </div>
              <button
                type="button"
                className="qdg-fullscreen-close"
                onClick={() => setFullViewOpen(false)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className="qdg-fullscreen-view">
              <TransformWrapper initialScale={1} minScale={0.25} maxScale={4} centerOnInit wheel={{ step: 0.1 }}>
                <TransformComponent wrapperClass="qdg-zoom-wrap qdg-zoom-wrap--fullscreen" contentClass="qdg-zoom-inner qdg-zoom-inner--fullscreen">
                  <img
                    title={`img-full-${fullViewPage.id || fullViewPage.page_id}`}
                    src={fullViewPage.image_url || fullViewPage.file_url}
                    className="qdg-image-img"
                    alt={`drawing-${fullViewPage.page_number || ''}`}
                    onError={(e) => {
                      const img = e.currentTarget
                      img.onerror = null
                      img.src = fullViewPage.file_url
                    }}
                  />
                </TransformComponent>
              </TransformWrapper>
            </div>
          </div>
        </div>
      )}

      {/* 모바일 드로어 스크림 */}
      {drawingsPanelOpen && activeProjectId && (
        <div className="qdg-drawings-scrim" onClick={() => setDrawingsPanelOpen(false)} role="presentation" />
      )}

      {infoPanelOpen && activeProjectId && (
        <div className="qdg-info-scrim" onClick={() => setInfoPanelOpen(false)} role="presentation" />
      )}

      {/* 슬라이드 사이드바 */}
      {sidebarOpen && (
        <div
          className="qdg-commerce-scrim"
          onClick={() => setSidebarOpen(false)}
          role="presentation"
        >
          <aside className="qdg-commerce-sidemenu" onClick={(e) => e.stopPropagation()}>
            <div className="qdg-commerce-sidemenu__header">
              <div className="qdg-commerce-sidemenu__title">프로젝트</div>
              <button type="button" className="qdg-commerce-close" onClick={() => setSidebarOpen(false)}>
                ×
              </button>
            </div>

            <div className="qdg-commerce-sidemenu__section">
              <input ref={fileInputRef} type="file" accept="application/pdf" className="qdg-hidden" onChange={handleUploadFile} />
              <button type="button" className="qdg-btn qdg-btn--primary qdg-btn--full" onClick={handleCreateProject}>
                프로젝트 추가
              </button>
            </div>

            <div className="qdg-commerce-sidemenu__list">
              {projects.length ? (
                projects.map((p) => {
                  const pid = p.project_id
                  const expanded = !!expandedProjectIds[pid]
                  const pages = projectPagesCache[pid]
                  const isActiveProject = String(activeProjectId) === String(pid)

                  return (
                    <div key={pid} className="qdg-project-item">
                      <div className="qdg-project-row">
                        <button
                          type="button"
                          className="qdg-project-row__main"
                          onClick={() => {
                            setActiveProjectId(pid)
                            setSelectedDrawingId(null)
                            setExpandedProjectIds((prev) => ({
                              ...prev,
                              [pid]: isActiveProject ? !prev[pid] : true,
                            }))
                            if (!projectPagesCache[pid]) ensureProjectPagesLoaded(pid)
                          }}
                        >
                          <div className="qdg-project-row__top">
                            <span className={`qdg-project-expander ${expanded ? 'qdg-project-expander--open' : ''}`}>▸</span>
                            <div className="qdg-project-row__name">{p.name}</div>
                          </div>
                          <div className="qdg-project-row__meta">{p.page_count} pages</div>
                        </button>
                        <div className="qdg-project-row__actions">
                          <button
                            type="button"
                            className="qdg-project-row__edit"
                            aria-label="수정"
                            onClick={() => handleRenameProject(pid, p.name)}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="qdg-project-row__del"
                            aria-label="삭제"
                            onClick={() => setDeleteModal({ open: true, uploadId: pid })}
                          >
                            삭제
                          </button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="qdg-project-submenu">
                          {isActiveProject && (
                            <div className="qdg-project-submenu__upload">
                              <button
                                type="button"
                                className="qdg-btn qdg-btn--secondary qdg-btn--full"
                                disabled={projectUploadBusy}
                                onClick={() => projectUploadInputRef.current?.click()}
                              >
                                {projectUploadBusy ? (
                                  <span className="qdg-inline-busy">
                                    <span className="qdg-inline-spinner" />
                                    처리 중...
                                  </span>
                                ) : (
                                  '도면 추가'
                                )}
                              </button>
                            </div>
                          )}
                          {Array.isArray(pages) && pages.length > 0 && (
                            <div
                              className="qdg-project-submenu__bulk-toolbar"
                              role="group"
                              aria-label="도면 다중 선택"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="qdg-btn qdg-btn--ghost qdg-btn--compact"
                                onClick={() => toggleAllPagesInProject(pid, pages)}
                              >
                                {isAllSelectedForProject(pid, pages) ? '전체 해제' : '전체 선택'}
                              </button>
                              <button
                                type="button"
                                className="qdg-btn qdg-btn--secondary qdg-btn--compact"
                                disabled={selectedCountForProject(pid) === 0}
                                onClick={() => {
                                  const ids = selectedPageIdsByProject[pid] || []
                                  if (!ids.length) return
                                  setActiveProjectId(pid)
                                  setPageDeleteModal({ open: true, mode: 'bulk', pageId: null, pageIds: [...ids] })
                                }}
                              >
                                선택 삭제 ({selectedCountForProject(pid)})
                              </button>
                            </div>
                          )}
                          {Array.isArray(pages) ? (
                            <div className="qdg-project-submenu__list">
                              {pages.map((d) => {
                                const active = String(selectedDrawingId) === String(d.page_id)
                                const checked = (selectedPageIdsByProject[pid] || []).some(
                                  (x) => String(x) === String(d.page_id)
                                )
                                return (
                                  <button
                                    key={d.page_id}
                                    type="button"
                                    className={`qdg-project-subpage-btn ${active ? 'qdg-project-subpage-btn--active' : ''}`}
                                    onClick={() => {
                                      setActiveProjectId(pid)
                                      setSelectedDrawingId(d.page_id)
                                      setExpandedProjectIds((prev) => ({ ...prev, [pid]: true }))
                                      setSidebarOpen(false)
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      className="qdg-project-subpage-check"
                                      checked={checked}
                                      onChange={(e) => {
                                        e.stopPropagation()
                                        togglePageSelected(pid, d.page_id, e.target.checked)
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      aria-label="도면 선택"
                                    />
                                    <span className="qdg-project-subpage-btn__num">P{d.page_number}</span>
                                    <div className="qdg-project-subpage-btn__right">
                                      <span className="qdg-project-subpage-btn__kind">
                                        {d.kind === 'production' ? '제작' : d.kind === 'installation' ? '설치' : '미분류'}
                                      </span>
                                      <span
                                        className="qdg-project-subpage-btn__del"
                                        role="button"
                                        tabIndex={0}
                                        title="도면 삭제"
                                        aria-label="도면 삭제"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setActiveProjectId(pid)
                                          setPageDeleteModal({
                                            open: true,
                                            mode: 'single',
                                            pageId: d.page_id,
                                            pageIds: [],
                                          })
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            setActiveProjectId(pid)
                                            setPageDeleteModal({
                                              open: true,
                                              mode: 'single',
                                              pageId: d.page_id,
                                              pageIds: [],
                                            })
                                          }
                                        }}
                                      >
                                        ×
                                      </span>
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="qdg-muted" style={{ padding: 10 }}>도면 불러오는 중...</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <p className="qdg-muted" style={{ padding: 12 }}>프로젝트가 없습니다.</p>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteModal.open && (
        <div className="qdg-commerce-modal-scrim" onClick={() => setDeleteModal({ open: false, uploadId: null })}>
          <div className="qdg-commerce-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qdg-commerce-modal__title">프로젝트 삭제</div>
            <div className="qdg-muted">
              선택한 프로젝트를 삭제하시겠습니까? 관련 도면(페이지)과 이미지가 함께 제거됩니다.
            </div>
            <div className="qdg-commerce-modal__actions">
              <button type="button" className="qdg-btn qdg-btn--secondary" onClick={() => setDeleteModal({ open: false, uploadId: null })}>
                취소
              </button>
              <button type="button" className="qdg-btn qdg-btn--primary" onClick={() => handleDeleteProject(deleteModal.uploadId)}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 도면 삭제 확인 모달 */}
      {pageDeleteModal.open && (
        <div className="qdg-commerce-modal-scrim" onClick={closePageDeleteModal}>
          <div className="qdg-commerce-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qdg-commerce-modal__title">도면 삭제</div>
            <div className="qdg-muted">
              {pageDeleteModal.mode === 'bulk'
                ? `선택한 ${(pageDeleteModal.pageIds || []).length}개의 도면을 삭제합니다. 관련 이미지가 함께 제거됩니다.`
                : '선택한 도면(페이지)을 삭제합니다. 관련 이미지가 함께 제거됩니다.'}
            </div>
            <div className="qdg-commerce-modal__actions">
              <button type="button" className="qdg-btn qdg-btn--secondary" onClick={closePageDeleteModal}>
                취소
              </button>
              <button type="button" className="qdg-btn qdg-btn--primary" onClick={handleDeletePage}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 스캔 오버레이 */}
      {scanOverlayOpen && (
        <div className="qdg-commerce-scan-overlay" role="dialog" aria-modal="true">
          <div className="qdg-commerce-scan">
            <div className="qdg-commerce-scan__header">
              <div className="qdg-commerce-scan__title">
                {addMode?.mode === 'related' ? '관련 도면 QR 스캔' : 'QR 스캔'}
              </div>
              <button type="button" className="qdg-commerce-close" onClick={stopScanOverlay}>×</button>
            </div>
            <QRScanner
              key={scannerKey}
              elementId={`qdg-qr-scan-${scannerKey}`}
              stopWhen={scanStop}
              onScan={(t) => handleScanText(t)}
              onError={() => {}}
            />
            <div className="qdg-commerce-scan__actions">
              <button type="button" className="qdg-btn qdg-btn--secondary" onClick={stopScanOverlay}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 메시지 */}
      {message && (
        <div className={`qdg-banner qdg-banner--${message.type}`} role="status" aria-live="polite">
          {message.text}
          <button type="button" className="qdg-banner-close" onClick={() => setMessage(null)}>×</button>
        </div>
      )}
    </div>
  )
}

export default QrDrawingManagerWidgetCommercial
