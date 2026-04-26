import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getSensorPercentInSlot } from '../../../entities/drawing/lib/drawingSensorPosition'
import { useActiveDrawing } from '../../../entities/drawing/model/activeDrawing'
import { DrawingSensorDot } from '../../../entities/drawing/ui/DrawingSensorDot'
import { DrawingViewResetIcon } from '../../../entities/drawing/ui/DrawingViewResetIcon'
import { PageContentGrid } from '../../../shared/ui/layout/PageContentGrid'
import { monitorAssets } from '../../monitor/assets/monitorAssets'
import { drawingSensorAssets } from '../assets/drawingSensorAssets'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.15

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function clampDrawingPan(x: number, y: number, zoom: number, vw: number, vh: number) {
  if (zoom <= 1) return { x: 0, y: 0 }
  const maxX = Math.max(0, (vw * zoom - vw) / 2)
  const maxY = Math.max(0, (vh * zoom - vh) / 2)
  return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) }
}

type RegisteredSensor = {
  id: string
  label: string
  color: 'green' | 'orange'
  unitLabel: string
  posText: string
}

function normalizeLabelKey(v: string) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function unitLabelToUnit(ul: string): 'pressure' | 'flow' {
  return ul.includes('유량') ? 'flow' : 'pressure'
}

const PLACEMENT_TOAST =
  '도면을 클릭하여 센서 설치 위치를 먼저 지정해 주세요.'

const MOCK_DRAWING_1_SENSORS: RegisteredSensor[] = [
  {
    id: 'S1773688338279',
    label: '압력-1',
    color: 'green',
    unitLabel: '압력 (MPa)',
    posText: '(13.714%, 19.953%)',
  },
  {
    id: 'S1773691967926',
    label: '유량-1',
    color: 'orange',
    unitLabel: '유량 (L/min)',
    posText: '(55.715%, 53.038%)',
  },
]

