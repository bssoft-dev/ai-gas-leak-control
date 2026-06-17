import type { MobileGasState } from '../model/useMobileGasState'

const LEVEL_STYLE: Record<number, string> = {
  0: 'bg-[#e8f4fc] text-[#0b1828] border-[#c5dff5]',
  1: 'bg-[#fff8e6] text-[#7a5b00] border-[#f5e6a8]',
  2: 'bg-[#fff1e6] text-[#9a3412] border-[#fed7aa]',
  3: 'bg-[#fee2e2] text-[#991b1b] border-[#fecaca]',
}

const LEVEL_LABEL: Record<number, string> = {
  0: '정상',
  1: '주의 (Level 1)',
  2: '경고 (Level 2)',
  3: '위험 (Level 3)',
}

export function RiskBanner({ state }: { state: MobileGasState | null }) {
  if (!state) {
    return (
      <div className="rounded-[10px] border border-[#e2e8f0] bg-[#f1f5f9] px-4 py-3 text-[#64748b]" role="status">
        상태 불러오는 중…
      </div>
    )
  }

  const level = state.riskLevel ?? 0
  return (
    <div
      className={`rounded-[10px] border px-4 py-3 ${LEVEL_STYLE[level] ?? LEVEL_STYLE[0]}`}
      role="status"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-semibold">{LEVEL_LABEL[level] ?? '정상'}</span>
        {state.valveClosed && (
          <span className="rounded-full bg-[#991b1b] px-2 py-0.5 text-[11px] font-medium text-white">
            밸브 차단
          </span>
        )}
      </div>
      {state.riskMessage && <p className="mt-1 text-[13px] leading-snug">{state.riskMessage}</p>}
      {state.autoShutdownDeadline && !state.valveClosed && (
        <p className="mt-1 text-[12px] opacity-90">
          자동 차단 예정: {formatDeadline(state.autoShutdownDeadline)}
        </p>
      )}
    </div>
  )
}

function formatDeadline(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}
