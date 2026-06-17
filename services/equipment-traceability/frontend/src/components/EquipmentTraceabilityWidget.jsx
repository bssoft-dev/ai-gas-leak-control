import React, { useState, useEffect, useRef, useMemo } from 'react'
import './EquipmentTraceabilityWidget.css'
import qrcodeReact from 'qrcode.react'
import { ReactBarcode } from 'react-jsbarcode'
import QRScanner from './QRScanner'
import InstallationLocationView from './InstallationLocationView'

const QRCodeComponent = qrcodeReact.QRCodeSVG || qrcodeReact

const BARCODE_OPTIONS = { format: 'CODE128', width: 2, height: 60, displayValue: true }

const FIELD_LABELS = {
  drawing_receipt_date: '도면접수일',
  ship_no: '호선',
  block: 'BLOCK',
  unit: 'UNIT',
  item: 'ITEM',
  pcs_no: "PC's No",
  installation_location: '설치위치도',
  paint_code: 'Paint Code',
  dwg_no: 'DWG No',
  quantity: '수량',
  list_weight: 'LIST 중량',
  remarks: '비고',
  revision_date_reason: '개정일/사유',
}

const FIELD_GROUPS = [
  { title: '기본 정보', keys: ['drawing_receipt_date', 'ship_no', 'block', 'unit', 'item', 'pcs_no'] },
  { title: '설치·도면', keys: ['installation_location', 'paint_code', 'dwg_no'] },
  { title: '수량·비고', keys: ['quantity', 'list_weight', 'remarks', 'revision_date_reason'] },
]

const INIT_RECORD = Object.fromEntries(Object.keys(FIELD_LABELS).map((k) => [k, '']))

const TABLE_COLUMNS = [
  { key: 'pcs_no', label: "PC's No" },
  { key: 'ship_no', label: '호선' },
  { key: 'block', label: 'BLOCK' },
  { key: 'unit', label: 'UNIT' },
  { key: 'item', label: 'ITEM' },
  { key: 'dwg_no', label: 'DWG No' },
  { key: 'quantity', label: '수량' },
]

const DRAWING_ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']

function extractPcsNo(scannedText) {
  if (!scannedText || typeof scannedText !== 'string') return ''
  const s = scannedText.trim()
  if (s.includes('|')) {
    const parts = s.split('|').map((p) => decodeURIComponent(p || ''))
    return parts[1] || parts[0] || s
  }
  return s
}

function parseQrTokens(scannedText) {
  if (!scannedText || typeof scannedText !== 'string') return null
  if (!scannedText.includes('|')) return null
  try {
    const parts = scannedText.split('|').map((p) => decodeURIComponent(p || ''))
    return { version: parts[0] || '', parts }
  } catch (_) {
    return null
  }
}

function getPdfVisionPageImageSrc(page) {
  const url = page?.image_data_url
  if (typeof url === 'string' && url && !url.startsWith('data:image')) return url
  const imagePath = page?.image_path
  if (typeof imagePath !== 'string' || !imagePath) return url || ''

  // data/traceability/pdf_vision/pages/{job_id}/page-{n}.png
  try {
    const m = imagePath.match(/pdf_vision\/pages\/([^/]+)\/page-(\d+)\.png$/)
    if (m) {
      const jobId = m[1]
      const pageNum = m[2]
      return `/api/traceability/pdf_vision/jobs/${jobId}/pages/${pageNum}/file`
    }
  } catch (_) {}
  return url || ''
}

function pdfClassificationLabel(c) {
  if (c === 'installation') return '설치도면'
  if (c === 'design') return '설계도면'
  return '분류대기'
}