export default function DrawingSensorPage() {
  const navigate = useNavigate()
  const { activeDrawing, activeDrawingId, activeIndex, total, goPrev, goNext } = useActiveDrawing()

  const { imgAttachFileAdd, imgChevronLeft, imgChevronRight, imgSelectCaret, imgEdit, imgDelete } = drawingSensorAssets

  const drawingName = activeDrawing?.name ?? '도면'
  const page = total <= 0 ? 0 : activeIndex + 1

  const drawingKey = activeDrawingId || '_none'

  const [label, setLabel] = useState('')
  const [unit, setUnit] = useState<'pressure' | 'flow'>('pressure')
  const [enabled, setEnabled] = useState(true)
  const [pendingPlacement, setPendingPlacement] = useState<{ leftPct: number; topPct: number } | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const drawingCanvasRef = useRef<HTMLDivElement>(null)
  const [drawingZoom, setDrawingZoom] = useState(1)
  const [drawingFabOpen, setDrawingFabOpen] = useState(false)
  const [drawingPan, setDrawingPan] = useState({ x: 0, y: 0 })
  const [isDrawingPanning, setIsDrawingPanning] = useState(false)
  const drawingViewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ active: boolean; pointerId: number; lastX: number; lastY: number } | null>(null)

  const [registrationsByDrawing, setRegistrationsByDrawing] = useState<Record<string, RegisteredSensor[]>>(() => ({
    'drawing-1': MOCK_DRAWING_1_SENSORS,
  }))

  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editUnit, setEditUnit] = useState<'pressure' | 'flow'>('pressure')

  const registeredSensors = useMemo(
    () => registrationsByDrawing[drawingKey] ?? [],
    [registrationsByDrawing, drawingKey],
  )

  useEffect(() => {
    setLabel('')
    setUnit('pressure')
    setEditingId(null)
    setDeleteConfirmId(null)
    setPendingPlacement(null)
    setDrawingZoom(1)
    setDrawingPan({ x: 0, y: 0 })
    setDrawingFabOpen(false)
  }, [drawingKey])

  useEffect(() => {
    if (drawingZoom <= 1) {
      setDrawingPan({ x: 0, y: 0 })
      return
    }
    const el = drawingViewportRef.current
    if (!el) return
    const { clientWidth: vw, clientHeight: vh } = el
    setDrawingPan((p) => clampDrawingPan(p.x, p.y, drawingZoom, vw, vh))
  }, [drawingZoom])

  const onDrawingPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (drawingZoom <= 1) return
      if (e.button !== 0) return
      const el = drawingViewportRef.current
      if (!el) return
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      dragRef.current = { active: true, pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
      setIsDrawingPanning(true)
    },
    [drawingZoom],
  )

  const onDrawingPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d?.active || e.pointerId !== d.pointerId) return
      const dx = e.clientX - d.lastX
      const dy = e.clientY - d.lastY
      d.lastX = e.clientX
      d.lastY = e.clientY
      const el = drawingViewportRef.current
      if (!el) return
      const { clientWidth: vw, clientHeight: vh } = el
      setDrawingPan((p) => clampDrawingPan(p.x + dx, p.y + dy, drawingZoom, vw, vh))
    },
    [drawingZoom],
  )

  const endDrawingDrag = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d?.active || e.pointerId !== d.pointerId) return
    dragRef.current = null
    setIsDrawingPanning(false)
    try {
      drawingViewportRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const canResetDrawingView = drawingZoom !== 1 || drawingPan.x !== 0 || drawingPan.y !== 0

  useEffect(() => {
    if (!toastMessage) return
    const id = window.setTimeout(() => setToastMessage(null), 3500)
    return () => window.clearTimeout(id)
  }, [toastMessage])

  const unitLabel = unit === 'pressure' ? '압력 (MPa)' : '유량 (L/min)'
  const unitColor: RegisteredSensor['color'] = unit === 'pressure' ? 'green' : 'orange'

  const onAdd = () => {
    if (!pendingPlacement) {
      setToastMessage(PLACEMENT_TOAST)
      return
    }
    const trimmed = label.trim()
    if (!trimmed) {
      setAlertMessage('라벨을 입력해 주세요.')
      return
    }

    const key = normalizeLabelKey(trimmed)
    const duplicate = registeredSensors.some((s) => normalizeLabelKey(s.label) === key)
    if (duplicate) {
      setAlertMessage('이 도면에서 이미 사용 중인 라벨명입니다.')
      return
    }

    const id = `S${Date.now()}`
    const posText = `(${pendingPlacement.leftPct.toFixed(3)}%, ${pendingPlacement.topPct.toFixed(3)}%)`
    setRegistrationsByDrawing((prev) => ({
      ...prev,
      [drawingKey]: [
        ...(prev[drawingKey] ?? []),
        {
          id,
          label: trimmed,
          color: unitColor,
          unitLabel,
          posText,
        },
      ],
    }))
    setLabel('')
    setPendingPlacement(null)
  }

  const onCancel = () => {
    setLabel('')
    setUnit('pressure')
    setPendingPlacement(null)
  }

  const onDrawingCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drawingZoom > 1) return
    const el = drawingCanvasRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
    const leftPct = (x / rect.width) * 100
    const topPct = (y / rect.height) * 100
    setPendingPlacement({ leftPct, topPct })
  }

  const onLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (!pendingPlacement && v.length > 0) {
      setToastMessage(PLACEMENT_TOAST)
      return
    }
    setLabel(v)
  }

  const startEdit = (s: RegisteredSensor) => {
    setEditingId(s.id)
    setEditLabel(s.label)
    setEditUnit(unitLabelToUnit(s.unitLabel))
  }

  const saveEdit = () => {
    if (!editingId) return
    const trimmed = editLabel.trim()
    if (!trimmed) {
      setAlertMessage('라벨을 입력해 주세요.')
      return
    }
    const key = normalizeLabelKey(trimmed)
    const duplicate = registeredSensors.some(
      (o) => o.id !== editingId && normalizeLabelKey(o.label) === key,
    )
    if (duplicate) {
      setAlertMessage('이 도면에서 이미 사용 중인 라벨명입니다.')
      return
    }
    const nextUnitLabel = editUnit === 'pressure' ? '압력 (MPa)' : '유량 (L/min)'
    const nextColor: RegisteredSensor['color'] = editUnit === 'pressure' ? 'green' : 'orange'
    setRegistrationsByDrawing((prev) => {
      const list = prev[drawingKey] ?? []
      return {
        ...prev,
        [drawingKey]: list.map((o) =>
          o.id === editingId
            ? { ...o, label: trimmed, unitLabel: nextUnitLabel, color: nextColor }
            : o,
        ),
      }
    })
    setEditingId(null)
  }

  const confirmDelete = () => {
    if (!deleteConfirmId) return
    setRegistrationsByDrawing((prev) => {
      const list = prev[drawingKey] ?? []
      return {
        ...prev,
        [drawingKey]: list.filter((o) => o.id !== deleteConfirmId),
      }
    })
    if (editingId === deleteConfirmId) setEditingId(null)
    setDeleteConfirmId(null)
  }

  return (
    <>
    <PageContentGrid>
      <section className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-9 lg:h-full">
      {/* Top row: title + add drawing — 우측 열 제목과 높이 맞춤 */}
      <div className="flex min-h-[40px] shrink-0 items-center justify-between gap-[12px]">
        <div className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[color:var(--blue_primary_800,#4370ac)] uppercase">
          {drawingName}
        </div>

        <button
          type="button"
          className="h-[40px] shrink-0 rounded-[4px] bg-[var(--blue_icon,#1392ec)] px-[22px] py-[8px] flex items-center justify-center gap-[8px]"
          aria-label="도면 추가"
        >
          <img alt="" className="block w-[20px] h-[20px]" src={imgAttachFileAdd} />
          <span className="font-['Pretendard',sans-serif] font-medium text-[16px] leading-[15px] tracking-[-0.25px] text-white uppercase whitespace-nowrap">
            도면 추가
          </span>
        </button>
      </div>

      {/* Main card — 관제 탭과 동일 그림자; 도면 영역은 최소 786px + 남는 높이 균등 */}
      <div className="mt-[12px] flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-[12px] gap-y-[8px] px-[32px] pb-[12px] pt-[24px]">
            <div className="font-['Pretendard',sans-serif] font-normal text-[14px] leading-[normal] text-[color:var(--black_500,#485b77)]">
              도면 내 설치 위치 등록 (도면을 클릭하여 센서 추가)
            </div>

            <div className="flex items-center gap-[12px] py-[4px]">
              <div className="font-['Pretendard',sans-serif] font-normal text-[14px] leading-[normal] text-[color:var(--black_500,#485b77)]">
                활성화 여부
              </div>
              <button
                type="button"
                className="relative h-[20px] w-[36px] rounded-full"
                style={{ backgroundColor: enabled ? '#22c55e' : '#e2e8f0' }}
                aria-label="활성화 여부"
                onClick={() => setEnabled((v) => !v)}
              >
                <span
                  className="absolute top-[2px] size-[16px] rounded-full border border-white bg-white"
                  style={{ left: enabled ? 18 : 2 }}
                />
              </button>
            </div>
          </div>

          <div className="relative min-h-[786px] min-w-0 flex-1">
            <div
              ref={drawingViewportRef}
              className={`absolute inset-0 overflow-hidden touch-none select-none ${
                drawingZoom > 1 ? (isDrawingPanning ? 'cursor-grabbing' : 'cursor-grab') : ''
              }`}
              onPointerDown={onDrawingPointerDown}
              onPointerMove={onDrawingPointerMove}
              onPointerUp={endDrawingDrag}
              onPointerCancel={endDrawingDrag}
              onLostPointerCapture={() => {
                dragRef.current = null
                setIsDrawingPanning(false)
              }}
            >
              <div
                className="relative h-full w-full"
                style={{ transform: `translate(${drawingPan.x}px, ${drawingPan.y}px)` }}
              >
                <div
                  className="relative h-full w-full"
                  style={{
                    transform: `scale(${drawingZoom})`,
                    transformOrigin: '50% 40%',
                    transition: isDrawingPanning ? 'none' : 'transform 0.15s ease-out',
                  }}
                >
                  <div className="relative h-full w-full overflow-hidden">
                    <div
                      ref={drawingCanvasRef}
                      className={`absolute left-0 top-[19.35%] h-[61.3%] w-full overflow-hidden ${drawingZoom <= 1 ? 'cursor-crosshair' : ''}`}
                      onClick={onDrawingCanvasClick}
                      role="presentation"
                    >
                      <div className="pointer-events-none relative h-full w-full">
                        <img
                          alt={drawingName}
                          className="absolute inset-0 h-full w-full object-contain"
                          src={activeDrawing?.imagePath ?? monitorAssets.imgDrawing}
                          draggable={false}
                        />
                        {(activeDrawing?.sensors ?? []).map((s) => {
                          const { leftPct, topPct } = getSensorPercentInSlot(s)
                          return (
                            <DrawingSensorDot key={s.id} leftPct={leftPct} topPct={topPct} variant={s.variant} />
                          )
                        })}
                        {pendingPlacement && (
                          <DrawingSensorDot
                            leftPct={pendingPlacement.leftPct}
                            topPct={pendingPlacement.topPct}
                            variant={unit === 'pressure' ? 'green' : 'yellow'}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pointer-events-none absolute inset-0 z-20">
              <div className="pointer-events-auto absolute bottom-[16px] right-[16px] flex flex-col-reverse items-center gap-[10px]">
                <button
                  type="button"
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full border border-[#e2e8f0] bg-white shadow-[0px_4px_14px_rgba(0,0,0,0.14)] transition-shadow hover:shadow-[0px_6px_18px_rgba(0,0,0,0.16)]"
                  aria-label={drawingFabOpen ? '도면 도구 닫기' : '도면 도구 열기'}
                  aria-expanded={drawingFabOpen}
                  onClick={() => setDrawingFabOpen((v) => !v)}
                >
                  {drawingFabOpen ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M18 6L6 18M6 6l12 12"
                        stroke="#94a3b8"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 7h16M4 12h16M4 17h16"
                        stroke="#94a3b8"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </button>

                {drawingFabOpen && (
                  <div className="flex flex-col items-center gap-[2px] rounded-[9999px] border border-[#e2e8f0] bg-white px-[6px] py-[8px] shadow-[0px_4px_14px_rgba(0,0,0,0.14)]">
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면 확대"
                      onClick={() =>
                        setDrawingZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 1000) / 1000))
                      }
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgAddCircle} />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="도면 축소"
                      onClick={() =>
                        setDrawingZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 1000) / 1000))
                      }
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgDoNotDisturbOn} />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-35"
                      aria-label="도면 크기·위치 원래대로"
                      disabled={!canResetDrawingView}
                      onClick={() => {
                        setDrawingZoom(1)
                        setDrawingPan({ x: 0, y: 0 })
                      }}
                    >
                      <DrawingViewResetIcon />
                    </button>
                    <button
                      type="button"
                      className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-[#f1f5f9]"
                      aria-label="관제 화면으로"
                      onClick={() => {
                        setDrawingFabOpen(false)
                        navigate('/')
                      }}
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={monitorAssets.imgEditSquare} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pagination */}
      <div className="mt-[18px] flex shrink-0 items-center justify-center gap-[51px] text-[16px] text-[#0b1828]">
        <button type="button" className="w-[20px] h-[20px] flex items-center justify-center" onClick={goPrev}>
          <img alt="" className="-scale-x-100 block w-[20px] h-[20px]" src={imgChevronLeft} />
        </button>
        <div className="font-['Pretendard',sans-serif] font-normal leading-[20px]">
          {page} / {total}
        </div>
        <button type="button" className="w-[20px] h-[20px] flex items-center justify-center" onClick={goNext}>
          <img alt="" className="block w-[20px] h-[20px]" src={imgChevronRight} />
        </button>
      </div>
      </section>

      <aside className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-3 lg:h-full">
        <div className="flex min-h-[40px] shrink-0 items-center font-['Pretendard',sans-serif] text-[16px] font-semibold uppercase leading-[1.2] text-[color:var(--blue_primary_800,#4370ac)] -translate-y-[2px]">
          등록된 센서 ({registeredSensors.length})
        </div>
        <div className="mt-[12px] flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]">
            {/* 상단 고정: 센서 생성 */}
            <div className="shrink-0 border-b border-[#e2e8f0] bg-[#fafafa] p-[12px]">
            <div className="flex flex-col gap-[12px]">
              <div>
                <div className="pb-[4px] font-['Pretendard',sans-serif] text-[13px] leading-[normal] text-[color:var(--black_500,#485b77)]">
                  라벨
                </div>
                <div className="flex h-[40px] w-full items-center rounded-[4px] border border-[#e2e8f0] bg-white px-[13px]">
                  <input
                    className="w-full bg-transparent font-['Pretendard',sans-serif] text-[14px] text-[#0b1828] outline-none placeholder:text-[#6b7280]"
                    placeholder="예: 압력-1"
                    value={label}
                    onChange={onLabelChange}
                  />
                </div>
              </div>
              <div>
                <div className="pb-[4px] font-['Pretendard',sans-serif] text-[13px] leading-[normal] text-[color:var(--black_500,#485b77)]">
                  단위
                </div>
                <div className="relative w-full">
                  <select
                    className="h-[40px] w-full appearance-none rounded-[4px] border border-[#e2e8f0] bg-white pl-[12px] pr-[36px] font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_title,#0b1828)]"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as 'pressure' | 'flow')}
                  >
                    <option value="pressure">압력 (MPa)</option>
                    <option value="flow">유량 (L/min)</option>
                  </select>
                  <img
                    alt=""
                    className="pointer-events-none absolute right-[9px] top-1/2 h-[21px] w-[21px] -translate-y-1/2"
                    src={imgSelectCaret}
                  />
                </div>
              </div>
              <div className="flex gap-[8px]">
                <button
                  type="button"
                  className="h-[40px] flex-1 rounded-[8px] bg-[var(--blue_icon,#1392ec)] font-['Pretendard',sans-serif] text-[14px] leading-[20px] text-white"
                  onClick={onAdd}
                >
                  추가
                </button>
                <button
                  type="button"
                  className="h-[40px] flex-1 rounded-[8px] bg-[var(--gray_sidebar_stroke,#e2e8f0)] font-['Pretendard',sans-serif] text-[14px] leading-[20px] text-[color:var(--black_700,#2c3c53)]"
                  onClick={onCancel}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
          <div className="shrink-0 border-b border-[#e2e8f0] px-[12px] py-[8px] font-['Pretendard',sans-serif] text-[12px] leading-[normal] text-[color:var(--black_500,#485b77)]">
            목록 ({registeredSensors.length})
          </div>
          <div className="notion-scrollbar flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto py-[12px] pl-[12px] pr-[4px]">
            {registeredSensors.map((s) =>
              editingId === s.id ? (
                <div
                  key={s.id}
                  className="flex flex-col gap-[12px] rounded-[8px] border border-[#e2e8f0] bg-white p-[14px]"
                >
                  <div className="flex flex-col gap-[12px] min-w-0">
                    <div
                      className={`h-[32px] w-[4px] shrink-0 self-start rounded-full ${
                        editUnit === 'pressure' ? 'bg-[var(--green_sensor,#85b548)]' : 'bg-[var(--orange_sensor,#daa324)]'
                      }`}
                    />
                    <div className="flex min-w-0 flex-col gap-[12px]">
                      <div className="flex flex-col gap-[8px]">
                        <div className="font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_500,#485b77)]">
                          라벨
                        </div>
                        <div className="flex h-[40px] items-center rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] px-[13px]">
                          <input
                            className="w-full bg-transparent font-['Pretendard',sans-serif] text-[14px] text-[#0b1828] outline-none"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-[8px]">
                        <div className="font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_500,#485b77)]">
                          단위
                        </div>
                        <div className="relative w-full">
                          <select
                            className="h-[40px] w-full appearance-none rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] pl-[12px] pr-[36px] font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_title,#0b1828)]"
                            value={editUnit}
                            onChange={(e) => setEditUnit(e.target.value as 'pressure' | 'flow')}
                          >
                            <option value="pressure">압력 (MPa)</option>
                            <option value="flow">유량 (L/min)</option>
                          </select>
                          <img
                            alt=""
                            className="pointer-events-none absolute right-[9px] top-1/2 h-[21px] w-[21px] -translate-y-1/2"
                            src={imgSelectCaret}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-[4px]">
                    <button
                      type="button"
                      className="flex h-[28px] w-[28px] items-center justify-center rounded-[4px] hover:bg-[#eff6ff]"
                      aria-label="수정 저장"
                      onClick={saveEdit}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M20 6L9 17l-5-5"
                          stroke="var(--blue_icon,#1392ec)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="group flex h-[28px] w-[28px] items-center justify-center rounded-[4px] hover:bg-[#fef2f2]"
                      aria-label="센서 삭제"
                      onClick={() => setDeleteConfirmId(s.id)}
                    >
                      <img
                        alt=""
                        className="block h-[20px] w-[20px] transition-[filter] group-hover:[filter:invert(32%)_sepia(95%)_saturate(2582%)_hue-rotate(331deg)_brightness(99%)_contrast(96%)]"
                        src={imgDelete}
                      />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={s.id}
                  className="flex flex-col gap-[10px] rounded-[8px] border border-[#e2e8f0] bg-white p-[14px] min-w-0"
                >
                  <div className="flex items-start gap-[12px] min-w-0">
                    <div
                      className={`mt-[2px] h-[32px] w-[4px] shrink-0 rounded-full ${
                        s.color === 'green' ? 'bg-[var(--green_sensor,#85b548)]' : 'bg-[var(--orange_sensor,#daa324)]'
                      }`}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
                      <div className="truncate font-['Pretendard',sans-serif] text-[15px] leading-[20px] text-[color:var(--black_700,#2c3c53)]">
                        {s.label}
                      </div>
                      <div className="break-words font-['Pretendard',sans-serif] text-[12px] leading-[normal] text-[color:var(--black_300,#7a89a1)]">
                        {s.unitLabel}
                      </div>
                      <div className="break-all font-['Pretendard',sans-serif] text-[11px] leading-[normal] text-[color:var(--black_300,#7a89a1)]">
                        {s.posText}
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-[4px]">
                    <button
                      type="button"
                      className="flex h-[28px] w-[28px] items-center justify-center rounded-[4px] hover:bg-[#f1f5f9]"
                      aria-label="센서 편집"
                      onClick={() => startEdit(s)}
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={imgEdit} />
                    </button>
                    <button
                      type="button"
                      className="group flex h-[28px] w-[28px] items-center justify-center rounded-[4px] hover:bg-[#fef2f2]"
                      aria-label="센서 삭제"
                      onClick={() => setDeleteConfirmId(s.id)}
                    >
                      <img
                        alt=""
                        className="block h-[20px] w-[20px] transition-[filter] group-hover:[filter:invert(32%)_sepia(95%)_saturate(2582%)_hue-rotate(331deg)_brightness(99%)_contrast(96%)]"
                        src={imgDelete}
                      />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
          </div>
        </div>
        {/* 좌측 페이지네이션 행과 동일 높이 → 양열 flex-1 카드 높이 맞춤 */}
        <div
          className="mt-[18px] flex h-[20px] shrink-0 items-center justify-center gap-[51px]"
          aria-hidden="true"
        />
      </aside>
    </PageContentGrid>

    {alertMessage && (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-[24px]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sensor-label-alert-title"
      >
        <div className="w-full max-w-[360px] rounded-[12px] bg-white p-[24px] shadow-[0px_12px_40px_rgba(0,0,0,0.18)]">
          <div id="sensor-label-alert-title" className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.4] text-[color:var(--black_title,#0b1828)]">
            알림
          </div>
          <p className="mt-[12px] font-['Pretendard',sans-serif] text-[14px] leading-[1.5] text-[color:var(--black_500,#485b77)]">
            {alertMessage}
          </p>
          <div className="mt-[20px] flex justify-end">
            <button
              type="button"
              className="h-[40px] rounded-[8px] bg-[var(--blue_icon,#1392ec)] px-[20px] font-['Pretendard',sans-serif] text-[14px] leading-[20px] text-white"
              onClick={() => setAlertMessage(null)}
            >
              확인
            </button>
          </div>
        </div>
      </div>
    )}

    {deleteConfirmId && (
      <div
        className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 px-[24px]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sensor-delete-title"
        onClick={() => setDeleteConfirmId(null)}
      >
        <div
          className="w-full max-w-[500px] rounded-[12px] bg-white p-[40px] shadow-[0px_12px_40px_rgba(0,0,0,0.18)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center">
            <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#fef2f2]" aria-hidden>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
              </svg>
            </div>
          </div>
          <h2
            id="sensor-delete-title"
            className="mt-[24px] text-center font-['Pretendard',sans-serif] text-[18px] font-semibold leading-[1.35] text-[color:var(--black_title,#0b1828)]"
          >
            해당 센서를 삭제하시겠습니까?
          </h2>
          <p className="mt-[12px] text-center font-['Pretendard',sans-serif] text-[14px] leading-[1.5] text-[color:var(--black_500,#485b77)]">
            삭제 시 등록된 센서 정보가 제거됩니다.
          </p>
          <div className="mt-[28px] flex gap-[12px]">
            <button
              type="button"
              className="h-[52px] flex-1 rounded-[8px] border border-[#e2e8f0] bg-white font-['Pretendard',sans-serif] text-[16px] font-medium text-[color:var(--black_700,#2c3c53)]"
              onClick={() => setDeleteConfirmId(null)}
            >
              취소
            </button>
            <button
              type="button"
              className="h-[52px] flex-1 rounded-[8px] bg-[#ef4444] font-['Pretendard',sans-serif] text-[16px] font-medium text-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)]"
              onClick={confirmDelete}
            >
              삭제
            </button>
          </div>
        </div>
      </div>
    )}

    {toastMessage && (
      <div
        className="pointer-events-none fixed bottom-[28px] left-1/2 z-[300] max-w-[min(92vw,420px)] -translate-x-1/2 rounded-[10px] bg-[#2f2f2f] px-[18px] py-[12px] text-center font-['Pretendard',sans-serif] text-[14px] leading-[1.45] text-white shadow-[0px_8px_24px_rgba(0,0,0,0.22)]"
        role="status"
        aria-live="polite"
      >
        {toastMessage}
      </div>
    )}
    </>
  )
}

