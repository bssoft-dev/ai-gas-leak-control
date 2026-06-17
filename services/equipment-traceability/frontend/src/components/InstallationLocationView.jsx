/**
 * 도면 관리: 도면 업로드(PDF/이미지), DWG No 등록, 도면 위 설치 위치 포인트 표시/저장
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import './InstallationLocationView.css'
import qrcodeReact from 'qrcode.react'

const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']
const QRCodeComponent = qrcodeReact.QRCodeSVG || qrcodeReact

function InstallationLocationView({ onAction, events }) {
  const [drawings, setDrawings] = useState([])
  const [selectedDrawing, setSelectedDrawing] = useState(null)
  const [points, setPoints] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [uploadDwgNo, setUploadDwgNo] = useState('')
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [editingPointId, setEditingPointId] = useState(null)
  const [editPcsNo, setEditPcsNo] = useState('')
  const canvasWrapRef = useRef(null)
  const imageRef = useRef(null)
  const [drawingImageUrl, setDrawingImageUrl] = useState(null)
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 })
  const [equipmentRecords, setEquipmentRecords] = useState([])
  const [autocompleteOpenFor, setAutocompleteOpenFor] = useState(null) // point id when dropdown is open
  const [inputMode, setInputMode] = useState(false) // true일 때만 도면 클릭으로 포인트 추가
  const [zoomLevel, setZoomLevel] = useState(1)
  const pinchStartRef = useRef(null) // { distance, zoom }
  const zoomScrollRef = useRef(null) // 줌 후 스크롤 보정 { left, top }
  const dragStartRef = useRef(null) // { clientX, clientY, scrollLeft, scrollTop }
  const didDragRef = useRef(false)
  const [qrExpanded, setQrExpanded] = useState(false)

  const setMsg = (text, type = 'info') => setMessage({ text, type })
  const clearMsg = () => setMessage(null)

  const loadDrawings = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch('/api/installation/drawings')
      if (res.ok) {
        const data = await res.json()
        setDrawings(Array.isArray(data) ? data : [])
      }
    } catch (_) {}
    setLoadingList(false)
  }, [])

  useEffect(() => {
    loadDrawings()
  }, [loadDrawings])

  useEffect(() => {
    if (!events?.subscribe) return
    const es = new EventSource('/api/events/stream')
    const handler = (e) => {
      try {
        const ev = JSON.parse(e.data)
        const payload = ev.payload || {}
        if (ev.type === 'INSTALLATION_DRAWING_UPLOADED' && payload.success) {
          setMsg('도면이 등록되었습니다.', 'success')
          setUploadFile(null)
          setUploadDwgNo('')
          loadDrawings()
        }
        if (ev.type === 'INSTALLATION_DRAWING_UPLOADED' && !payload.success) {
          setMsg(payload.error || '업로드 실패', 'error')
        }
        if (ev.type === 'INSTALLATION_POINTS_SAVED' && payload.success) {
          const n = payload.records_updated || 0
          setMsg(n > 0 ? `설치 위치가 저장되었습니다. ${n}건 자재에 도면번호가 반영되었습니다.` : '설치 위치가 저장되었습니다.', 'success')
          setPoints(payload.points || [])
          setSaving(false)
        }
        if (ev.type === 'INSTALLATION_POINTS_SAVED' && !payload.success) {
          setMsg(payload.error || '저장 실패', 'error')
          setSaving(false)
        }
        if (ev.type === 'INSTALLATION_DRAWING_DELETED') {
          if (payload.success) {
            const n = payload.records_cleared || 0
            setMsg(n > 0 ? `도면이 삭제되었습니다. ${n}건 자재의 DWG No가 초기화되었습니다.` : '도면이 삭제되었습니다.', 'success')
            if (selectedDrawing && payload.drawing_id === selectedDrawing.id) {
              closeDrawing()
            }
            loadDrawings()
          } else {
            setMsg(payload.error || '삭제 실패', 'error')
          }
        }
      } catch (_) {}
    }
    es.onmessage = handler
    return () => es.close()
  }, [events?.subscribe, loadDrawings, selectedDrawing])

  const handleUpload = async () => {
    if (!uploadFile || !onAction || !events?.onUploadDrawing) return
    const ext = '.' + (uploadFile.name || '').split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXT.includes(ext)) {
      setMsg(`허용 형식: ${ALLOWED_EXT.join(', ')}`, 'error')
      return
    }
    setUploading(true)
    clearMsg()
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        let base64 = reader.result
        if (typeof base64 === 'string' && base64.startsWith('data:')) {
          base64 = base64.replace(/^data:[^;]+;base64,/, '')
        }
        onAction('onUploadDrawing', {
          dwg_no: uploadDwgNo.trim() || uploadFile.name,
          filename: uploadFile.name,
          file_base64: base64,
        })
        setUploading(false)
        resolve()
      }
      reader.readAsDataURL(uploadFile)
    })
  }

  const loadEquipmentRecords = useCallback(async () => {
    try {
      const res = await fetch('/api/traceability/records')
      if (res.ok) {
        const data = await res.json()
        setEquipmentRecords(Array.isArray(data) ? data : [])
      }
    } catch (_) {}
  }, [])

  const openDrawing = async (drawing) => {
    setSelectedDrawing(drawing)
    setDrawingImageUrl(null)
    setPoints([])
    setLoadingDetail(true)
    loadEquipmentRecords()
    try {
      const [detailRes, fileUrl] = await Promise.all([
        fetch(`/api/installation/drawings/${drawing.id}`),
        Promise.resolve(`/api/installation/drawings/${drawing.id}/file`),
      ])
      if (!detailRes.ok) throw new Error('도면 정보 조회 실패')
      const { drawing: d, points: p } = await detailRes.json()
      setPoints(Array.isArray(p) ? p : [])
      if (d.file_type === 'pdf') {
        setDrawingImageUrl(fileUrl + '?t=' + Date.now())
      } else {
        setDrawingImageUrl(fileUrl + '?t=' + Date.now())
      }
    } catch (e) {
      setMsg(e.message || '도면 로드 실패', 'error')
    }
    setLoadingDetail(false)
  }

  const closeDrawing = () => {
    setSelectedDrawing(null)
    setPoints([])
    setDrawingImageUrl(null)
    setImageSize({ w: 0, h: 0 })
    setZoomLevel(1)
    setInputMode(false)
  }

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const wrap = canvasWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const contentX = wrap.scrollLeft + mx
    const contentY = wrap.scrollTop + my
    const delta = e.deltaY > 0 ? -0.15 : 0.15
    const newZoom = Math.min(3, Math.max(0.25, zoomLevel + delta))
    setZoomLevel(newZoom)
    const ratio = newZoom / zoomLevel
    zoomScrollRef.current = {
      left: contentX * ratio - mx,
      top: contentY * ratio - my,
    }
  }, [zoomLevel])

  useEffect(() => {
    const el = canvasWrapRef.current
    if (!el || selectedDrawing?.file_type === 'pdf') return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [selectedDrawing?.file_type, handleWheel])

  useEffect(() => {
    if (zoomScrollRef.current && canvasWrapRef.current) {
      const { left, top } = zoomScrollRef.current
      canvasWrapRef.current.scrollLeft = left
      canvasWrapRef.current.scrollTop = top
      zoomScrollRef.current = null
    }
  }, [zoomLevel])

  const zoomByButtons = useCallback((delta) => {
    const wrap = canvasWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const mx = rect.width / 2
    const my = rect.height / 2
    const contentX = wrap.scrollLeft + mx
    const contentY = wrap.scrollTop + my
    const newZoom = Math.min(3, Math.max(0.25, zoomLevel + delta))
    setZoomLevel(newZoom)
    const ratio = newZoom / zoomLevel
    zoomScrollRef.current = { left: contentX * ratio - mx, top: contentY * ratio - my }
  }, [zoomLevel])

  const handlePanStart = useCallback((e) => {
    if (selectedDrawing?.file_type === 'pdf') return
    if (e.target.closest('.il-zoom-controls') || e.target.closest('button')) return
    const wrap = canvasWrapRef.current
    if (!wrap) return
    didDragRef.current = false
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      scrollLeft: wrap.scrollLeft,
      scrollTop: wrap.scrollTop,
    }
    const onMove = (e2) => {
      if (!dragStartRef.current) return
      didDragRef.current = true
      wrap.style.cursor = 'grabbing'
      const dx = dragStartRef.current.clientX - e2.clientX
      const dy = dragStartRef.current.clientY - e2.clientY
      wrap.scrollLeft = dragStartRef.current.scrollLeft + dx
      wrap.scrollTop = dragStartRef.current.scrollTop + dy
    }
    const onUp = () => {
      dragStartRef.current = null
      if (wrap) wrap.style.cursor = 'grab'
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [selectedDrawing?.file_type])

  const handlePinchStart = (e) => {
    if (e.touches.length !== 2) return
    const d = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY)
    pinchStartRef.current = { distance: d, zoom: zoomLevel }
  }

  const handlePinchMove = (e) => {
    if (e.touches.length !== 2 || !pinchStartRef.current) return
    e.preventDefault()
    const d = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY)
    const { distance, zoom } = pinchStartRef.current
    const scale = d / distance
    const next = Math.min(3, Math.max(0.25, zoom * scale))
    setZoomLevel(next)
    pinchStartRef.current = { distance: d, zoom: next }
  }

  const handlePinchEnd = () => {
    pinchStartRef.current = null
  }

  const handleDeleteDrawing = (drawing, e) => {
    e?.stopPropagation?.()
    if (!window.confirm(`도면 "${drawing.dwg_no || drawing.filename}"을(를) 삭제하시겠습니까?`)) return
    if (!onAction || !events?.onDeleteDrawing) return
    onAction('onDeleteDrawing', { drawing_id: drawing.id })
  }

  const onImageLoad = (e) => {
    const img = e.target
    if (img.naturalWidth) setImageSize({ w: img.naturalWidth, h: img.naturalHeight })
  }

  const handleCanvasClick = (e) => {
    if (didDragRef.current) return
    if (!inputMode || !selectedDrawing) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    const newPoint = {
      id: 'p-' + Date.now(),
      x,
      y,
      pcs_no: '',
      label: '',
      record_id: '',
    }
    setPoints((prev) => [...prev, newPoint])
    setEditingPointId(newPoint.id)
    setEditPcsNo('')
  }

  const handleSavePoints = () => {
    if (!selectedDrawing || !onAction || !events?.onPointsSave) return
    setSaving(true)
    clearMsg()
    onAction('onPointsSave', {
      drawing_id: selectedDrawing.id,
      points: points.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        pcs_no: p.pcs_no || '',
        label: p.label || '',
        record_id: p.record_id || '',
      })),
    })
  }

  const removePoint = (id) => {
    setPoints((prev) => prev.filter((p) => p.id !== id))
    if (editingPointId === id) setEditingPointId(null)
  }

  const buildLocationQrString = (drawingId, pointId, pcsNo) => {
    const tokens = ['T2', drawingId, pointId, pcsNo || '']
    return tokens.map((t) => encodeURIComponent(String(t))).join('|')
  }

  const updatePointPcsNo = (id, pcs_no, record_id = '') => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, pcs_no: pcs_no || '', record_id: record_id || p.record_id } : p)))
    setEditPcsNo(pcs_no)
  }

  // 설치위치가 지정되지 않은 장비 (installation_location 비어 있음). 이미 이 도면 포인트에 할당된 pcs_no는 제외
  const assignedPcsNos = points.map((p) => (p.pcs_no || '').trim()).filter(Boolean)
  const unassignedEquipment = equipmentRecords.filter((r) => {
    const loc = (r.installation_location || '').trim()
    const pcs = (r.pcs_no || '').trim()
    return !loc && pcs
  })

  const getAutocompleteCandidates = (pointId, query) => {
    const q = (query || '').trim().toLowerCase()
    const alreadyAssigned = points.filter((pt) => pt.id !== pointId).map((pt) => (pt.pcs_no || '').trim())
    return unassignedEquipment.filter((r) => {
      const pcs = (r.pcs_no || '').trim()
      if (alreadyAssigned.includes(pcs)) return false
      if (!q) return true
      return (
        pcs.toLowerCase().includes(q) ||
        (r.ship_no || '').toLowerCase().includes(q) ||
        (r.block || '').toLowerCase().includes(q) ||
        (r.unit || '').toLowerCase().includes(q) ||
        (r.item || '').toLowerCase().includes(q) ||
        (r.dwg_no || '').toLowerCase().includes(q)
      )
    }).slice(0, 12)
  }

  return (
    <div className="il-view">
      {message && (
        <div className={`il-message il-message--${message.type}`} role="alert">
          <span>{message.text}</span>
          <button type="button" className="il-message-dismiss" onClick={clearMsg} aria-label="닫기">×</button>
        </div>
      )}

      {!selectedDrawing ? (
        <>
          <section className="il-section il-upload">
            <h3 className="il-section-title">도면 업로드</h3>
            <p className="il-hint">이미지(PNG, JPG, GIF, WEBP) 파일을 업로드하고 DWG No를 입력하세요.</p>
            <div className="il-upload-row">
              <input
                type="text"
                className="il-input"
                placeholder="DWG No"
                value={uploadDwgNo}
                onChange={(e) => setUploadDwgNo(e.target.value)}
              />
              <label className="il-file-label">
                <input
                  type="file"
                  accept={ALLOWED_EXT.join(',')}
                  className="il-file-input"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
                <span className="il-btn il-btn--secondary">{uploadFile ? uploadFile.name : '파일 선택'}</span>
              </label>
              <button
                type="button"
                className="il-btn il-btn--primary"
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
              >
                {uploading ? '업로드 중…' : '업로드'}
              </button>
            </div>
          </section>

          <section className="il-section il-list">
            <h3 className="il-section-title">도면 목록</h3>
            {loadingList ? (
              <p className="il-loading">목록 로딩 중…</p>
            ) : drawings.length === 0 ? (
              <p className="il-empty">등록된 도면이 없습니다. 도면을 업로드하세요.</p>
            ) : (
              <ul className="il-drawing-list">
                {drawings.map((d) => (
                  <li key={d.id} className="il-drawing-item">
                    <button type="button" className="il-drawing-btn" onClick={() => openDrawing(d)}>
                      <span className="il-drawing-id" title={d.id}>ID: {d.id}</span>
                      <span className="il-drawing-dwg">{d.dwg_no || '(DWG No 없음)'}</span>
                      <span className="il-drawing-filename">{d.filename}</span>
                      <span className="il-drawing-meta">{d.file_type} · {d.updated_at?.slice(0, 10)}</span>
                    </button>
                    <button type="button" className="il-drawing-delete" onClick={(e) => handleDeleteDrawing(d, e)} title="도면 삭제" aria-label="도면 삭제">×</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <div className="il-editor">
          <div className="il-editor-head">
            <div className="il-editor-title-wrap">
              <h3 className="il-editor-title">설치 위치 표시</h3>
              <div className="il-editor-drawing-info">
                <span className="il-editor-dwg">DWG No: {selectedDrawing.dwg_no || '-'}</span>
                
              </div>
            </div>
            <div className="il-editor-head-actions">
              <button type="button" className="il-btn il-btn--danger il-btn--sm" onClick={() => handleDeleteDrawing(selectedDrawing)} title="도면 삭제">
                도면 삭제
              </button>
              <button type="button" className="il-btn il-btn--secondary il-btn--sm" onClick={closeDrawing}>
                목록으로
              </button>
            </div>
          </div>
          <p className="il-hint">포인트를 선택해 PC&apos;s No를 입력하고 저장하세요.</p>
          <label className="il-input-mode-toggle">
            <input type="checkbox" checked={inputMode} onChange={(e) => setInputMode(e.target.checked)} />
            <span>입력모드</span>
            <span className="il-input-mode-hint">{inputMode ? '도면 클릭 시 포인트 추가' : '포인트 추가 비활성화'}</span>
          </label>

          <div className="il-editor-body">
            <div
              className="il-canvas-wrap"
              ref={canvasWrapRef}
              style={selectedDrawing?.file_type !== 'pdf' ? { overflow: 'auto', cursor: 'grab' } : undefined}
              onMouseDown={selectedDrawing?.file_type !== 'pdf' ? handlePanStart : undefined}
              onTouchStart={selectedDrawing?.file_type !== 'pdf' ? handlePinchStart : undefined}
              onTouchMove={selectedDrawing?.file_type !== 'pdf' ? handlePinchMove : undefined}
              onTouchEnd={handlePinchEnd}
              onTouchCancel={handlePinchEnd}
            >
              {loadingDetail ? (
                <div className="il-canvas-loading">도면 로딩 중…</div>
              ) : (
                <>
                  {selectedDrawing.file_type === 'pdf' ? (
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: '600px',
                        minHeight: 500,
                      }}
                    >
                      <iframe
                        title="도면 PDF"
                        src={drawingImageUrl || ''}
                        className="il-canvas-pdf"
                        style={{ display: drawingImageUrl ? 'block' : 'none', height: '100%' }}
                      />
                      {drawingImageUrl && (
                        <div
                          className="il-canvas-click-layer"
                          style={{ cursor: inputMode ? 'crosshair' : 'pointer' }}
                          onClick={handleCanvasClick}
                        />
                      )}
                      {drawingImageUrl && (
                        <div className="il-points-layer">
                          {points.map((p) => (
                            <div
                              key={p.id}
                              className="il-point"
                              style={{
                                left: `${p.x * 100}%`,
                                top: `${p.y * 100}%`,
                                transform: 'translate(-50%, -50%)',
                              }}
                              title={p.pcs_no || "PC's No 미입력"}
                            >
                              <span className="il-point-dot" />
                              <span className="il-point-label">{p.pcs_no || '?'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className="il-canvas-zoom-inner"
                      style={{
                        width: imageSize.w ? `${imageSize.w}px` : '100%',
                        height: imageSize.h ? `${imageSize.h}px` : '200px',
                        transform: `scale(${zoomLevel})`,
                        transformOrigin: '0 0',
                      }}
                    >
                      <img
                        ref={imageRef}
                        src={drawingImageUrl || ''}
                        alt="도면"
                        className="il-canvas-img"
                        style={{ display: drawingImageUrl ? 'block' : 'none' }}
                        onLoad={onImageLoad}
                      />
                      {drawingImageUrl && (
                        <div
                          className="il-canvas-click-layer"
                          style={{ cursor: inputMode ? 'crosshair' : 'grab' }}
                          onClick={handleCanvasClick}
                        />
                      )}
                      {drawingImageUrl && (
                        <div className="il-points-layer">
                          {points.map((p) => (
                            <div
                              key={p.id}
                              className="il-point"
                              style={{
                                left: `${p.x * 100}%`,
                                top: `${p.y * 100}%`,
                                transform: 'translate(-50%, -50%)',
                              }}
                              title={p.pcs_no || "PC's No 미입력"}
                            >
                              <span className="il-point-dot" />
                              <span className="il-point-label">{p.pcs_no || '?'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {selectedDrawing?.file_type !== 'pdf' && !loadingDetail && (
                <div className="il-zoom-controls">
                  <button type="button" className="il-zoom-btn" onClick={() => zoomByButtons(0.25)} title="줌인">+</button>
                  <span className="il-zoom-value">{Math.round(zoomLevel * 100)}%</span>
                  <button type="button" className="il-zoom-btn" onClick={() => zoomByButtons(-0.25)} title="줌아웃">−</button>
                </div>
              )}
            </div>

            <div className="il-sidebar">
              <h4 className="il-sidebar-title">설치 위치 목록</h4>
              {points.length === 0 ? (
                <p className="il-sidebar-empty">도면을 클릭해 포인트를 추가하세요.</p>
              ) : (
                <ul className="il-point-list">
                  {points.map((p) => {
                    const showAutocomplete = autocompleteOpenFor === p.id
                    const query = editingPointId === p.id ? editPcsNo : p.pcs_no
                    const candidates = getAutocompleteCandidates(p.id, query)
                    return (
                      <li key={p.id} className="il-point-item">
                        <div className="il-point-item-row">
                          <span className="il-point-item-coord">({(p.x * 100).toFixed(0)}, {(p.y * 100).toFixed(0)})</span>
                          <button type="button" className="il-point-item-remove" onClick={() => removePoint(p.id)} aria-label="삭제">×</button>
                        </div>
                        <div className="il-point-input-wrap">
                          <input
                            type="text"
                            className="il-input il-input--sm"
                            placeholder="PC's No (입력 또는 목록에서 선택)"
                            value={editingPointId === p.id ? editPcsNo : p.pcs_no}
                            onChange={(e) => {
                              setEditPcsNo(e.target.value)
                              updatePointPcsNo(p.id, e.target.value)
                              setAutocompleteOpenFor(p.id)
                            }}
                            onFocus={() => { setEditingPointId(p.id); setEditPcsNo(p.pcs_no || ''); setAutocompleteOpenFor(p.id) }}
                            onBlur={() => { setTimeout(() => setAutocompleteOpenFor(null), 180) }}
                          />
                          {showAutocomplete && (
                            <ul className="il-autocomplete" role="listbox">
                              {candidates.length === 0 ? (
                                <li className="il-autocomplete-item il-autocomplete-item--empty">설치위치 미지정 장비가 없습니다.</li>
                              ) : (
                                candidates.map((r) => (
                                  <li
                                    key={r.id || r.pcs_no}
                                    className="il-autocomplete-item"
                                    role="option"
                                    onMouseDown={(e) => {
                                      e.preventDefault()
                                      updatePointPcsNo(p.id, r.pcs_no || '', r.id || '')
                                      setEditPcsNo(r.pcs_no || '')
                                      setAutocompleteOpenFor(null)
                                    }}
                                  >
                                    <span className="il-autocomplete-pcs">{r.pcs_no || '-'}</span>
                                    {(r.ship_no || r.block || r.unit) && (
                                      <span className="il-autocomplete-meta">{[r.ship_no, r.block, r.unit].filter(Boolean).join(' · ')}</span>
                                    )}
                                  </li>
                                ))
                              )}
                            </ul>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              <button
                type="button"
                className="il-btn il-btn--primary il-save-btn"
                onClick={handleSavePoints}
                disabled={saving || !points.length}
              >
                {saving ? '저장 중…' : '저장'}
              </button>

              <div style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="il-btn il-btn--secondary il-save-btn"
                  style={{ width: '100%' }}
                  onClick={() => setQrExpanded((v) => !v)}
                  disabled={!selectedDrawing || points.length === 0}
                >
                  {qrExpanded ? '위치 QR 접기' : '위치 QR 생성/보기'}
                </button>
              </div>

              {qrExpanded && (
                <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  {points.slice(0, 48).map((p) => {
                    const drawingId = selectedDrawing?.id || ''
                    const qrStr = buildLocationQrString(drawingId, p.id, p.pcs_no || '')
                    return (
                      <div key={p.id} style={{ border: '1px solid var(--et-border, #e5e7eb)', borderRadius: 8, padding: 8, background: 'var(--et-bg-card, #fff)' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--et-text-muted, #6b7280)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.pcs_no || '-'}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          <QRCodeComponent value={qrStr} size={110} level="M" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default InstallationLocationView
