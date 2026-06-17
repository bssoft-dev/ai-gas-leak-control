import { RiskBanner } from '../components/RiskBanner'
import { SensorValueCard } from '../components/SensorValueCard'
import { useMobileGasState } from '../model/useMobileGasState'

export default function MobileHomePage() {
  const { state, sensors, error, refresh } = useMobileGasState()

  return (
    <section className="space-y-4">
      <RiskBanner state={state} />

      {error && (
        <p className="text-[13px] text-[#b91c1c]">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-2 text-[13px]">
        <Stat label="금일 사용량" value={`${(state?.dailyGasLiters ?? 0).toFixed(1)} L`} />
        <Stat label="엣지 부하" value={`${(state?.edgeLoadPercent ?? 0).toFixed(0)} %`} />
        <Stat label="밸브" value={state?.valveClosed ? '차단' : '개방'} danger={state?.valveClosed} />
        <Stat label="사이렌" value={state?.alarmSirenOn ? 'ON' : 'OFF'} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-[#0b1828]">실시간 센서</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[13px] font-medium text-[#2563eb]"
        >
          새로고침
        </button>
      </motion>

      <div className="grid gap-2">
        {sensors.length === 0 ? (
          <p className="text-[14px] text-[#64748b]">등록된 센서가 없습니다.</p>
        ) : (
          sensors.map((s) => <SensorValueCard key={s.id} sensor={s} />)
        )}
      </motion>
    </section>
  )
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-[8px] border border-[#e2e8f0] bg-white px-3 py-2">
      <p className="text-[11px] text-[#64748b]">{label}</p>
      <p className={`text-[15px] font-semibold ${danger ? 'text-[#dc2626]' : 'text-[#0b1828]'}`}>{value}</p>
    </motion>
  )
}
