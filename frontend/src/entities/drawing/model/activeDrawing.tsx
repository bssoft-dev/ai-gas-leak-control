import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { OpenAPI } from '../../../api/core/OpenAPI'
import { DefaultService } from '../../../api/services/DefaultService'
import { useEventStream } from '../../../shared/events/EventStreamProvider'
import { getDrawingFileKind, type DrawingFileKind } from '../lib/drawingFileKind'
import { mockDrawingDetails } from '../../../mocks/data/drawingDetails'

const ACTIVE_DRAWING_IDS_STORAGE_KEY = 'ai-gas-leak-control.activeDrawingIds'
const HIDDEN_DEMO_DRAWING_IDS_STORAGE_KEY = 'ai-gas-leak-control.hiddenDemoDrawingIds'
const DEMO_DRAWINGS: DrawingItem[] = Object.values(mockDrawingDetails).map((drawing) => ({
  id: drawing.id,
  name: drawing.name,
  status: 'ok',
}))
const DEMO_DRAWING_ID_SET = new Set(DEMO_DRAWINGS.map((drawing) => drawing.id))

export type DrawingItem = {
  id: string
  name: string
  status?: 'ok' | 'warn' | 'danger'
  isActive?: boolean
}

export type DrawingSensor = {
  id: string
  left: number
  top: number
  variant: 'green' | 'yellow'
  label?: string
  unitLabel?: string
  /** percent: left/top는 도면 이미지 슬롯 내 0~100. 생략 시 레거시 픽셀(고정 설계 폭 기준)로 해석 */
  positionUnit?: 'percent' | 'legacy_px'
}

export type DrawingDetail = {
  id: string
  name: string
  imagePath: string
  fileKind?: DrawingFileKind
  sensors: DrawingSensor[]
}