function EquipmentTraceabilityWidget({ onAction, events }) {
  const [listRecords, setListRecords] = useState([])
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [listFilters, setListFilters] = useState({ ship_no: '', block: '', unit: '' })
  const [qrPayload, setQrPayload] = useState(null)
  const [barcodePayload, setBarcodePayload] = useState(null)
  const [scanResult, setScanResult] = useState(null)
  const [scanAccepted, setScanAccepted] = useState(false) // 코드 인식 시 즉시 카메라 종료용
  const [scanNotFound, setScanNotFound] = useState(false) // 조회 결과 없음
  const [message, setMessage] = useState(null)
  const [loadingImport, setLoadingImport] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [modalForm, setModalForm] = useState(false)
  const [modalQR, setModalQR] = useState(false)
  const [locationModalOpen, setLocationModalOpen] = useState(false)
  const [locationDrawing, setLocationDrawing] = useState(null)
  const [locationPoints, setLocationPoints] = useState([])
  const [locationActivePoint, setLocationActivePoint] = useState(null)
  const [locationPendingPcsNo, setLocationPendingPcsNo] = useState('')
  const [locationRecord, setLocationRecord] = useState(null)
  const lastLocationQueryRef = useRef({ key: '', at: 0 })

  const [record, setRecord] = useState({ ...INIT_RECORD })
  const [checkedIds, setCheckedIds] = useState(new Set())
  const [loadingDelete, setLoadingDelete] = useState(false)
  const [listSearch, setListSearch] = useState('') // 자재 목록 전체 필드 검색 (단일 인풋)
  const [sortKey, setSortKey] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  const [activeTab, setActiveTab] = useState('list') // 'list' | 'installation' | 'pdf'
  const fileInputRef = useRef(null)
  const pdfFileInputRef = useRef(null)
  const eventSourceRef = useRef(null)
  const qrSvgRef = useRef(null)
  const barcodeContainerRef = useRef(null)
  const lastQueryRef = useRef({ pcs_no: '', at: 0 })
  const [detailDrawing, setDetailDrawing] = useState(null) // 선택 레코드에 연동된 도면 + 포인트
  const [loadingDetailDrawing, setLoadingDetailDrawing] = useState(false)

  // 자재 상세(자재관리)에서 레코드별 도면 업로드
  const [recordDrawingUploadOpen, setRecordDrawingUploadOpen] = useState(false)
  const [recordDrawingUploadDwgNo, setRecordDrawingUploadDwgNo] = useState('')
  const [recordDrawingUploadFiles, setRecordDrawingUploadFiles] = useState([])
  const [recordDrawingUploading, setRecordDrawingUploading] = useState(false)
  const [recordDrawingUploadProgress, setRecordDrawingUploadProgress] = useState({ done: 0, total: 0 })
  const [recordDrawingUploadError, setRecordDrawingUploadError] = useState(null)
  const recordDrawingUploadQueueRef = useRef(null)

  const [pdfStage, setPdfStage] = useState('upload') // upload | review
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState(null)
  const [pdfReview, setPdfReview] = useState(null)
  const [pdfPendingName, setPdfPendingName] = useState('')
  const [pdfPageFilter, setPdfPageFilter] = useState('all') // all | design | installation
  const [pdfZoomPage, setPdfZoomPage] = useState(null)
  const [pdfSelectedPageNum, setPdfSelectedPageNum] = useState(null)

  const filteredPdfPages = useMemo(() => {
    if (!pdfReview?.pages?.length) return []
    return pdfReview.pages.filter(
      (p) => pdfPageFilter === 'all' || (p.classification || '') === pdfPageFilter
    )
  }, [pdfReview, pdfPageFilter])

  useEffect(() => {
    if (pdfStage !== 'review' || !pdfReview) {
      setPdfSelectedPageNum(null)
      return
    }
    if (filteredPdfPages.length === 0) {
      setPdfSelectedPageNum(null)
      return
    }
    setPdfSelectedPageNum((prev) => {
      if (prev != null && filteredPdfPages.some((p) => p.page_number === prev)) return prev
      return filteredPdfPages[0].page_number
    })
  }, [pdfStage, pdfReview, pdfPageFilter, filteredPdfPages])

  const pdfSelectedPage = useMemo(() => {
    if (pdfSelectedPageNum == null || !pdfReview?.pages) return null
    return pdfReview.pages.find((p) => p.page_number === pdfSelectedPageNum) || null
  }, [pdfReview, pdfSelectedPageNum])

  useEffect(() => {
    if (!pdfLoading) setPdfPendingName('')
  }, [pdfLoading])

  const setMessageSuccess = (text) => setMessage({ text, type: 'success' })
  const setMessageError = (text) => setMessage({ text, type: 'error' })

  const subscribeTypes = events?.subscribe || []
  useEffect(() => {
    const loadInitial = async () => {
      try {
        const res = await fetch('/api/traceability/records')
        if (res.ok) {
          const records = await res.json()
          if (Array.isArray(records)) {
            setListRecords(records)
            setLoadingList(false)
            return
          }
        }
      } catch (_) {}
      if (onAction && events?.onListRecords) handleList()
    }
    setLoadingList(true)
    loadInitial()
  }, [])

  useEffect(() => {
    if (!Array.isArray(subscribeTypes) || subscribeTypes.length === 0) return
    const es = new EventSource('/api/events/stream')
    eventSourceRef.current = es
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        if (!ev.type || !subscribeTypes.includes(ev.type)) return
        const payload = ev.payload || {}
        if (ev.type === 'TRACEABILITY_RECORD_SAVED') {
          setMessageSuccess('저장되었습니다.')
          setModalForm(false)
          setRecord({ ...INIT_RECORD })
          handleList()
        }
        if (ev.type === 'TRACEABILITY_RECORD_RESULT') {
          const rec = payload.record || null
              // (1) 현장 위치 QR(T2) 스캔 모드: selectedRecord 모달을 건드리지 않고 locationRecord만 갱신
              if (locationModalOpen && locationPendingPcsNo) {
                const recPcs = (rec && (rec.pcs_no || '').trim()) || ''
                if (rec && recPcs === locationPendingPcsNo) {
                  setLocationRecord(rec)
                  setLocationPendingPcsNo('')
                }
                return
              }

              // (2) 기존 PCS QR/BARCODE 조회 모드
              setScanResult(rec)
              if (rec) {
                setSelectedRecord(rec)
                setListRecords((prev) => {
                  const exists = prev.some((r) => (r.pcs_no || r.id) === (rec.pcs_no || rec.id))
                  if (exists) return prev
                  return [rec, ...prev]
                })
                setModalQR(false) // 모달 닫고 자재 화면 표시
              } else {
                setScanNotFound(true) // 조회 결과 없음
              }
        }
        if (ev.type === 'TRACEABILITY_RECORD_LIST_RESULT') {
          setListRecords(payload.records || [])
          setLoadingList(false)
        }
        if (ev.type === 'QR_CODE_PAYLOAD_READY') {
          setQrPayload({ qr_string: payload.qr_string, qr_json: payload.qr_json })
        }
        if (ev.type === 'TRACEABILITY_IMPORT_DONE') {
          setLoadingImport(false)
          if (payload.success) {
            setMessageSuccess(`기초데이터 불러오기 완료: ${payload.imported}건 반영`)
            handleList()
          } else {
            setMessageError(payload.error || '알 수 없음')
          }
        }
            if (ev.type === 'TRACEABILITY_PDF_INGESTED') {
              if (!payload.success) {
                setPdfLoading(false)
                setPdfError(payload.error || 'PDF 저장 실패')
              }
            }
            if (ev.type === 'TRACEABILITY_PDF_REVIEW_READY') {
              setPdfLoading(false)
              if (payload.success) {
                console.log('TRACEABILITY_PDF_REVIEW_READY', payload)
                // setPdfReview(payload)
                
                setPdfStage('review')
              } else {
                setPdfError(payload.error || 'PDF 분석 실패')
              }
            }
            if (ev.type === 'TRACEABILITY_PDF_COMMIT_DONE') {
              setPdfLoading(false)
              if (payload.success) {
                setMessageSuccess(`PDF 반영 완료 (레코드: ${payload.inserted_records || 0}건 삽입 / 설치 포인트: ${payload.installation_points_committed || 0}개)`)
                setActiveTab('list')
                setPdfStage('upload')
                setPdfReview(null)
                handleList()
              } else {
                setMessageError(payload.error || '커밋 실패')
              }
            }
        if (ev.type === 'TRACEABILITY_PDF_VISION_READY') {
          setPdfLoading(false)
          if (payload.success) {
            console.log('TRACEABILITY_PDF_VISION_READY', payload)
            setPdfReview(payload)
            setPdfStage('review')
          } else {
            setPdfError(payload.error || 'PDF 비전 분석 실패')
          }
        }
        if (ev.type === 'TRACEABILITY_PDF_VISION_FAILED') {
          setPdfLoading(false)
          setPdfError(payload.error || 'PDF 비전 분석 실패')
        }

        if (ev.type === 'INSTALLATION_DRAWING_UPLOADED') {
          const q = recordDrawingUploadQueueRef.current
          if (!q?.active) return

          if (!payload.success) {
            q.active = false
            setRecordDrawingUploading(false)
            setRecordDrawingUploadError(payload.error || '도면 업로드 실패')
            setMessageError(payload.error || '도면 업로드 실패')
            return
          }

          const drawing = payload.drawing || null
          if (drawing?.id) {
            q.uploaded.push(drawing)
            q.lastDrawingId = drawing.id
          }
          q.index += 1
          setRecordDrawingUploadProgress({ done: q.uploaded.length, total: q.files.length })

          if (q.index < q.files.length) {
            dispatchRecordDrawingUploadAt(q, q.index).catch((e) => {
              q.active = false
              setRecordDrawingUploading(false)
              setRecordDrawingUploadError(e?.message || '도면 업로드 실패')
              setMessageError(e?.message || '도면 업로드 실패')
            })
            return
          }

          // 완료: 레코드에 DWG No / 마지막 도면 ID 반영
          q.active = false
          setRecordDrawingUploading(false)
          setRecordDrawingUploadOpen(false)
          setRecordDrawingUploadFiles([])
          setRecordDrawingUploadError(null)
          setMessageSuccess('도면이 업로드되었습니다.')

          const updated = {
            ...(q.recordSnapshot || {}),
            dwg_no: q.dwg_no || (q.recordSnapshot?.dwg_no || ''),
            installation_location: q.lastDrawingId ? `도면 ID: ${q.lastDrawingId}` : (q.recordSnapshot?.installation_location || ''),
          }

          if (updated?.id) {
            setSelectedRecord(updated)
            onAction?.('onSaveRecord', updated)
            handleList()
          }
        }
        if (ev.type === 'TRACEABILITY_RECORD_DELETED') {
          setLoadingDelete(false)
          setCheckedIds(new Set())
          if (payload.success) {
            setMessageSuccess(`${payload.deleted}건 삭제되었습니다.`)
            handleList()
            if (selectedRecord && payload.ids?.includes(selectedRecord.id)) setSelectedRecord(null)
          } else {
            setMessageError(payload.error || '삭제 실패')
          }
        }
      } catch (_) {}
    }
    es.onerror = () => es.close()
    return () => { es.close(); eventSourceRef.current = null }
  }, [subscribeTypes.join(',')])

  const handleList = () => {
    if (!onAction || !events?.onListRecords) return
    setLoadingList(true)
    setListRecords([])
    onAction('onListRecords', {
      ship_no: listFilters.ship_no || undefined,
      block: listFilters.block || undefined,
      unit: listFilters.unit || undefined,
      limit: 500,
    })
  }

  useEffect(() => {
    if (!selectedRecord) {
      setQrPayload(null)
      setBarcodePayload(null)
      setDetailDrawing(null)
      return
    }
    if (onAction && events?.onGenerateQR) {
      setQrPayload(null)
      onAction('onGenerateQR', { record: selectedRecord })
    }
    const pcs = selectedRecord.pcs_no || ''
    if (pcs) setBarcodePayload(pcs)
    else setBarcodePayload(null)

    // 해당 자재에 연동된 도면·설치 위치 조회
    const dwg = (selectedRecord.dwg_no || '').trim()
    const instLoc = (selectedRecord.installation_location || '').trim()
    if (!dwg && !instLoc) {
      setDetailDrawing(null)
      return
    }
    setLoadingDetailDrawing(true)
    setDetailDrawing(null)
    const run = async () => {
      try {
        const res = await fetch('/api/installation/drawings')
        if (!res.ok) return
        const drawings = await res.json()
        if (!Array.isArray(drawings)) return
        let drawing = null
        const recordId = selectedRecord.id || ''
        const pcsNo = (selectedRecord.pcs_no || '').trim()
        if (instLoc && instLoc.startsWith('도면 ID:')) {
          const idPart = instLoc.replace(/도면\s*ID\s*:\s*/i, '').trim()
          drawing = drawings.find((d) => d.id === idPart)
        }
        if (!drawing && dwg) {
          drawing = drawings.find((d) => (d.dwg_no || '').trim() === dwg)
        }
        if (!drawing) return
        const detailRes = await fetch(`/api/installation/drawings/${drawing.id}`)
        if (!detailRes.ok) return
        const { drawing: d, points } = await detailRes.json()
        const myPoints = (points || []).filter(
          (p) => (p.record_id && p.record_id === recordId) || (pcsNo && (p.pcs_no || '').trim() === pcsNo)
        )
        setDetailDrawing({ drawing: d, points: myPoints.length ? myPoints : points })
      } catch (_) {}
      setLoadingDetailDrawing(false)
    }
    run()
  }, [selectedRecord])

  const doImportExcel = (file) => {
    if (!onAction || !events?.onImportExcel) return
    setLoadingImport(true)
    setMessage(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const buf = reader.result
        let base64
        if (typeof buf === 'string') base64 = buf.replace(/^data:.*;base64,/, '')
        else {
          const bytes = new Uint8Array(buf)
          let binary = ''
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
          base64 = btoa(binary)
        }
        onAction('onImportExcel', { excel_base64: base64, filename: file.name })
      } catch (e) {
        setLoadingImport(false)
        setMessageError('파일 읽기 실패: ' + (e.message || '알 수 없음'))
      }
    }
    reader.onerror = () => { setLoadingImport(false); setMessageError('파일 읽기 오류') }
    reader.readAsArrayBuffer(file)
  }

  const doUploadPdf = (file) => {
    if (!onAction || !events?.onUploadPdf) return
    setPdfLoading(true)
    setPdfError(null)
    setPdfStage('upload')
    setPdfReview(null)

    const job_id = (crypto?.randomUUID?.() || String(Date.now()))
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const buf = reader.result
        let base64
        if (typeof buf === 'string') base64 = buf.replace(/^data:.*;base64,/, '')
        else {
          const bytes = new Uint8Array(buf)
          let binary = ''
          for (let i = 0; i < bytes.length; i += 8192) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
          }
          base64 = btoa(binary)
        }
        onAction('onUploadPdf', { file_base64: base64, filename: file.name, job_id })
      } catch (e) {
        setPdfLoading(false)
        setPdfError('파일 읽기 실패: ' + (e.message || '알 수 없음'))
      }
    }
    reader.onerror = () => {
      setPdfLoading(false)
      setPdfError('파일 읽기 오류')
    }
    reader.readAsArrayBuffer(file)
  }

  const handlePdfFileSelected = (e) => {
    const input = e.target
    const file = input.files?.[0]
    if (input) input.value = ''
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) {
      setMessageError('PDF 파일(.pdf)만 선택할 수 있습니다.')
      return
    }
    if (!onAction || !events?.onUploadPdf) {
      setMessageError('PDF 업로드 기능을 사용할 수 없습니다.')
      return
    }
    if (pdfLoading) return
    setPdfPendingName(file.name)
    doUploadPdf(file)
  }

  const readFileAsBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          let base64 = reader.result
          if (typeof base64 === 'string') {
            base64 = base64.replace(/^data:[^;]+;base64,/, '')
          } else {
            const bytes = new Uint8Array(base64)
            let binary = ''
            for (let i = 0; i < bytes.length; i += 8192) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
            }
            base64 = btoa(binary)
          }
          resolve(base64)
        } catch (e) {
          reject(e)
        }
      }
      reader.onerror = () => reject(new Error('파일을 읽는 중 오류가 발생했습니다.'))
      reader.readAsDataURL(file)
    })
  }

  const dispatchRecordDrawingUploadAt = async (queue, index) => {
    if (!queue?.active) return
    const file = queue.files?.[index]
    if (!file) return
    const base64 = await readFileAsBase64(file)
    onAction?.('onUploadDrawing', {
      dwg_no: queue.dwg_no,
      filename: file.name,
      file_base64: base64,
    })
  }

  const startRecordDrawingUpload = async (files) => {
    if (!selectedRecord || !onAction || !events?.onUploadDrawing) return
    if (!Array.isArray(files) || files.length === 0) return
    if (recordDrawingUploading) return

    const invalid = files.filter((f) => {
      const ext = '.' + (f?.name || '').split('.').pop()?.toLowerCase()
      return !DRAWING_ALLOWED_EXT.includes(ext)
    })
    if (invalid.length > 0) {
      setRecordDrawingUploadError('허용 형식: ' + DRAWING_ALLOWED_EXT.join(', '))
      return
    }

    const first = files[0]
    const inferredDwgNo = (recordDrawingUploadDwgNo || selectedRecord.dwg_no || first?.name || '').trim()
    if (!inferredDwgNo) {
      setRecordDrawingUploadError('DWG No를 지정할 수 없습니다.')
      return
    }

    const recordSnapshot = selectedRecord
    const queue = {
      active: true,
      recordSnapshot,
      dwg_no: inferredDwgNo,
      files,
      index: 0,
      uploaded: [],
      lastDrawingId: null,
    }
    recordDrawingUploadQueueRef.current = queue

    setRecordDrawingUploadError(null)
    setRecordDrawingUploading(true)
    setRecordDrawingUploadProgress({ done: 0, total: files.length })

    try {
      await dispatchRecordDrawingUploadAt(queue, 0)
    } catch (e) {
      queue.active = false
      setRecordDrawingUploading(false)
      setRecordDrawingUploadError(e?.message || '도면 업로드 시작 실패')
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!/\.xlsx?$/i.test(file.name)) {
        setMessageError('엑셀 파일(.xlsx)만 선택 가능합니다.')
      } else {
        doImportExcel(file)
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleScanSuccess = (decodedText) => {
    const parsed = parseQrTokens(decodedText)
    if (parsed && parsed.version === 'T2') {
      const drawingId = parsed.parts[1] || ''
      const pointId = parsed.parts[2] || ''
      const pcsNoFromPayload = parsed.parts[3] || ''
      if (!drawingId || !pointId) return
      const key = `${drawingId}:${pointId}`
      const now = Date.now()
      const { key: lastKey, at } = lastLocationQueryRef.current
      if (lastKey === key && now - at < 2000) return
      lastLocationQueryRef.current = { key, at: now }

      const run = async () => {
        try {
          setLocationRecord(null)
          setLocationPendingPcsNo('')
          setLocationPoints([])
          setLocationDrawing(null)
          setLocationActivePoint(null)
          setLocationModalOpen(true)
          setScanAccepted(true)
          setScanNotFound(false)
          setModalQR(false)

          const res = await fetch(`/api/installation/drawings/${drawingId}`)
          if (!res.ok) throw new Error('설치 도면을 불러올 수 없습니다.')
          const data = await res.json()
          const drawing = data?.drawing || null
          const points = Array.isArray(data?.points) ? data.points : []
          setLocationDrawing(drawing)
          setLocationPoints(points)
          const pt = points.find((p) => p.id === pointId) || null
          setLocationActivePoint(pt)

          const pcs = _clean(pcsNoFromPayload) || _clean(pt?.pcs_no || '')
          if (pcs) {
            setLocationPendingPcsNo(pcs)
            onAction('onQueryRecord', { pcs_no: pcs })
          }
        } catch (e) {
          setMessageError(e?.message || '현장 위치 조회 실패')
          setLocationModalOpen(false)
        }
      }

      run()
      return
    }

    const pcsNo = extractPcsNo(decodedText)
    if (!pcsNo) return
    const now = Date.now()
    const { pcs_no: last, at } = lastQueryRef.current
    if (last === pcsNo && now - at < 2000) return
    lastQueryRef.current = { pcs_no: pcsNo, at: now }
    setScanResult(null)
    onAction('onQueryRecord', { pcs_no: pcsNo })
  }

  const _clean = (v) => (v == null ? '' : String(v).trim())

  const handleSave = () => {
    if (!onAction || !events?.onSaveRecord) return
    onAction('onSaveRecord', record)
  }

  const handleFieldChange = (key, value) => setRecord((prev) => ({ ...prev, [key]: value }))

  const handleToggleCheck = (id, e) => {
    e?.stopPropagation?.()
    if (!id) return
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleToggleAll = (e) => {
    e?.stopPropagation?.()
    const ids = filteredAndSortedRecords.map((r) => r.id).filter(Boolean)
    if (ids.length === 0) return
    const allSelected = ids.every((id) => checkedIds.has(id))
    if (allSelected) {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setCheckedIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.add(id))
        return next
      })
    }
  }

  const filteredAndSortedRecords = useMemo(() => {
    let result = [...listRecords]
    const q = (listSearch || '').trim().toLowerCase()
    if (q) {
      const keys = Object.keys(FIELD_LABELS)
      result = result.filter((r) =>
        keys.some((key) => {
          const v = r[key]
          if (v == null) return false
          return String(v).toLowerCase().includes(q)
        })
      )
    }
    if (sortKey) {
      result.sort((a, b) => {
        const va = a[sortKey]
        const vb = b[sortKey]
        const aNum = Number(va)
        const bNum = Number(vb)
        const useNum = !Number.isNaN(aNum) && !Number.isNaN(bNum)
        let cmp = 0
        if (useNum) cmp = aNum - bNum
        else cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'ko')
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [listRecords, listSearch, sortKey, sortDir])

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const handleDelete = () => {
    const ids = Array.from(checkedIds).filter(Boolean)
    if (ids.length === 0) {
      setMessageError('삭제할 항목을 선택하세요.')
      return
    }
    if (!onAction || !events?.onDeleteRecords) return
    setLoadingDelete(true)
    setMessage(null)
    onAction('onDeleteRecords', { ids })
  }

  const getBarcodeSvgHtml = () => {
    const svg = barcodeContainerRef.current?.querySelector('svg')
    return svg ? svg.outerHTML : ''
  }

  const printFull = async () => {
    if (!selectedRecord) return
    const win = window.open('', '_blank')
    if (!win) {
      setMessage({ text: '인쇄 창이 차단되었습니다. 팝업 허용 후 다시 시도하세요.', type: 'error' })
      return
    }
    const rows = Object.entries(FIELD_LABELS).map(([k, l]) => `<tr><th>${l}</th><td>${selectedRecord[k] ?? '-'}</td></tr>`).join('')
    let qrDataUrl = ''
    if (qrPayload) {
      try {
        const mod = await import('qrcode')
        const QRCode = mod.default ?? mod
        qrDataUrl = await (QRCode.toDataURL || (mod.toDataURL)).call(QRCode, qrPayload.qr_string, { width: 180, margin: 1 })
      } catch (_) {}
    }
    const barcodeSvgHtml = barcodePayload ? getBarcodeSvgHtml() : ''
    const barcodeBlock = barcodePayload
      ? `<div class="print-barcode">${barcodeSvgHtml || `<svg id="bc"></svg>`}<div>바코드</div></div>`
      : ''
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>자재 상세</title>
<style>body{font-family:'Noto Sans KR',sans-serif;padding:24px;max-width:520px;margin:0 auto;font-size:14px}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th,td{padding:10px 12px;border:1px solid #ddd;text-align:left}
th{background:#f5f5f5;width:140px}
.print-qr,.print-barcode{text-align:center;padding:20px;margin:16px 0;border:1px solid #eee;border-radius:8px}
.print-qr img{display:block;margin:0 auto 8px}
.print-barcode svg{max-width:100%;height:auto}
@media print{body{padding:0}}</style></head><body>
<h2 style="margin:0 0 16px 0;font-size:1.1rem">자재 상세</h2>
<table>${rows}</table>
${qrDataUrl ? `<div class="print-qr"><img src="${qrDataUrl}" alt="QR" width="160" height="160"/><div>QR 코드</div></div>` : ''}
${barcodeBlock}
</body></html>`
    win.document.write(html)
    win.document.close()
    if (barcodePayload && !getBarcodeSvgHtml()) {
      try {
        const mod = await import('jsbarcode')
        const JsBarcode = mod.default ?? mod
        const el = win.document.getElementById('bc')
        if (typeof JsBarcode === 'function' && el) {
          JsBarcode(el, barcodePayload, { format: 'CODE128', width: 2, height: 80, displayValue: true })
        }
      } catch (_) {}
    }
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 500)
  }

  const printQR = async () => {
    if (!qrPayload) return
    const win = window.open('', '_blank')
    if (!win) {
      setMessage({ text: '인쇄 창이 차단되었습니다. 팝업 허용 후 다시 시도하세요.', type: 'error' })
      return
    }
    try {
      const mod = await import('qrcode')
      const QRCode = mod.default ?? mod
      const toDataURL = QRCode.toDataURL || mod.toDataURL
      const dataUrl = await toDataURL(qrPayload.qr_string, { width: 256, margin: 2 })
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR 코드</title>
<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:sans-serif}
img{margin:16px 0}p{font-size:14px;color:#666}</style></head><body>
<img src="${dataUrl}" alt="QR" width="200" height="200"/>
<p>${selectedRecord?.pcs_no || ''}</p></body></html>`
      win.document.write(html)
      win.document.close()
      win.focus()
      setTimeout(() => { win.print(); win.close() }, 500)
    } catch (e) {
      win.close()
      setMessage({ text: 'QR 코드 생성 실패: ' + (e.message || '알 수 없음'), type: 'error' })
    }
  }

  const printBarcode = async () => {
    if (!barcodePayload) return
    const win = window.open('', '_blank')
    if (!win) {
      setMessage({ text: '인쇄 창이 차단되었습니다. 팝업 허용 후 다시 시도하세요.', type: 'error' })
      return
    }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>바코드</title>
<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:sans-serif}
#bc{margin:16px 0}p{font-size:14px;color:#666}</style></head><body>
<svg id="bc"></svg><p>${selectedRecord?.pcs_no || ''}</p></body></html>`
    win.document.write(html)
    win.document.close()
    try {
      const mod = await import('jsbarcode')
      const JsBarcode = mod.default ?? mod
      if (typeof JsBarcode === 'function') {
        JsBarcode(win.document.getElementById('bc'), barcodePayload, { format: 'CODE128', width: 2, height: 80, displayValue: true })
      }
    } catch (_) {}
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 400)
  }

  return (
    <div className="et">
      <div className="et-tabs">
        <button type="button" className={`et-tab ${activeTab === 'list' ? 'et-tab--active' : ''}`} onClick={() => setActiveTab('list')}>자재 관리</button>
        <button type="button" className={`et-tab ${activeTab === 'installation' ? 'et-tab--active' : ''}`} onClick={() => setActiveTab('installation')}>도면 관리</button>
        <button type="button" className={`et-tab ${activeTab === 'pdf' ? 'et-tab--active' : ''}`} onClick={() => setActiveTab('pdf')}>PDF 분석</button>
      </div>

      {message && (
        <div className={`et-alert et-alert--${message.type} et-message-banner`} role="alert">
          <span>{message.text}</span>
          <button type="button" className="et-alert-dismiss" onClick={() => setMessage(null)} aria-label="닫기">×</button>
        </div>
      )}

      {activeTab === 'installation' && (
        <InstallationLocationView onAction={onAction} events={events} />
      )}
      {activeTab === 'list' && (
      <section className="et-panel et-panel--list">
        <div className="et-toolbar">
          <div className="et-toolbar-group">
            <button type="button" className="et-btn et-btn--primary" onClick={() => { setRecord({ ...INIT_RECORD }); setModalForm(true) }}>
              자재등록
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="et-file-input" onChange={handleFileChange} />
            <button type="button" className="et-btn et-btn--secondary" onClick={() => fileInputRef.current?.click()} disabled={loadingImport}>
              {loadingImport ? '불러오는 중…' : '엑셀 업로드'}
            </button>
            <button type="button" className="et-btn et-btn--secondary" onClick={() => { setScanResult(null); setScanAccepted(false); lastQueryRef.current = { pcs_no: '', at: 0 }; setModalQR(true) }}>
              QR/BARCODE
            </button>
            <button type="button" className="et-btn et-btn--danger" onClick={handleDelete} disabled={loadingDelete || checkedIds.size === 0}>
              {loadingDelete ? '삭제 중…' : `선택 삭제 (${checkedIds.size})`}
            </button>
          </div>
          <div className="et-toolbar-group et-toolbar-filters">
            <input
              type="text"
              className="et-input et-input--search"
              placeholder="검색"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              aria-label="자재 목록 검색"
            />
            <button type="button" className="et-btn et-btn--primary" onClick={handleList} disabled={loadingList}>
              {loadingList ? '불러오는 중…' : '새로고침'}
            </button>
          </div>
        </div>

        <div className="et-list-layout">
          <div className="et-table-card et-table-card--full">
            <div className="et-table-wrap">
              <table className="et-table">
                <thead>
                  <tr>
                    <th className="et-table-th-check">
                      <input type="checkbox" checked={filteredAndSortedRecords.length > 0 && filteredAndSortedRecords.filter((r) => r.id).every((r) => checkedIds.has(r.id))} onChange={handleToggleAll} onClick={(e) => e.stopPropagation()} aria-label="전체 선택" />
                    </th>
                    {TABLE_COLUMNS.map(({ key, label }) => (
                      <th key={key} className="et-table-th-sort" onClick={() => handleSort(key)}>
                        <span className="et-table-th-label">{label}</span>
                        {sortKey === key && <span className="et-table-sort-icon" aria-hidden>{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedRecords.length === 0 && !loadingList && (
                    <tr className="et-table-empty"><td colSpan={8}>데이터가 없습니다. 자재를 입력하거나 엑셀파일을 업로드 하세요.</td></tr>
                  )}
                  {filteredAndSortedRecords.map((r, i) => (
                    <tr key={r.id || i} className={`et-table-row ${selectedRecord?.pcs_no === r.pcs_no ? 'et-table-row--selected' : ''}`} onClick={() => setSelectedRecord(r)}>
                      <td className="et-table-td-check" onClick={(e) => e.stopPropagation()}>
                        {r.id ? (
                          <input type="checkbox" checked={checkedIds.has(r.id)} onChange={(e) => handleToggleCheck(r.id, e)} aria-label={`${r.pcs_no || ''} 선택`} />
                        ) : (
                          <span className="et-table-check-placeholder">—</span>
                        )}
                      </td>
                      {TABLE_COLUMNS.map(({ key }) => (
                        <td key={key}>{r[key] ?? '-'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {listRecords.length > 0 && (
              <div className="et-table-footer">
                총 <strong>{listRecords.length}</strong>건
                {listSearch.trim() && (
                  <span className="et-table-footer-filtered"> (검색: <strong>{filteredAndSortedRecords.length}</strong>건)</span>
                )}
              </div>
            )}
          </div>

          {selectedRecord && (
            <div className="et-modal-overlay" onClick={() => setSelectedRecord(null)}>
              <div className="et-modal et-detail-modal" onClick={(e) => e.stopPropagation()}>
                <div className="et-detail-head">
                  <h3 className="et-detail-title">상세 조회</h3>
                  <button type="button" className="et-modal-close" onClick={() => setSelectedRecord(null)} aria-label="닫기">×</button>
                </div>
                <div className="et-detail-body">
                <div className="et-detail-section">
                  <h4 className="et-detail-section-title">장비 정보</h4>
                  <dl className="et-detail-dl">
                    {Object.entries(FIELD_LABELS).map(([key, label]) => (
                      <div key={key} className="et-detail-row">
                        <dt>{label}</dt>
                        <dd>{selectedRecord[key] ?? '-'}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                  <div className="et-detail-section et-detail-section--drawing">
                    <h4 className="et-detail-section-title">도면 / 설치 위치</h4>
                    {loadingDetailDrawing ? (
                      <p className="et-detail-drawing-loading">도면 정보를 불러오는 중…</p>
                    ) : detailDrawing ? (
                      <div className="et-detail-drawing-wrap">
                        <div className="et-detail-drawing-meta">
                          <span className="et-detail-drawing-dwg">DWG No: {detailDrawing.drawing.dwg_no || '-'}</span>
                        </div>
                        <div className="et-detail-drawing-preview">
                          {detailDrawing.drawing.file_type === 'pdf' ? (
                            <div className="et-detail-drawing-pdf-placeholder">
                              <span>PDF 도면</span>
                              <a
                                href={`/api/installation/drawings/${detailDrawing.drawing.id}/file`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="et-btn et-btn--secondary et-btn--sm"
                              >
                                도면 보기
                              </a>
                            </div>
                          ) : (
                            <img
                              src={`/api/installation/drawings/${detailDrawing.drawing.id}/file?t=preview`}
                              alt="도면"
                              className="et-detail-drawing-img"
                            />
                          )}
                          <div className="et-detail-drawing-points-overlay">
                            {(detailDrawing.points || []).map((p) => (
                              <div
                                key={p.id}
                                className="et-detail-drawing-point"
                                style={{
                                  left: `${p.x * 100}%`,
                                  top: `${p.y * 100}%`,
                                  transform: 'translate(-50%, -50%)',
                                }}
                                title={p.pcs_no || ''}
                              >
                                <span className="et-detail-drawing-point-dot" />
                              </div>
                            ))}
                          </div>
                        </div>
                        {(detailDrawing.points || []).length > 0 && (
                          <ul className="et-detail-drawing-point-list">
                            {detailDrawing.points.map((p) => (
                              <li key={p.id} className="et-detail-drawing-point-item">
                                <span className="et-detail-drawing-point-coord">({(p.x * 100).toFixed(0)}%, {(p.y * 100).toFixed(0)}%)</span>
                                {p.pcs_no && <span className="et-detail-drawing-point-pcs">{p.pcs_no}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <p className="et-detail-drawing-empty">연동된 도면이 없습니다. 아래에서 설치도면/이미지를 업로드하세요.</p>
                    )}

                    <div className="et-record-drawing-upload">
                      <div className="et-record-drawing-upload-row">
                        <button
                          type="button"
                          className="et-btn et-btn--secondary"
                          disabled={recordDrawingUploading}
                          onClick={() => {
                            setRecordDrawingUploadOpen((v) => {
                              const next = !v
                              if (next) {
                                setRecordDrawingUploadDwgNo((selectedRecord.dwg_no || '').trim())
                                setRecordDrawingUploadFiles([])
                                setRecordDrawingUploadError(null)
                              }
                              return next
                            })
                          }}
                        >
                          {recordDrawingUploadOpen ? '업로드 접기' : '설치도면/이미지 업로드'}
                        </button>
                        {recordDrawingUploading && (
                          <span className="et-record-drawing-upload-progress" aria-live="polite">
                            업로드 중… ({recordDrawingUploadProgress.done}/{recordDrawingUploadProgress.total})
                          </span>
                        )}
                      </div>

                      {recordDrawingUploadOpen && (
                        <div className="et-record-drawing-upload-panel">
                          <div className="et-form-field">
                            <label className="et-label">DWG No</label>
                            <input
                              type="text"
                              className="et-input"
                              value={recordDrawingUploadDwgNo}
                              onChange={(e) => setRecordDrawingUploadDwgNo(e.target.value)}
                              placeholder="미지정 시 파일명 사용"
                              disabled={recordDrawingUploading}
                            />
                          </div>

                          <input
                            type="file"
                            multiple
                            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"
                            className="et-record-drawing-file-input"
                            disabled={recordDrawingUploading}
                            onChange={(e) => {
                              setRecordDrawingUploadError(null)
                              setRecordDrawingUploadFiles(Array.from(e.target.files || []))
                            }}
                          />

                          {recordDrawingUploadFiles?.length > 0 && (
                            <p className="et-file-name" style={{ marginTop: '0.5rem' }} title={recordDrawingUploadFiles.map((f) => f.name).join(', ')}>
                              선택: {recordDrawingUploadFiles.length}장
                            </p>
                          )}

                          {recordDrawingUploadError && (
                            <div className="et-alert et-alert--error" role="alert">
                              <span>{recordDrawingUploadError}</span>
                            </div>
                          )}

                          <div className="et-record-drawing-upload-actions">
                            <button
                              type="button"
                              className="et-btn et-btn--primary"
                              disabled={recordDrawingUploading || recordDrawingUploadFiles.length === 0}
                              onClick={() => startRecordDrawingUpload(recordDrawingUploadFiles)}
                            >
                              {recordDrawingUploading ? '업로드 중…' : '업로드 시작'}
                            </button>
                            <button
                              type="button"
                              className="et-btn et-btn--secondary"
                              disabled={recordDrawingUploading}
                              onClick={() => {
                                setRecordDrawingUploadOpen(false)
                                setRecordDrawingUploadFiles([])
                                setRecordDrawingUploadError(null)
                              }}
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                <div className="et-detail-section et-detail-section--codes">
                  <h4 className="et-detail-section-title">QR / 바코드</h4>
                  <div className="et-codes-grid">
                    {qrPayload && (
                      <div className="et-code-card">
                        <div className="et-code-card-label">QR 코드</div>
                        <div className="et-code-card-content" ref={qrSvgRef}>
                          {QRCodeComponent && <QRCodeComponent value={qrPayload.qr_string} size={140} level="M" className="et-qr-canvas" />}
                        </div>
                      </div>
                    )}
                    {barcodePayload && (
                      <div className="et-code-card">
                        <div className="et-code-card-label">바코드</div>
                        <div className="et-code-card-content" ref={barcodeContainerRef}>
                          <ReactBarcode value={barcodePayload} options={BARCODE_OPTIONS} renderer="svg" className="et-barcode-svg" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="et-detail-actions">
                    <button type="button" className="et-btn et-btn--primary" onClick={printFull}>전체 인쇄</button>
                    <button type="button" className="et-btn et-btn--secondary" onClick={printQR} disabled={!qrPayload}>QR코드 인쇄</button>
                    <button type="button" className="et-btn et-btn--secondary" onClick={printBarcode} disabled={!barcodePayload}>바코드 인쇄</button>
                  </div>
                </div>
              </div>
            </div>
            </div>
          )}
        </div>
      </section>
      )}
      {activeTab === 'pdf' && (
        <section className="et-panel et-panel--pdf" aria-labelledby="et-pdf-panel-title">
          <div className="et-panel-head et-panel-head--pdf">
            <h2 id="et-pdf-panel-title" className="et-panel-title">PDF 도면 분석</h2>
            <p className="et-panel-desc">
              PDF를 업로드하면 전체 페이지를 이미지로 변환하고, 페이지별로 설치도면/설계도면을 자동 분류한 뒤 텍스트 인식 결과를 함께 보여줍니다.
            </p>
          </div>
          <div className="et-panel-body et-panel-body--pdf">
            <input
              ref={pdfFileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="et-file-input"
              onChange={handlePdfFileSelected}
              aria-hidden
              tabIndex={-1}
            />

            {pdfError && (
              <div className="et-alert et-alert--error et-pdf-upload-alert" role="alert">
                <span>{pdfError}</span>
              </div>
            )}

            {pdfStage === 'upload' && (
              <div className="et-pdf-upload-block">
                <div className="et-toolbar-group et-pdf-upload-actions">
                  <button
                    type="button"
                    className="et-btn et-btn--primary"
                    disabled={pdfLoading}
                    onClick={() => pdfFileInputRef.current?.click()}
                  >
                    {pdfLoading ? '분석 중…' : 'PDF 업로드'}
                  </button>
                  {pdfLoading && pdfPendingName && (
                    <span className="et-file-name" title={pdfPendingName}>
                      파일: {pdfPendingName}
                    </span>
                  )}
                </div>
                {!pdfLoading && (
                  <p className="et-pdf-upload-hint">
                    버튼을 눌러 PDF를 선택하면 곧바로 페이지 이미지 변환·분석이 시작됩니다.
                  </p>
                )}
              </div>
            )}

            {pdfStage === 'review' && pdfReview && (
              <div className="et-pdf-review-wrap">
                <div className="et-card et-pdf-summary-card">
                  <h4 className="et-card-title">페이지 분석 요약</h4>
                  <div className="et-pdf-summary-meta">
                    <span>전체 페이지: {pdfReview.summary?.total_pages || 0}장</span>
                    <span>설계 도면: {pdfReview.summary?.design_pages || 0}장</span>
                    <span>설치 도면: {pdfReview.summary?.installation_pages || 0}장</span>
                    <span>분류 상태: {pdfReview.status === 'classified' ? '완료' : '페이지 이미지 변환 완료(텍스트 분석 대기)'}</span>
                  </div>
                </div>

                <div className="et-toolbar-group et-pdf-filter-row" style={{ gap: '0.5rem' }}>
                  <button type="button" className={`et-btn ${pdfPageFilter === 'all' ? 'et-btn--primary' : 'et-btn--secondary'}`} onClick={() => setPdfPageFilter('all')}>전체</button>
                  <button type="button" className={`et-btn ${pdfPageFilter === 'design' ? 'et-btn--primary' : 'et-btn--secondary'}`} onClick={() => setPdfPageFilter('design')}>설계도면</button>
                  <button type="button" className={`et-btn ${pdfPageFilter === 'installation' ? 'et-btn--primary' : 'et-btn--secondary'}`} onClick={() => setPdfPageFilter('installation')}>설치도면</button>
                  <span className="et-pdf-filter-spacer" aria-hidden />
                  <button
                    type="button"
                    className="et-btn et-btn--secondary"
                    disabled={pdfLoading}
                    onClick={() => pdfFileInputRef.current?.click()}
                  >
                    {pdfLoading ? '분석 중…' : '새 PDF 분석'}
                  </button>
                  {pdfLoading && pdfPendingName && (
                    <span className="et-file-name" title={pdfPendingName}>
                      {pdfPendingName}
                    </span>
                  )}
                </div>

                {filteredPdfPages.length === 0 ? (
                  <p className="et-pdf-viewer-empty">필터에 해당하는 페이지가 없습니다.</p>
                ) : (
                  <div className="et-pdf-viewer">
                    <aside className="et-pdf-thumbs" aria-label="페이지 썸네일">
                      {filteredPdfPages.map((p) => (
                        <button
                          key={p.page_number}
                          type="button"
                          className={`et-pdf-thumb-btn ${pdfSelectedPageNum === p.page_number ? 'et-pdf-thumb-btn--active' : ''}`}
                          onClick={() => setPdfSelectedPageNum(p.page_number)}
                        >
                          <span className="et-pdf-thumb-label">Page {p.page_number}</span>
                          {p.image_data_url ? (
                            <img
                              className="et-pdf-thumb-img"
                              src={getPdfVisionPageImageSrc(p)}
                              alt=""
                            />
                          ) : (
                            <div className="et-pdf-thumb-placeholder">이미지 없음</div>
                          )}
                          <span className={`et-pdf-badge et-pdf-badge--${p.classification || 'unknown'}`}>
                            {pdfClassificationLabel(p.classification)}
                          </span>
                        </button>
                      ))}
                    </aside>

                    <div className="et-pdf-main">
                      {pdfSelectedPage && (
                        <>
                          <div className="et-pdf-main-toolbar">
                            <span className="et-pdf-main-title">Page {pdfSelectedPage.page_number}</span>
                            <button
                              type="button"
                              className="et-btn et-btn--secondary et-btn--sm"
                              onClick={() => setPdfZoomPage(pdfSelectedPage)}
                            >
                              전체 화면
                            </button>
                          </div>
                          <div className="et-pdf-main-canvas">
                            {pdfSelectedPage.image_data_url ? (
                              <>
                                <img
                                  className="et-pdf-main-image"
                                  src={getPdfVisionPageImageSrc(pdfSelectedPage)}
                                  alt={`PDF ${pdfSelectedPage.page_number} 페이지`}
                                />
                                {(pdfSelectedPage.overlay_boxes || []).map((b, idx) => (
                                  <div
                                    key={`${pdfSelectedPage.page_number}-ov-${idx}`}
                                    className={`et-pdf-overlay-box et-pdf-overlay-box--${b.type === 'table' ? 'table' : 'layout'}`}
                                    style={{
                                      left: `${(Number(b.x) || 0) * 100}%`,
                                      top: `${(Number(b.y) || 0) * 100}%`,
                                      width: `${(Number(b.w) || 0) * 100}%`,
                                      height: `${(Number(b.h) || 0) * 100}%`,
                                    }}
                                    title={`${b.type || 'layout'} ${b.text || ''}`.trim()}
                                  />
                                ))}
                              </>
                            ) : (
                              <div className="et-pdf-page-empty">이미지 없음</div>
                            )}
                          </div>
                          <p className="et-pdf-main-hint">빨강: 텍스트/레이아웃 bbox · 파랑: 테이블 bbox</p>
                        </>
                      )}
                    </div>

                    <aside className="et-pdf-ai-panel" aria-label="인공지능 인식 결과">
                      <h4 className="et-pdf-ai-title">인공지능(VLM) 인식 결과</h4>
                      {pdfSelectedPage ? (
                        <>
                          <div className="et-pdf-ai-block">
                            <div className="et-pdf-ai-label">최종 분류</div>
                            <div className="et-pdf-ai-value">
                              <span className={`et-pdf-badge et-pdf-badge--${pdfSelectedPage.classification || 'unknown'}`}>
                                {pdfClassificationLabel(pdfSelectedPage.classification)}
                              </span>
                              {pdfSelectedPage.source && (
                                <span className="et-pdf-ai-sub">출처: {pdfSelectedPage.source === 'vision' ? '비전 API' : pdfSelectedPage.source === 'text' ? 'PDF 텍스트' : pdfSelectedPage.source}</span>
                              )}
                            </div>
                          </div>
                          {(pdfSelectedPage.classification_vision || pdfSelectedPage.confidence_vision != null) && (
                            <div className="et-pdf-ai-block">
                              <div className="et-pdf-ai-label">비전 API 분류</div>
                              <div className="et-pdf-ai-value">
                                {pdfSelectedPage.classification_vision
                                  ? pdfClassificationLabel(pdfSelectedPage.classification_vision)
                                  : '—'}
                                {typeof pdfSelectedPage.confidence_vision === 'number' && !Number.isNaN(pdfSelectedPage.confidence_vision) && (
                                  <span className="et-pdf-ai-sub">
                                    {' '}
                                    신뢰도: {(pdfSelectedPage.confidence_vision <= 1 ? Math.round(pdfSelectedPage.confidence_vision * 100) : pdfSelectedPage.confidence_vision)}
                                    {pdfSelectedPage.confidence_vision <= 1 ? '%' : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="et-pdf-ai-block">
                            <div className="et-pdf-ai-label">도면인식 결과</div>
                            <pre className="et-pdf-ai-pre">
                              {(pdfSelectedPage.text_vision || '').trim() || '없음'}
                            </pre>
                          </div>
                          <div className="et-pdf-ai-block">
                            <div className="et-pdf-ai-label">텍스트인식 결과</div>
                            <pre className="et-pdf-ai-pre">
                              {(pdfSelectedPage.text_pdf || '').trim() || '없음'}
                            </pre>
                          </div>
                          {Array.isArray(pdfSelectedPage.overlay_boxes) && pdfSelectedPage.overlay_boxes.length > 0 && (
                            <div className="et-pdf-ai-block">
                              <div className="et-pdf-ai-label">레이아웃·테이블 영역</div>
                              <p className="et-pdf-ai-meta">감지된 bbox {pdfSelectedPage.overlay_boxes.length}개 (중앙 이미지에 표시)</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="et-pdf-ai-empty">페이지를 선택하세요.</p>
                      )}
                    </aside>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}
      {/* 자재등록 모달 */}
      {modalForm && (
        <div className="et-modal-overlay" onClick={() => setModalForm(false)}>
          <div className="et-modal" onClick={(e) => e.stopPropagation()}>
            <div className="et-modal-head">
              <h3>자재등록</h3>
              <button type="button" className="et-modal-close" onClick={() => setModalForm(false)}>×</button>
            </div>
            <div className="et-modal-body">
              {FIELD_GROUPS.map((group) => (
                <fieldset key={group.title} className="et-fieldset">
                  <legend className="et-fieldset-legend">{group.title}</legend>
                  <div className="et-form-grid">
                    {group.keys.map((key) => (
                      <div key={key} className="et-form-field">
                        <label className="et-label">{FIELD_LABELS[key]}</label>
                        <input type="text" className="et-input" value={record[key] ?? ''} onChange={(e) => handleFieldChange(key, e.target.value)} placeholder={FIELD_LABELS[key]} />
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))}
              <div className="et-modal-actions">
                <button type="button" className="et-btn et-btn--secondary" onClick={() => setModalForm(false)}>취소</button>
                <button type="button" className="et-btn et-btn--primary" onClick={handleSave}>저장</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR/BARCODE 스캔 모달 */}
      {modalQR && (
        <div className="et-modal-overlay" onClick={() => { setModalQR(false); setScanResult(null) }}>
          <div className="et-modal et-modal--scanner" onClick={(e) => e.stopPropagation()}>
            <div className="et-modal-head">
              <h3>QR/바코드 스캔</h3>
              <button type="button" className="et-modal-close" onClick={() => { setModalQR(false); setScanResult(null) }}>×</button>
            </div>
            <div className="et-modal-body">
              <p className="et-modal-desc">자재 QR코드 또는 바코드 스캔</p>
              <QRScanner onScan={handleScanSuccess} stopWhen={scanAccepted || !!scanResult} />
              {scanAccepted && !scanResult && !scanNotFound && (
                <p className="et-scan-status">조회 중…</p>
              )}
              {scanNotFound && (
                <div className="et-scan-result">
                  <p className="et-scan-not-found">해당 장비를 찾을 수 없습니다.</p>
                  <button type="button" className="et-btn et-btn--primary et-scan-result-action" onClick={() => { setScanAccepted(false); setScanNotFound(false) }}>
                    다시 스캔
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 현장 위치(QR T2) 모달 */}
      {locationModalOpen && locationDrawing && (
        <div
          className="et-modal-overlay"
          onClick={() => {
            setLocationModalOpen(false)
            setLocationRecord(null)
            setLocationPendingPcsNo('')
            setLocationDrawing(null)
            setLocationPoints([])
            setLocationActivePoint(null)
          }}
        >
          <div
            className="et-modal"
            style={{ maxWidth: 860 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="et-modal-head">
              <h3 className="et-detail-title" style={{ margin: 0 }}>현장 위치 조회</h3>
              <button
                type="button"
                className="et-modal-close"
                onClick={() => {
                  setLocationModalOpen(false)
                  setLocationRecord(null)
                  setLocationPendingPcsNo('')
                  setLocationDrawing(null)
                  setLocationPoints([])
                  setLocationActivePoint(null)
                }}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="et-modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '1.25rem', alignItems: 'start' }}>
                <div>
                  <div style={{ position: 'relative', background: 'var(--et-bg-input)', border: '1px solid var(--et-border)', borderRadius: 8, overflow: 'hidden' }}>
                    {locationDrawing.file_type === 'pdf' ? (
                      <iframe
                        title="설치 도면 PDF"
                        src={`/api/installation/drawings/${locationDrawing.id}/file?t=${Date.now()}`}
                        style={{ width: '100%', height: 520, border: 0, display: locationDrawing ? 'block' : 'none' }}
                      />
                    ) : (
                      <img
                        src={`/api/installation/drawings/${locationDrawing.id}/file?t=preview`}
                        alt="설치 도면"
                        style={{ width: '100%', height: 'auto', display: 'block', maxHeight: 520, objectFit: 'contain' }}
                      />
                    )}

                    <div className="et-detail-drawing-points-overlay">
                      {(locationPoints || []).map((p) => {
                        const active = locationActivePoint?.id && p.id === locationActivePoint.id
                        return (
                          <div
                            key={p.id}
                            className="et-detail-drawing-point"
                            style={{
                              left: `${p.x * 100}%`,
                              top: `${p.y * 100}%`,
                              transform: 'translate(-50%, -50%)',
                            }}
                            title={p.pcs_no || ''}
                          >
                            <span
                              className="et-detail-drawing-point-dot"
                              style={active ? { background: '#dc2626' } : undefined}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {locationActivePoint && (
                    <p style={{ margin: '0.75rem 0 0', color: 'var(--et-text-muted)', fontSize: '0.85rem' }}>
                      Pin: {locationActivePoint.pcs_no || '-'} / 좌표 ({(locationActivePoint.x * 100).toFixed(0)}%, {(locationActivePoint.y * 100).toFixed(0)}%)
                    </p>
                  )}
                </div>

                <div>
                  <div className="et-card">
                    <h4 className="et-card-title">투입 자재 리스트</h4>
                    <p className="et-card-desc">
                      {locationPendingPcsNo
                        ? '자재 정보를 불러오는 중…'
                        : locationRecord
                          ? '이 위치(핀)에 연결된 자재입니다.'
                          : 'QR 스캔 후 자재를 조회하세요.'}
                    </p>
                    {locationRecord ? (
                      <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.85rem' }}>
                        <div><strong>{locationRecord.item || '-'}</strong></div>
                        <div>PCS No: {locationRecord.pcs_no || '-'}</div>
                        <div>수량: {locationRecord.quantity || '-'}</div>
                        <div>중량: {locationRecord.list_weight || '-'}</div>
                        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="et-btn et-btn--primary"
                            onClick={() => {
                              setLocationModalOpen(false)
                              setSelectedRecord(locationRecord)
                            }}
                          >
                            상세 도면 보기
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {pdfZoomPage && (
        <div className="et-modal-overlay" onClick={() => setPdfZoomPage(null)}>
          <div className="et-modal et-pdf-zoom-modal" onClick={(e) => e.stopPropagation()}>
            <div className="et-modal-head">
              <h3 className="et-detail-title" style={{ margin: 0 }}>
                Page {pdfZoomPage.page_number} 확대 보기
              </h3>
              <button type="button" className="et-modal-close" onClick={() => setPdfZoomPage(null)} aria-label="닫기">×</button>
            </div>
            <div className="et-modal-body">
              <div className="et-pdf-zoom-canvas">
                <img
                  src={getPdfVisionPageImageSrc(pdfZoomPage)}
                  alt={`PDF ${pdfZoomPage.page_number} 확대`}
                  className="et-pdf-zoom-image"
                />
                {(pdfZoomPage.overlay_boxes || []).map((b, idx) => (
                  <div
                    key={`${pdfZoomPage.page_number}-${idx}`}
                    className={`et-pdf-overlay-box et-pdf-overlay-box--${b.type === 'table' ? 'table' : 'layout'}`}
                    style={{
                      left: `${(Number(b.x) || 0) * 100}%`,
                      top: `${(Number(b.y) || 0) * 100}%`,
                      width: `${(Number(b.w) || 0) * 100}%`,
                      height: `${(Number(b.h) || 0) * 100}%`,
                    }}
                    title={`${b.type || 'layout'} ${b.text || ''}`.trim()}
                  />
                ))}
              </div>
              <p className="et-pdf-zoom-help">
                빨강: 텍스트/레이아웃 bbox, 파랑: 테이블 bbox
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EquipmentTraceabilityWidget
