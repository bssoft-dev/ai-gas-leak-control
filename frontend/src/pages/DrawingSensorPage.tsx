import { useEffect, useMemo, useState } from 'react'

import { drawingSensorAssets } from '../assets/drawing-sensor/drawingSensorAssets'
import { useActiveDrawing } from '../state/activeDrawing'

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
  const { activeDrawing, activeDrawingId, activeIndex, total, goPrev, goNext } = useActiveDrawing()

  const { imgAttachFileAdd, imgChevronLeft, imgChevronRight, imgSelectCaret, imgEdit, imgDelete } = drawingSensorAssets

  const drawingName = activeDrawing?.name ?? '도면'
  const page = total <= 0 ? 0 : activeIndex + 1

  const drawingKey = activeDrawingId || '_none'

  const [label, setLabel] = useState('')
  const [unit, setUnit] = useState<'pressure' | 'flow'>('pressure')
  const [enabled, setEnabled] = useState(true)

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
  }, [drawingKey])

  const unitLabel = unit === 'pressure' ? '압력 (MPa)' : '유량 (L/min)'
  const unitColor: RegisteredSensor['color'] = unit === 'pressure' ? 'green' : 'orange'

  const onAdd = () => {
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
    const posText = '(—, —)'
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
  }

  const onCancel = () => {
    setLabel('')
    setUnit('pressure')
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

  const SensorDot = ({ left, top, variant }: { left: number; top: number; variant: 'green' | 'yellow' }) => {
    const color = variant === 'green' ? '#7cbf6a' : '#caa23d'
    const halo = variant === 'green' ? 'rgba(124,191,106,0.55)' : 'rgba(202,162,61,0.55)'
    const haloMid = variant === 'green' ? 'rgba(124,191,106,0.25)' : 'rgba(202,162,61,0.25)'

    return (
      <div className="absolute" style={{ left, top, width: 14, height: 14 }}>
        <div
          className="absolute rounded-full"
          style={{
            left: -6,
            top: -6,
            width: 26,
            height: 26,
            background: `radial-gradient(circle, ${halo} 0%, ${haloMid} 45%, rgba(0,0,0,0) 70%)`,
            filter: 'blur(0.2px)',
          }}
        />
        <div className="absolute left-[2px] top-[2px] w-[10px] h-[10px] rounded-full" style={{ backgroundColor: color }} />
      </div>
    )
  }

  return (
    <>
    <div className="w-full bg-white px-[24px] pt-[26px] pb-[24px]">
      {/* Top row: title + add drawing */}
      <div className="flex items-center justify-between">
        <div className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[color:var(--blue_primary_800,#4370ac)] uppercase">
          {drawingName}
        </div>

        <button
          type="button"
          className="h-[40px] rounded-[4px] bg-[var(--blue_icon,#1392ec)] px-[22px] py-[8px] flex items-center justify-center gap-[8px]"
          aria-label="도면 추가"
        >
          <img alt="" className="block w-[20px] h-[20px]" src={imgAttachFileAdd} />
          <span className="font-['Pretendard',sans-serif] font-medium text-[16px] leading-[15px] tracking-[-0.25px] text-white uppercase whitespace-nowrap">
            도면 추가
          </span>
        </button>
      </div>

      {/* Main card */}
      <div className="mt-[12px] bg-white rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_0px_rgba(0,0,0,0.15)]">
        <div className="px-[32px] py-[24px] flex flex-col gap-[24px]">
          {/* Drawing area header */}
          <div className="flex flex-col gap-[12px]">
            <div className="flex items-center justify-between pb-[2px]">
              <div className="font-['Pretendard',sans-serif] font-normal text-[14px] leading-[normal] text-[color:var(--black_500,#485b77)]">
                도면 내 설치 위치 등록 (도면을 클릭하여 센서 추가)
              </div>

              <div className="flex items-center gap-[12px] pl-[24px] py-[12px]">
                <div className="font-['Pretendard',sans-serif] font-normal text-[14px] leading-[normal] text-[color:var(--black_500,#485b77)]">
                  활성화 여부
                </div>
                <button
                  type="button"
                  className="relative w-[36px] h-[20px] rounded-full"
                  style={{ backgroundColor: enabled ? '#22c55e' : '#e2e8f0' }}
                  aria-label="활성화 여부"
                  onClick={() => setEnabled((v) => !v)}
                >
                  <span
                    className="absolute top-[2px] size-[16px] rounded-full bg-white border border-white"
                    style={{ left: enabled ? 18 : 2 }}
                  />
                </button>
              </div>
            </div>

            {/* Drawing canvas */}
            <div className="bg-white border border-[#e2e8f0] rounded-[8px] p-px overflow-hidden">
              <div className="aspect-[21/9] w-full relative">
                <div className="absolute inset-0 p-[16px] flex items-center justify-center">
                  <div className="flex-1 h-full relative overflow-hidden">
                    <img
                      alt={drawingName}
                      className="absolute h-full left-1/2 -translate-x-1/2 top-0 object-contain"
                      src={activeDrawing?.imagePath ?? ''}
                    />
                    {(activeDrawing?.sensors ?? []).map((s) => (
                      <SensorDot key={s.id} left={s.left} top={s.top} variant={s.variant} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sensor registration bar */}
          <div className="bg-white border border-[#e2e8f0] rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] p-[17px] flex items-center justify-between gap-[16px]">
            <div className="flex flex-1 items-center gap-[24px]">
              <div className="flex items-center gap-[12px]">
                <div className="pb-[2px] font-['Pretendard',sans-serif] text-[14px] leading-[normal] text-[color:var(--black_500,#485b77)]">
                  라벨
                </div>
                <div className="h-[40px] w-[256px] bg-[#f8fafc] border border-[#e2e8f0] rounded-[4px] px-[13px] flex items-center">
                  <input
                    className="w-full bg-transparent outline-none font-['Pretendard',sans-serif] text-[14px] text-[#0b1828] placeholder:text-[#6b7280]"
                    placeholder="예: 압력-1"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-[12px]">
                <div className="pb-[2px] font-['Pretendard',sans-serif] text-[14px] leading-[normal] text-[color:var(--black_500,#485b77)]">
                  단위
                </div>
                <div className="relative w-[192px]">
                  <select
                    className="appearance-none h-[40px] w-full bg-[#f8fafc] border border-[#e2e8f0] rounded-[4px] pl-[12px] pr-[36px] font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_title,#0b1828)]"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as any)}
                  >
                    <option value="pressure">압력 (MPa)</option>
                    <option value="flow">유량 (L/min)</option>
                  </select>
                  <img alt="" className="pointer-events-none absolute right-[9px] top-1/2 -translate-y-1/2 w-[21px] h-[21px]" src={imgSelectCaret} />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-[12px]">
              <button
                type="button"
                className="h-[40px] rounded-[8px] bg-[var(--blue_icon,#1392ec)] px-[24px] text-white font-['Pretendard',sans-serif] text-[14px] leading-[20px]"
                onClick={onAdd}
              >
                추가
              </button>
              <button
                type="button"
                className="h-[40px] rounded-[8px] bg-[var(--gray_sidebar_stroke,#e2e8f0)] px-[24px] font-['Pretendard',sans-serif] text-[14px] leading-[20px] text-[color:var(--black_700,#2c3c53)]"
                onClick={onCancel}
              >
                취소
              </button>
            </div>
          </div>

          {/* Registered sensor list */}
          <div className="flex flex-col gap-[12px]">
            <div className="pb-[2px] font-['Pretendard',sans-serif] text-[14px] leading-[normal] text-[color:var(--black_500,#485b77)]">
              등록된 센서 ({registeredSensors.length})
            </div>

            <div className="flex flex-col gap-[8px]">
              {registeredSensors.map((s) =>
                editingId === s.id ? (
                  <div
                    key={s.id}
                    className="bg-white border border-[#e2e8f0] rounded-[8px] p-[17px] flex flex-col gap-[12px] min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between"
                  >
                    <div className="flex flex-1 flex-col gap-[12px] min-[640px]:flex-row min-[640px]:items-center min-[640px]:gap-[24px] min-w-0">
                      <div
                        className={`w-[4px] h-[32px] shrink-0 rounded-full self-start min-[640px]:self-center ${
                          editUnit === 'pressure' ? 'bg-[var(--green_sensor,#85b548)]' : 'bg-[var(--orange_sensor,#daa324)]'
                        }`}
                      />
                      <div className="flex flex-1 flex-wrap items-center gap-[12px] min-w-0">
                        <div className="flex items-center gap-[12px]">
                          <div className="pb-[2px] font-['Pretendard',sans-serif] text-[14px] leading-[normal] text-[color:var(--black_500,#485b77)] w-[25px] shrink-0">
                            라벨
                          </div>
                          <div className="h-[40px] w-[min(256px,100%)] bg-[#f8fafc] border border-[#e2e8f0] rounded-[4px] px-[13px] flex items-center">
                            <input
                              className="w-full bg-transparent outline-none font-['Pretendard',sans-serif] text-[14px] text-[#0b1828]"
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-[12px]">
                          <div className="pb-[2px] font-['Pretendard',sans-serif] text-[14px] leading-[normal] text-[color:var(--black_500,#485b77)] w-[25px] shrink-0">
                            단위
                          </div>
                          <div className="relative w-[192px] max-w-full">
                            <select
                              className="appearance-none h-[40px] w-full bg-[#f8fafc] border border-[#e2e8f0] rounded-[4px] pl-[12px] pr-[36px] font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_title,#0b1828)]"
                              value={editUnit}
                              onChange={(e) => setEditUnit(e.target.value as 'pressure' | 'flow')}
                            >
                              <option value="pressure">압력 (MPa)</option>
                              <option value="flow">유량 (L/min)</option>
                            </select>
                            <img
                              alt=""
                              className="pointer-events-none absolute right-[9px] top-1/2 -translate-y-1/2 w-[21px] h-[21px]"
                              src={imgSelectCaret}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-[4px] shrink-0">
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
                    className="bg-white border border-[#e2e8f0] rounded-[8px] p-[17px] flex items-center justify-between gap-[12px] min-w-0"
                  >
                    <div className="flex items-center gap-[16px] min-w-0 flex-1">
                      <div
                        className={`w-[4px] h-[32px] shrink-0 rounded-full ${
                          s.color === 'green' ? 'bg-[var(--green_sensor,#85b548)]' : 'bg-[var(--orange_sensor,#daa324)]'
                        }`}
                      />
                      <div className="flex min-w-0 flex-col gap-[2px] sm:flex-row sm:items-baseline sm:gap-[8px]">
                        <div className="font-['Pretendard',sans-serif] text-[16px] leading-[20px] text-[color:var(--black_700,#2c3c53)] truncate">
                          {s.label}
                        </div>
                        <div className="font-['Pretendard',sans-serif] text-[14px] leading-[normal] text-[color:var(--black_300,#7a89a1)] break-words">
                          {s.unitLabel}, {s.posText}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-[4px] shrink-0">
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
      </div>

      {/* Pagination */}
      <div className="mt-[18px] flex items-center justify-center gap-[51px] text-[16px] text-[#0b1828]">
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
    </div>

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
    </>
  )
}