type ActiveDrawingContextValue = {
  drawings: DrawingItem[]
  activeDrawingIds: string[]
  activeDrawingId: string
  setActiveDrawingId: (id: string) => void
  toggleDrawingActive: (id: string) => void
  refreshDrawings: (preferredActiveId?: string) => Promise<DrawingItem[]>
  removeDrawing: (id: string) => Promise<void>
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

function readStoredActiveDrawingIds(): string[] {
  return readStoredStringArray(ACTIVE_DRAWING_IDS_STORAGE_KEY)
}

function readStoredHiddenDemoDrawingIds(): string[] {
  return readStoredStringArray(HIDDEN_DEMO_DRAWING_IDS_STORAGE_KEY)
}

function readStoredStringArray(storageKey: string): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function normalizeSensorVariant(sensor: any): DrawingSensor['variant'] {
  return String(sensor?.sensor_type ?? '').toLowerCase() === 'flow' ? 'yellow' : 'green'
}

function normalizeSensorUnitLabel(sensor: any): string {
  const sensorType = String(sensor?.sensor_type ?? '').toLowerCase()
  if (sensorType === 'flow') return '유량 (L/min)'
  return `압력 (${String(sensor?.unit ?? 'MPa')})`
}

function normalizeDrawingDetailResponse(res: any, fallbackName?: string): DrawingDetail {
  const drawing = res?.drawing ?? res ?? {}
  const sensors = Array.isArray(res?.sensors) ? res.sensors : []
  const drawingId = String(drawing.id ?? '')

  return {
    id: drawingId,
    name: String(drawing.name ?? drawing.filename ?? fallbackName ?? drawingId),
    imagePath: `${OpenAPI.BASE}/api/gas-leak/drawings/${drawingId}/file`,
    fileKind: getDrawingFileKind(drawing.file_type, drawing.name ?? drawing.filename ?? fallbackName ?? drawingId),
    sensors: sensors.map((sensor: any) => ({
      id: String(sensor.id ?? sensor.label ?? crypto.randomUUID()),
      left: Number(sensor.x ?? 0) * 100,
      top: Number(sensor.y ?? 0) * 100,
      variant: normalizeSensorVariant(sensor),
      label: String(sensor.label ?? sensor.id ?? ''),
      unitLabel: normalizeSensorUnitLabel(sensor),
      positionUnit: 'percent' as const,
    })),
  }
}

function buildDrawingListWithDemos(res: any, activeDrawingIds: string[], hiddenDemoDrawingIds: string[]): DrawingItem[] {
  const apiList = Array.isArray(res)
    ? res.map((d: any) => ({
        id: String(d.id),
        name: String(d.name ?? d.filename ?? d.id),
        status: 'ok' as const,
      }))
    : []

  const knownIds = new Set(apiList.map((drawing) => drawing.id))
  const hiddenIdSet = new Set(hiddenDemoDrawingIds)
  const merged = [
    ...apiList,
    ...DEMO_DRAWINGS.filter((drawing) => !knownIds.has(drawing.id) && !hiddenIdSet.has(drawing.id)),
  ]

  return merged.map((drawing) => ({
    ...drawing,
    isActive: activeDrawingIds.includes(drawing.id),
  }))
}

export function ActiveDrawingProvider({ children }: { children: React.ReactNode }) {
  const { waitForEvent } = useEventStream()
  const [drawings, setDrawings] = useState<DrawingItem[]>([])
  const [activeDrawingIds, setActiveDrawingIds] = useState<string[]>(() => readStoredActiveDrawingIds())
  const [hiddenDemoDrawingIds, setHiddenDemoDrawingIds] = useState<string[]>(() => readStoredHiddenDemoDrawingIds())
  const [activeDrawingId, setActiveDrawingId] = useState<string>('')
  const [activeDrawing, setActiveDrawing] = useState<DrawingDetail | null>(null)

  const [isLoadingDrawings, setIsLoadingDrawings] = useState(false)
  const [isLoadingActiveDrawing, setIsLoadingActiveDrawing] = useState(false)
  const [errorDrawings, setErrorDrawings] = useState<string | null>(null)
  const [errorActiveDrawing, setErrorActiveDrawing] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(ACTIVE_DRAWING_IDS_STORAGE_KEY, JSON.stringify(activeDrawingIds))
  }, [activeDrawingIds])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(HIDDEN_DEMO_DRAWING_IDS_STORAGE_KEY, JSON.stringify(hiddenDemoDrawingIds))
  }, [hiddenDemoDrawingIds])

  const applyDrawingsResponse = useCallback(
    (res: any, preferredActiveId?: string) => {
      const list = buildDrawingListWithDemos(res, activeDrawingIds, hiddenDemoDrawingIds)
      const availableIdSet = new Set(list.map((drawing) => drawing.id))
      const nextActiveDrawingIds = activeDrawingIds.filter((id) => availableIdSet.has(id))

      setDrawings(list)
      if (nextActiveDrawingIds.length !== activeDrawingIds.length) {
        setActiveDrawingIds(nextActiveDrawingIds)
      }

      setActiveDrawingId((currentId) => {
        const targetId = preferredActiveId ?? currentId
        if (targetId && availableIdSet.has(targetId)) return targetId
        return list[0]?.id ?? ''
      })
      setErrorDrawings(null)

      return list
    },
    [activeDrawingIds, hiddenDemoDrawingIds],
  )

  const refreshDrawings = useCallback(
    async (preferredActiveId?: string) => {
      setIsLoadingDrawings(true)
      setErrorDrawings(null)
      try {
        const res = await DefaultService.getGasLeakDrawingsApiGasLeakDrawingsGet()
        return applyDrawingsResponse(res, preferredActiveId)
      } catch (e: any) {
        setErrorDrawings(e?.message ?? String(e))
        throw e
      } finally {
        setIsLoadingDrawings(false)
      }
    },
    [applyDrawingsResponse],
  )

  useEffect(() => {
    let mounted = true
    setIsLoadingDrawings(true)
    setErrorDrawings(null)

    DefaultService.getGasLeakDrawingsApiGasLeakDrawingsGet()
      .then((res) => {
        if (!mounted) return
        applyDrawingsResponse(res, activeDrawingId || undefined)
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
    setDrawings((prev) =>
      prev.map((drawing) => ({
        ...drawing,
        isActive: activeDrawingIds.includes(drawing.id),
      })),
    )
  }, [activeDrawingIds])

  useEffect(() => {
    if (!activeDrawingId) {
      setActiveDrawing(null)
      setErrorActiveDrawing(null)
      setIsLoadingActiveDrawing(false)
      return
    }
    let mounted = true
    setIsLoadingActiveDrawing(true)
    setErrorActiveDrawing(null)
    const selectedDrawing = drawings.find((d) => d.id === activeDrawingId)
    const mockDrawingDetail = mockDrawingDetails[activeDrawingId]

    if (mockDrawingDetail) {
      setActiveDrawing({
        ...mockDrawingDetail,
        name: selectedDrawing?.name ?? mockDrawingDetail.name,
        fileKind: getDrawingFileKind(undefined, selectedDrawing?.name ?? mockDrawingDetail.name),
      })
      setErrorActiveDrawing(null)
      setIsLoadingActiveDrawing(false)
      return () => {
        mounted = false
      }
    }

    DefaultService.getGasLeakDrawingApiGasLeakDrawingsDrawingIdGet(activeDrawingId)
      .then((res) => {
        if (!mounted) return
        setActiveDrawing(normalizeDrawingDetailResponse(res, selectedDrawing?.name))
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
  }, [activeDrawingId, drawings])

  const activeIndex = useMemo(() => Math.max(0, drawings.findIndex((d) => d.id === activeDrawingId)), [activeDrawingId, drawings])
  const total = drawings.length

  const removeDrawingLocally = useCallback((id: string) => {
    setDrawings((prev) => {
      const next = prev.filter((d) => d.id !== id)
      setActiveDrawingId((cur) => (cur === id ? next[0]?.id ?? '' : cur))
      return next
    })
    setActiveDrawingIds((prev) => prev.filter((drawingId) => drawingId !== id))
  }, [])

  const removeDrawing = useCallback(
    async (id: string) => {
      if (DEMO_DRAWING_ID_SET.has(id)) {
        setHiddenDemoDrawingIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
        removeDrawingLocally(id)
        return
      }

      await DefaultService.publishEventApiEventsPublishPost({
        type: 'GAS_LEAK_DRAWING_DELETE',
        payload: {
          drawing_id: id,
        },
      })
      const deleteResult = await waitForEvent(
        'GAS_LEAK_DRAWING_DELETED',
        (payload) => !payload?.drawing_id || payload?.drawing_id === id,
        8000,
      ).catch(() => null)

      if (deleteResult?.payload?.success === false) {
        throw new Error(deleteResult.payload.error ?? '도면 삭제에 실패했습니다.')
      }

      removeDrawingLocally(id)
    },
    [removeDrawingLocally, waitForEvent],
  )

  const toggleDrawingActive = useCallback((id: string) => {
    setActiveDrawingIds((prev) => (prev.includes(id) ? prev.filter((drawingId) => drawingId !== id) : [...prev, id]))
  }, [])

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
      activeDrawingIds,
      activeDrawingId,
      setActiveDrawingId,
      toggleDrawingActive,
      refreshDrawings,
      removeDrawing,
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
  }, [
    activeDrawing,
    activeDrawingIds,
    activeDrawingId,
    activeIndex,
    drawings,
    errorActiveDrawing,
    errorDrawings,
    isLoadingActiveDrawing,
    isLoadingDrawings,
    refreshDrawings,
    removeDrawing,
    toggleDrawingActive,
    total,
  ])

  return <ActiveDrawingContext.Provider value={value}>{children}</ActiveDrawingContext.Provider>
}

export function useActiveDrawing() {
  const ctx = useContext(ActiveDrawingContext)
  if (!ctx) throw new Error('useActiveDrawing must be used within ActiveDrawingProvider')
  return ctx
}

