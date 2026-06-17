import { useCallback, useEffect, useState } from 'react'
import { DefaultService } from '../../../api/services/DefaultService'

/** 선택된 엣지에서 사용 가능한 센서 ID 목록을 가져옵니다. */
export function useAvailableSensors(edgeId: string | null) {
  const [sensorIds, setSensorIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!edgeId) {
      setSensorIds([])
      return
    }
    setLoading(true)
    try {
      const data = await DefaultService.getGasLeakAvailableSensorsApiGasLeakAvailableSensorsGet(edgeId) as string[]
      if (Array.isArray(data)) {
        setSensorIds(data)
      }
    } catch {
      if (import.meta.env.DEV) {
        setSensorIds(['S1_Pressure', 'S2_O2', 'S3_LPG'])
      }
    } finally {
      setLoading(false)
    }
  }, [edgeId])

  useEffect(() => {
    void load()
    // 10초마다 갱신
    const id = window.setInterval(() => void load(), 10000)
    return () => window.clearInterval(id)
  }, [load])

  return { sensorIds, loading, reload: load }
}
