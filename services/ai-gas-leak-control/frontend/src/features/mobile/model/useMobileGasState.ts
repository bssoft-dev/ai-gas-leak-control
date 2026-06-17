import { useCallback, useEffect, useState } from 'react'

import { DefaultService } from '../../../api/services/DefaultService'

export type MobileGasState = {
  valveClosed: boolean
  riskLevel: number
  riskMessage: string | null
  alarmBeaconOn: boolean
  alarmSirenOn: boolean
  autoShutdownDeadline: string | null
  edgeLoadPercent: number
  dailyGasLiters: number
}

export type MobileSensor = {
  id: string
  label: string
  value: number
  unit: string
  sensor_type?: string
}

const POLL_MS = 2500

function mapState(raw: Record<string, unknown>): MobileGasState {
  return {
    valveClosed: Boolean(raw.valve_closed ?? raw.valveClosed),
    riskLevel: Number(raw.risk_level ?? raw.riskLevel ?? 0),
    riskMessage: (raw.risk_message as string) ?? (raw.riskMessage as string) ?? null,
    alarmBeaconOn: Boolean(raw.alarm_beacon_on ?? raw.alarmBeaconOn),
    alarmSirenOn: Boolean(raw.alarm_siren_on ?? raw.alarmSirenOn),
    autoShutdownDeadline:
      (raw.auto_shutdown_deadline as string) ?? (raw.autoShutdownDeadline as string) ?? null,
    edgeLoadPercent: Number(raw.edge_load_percent ?? raw.edgeLoadPercent ?? 0),
    dailyGasLiters: Number(raw.daily_gas_liters ?? raw.dailyGasLiters ?? 0),
  }
}

export function useMobileGasState() {
  const [state, setState] = useState<MobileGasState | null>(null)
  const [sensors, setSensors] = useState<MobileSensor[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [stateRes, sensorsRes] = await Promise.all([
        DefaultService.getGasLeakStateApiGasLeakStateGet(),
        DefaultService.getGasLeakSensorsApiGasLeakSensorsGet(),
      ])
      setState(mapState(stateRes as Record<string, unknown>))
      const list = Array.isArray(sensorsRes) ? sensorsRes : []
      setSensors(
        list.map((s: Record<string, unknown>) => ({
          id: String(s.id ?? ''),
          label: String(s.label ?? s.id ?? '센서'),
          value: Number(s.value ?? 0),
          unit: String(s.unit ?? ''),
          sensor_type: s.sensor_type as string | undefined,
        })),
      )
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  return { state, sensors, error, refresh }
}
