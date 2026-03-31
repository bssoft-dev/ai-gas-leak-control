import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { DefaultService } from '../api/services/DefaultService'

export type DrawingItem = {
  id: string
  name: string
  status?: 'ok' | 'warn' | 'danger'
}

export type DrawingSensor = {
  id: string
  left: number
  top: number
  variant: 'green' | 'yellow'
}

export type DrawingDetail = {
  id: string
  name: string
  imagePath: string
  sensors: DrawingSensor[]
}

type ActiveDrawingContextValue = {
  drawings: DrawingItem[]
  activeDrawingId: string
  setActiveDrawingId: (id: string) => void
  activeDrawing: DrawingDetail | null
  isLoadingDrawings: boolean
  isLoadingActiveDrawing: boolean
  errorDrawings: string | null
  errorActiveDrawing: string | null
  activeIndex: number
  total: number
  goPrev: () => void
  goNext: () => void
}

const ActiveDrawingContext = createContext<ActiveDrawingContextValue | null>(null)

export function ActiveDrawingProvider({ children }: { children: React.ReactNode }) {
  const [drawings, setDrawings] = useState<DrawingItem[]>([])
  const [activeDrawingId, setActiveDrawingId] = useState<string>('')
  const [activeDrawing, setActiveDrawing] = useState<DrawingDetail | null>(null)

  const [isLoadingDrawings, setIsLoadingDrawings] = useState(false)
  const [isLoadingActiveDrawing, setIsLoadingActiveDrawing] = useState(false)
  const [errorDrawings, setErrorDrawings] = useState<string | null>(null)
  const [errorActiveDrawing, setErrorActiveDrawing] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setIsLoadingDrawings(true)
    setErrorDrawings(null)

    DefaultService.getGasLeakDrawingsApiGasLeakDrawingsGet()
      .then((res) => {
        if (!mounted) return
        const list = Array.isArray(res)
          ? res.map((d: any) => ({
              id: String(d.id),
              name: String(d.name ?? d.filename ?? d.id),
              status: 'ok' as const,
            }))
          : []

        setDrawings(list)
        if (!activeDrawingId && list[0]?.id) setActiveDrawingId(list[0].id)
        setErrorDrawings(null)
      })
      .catch((e) => {
        if (!mounted) return
        setErrorDrawings(e?.message ?? String(e))
      })
      .finally(() => {
        if (!mounted) return
        setIsLoadingDrawings(false)
      })

    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!activeDrawingId) return
    let mounted = true
    setIsLoadingActiveDrawing(true)
    setErrorActiveDrawing(null)

    DefaultService.getGasLeakDrawingApiGasLeakDrawingsDrawingIdGet(activeDrawingId)
      .then((res) => {
        if (!mounted) return
        setActiveDrawing(res as DrawingDetail)
        setErrorActiveDrawing(null)
      })
      .catch((e) => {
        if (!mounted) return
        setErrorActiveDrawing(e?.message ?? String(e))
        setActiveDrawing(null)
      })
      .finally(() => {
        if (!mounted) return
        setIsLoadingActiveDrawing(false)
      })

    return () => {
      mounted = false
    }
  }, [activeDrawingId])

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
      activeDrawing,
      isLoadingDrawings,
      isLoadingActiveDrawing,
      errorDrawings,
      errorActiveDrawing,
      activeIndex,
      total,
      goPrev,
      goNext,
    }
  }, [activeDrawing, activeDrawingId, activeIndex, drawings, errorActiveDrawing, errorDrawings, isLoadingActiveDrawing, isLoadingDrawings, total])

  return <ActiveDrawingContext.Provider value={value}>{children}</ActiveDrawingContext.Provider>
}

export function useActiveDrawing() {
  const ctx = useContext(ActiveDrawingContext)
  if (!ctx) throw new Error('useActiveDrawing must be used within ActiveDrawingProvider')
  return ctx
}

