import type { MobileSensor } from '../model/useMobileGasState'

export function SensorValueCard({ sensor }: { sensor: MobileSensor }) {
  const isConcentration = sensor.sensor_type === 'concentration' || sensor.unit === '%'
  const tone =
    isConcentration && sensor.value >= 2.5
      ? 'border-[#fecaca] bg-[#fff5f5]'
      : 'border-[#e2e8f0] bg-white'

  return (
    <article className={`rounded-[10px] border px-4 py-3 shadow-sm ${tone}`}>
      <p className="text-[12px] font-medium text-[#64748b]">{sensor.label}</p>
      <p className="mt-1 font-['Pretendard',sans-serif] text-[22px] font-semibold tabular-nums text-[#0b1828]">
        {Number.isFinite(sensor.value) ? sensor.value.toFixed(2) : '--'}
        <span className="ml-1 text-[14px] font-normal text-[#64748b]">{sensor.unit}</span>
      </p>
    </article>
  )
}
