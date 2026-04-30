import { drawingSensorAssets } from '../assets/drawingSensorAssets'
import type { RegisteredSensor } from '../model/registeredSensor'

type SensorManagementSidebarProps = {
  enabled: boolean
  label: string
  unit: 'pressure' | 'flow'
  registeredSensors: RegisteredSensor[]
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
}

export function SensorManagementSidebar({
  enabled,
  label,
  unit,
  registeredSensors,
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
}: SensorManagementSidebarProps) {
  const { imgSelectCaret, imgEdit, imgDelete } = drawingSensorAssets

  return (
    <aside className="col-span-12 flex min-h-0 min-w-0 flex-col lg:col-span-3 lg:h-full">
      <div className="flex min-h-[40px] shrink-0 items-center font-['Pretendard',sans-serif] text-[16px] font-semibold leading-[1.2] text-[color:var(--blue_primary_800,#4370ac)] -translate-y-[2px]">
        등록된 센서 ({registeredSensors.length})
      </div>
      <div className="mt-[12px] flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)]">
          <div className="shrink-0 border-b border-[#e2e8f0] bg-[#fafafa] p-[12px]">
            <div className="flex flex-col gap-[12px]">
              <div>
                <div className="pb-[4px] font-['Pretendard',sans-serif] text-[13px] leading-[normal] text-[color:var(--black_500,#485b77)]">
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
                <div className="pb-[4px] font-['Pretendard',sans-serif] text-[13px] leading-[normal] text-[color:var(--black_500,#485b77)]">
                  단위
                </div>
                <div className="relative w-full">
                  <select
                    className="h-[40px] w-full appearance-none rounded-[4px] border border-[#e2e8f0] bg-white pl-[12px] pr-[36px] font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_title,#0b1828)] disabled:cursor-not-allowed disabled:text-[#94a3b8]"
                    value={unit}
                    onChange={(e) => onUnitChange(e.target.value as 'pressure' | 'flow')}
                    disabled={!enabled}
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
                  className="h-[40px] flex-1 rounded-[8px] bg-[var(--blue_icon,#1392ec)] font-['Pretendard',sans-serif] text-[14px] leading-[20px] text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onAdd}
                  disabled={!enabled}
                >
                  추가
                </button>
                <button
                  type="button"
                  className="h-[40px] flex-1 rounded-[8px] bg-[var(--gray_sidebar_stroke,#e2e8f0)] font-['Pretendard',sans-serif] text-[14px] leading-[20px] text-[color:var(--black_700,#2c3c53)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onCancel}
                  disabled={!enabled}
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
            {registeredSensors.map((sensor) =>
              editingId === sensor.id ? (
                <div
                  key={sensor.id}
                  className="flex flex-col gap-[12px] rounded-[8px] border border-[#e2e8f0] bg-white p-[14px]"
                >
                  <div className="flex min-w-0 flex-col gap-[12px]">
                    <div
                      className={`h-[32px] w-[4px] shrink-0 self-start rounded-full ${
                        editUnit === 'pressure'
                          ? 'bg-[var(--green_sensor,#85b548)]'
                          : 'bg-[var(--orange_sensor,#daa324)]'
                      }`}
                    />
                    <div className="flex min-w-0 flex-col gap-[12px]">
                      <div className="flex flex-col gap-[8px]">
                        <div className="font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_500,#485b77)]">
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
                        <div className="relative w-full">
                          <select
                            className="h-[40px] w-full appearance-none rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] pl-[12px] pr-[36px] font-['Pretendard',sans-serif] text-[14px] text-[color:var(--black_title,#0b1828)] disabled:cursor-not-allowed disabled:text-[#94a3b8]"
                            value={editUnit}
                            onChange={(e) => onEditUnitChange(e.target.value as 'pressure' | 'flow')}
                            disabled={!enabled}
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
                      className="flex h-[28px] w-[28px] items-center justify-center rounded-[4px] hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="수정 저장"
                      onClick={onSaveEdit}
                      disabled={!enabled}
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
                      className="group flex h-[28px] w-[28px] items-center justify-center rounded-[4px] hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="센서 삭제"
                      onClick={() => onRequestDelete(sensor.id)}
                      disabled={!enabled}
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
                  key={sensor.id}
                  className="flex min-w-0 flex-col gap-[10px] rounded-[8px] border border-[#e2e8f0] bg-white p-[14px]"
                >
                  <div className="flex min-w-0 items-start gap-[12px]">
                    <div
                      className={`mt-[2px] h-[32px] w-[4px] shrink-0 rounded-full ${
                        sensor.color === 'green'
                          ? 'bg-[var(--green_sensor,#85b548)]'
                          : 'bg-[var(--orange_sensor,#daa324)]'
                      }`}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
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
                  </div>
                  <div className="flex justify-end gap-[4px]">
                    <button
                      type="button"
                      className="flex h-[28px] w-[28px] items-center justify-center rounded-[4px] hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="센서 편집"
                      onClick={() => onStartEdit(sensor)}
                      disabled={!enabled}
                    >
                      <img alt="" className="block h-[20px] w-[20px]" src={imgEdit} />
                    </button>
                    <button
                      type="button"
                      className="group flex h-[28px] w-[28px] items-center justify-center rounded-[4px] hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="센서 삭제"
                      onClick={() => onRequestDelete(sensor.id)}
                      disabled={!enabled}
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
    </aside>
  )
}
