import { useMemo, useState } from 'react'

import { drawingSensorAssets } from '../assets/drawing-sensor/drawingSensorAssets'
import { useActiveDrawing } from '../state/activeDrawing'

type RegisteredSensor = {
  id: string
  color: 'green' | 'orange'
  unitLabel: string
  posText: string
}

export default function DrawingSensorPage() {
  const { activeDrawing, activeIndex, total, goPrev, goNext } = useActiveDrawing()

  const { imgAttachFileAdd, imgChevronLeft, imgChevronRight, imgSelectCaret, imgEdit, imgDelete } = drawingSensorAssets

  const drawingName = activeDrawing?.name ?? '도면'
  const page = total <= 0 ? 0 : activeIndex + 1

  const [label, setLabel] = useState('')
  const [unit, setUnit] = useState<'pressure' | 'flow' | 'gas'>('pressure')
  const [enabled, setEnabled] = useState(true)

  const initialRegisteredSensors = useMemo<RegisteredSensor[]>(
    () => [
      { id: 'S1773688338279', color: 'green', unitLabel: '압력 (MPa)', posText: '(13.714%, 19.953%)' },
      { id: 'S1773691967926', color: 'orange', unitLabel: '유량 (L/min)', posText: '(55.715%, 53.038%)' },
    ],
    [],
  )
  const [registeredSensors, setRegisteredSensors] = useState<RegisteredSensor[]>(initialRegisteredSensors)

  const unitLabel =
    unit === 'pressure' ? '압력 (MPa)' : unit === 'flow' ? '유량 (L/min)' : '가스 (ppm)'
  const unitColor: RegisteredSensor['color'] = unit === 'pressure' ? 'green' : 'orange'

  const onAdd = () => {
    const id = `S${Date.now()}`
    const posText = '(—, —)'
    setRegisteredSensors((prev) => [
      ...prev,
      {
        id,
        color: unitColor,
        unitLabel,
        posText,
      },
    ])
  }

  const onCancel = () => {
    setLabel('')
    setUnit('pressure')
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
                    <option value="gas">가스 (ppm)</option>
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
              {registeredSensors.map((s) => (
                <div key={s.id} className="bg-white border border-[#e2e8f0] rounded-[8px] p-[17px] flex items-center justify-between">
                  <div className="flex items-center gap-[16px]">
                    <div
                      className={`w-[4px] h-[32px] rounded-full ${
                        s.color === 'green' ? 'bg-[var(--green_sensor,#85b548)]' : 'bg-[var(--orange_sensor,#daa324)]'
                      }`}
                    />
                    <div className="flex items-baseline gap-[8px] whitespace-nowrap">
                      <div className="font-['Pretendard',sans-serif] text-[16px] leading-[20px] text-[color:var(--black_700,#2c3c53)]">{s.id}</div>
                      <div className="font-['Pretendard',sans-serif] text-[14px] leading-[normal] text-[color:var(--black_300,#7a89a1)]">
                        — {s.unitLabel}, {s.posText}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-[4px]">
                    <button type="button" className="w-[20px] h-[20px] flex items-center justify-center" aria-label="센서 편집">
                      <img alt="" className="block w-[20px] h-[20px]" src={imgEdit} />
                    </button>
                    <button type="button" className="w-[20px] h-[20px] flex items-center justify-center" aria-label="센서 삭제">
                      <img alt="" className="block w-[20px] h-[20px]" src={imgDelete} />
                    </button>
                  </div>
                </div>
              ))}
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
  )
}

