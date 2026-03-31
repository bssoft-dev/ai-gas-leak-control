import React, { createContext, useContext, useMemo, useState } from 'react'

export type DrawingItem = {
  id: string
  name: string
  status?: 'ok' | 'warn' | 'danger'
}

type ActiveDrawingContextValue = {
  drawings: DrawingItem[]
  activeDrawingId: string
  setActiveDrawingId: (id: string) => void
  activeIndex: number
  total: number
  goPrev: () => void
  goNext: () => void
}

const ActiveDrawingContext = createContext<ActiveDrawingContextValue | null>(null)

export function ActiveDrawingProvider({ children }: { children: React.ReactNode }) {
  const drawings = useMemo<DrawingItem[]>(
    () => [
      { id: 'd1', name: '도면 1', status: 'ok' },
      { id: 'd2', name: '도면 2', status: 'ok' },
      { id: 'd3', name: '도면 3', status: 'ok' },
    ],
    [],
  )

  const [activeDrawingId, setActiveDrawingId] = useState(drawings[0]?.id ?? 'd1')

  const activeIndex = useMemo(() => Math.max(0, drawings.findIndex((d) => d.id === activeDrawingId)), [activeDrawingId, drawings])
  const total = drawings.length

  const value = useMemo<ActiveDrawingContextValue>(() => {
    const goPrev = () => {
      if (total <= 0) return
      const nextIdx = Math.max(0, activeIndex - 1)
      setActiveDrawingId(drawings[nextIdx]?.id ?? activeDrawingId)
    }

    const goNext = () => {
      if (total <= 0) return
      const nextIdx = Math.min(total - 1, activeIndex + 1)
      setActiveDrawingId(drawings[nextIdx]?.id ?? activeDrawingId)
    }

    return {
      drawings,
      activeDrawingId,
      setActiveDrawingId,
      activeIndex,
      total,
      goPrev,
      goNext,
    }
  }, [activeDrawingId, activeIndex, drawings, total])

  return <ActiveDrawingContext.Provider value={value}>{children}</ActiveDrawingContext.Provider>
}

export function useActiveDrawing() {
  const ctx = useContext(ActiveDrawingContext)
  if (!ctx) throw new Error('useActiveDrawing must be used within ActiveDrawingProvider')
  return ctx
}

