import { useCallback, useEffect, useState } from 'react'
import { DefaultService } from '../../../api/services/DefaultService'

export type EdgeInfo = {
  edge_id: string
  ip: string | null
  port: number
  registered_at: string | null
}

/** 등록된 엣지 컨트롤러 목록을 주기적으로 폴링합니다. */
export function useEdgeList(pollMs = 5000) {
  const [edges, setEdges] = useState<EdgeInfo[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await DefaultService.getGasLeakEdgesApiGasLeakEdgesGet() as EdgeInfo[]
      if (Array.isArray(data)) {
        setEdges(data)
      }
    } catch {
      // 백엔드 없을 때 DEV 더미
      if (import.meta.env.DEV) {
        setEdges([{ edge_id: 'edge-01', ip: '127.0.0.1', port: 26030, registered_at: null }])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), pollMs)
    return () => window.clearInterval(id)
  }, [load, pollMs])

  return { edges, loading, reload: load }
}
