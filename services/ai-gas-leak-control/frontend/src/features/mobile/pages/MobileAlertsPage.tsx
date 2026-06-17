import { useCallback, useEffect, useState } from 'react'

import { fetchAlarmHistory } from '../api/mobileApi'
import { RiskBanner } from '../components/RiskBanner'
import { useMobileGasState } from '../model/useMobileGasState'

type AlarmRow = {
  at?: string
  channel?: string
  message?: string
  sent?: boolean
}

export default function MobileAlertsPage() {
  const { state } = useMobileGasState()
  const [rows, setRows] = useState<AlarmRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await fetchAlarmHistory(50)
      setRows(Array.isArray(data) ? data : [])
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '알림 이력을 불러오지 못했습니다.')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(id)
  }, [load])

  return (
    <section className="space-y-4">
      <RiskBanner state={state} />

      <p className="text-[13px] text-[#64748b]">
        위험 단계 상승 시 브라우저 알림·진동이 동작합니다. (설정에서 푸시 허용 필요)
      </p>

      {error && <p className="text-[13px] text-[#b91c1c]">{error}</p>}

      <ul className="space-y-2">
        {rows.length === 0 ? (
          <li className="text-[14px] text-[#64748b]">최근 경보 이력이 없습니다.</li>
        ) : (
          rows.map((row, i) => (
            <li
              key={`${row.at}-${i}`}
              className="rounded-[10px] border border-[#e2e8f0] bg-white px-3 py-2 text-[13px]"
            >
              <p className="font-medium text-[#0b1828]">{row.message || '알림'}</p>
              <p className="mt-1 text-[#64748b]">
                {row.channel} · {row.at ? new Date(row.at).toLocaleString('ko-KR') : ''}
              </p>
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
