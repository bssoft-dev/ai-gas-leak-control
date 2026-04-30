import { useEffect, useMemo, useState } from 'react'

import { drawingSensorAssets } from '../assets/drawingSensorAssets'
import type { RegisteredSensor } from '../model/registeredSensor'

type SensorManagementSidebarProps = {
  enabled: boolean
  label: string
  unit: 'pressure' | 'flow'
  registeredSensors: RegisteredSensor[]
  selectedSensorId: string | null
  editingId: string | null
  editLabel: string
  editUnit: 'pressure' | 'flow'
  onLabelChange: (value: string) => void
  onUnitChange: (value: 'pressure' | 'flow') => void
  onAdd: () => void
  onCancel: () => void
  onStartEdit: (sensor: RegisteredSensor) => void
  onEditLabelChange: (value: string) => void
  onEditUnitChange: (value: 'pressure' | 'flow') => void
  onSaveEdit: () => void
  onRequestDelete: (sensorId: string) => void
  onSelectSensor: (sensorId: string) => void
}

const UNIT_OPTIONS = [
  { value: 'pressure', label: '압력 (MPa)' },
  { value: 'flow', label: '유량 (L/min)' },
] as const

function UnitSelect({
  value,
  onChange,
  disabled,
  caretSrc,
  surface = 'white',
}: {
  value: 'pressure' | 'flow'
  onChange: (value: 'pressure' | 'flow') => void
  disabled: boolean
  caretSrc: string
  surface?: 'white' | 'muted'
}) {
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => UNIT_OPTIONS.find((option) => option.value === value) ?? UNIT_OPTIONS[0], [value])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-unit-select-root]')) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const surfaceClass = surface === 'muted' ? 'bg-[#f8fafc]' : 'bg-white'

  return (
    <div className="relative mt-[2px] w-full" data-unit-select-root>
      <button
        type="button"
        disabled={disabled}
        className={`flex h-[40px] w-full items-center justify-between rounded-[4px] border border-[#e2e8f0] ${surfaceClass} pl-[12px] pr-[36px] font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_title,#0b1828)] outline-none transition hover:bg-[#f8fafc] focus:border-[#e2e8f0] focus:[outline:0] focus-visible:[outline:0] focus-visible:[box-shadow:none] disabled:cursor-not-allowed disabled:text-[#94a3b8]`}
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev)
        }}
      >
        <span className="min-w-0 truncate text-left">{selected.label}</span>
        <img
          alt=""
          className={`pointer-events-none absolute right-[13px] top-1/2 h-[10px] w-[10px] -translate-y-1/2 opacity-75 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          src={caretSrc}
        />
      </button>

      {open && !disabled && (
        <div className="absolute left-0 top-full z-30 mt-[2px] w-full overflow-hidden rounded-[4px] border border-[#e2e8f0] bg-white p-[4px] shadow-[0px_10px_24px_rgba(15,23,42,0.12)]">
          {UNIT_OPTIONS.map((option) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                className={`flex h-[34px] w-full items-center rounded-[4px] px-[10px] text-left font-['Pretendard',sans-serif] text-[14px] transition ${
                  isSelected ? 'bg-[#eef5fb] font-semibold text-[#4370ac]' : 'text-[#0b1828] hover:bg-[#f8fafc]'
                }`}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SensorManagementSidebar({
  enabled,
  label,
  unit,
  registeredSensors,
  selectedSensorId,
  editingId,
  editLabel,
  editUnit,
  onLabelChange,
  onUnitChange,
  onAdd,
  onCancel,
  onStartEdit,
  onEditLabelChange,
  onEditUnitChange,
  onSaveEdit,
  onRequestDelete,
  onSelectSensor,
}: SensorManagementSidebarProps) {
  const { imgSelectCaret, imgEdit, imgDelete } = drawingSensorAssets

  return (
    <aside className="col-span-12 flex min-h-0 min-w-0 flex-col xl:col-span-3 xl:h-full">
      <div className="flex min-h-[40px] shrink-0 items-center font-['Pretendard',sans-serif] text-[16px] font-semibold leading-[1.2] text-[color:var(--blue_primary_800,#4370ac)] -translate-y-[2px]">
        등록된 센서 ({registeredSensors.length})
      </div>
      <div className="mt-[8px] flex min-h-0 flex-1 flex-col">
        <div className="flex max-h-[560px] min-h-[320px] flex-1 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.12),0px_1px_3px_1px_rgba(0,0,0,0.05)] md:max-h-[640px] xl:max-h-none xl:min-h-0">
          <div className="shrink-0 border-b border-[#e2e8f0] bg-[#fafafa] p-[12px]">
            <div className="flex flex-col gap-[12px]">
              <div>
                <div className="pb-[2px] font-['Pretendard',sans-serif] text-[13px] leading-[normal] text-[color:var(--black_500,#485b77)]">
                  라벨
                </div>
                <div className="flex h-[40px] w-full items-center rounded-[4px] border border-[#e2e8f0] bg-white px-[13px]">
                  <input
                    className="w-full bg-transparent font-['Pretendard',sans-serif] text-[14px] text-[#0b1828] outline-none placeholder:text-[#6b7280] disabled:cursor-not-allowed disabled:text-[#94a3b8]"
                    placeholder="예: 압력-1"
                    value={label}
                    onChange={(e) => onLabelChange(e.target.value)}
                    disabled={!enabled}
                  />
                </div>
              </div>

              <div>
                <div className="font-['Pretendard',sans-serif] text-[13px] leading-[normal] text-[color:var(--black_500,#485b77)]">
                  단위
                </div>
                <div className="hidden">
                  <select
                    className="h-[40px] w-full appearance-none rounded-[4px] border border-[#e2e8f0] bg-white pl-[12px] pr-[36px] font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_title,#0b1828)] outline-none focus:border-[#e2e8f0] focus:ring-0 focus:ring-offset-0 focus:[outline:0] focus-visible:[outline:0] focus-visible:[box-shadow:none] disabled:cursor-not-allowed disabled:text-[#94a3b8]"
                    value={unit}
                    onChange={(e) => onUnitChange(e.target.value as 'pressure' | 'flow')}
                    disabled={!enabled}
                  >
                    <option value="pressure">압력 (MPa)</option>
                    <option value="flow">유량 (L/min)</option>
                  </select>
                  <img
                    alt=""
                    className="pointer-events-none absolute right-[13px] top-1/2 h-[10px] w-[10px] -translate-y-1/2 opacity-75"
                    src={imgSelectCaret}
                  />
                </div>
                <UnitSelect value={unit} onChange={onUnitChange} disabled={!enabled} caretSrc={imgSelectCaret} />
              </div>

              <div className="flex gap-[8px]">
                <button
                  type="button"
                  className={`h-[40px] flex-1 rounded-[4px] bg-[var(--blue_icon,#1392ec)] font-['Pretendard',sans-serif] text-[14px] leading-[20px] text-white ${!enabled ? 'cursor-not-allowed opacity-60' : ''}`}
                  onClick={onAdd}
                >
                  추가
                </button>
                <button
                  type="button"
                  className={`h-[40px] flex-1 rounded-[4px] bg-[var(--gray_sidebar_stroke,#e2e8f0)] font-['Pretendard',sans-serif] text-[14px] leading-[20px] text-[color:var(--black_700,#2c3c53)] ${!enabled ? 'cursor-not-allowed opacity-60' : ''}`}
                  onClick={onCancel}
                >
                  취소
                </button>
              </div>
            </div>
          </div>

          <div className="shrink-0 px-[12px] pt-[10px] pb-[6px] font-['Pretendard',sans-serif] text-[12px] leading-[normal] text-[color:var(--black_500,#485b77)]">
            목록 ({registeredSensors.length})
          </div>

          <div className="notion-scrollbar flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto px-[12px] pt-[8px] pb-[12px]">
            {registeredSensors.map((sensor) =>
              editingId === sensor.id ? (
                <div
                  key={sensor.id}
                  className="flex flex-col gap-[10px] rounded-[8px] border border-[#e2e8f0] bg-white p-[12px]"
                >
                  <div className="flex min-w-0 flex-col gap-[12px]">
                    <div
                      className={`h-[40px] w-[4px] shrink-0 self-start rounded-full ${
                        editUnit === 'pressure'
                          ? 'bg-[var(--green_sensor,#34d399)]'
                          : 'bg-[var(--orange_sensor,#fbbf24)]'
                      }`}
                    />
                    <div className="flex min-w-0 flex-col gap-[12px]">
                      <div className="flex flex-col gap-[8px]">
                        <div className="pb-[2px] font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_500,#485b77)]">
                          라벨
                        </div>
                        <div className="flex h-[40px] items-center rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] px-[13px]">
                          <input
                            className="w-full bg-transparent font-['Pretendard',sans-serif] text-[14px] text-[#0b1828] outline-none disabled:cursor-not-allowed disabled:text-[#94a3b8]"
                            value={editLabel}
                            onChange={(e) => onEditLabelChange(e.target.value)}
                            disabled={!enabled}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-[8px]">
                        <div className="font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_500,#485b77)]">
                          단위
                        </div>
                        <div className="hidden">
                          <select
                            className="h-[40px] w-full appearance-none rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] pl-[12px] pr-[36px] font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_title,#0b1828)] outline-none focus:border-[#e2e8f0] focus:ring-0 focus:ring-offset-0 focus:[outline:0] focus-visible:[outline:0] focus-visible:[box-shadow:none] disabled:cursor-not-allowed disabled:text-[#94a3b8]"
                            value={editUnit}
                            onChange={(e) => onEditUnitChange(e.target.value as 'pressure' | 'flow')}
                            disabled={!enabled}
                          >
                            <option value="pressure">압력 (MPa)</option>
                            <option value="flow">유량 (L/min)</option>
                          </select>
                          <img
                            alt=""
                            className="pointer-events-none absolute right-[13px] top-1/2 h-[10px] w-[10px] -translate-y-1/2 opacity-75"
                            src={imgSelectCaret}
                          />
                        </div>
                        <UnitSelect
                          value={editUnit}
                          onChange={onEditUnitChange}
                          disabled={!enabled}
                          caretSrc={imgSelectCaret}
                          surface="muted"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-[4px]">
                    <button
                      type="button"
                      className={`flex h-[28px] w-[28px] items-center justify-center rounded-[4px] hover:bg-[#eff6ff] ${!enabled ? 'cursor-not-allowed opacity-50' : ''}`}
                      aria-label="수정 저장"
                      onClick={onSaveEdit}
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
                      className={`group flex h-[28px] w-[28px] items-center justify-center rounded-[4px] transition-colors hover:bg-[#f1f5f9] active:bg-[#e2e8f0] ${!enabled ? 'cursor-not-allowed opacity-50' : ''}`}
                      aria-label="센서 삭제"
                      onClick={() => onRequestDelete(sensor.id)}
                    >
                      <img
                        alt=""
                        className="block h-[20px] w-[20px] opacity-80 transition-opacity group-hover:opacity-100"
                        src={imgDelete}
                      />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={sensor.id}
                  role="button"
                  tabIndex={0}
                  className={`flex min-w-0 flex-col gap-[8px] rounded-[8px] border bg-white p-[12px] outline-none transition-colors ${
                    selectedSensorId === sensor.id
                      ? sensor.color === 'green'
                        ? 'border-[#34d399] ring-2 ring-[rgba(52,211,153,0.30)]'
                        : 'border-[#fbbf24] ring-2 ring-[rgba(251,191,36,0.30)]'
                      : 'border-[#e2e8f0] hover:bg-[#f8fafc]'
                  }`}
                  onClick={() => onSelectSensor(sensor.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectSensor(sensor.id)
                    }
                  }}
                >
                  <div className="flex min-w-0 flex-1 gap-[12px]">
                    <div
                      className={`w-[4px] shrink-0 self-stretch rounded-full ${
                        sensor.color === 'green'
                          ? 'bg-[var(--green_sensor,#34d399)]'
                          : 'bg-[var(--orange_sensor,#fbbf24)]'
                      }`}
                      aria-hidden
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
                      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                        <div className="truncate font-['Pretendard',sans-serif] text-[15px] leading-[20px] text-[color:var(--black_700,#2c3c53)]">
                          {sensor.label}
                        </div>
                        <div className="break-words font-['Pretendard',sans-serif] text-[12px] leading-[normal] text-[color:var(--black_300,#7a89a1)]">
                          {sensor.unitLabel}
                        </div>
                        <div className="break-all font-['Pretendard',sans-serif] text-[11px] leading-[normal] text-[color:var(--black_300,#7a89a1)]">
                          {sensor.posText}
                        </div>
                      </div>

                      <div className="flex justify-end gap-[4px]">
                        <button
                          type="button"
                          className={`group flex h-[28px] w-[28px] items-center justify-center rounded-[4px] transition-colors hover:bg-[#f1f5f9] active:bg-[#e2e8f0] ${!enabled ? 'cursor-not-allowed opacity-50' : ''}`}
                          aria-label="센서 편집"
                          onClick={(e) => {
                            e.stopPropagation()
                            onStartEdit(sensor)
                          }}
                        >
                          <img
                            alt=""
                            className="block h-[20px] w-[20px] opacity-80 transition-opacity group-hover:opacity-100"
                            src={imgEdit}
                          />
                        </button>
                        <button
                          type="button"
                          className={`group flex h-[28px] w-[28px] items-center justify-center rounded-[4px] transition-colors hover:bg-[#f1f5f9] active:bg-[#e2e8f0] ${!enabled ? 'cursor-not-allowed opacity-50' : ''}`}
                          aria-label="센서 삭제"
                          onClick={(e) => {
                            e.stopPropagation()
                            onRequestDelete(sensor.id)
                          }}
                        >
                          <img
                            alt=""
                            className="block h-[20px] w-[20px] opacity-80 transition-opacity group-hover:opacity-100"
                            src={imgDelete}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
