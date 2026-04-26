import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useActiveDrawing } from '../../../entities/drawing/model/activeDrawing'
import { useDrawingViewport } from '../../../entities/drawing/model/useDrawingViewport'
import { PageContentGrid } from '../../../shared/ui/layout/PageContentGrid'
import { drawingSensorAssets } from '../assets/drawingSensorAssets'
import {
  mapDrawingSensorsToRegisteredSensors,
  normalizeLabelKey,
  type RegisteredSensor,
  unitLabelToUnit,
} from '../model/registeredSensor'
import { DrawingSensorCanvas } from '../ui/DrawingSensorCanvas'
import { SensorAlertDialog } from '../ui/SensorAlertDialog'
import { SensorDeleteDialog } from '../ui/SensorDeleteDialog'
import { SensorManagementSidebar } from '../ui/SensorManagementSidebar'
import { SensorToast } from '../ui/SensorToast'

const PLACEMENT_TOAST = '도면을 먼저 클릭해서 센서 설치 위치를 선택해 주세요.'

export default function DrawingSensorPage() {
  const navigate = useNavigate()
  const { drawings, activeDrawing, activeDrawingId, activeIndex, total, goPrev, goNext } = useActiveDrawing()
  const { imgChevronLeft, imgChevronRight } = drawingSensorAssets
  const viewport = useDrawingViewport(activeDrawingId)
  const drawingCanvasRef = useRef<HTMLDivElement>(null)

  const selectedDrawing = drawings.find((drawing) => drawing.id === activeDrawingId)
  const drawingName = selectedDrawing?.name ?? activeDrawing?.name ?? '도면'
  const drawingKey = activeDrawingId || '_none'
  const page = total <= 0 ? 0 : activeIndex + 1

  const [label, setLabel] = useState('')
  const [unit, setUnit] = useState<'pressure' | 'flow'>('pressure')
  const [enabled, setEnabled] = useState(true)
  const [pendingPlacement, setPendingPlacement] = useState<{ leftPct: number; topPct: number } | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [registrationsByDrawing, setRegistrationsByDrawing] = useState<Record<string, RegisteredSensor[]>>({})
  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editUnit, setEditUnit] = useState<'pressure' | 'flow'>('pressure')

  const registeredSensors = useMemo(
    () => registrationsByDrawing[drawingKey] ?? [],
    [registrationsByDrawing, drawingKey],
  )

  useEffect(() => {
    setLabel('')
    setUnit('pressure')
    setEditingId(null)
    setDeleteConfirmId(null)
    setPendingPlacement(null)
  }, [drawingKey])

  useEffect(() => {
    if (!activeDrawingId || !activeDrawing) return
    setRegistrationsByDrawing((prev) => {
      if (prev[activeDrawingId]) return prev
      return {
        ...prev,
        [activeDrawingId]: mapDrawingSensorsToRegisteredSensors(activeDrawing.sensors ?? []),
      }
    })
  }, [activeDrawing, activeDrawingId])

  useEffect(() => {
    if (!toastMessage) return
    const timeoutId = window.setTimeout(() => setToastMessage(null), 3500)
    return () => window.clearTimeout(timeoutId)
  }, [toastMessage])

  const unitLabel = unit === 'pressure' ? '압력 (MPa)' : '유량 (L/min)'
  const unitColor: RegisteredSensor['color'] = unit === 'pressure' ? 'green' : 'orange'

  const onAdd = () => {
    if (!pendingPlacement) {
      setToastMessage(PLACEMENT_TOAST)
      return
    }

    const trimmed = label.trim()
    if (!trimmed) {
      setAlertMessage('라벨을 입력해 주세요.')
      return
    }

    const nextLabelKey = normalizeLabelKey(trimmed)
    const duplicate = registeredSensors.some((sensor) => normalizeLabelKey(sensor.label) === nextLabelKey)
    if (duplicate) {
      setAlertMessage('이 도면에서 이미 사용 중인 라벨명입니다.')
      return
    }

    const sensorId = `S${Date.now()}`
    const posText = `(${pendingPlacement.leftPct.toFixed(3)}%, ${pendingPlacement.topPct.toFixed(3)}%)`

    setRegistrationsByDrawing((prev) => ({
      ...prev,
      [drawingKey]: [
        ...(prev[drawingKey] ?? []),
        {
          id: sensorId,
          label: trimmed,
          color: unitColor,
          unitLabel,
          posText,
        },
      ],
    }))
    setLabel('')
    setPendingPlacement(null)
  }

  const onCancel = () => {
    setLabel('')
    setUnit('pressure')
    setPendingPlacement(null)
  }

  const onDrawingCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (viewport.zoom > 1) return
    const element = drawingCanvasRef.current
    if (!element) return

    const rect = element.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return

    setPendingPlacement({
      leftPct: (x / rect.width) * 100,
      topPct: (y / rect.height) * 100,
    })
  }

  const onLabelChange = (value: string) => {
    if (!pendingPlacement && value.length > 0) {
      setToastMessage(PLACEMENT_TOAST)
      return
    }
    setLabel(value)
  }

  const startEdit = (sensor: RegisteredSensor) => {
    setEditingId(sensor.id)
    setEditLabel(sensor.label)
    setEditUnit(unitLabelToUnit(sensor.unitLabel))
  }

  const saveEdit = () => {
    if (!editingId) return

    const trimmed = editLabel.trim()
    if (!trimmed) {
      setAlertMessage('라벨을 입력해 주세요.')
      return
    }

    const nextLabelKey = normalizeLabelKey(trimmed)
    const duplicate = registeredSensors.some(
      (sensor) => sensor.id !== editingId && normalizeLabelKey(sensor.label) === nextLabelKey,
    )
    if (duplicate) {
      setAlertMessage('이 도면에서 이미 사용 중인 라벨명입니다.')
      return
    }

    const nextUnitLabel = editUnit === 'pressure' ? '압력 (MPa)' : '유량 (L/min)'
    const nextColor: RegisteredSensor['color'] = editUnit === 'pressure' ? 'green' : 'orange'

    setRegistrationsByDrawing((prev) => {
      const currentList = prev[drawingKey] ?? []
      return {
        ...prev,
        [drawingKey]: currentList.map((sensor) =>
          sensor.id === editingId
            ? { ...sensor, label: trimmed, unitLabel: nextUnitLabel, color: nextColor }
            : sensor,
        ),
      }
    })
    setEditingId(null)
  }

  const confirmDelete = () => {
    if (!deleteConfirmId) return
    setRegistrationsByDrawing((prev) => {
      const currentList = prev[drawingKey] ?? []
      return {
        ...prev,
        [drawingKey]: currentList.filter((sensor) => sensor.id !== deleteConfirmId),
      }
    })
    if (editingId === deleteConfirmId) setEditingId(null)
    setDeleteConfirmId(null)
  }

  if (total === 0) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-[24px]">
        <div className="flex flex-col items-center justify-center rounded-[12px] bg-white px-[32px] py-[48px] text-center">
          <p className="font-['Pretendard',sans-serif] text-[24px] font-semibold leading-[1.4] text-[color:var(--black_title,#0b1828)]">
            업로드된 도면이 없습니다.
          </p>
          <button
            type="button"
            className="mt-[20px] flex h-[48px] items-center justify-center gap-[8px] rounded-[4px] bg-[var(--blue_icon,#1392ec)] px-[22px] py-[8px]"
            aria-label="도면 업로드"
          >
            <img alt="" className="block h-[20px] w-[20px]" src={imgAttachFileAdd} />
            <span className="whitespace-nowrap font-['Pretendard',sans-serif] text-[16px] font-medium leading-[15px] tracking-[-0.25px] text-white">
              도면 업로드
            </span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <PageContentGrid>
        <DrawingSensorCanvas
          drawingName={drawingName}
          activeDrawing={activeDrawing}
          enabled={enabled}
          onToggleEnabled={() => setEnabled((current) => !current)}
          pendingPlacement={pendingPlacement}
          unit={unit}
          drawingCanvasRef={drawingCanvasRef}
          viewportRef={viewport.viewportRef}
          zoom={viewport.zoom}
          pan={viewport.pan}
          isPanning={viewport.isPanning}
          isFabOpen={viewport.isFabOpen}
          canResetView={viewport.canResetView}
          onPointerDown={viewport.onPointerDown}
          onPointerMove={viewport.onPointerMove}
          onPointerUp={viewport.endPointerDrag}
          onPointerCancel={viewport.endPointerDrag}
          onLostPointerCapture={viewport.onLostPointerCapture}
          onCanvasClick={onDrawingCanvasClick}
          onToggleFab={() => viewport.setIsFabOpen((open) => !open)}
          onZoomIn={viewport.zoomIn}
          onZoomOut={viewport.zoomOut}
          onResetView={viewport.resetView}
          onMoveToMonitor={() => {
            viewport.setIsFabOpen(false)
            navigate('/')
          }}
        />

        <SensorManagementSidebar
          label={label}
          unit={unit}
          registeredSensors={registeredSensors}
          editingId={editingId}
          editLabel={editLabel}
          editUnit={editUnit}
          onLabelChange={onLabelChange}
          onUnitChange={setUnit}
          onAdd={onAdd}
          onCancel={onCancel}
          onStartEdit={startEdit}
          onEditLabelChange={setEditLabel}
          onEditUnitChange={setEditUnit}
          onSaveEdit={saveEdit}
          onRequestDelete={setDeleteConfirmId}
        />

        <div className="col-span-12 mt-[18px] flex shrink-0 items-center justify-center gap-[51px] text-[16px] text-[#0b1828] lg:col-span-9">
          <button type="button" className="flex h-[20px] w-[20px] items-center justify-center" onClick={goPrev}>
            <img alt="" className="-scale-x-100 block h-[20px] w-[20px]" src={imgChevronLeft} />
          </button>
          <div className="font-['Pretendard',sans-serif] font-normal leading-[20px]">
            {page} / {total}
          </div>
          <button type="button" className="flex h-[20px] w-[20px] items-center justify-center" onClick={goNext}>
            <img alt="" className="block h-[20px] w-[20px]" src={imgChevronRight} />
          </button>
        </div>
      </PageContentGrid>

      <SensorAlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} />
      <SensorDeleteDialog
        open={deleteConfirmId != null}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={confirmDelete}
      />
      <SensorToast message={toastMessage} />
    </>
  )
}
