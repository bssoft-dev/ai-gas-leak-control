import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { DefaultService } from '../../../api/services/DefaultService'
import { useActiveDrawing } from '../../../entities/drawing/model/activeDrawing'
import { useDrawingViewport } from '../../../entities/drawing/model/useDrawingViewport'
import { formatDrawingName } from '../../../shared/lib/formatDrawingName'
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

const PLACEMENT_TOAST = '도면을 먼저 클릭해서 센서 배치 위치를 선택해 주세요.'
const DEFAULT_ZONE_ID = 'zone-1'

function mapUnitToPayload(sensor: RegisteredSensor) {
  const sensorType = sensor.color === 'orange' ? 'flow' : 'pressure'
  return {
    sensorType,
    unit: sensorType === 'flow' ? 'L/min' : 'MPa',
  }
}

function isSupportedDrawingFile(file: File) {
  return file.type.startsWith('image/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const [, base64 = ''] = result.split(',')
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽을 수 없습니다.'))
    reader.readAsDataURL(file)
  })
}

export default function DrawingSensorPage() {
  const navigate = useNavigate()
  const {
    drawings,
    activeDrawing,
    activeDrawingId,
    activeIndex,
    total,
    goPrev,
    goNext,
    setActiveDrawingId,
    toggleDrawingActive,
    refreshDrawings,
  } = useActiveDrawing()
  const { imgAttachFileAdd, imgChevronLeft, imgChevronRight } = drawingSensorAssets
  const viewport = useDrawingViewport(activeDrawingId)
  const drawingCanvasRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedDrawing = drawings.find((drawing) => drawing.id === activeDrawingId)
  const drawingName = formatDrawingName(selectedDrawing?.name ?? activeDrawing?.name) || '도면'
  const enabled = Boolean(selectedDrawing?.isActive)
  const drawingKey = activeDrawingId || '_none'
  const page = total <= 0 ? 0 : activeIndex + 1

  const [label, setLabel] = useState('')
  const [unit, setUnit] = useState<'pressure' | 'flow'>('pressure')
  const [pendingPlacement, setPendingPlacement] = useState<{ leftPct: number; topPct: number } | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [registrationsByDrawing, setRegistrationsByDrawing] = useState<Record<string, RegisteredSensor[]>>({})
  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editUnit, setEditUnit] = useState<'pressure' | 'flow'>('pressure')
  const [isSavingSensors, setIsSavingSensors] = useState(false)
  const [isUploadingDrawings, setIsUploadingDrawings] = useState(false)

  const registeredSensors = useMemo(
    () => registrationsByDrawing[drawingKey] ?? [],
    [registrationsByDrawing, drawingKey],
  )

  const displaySensors = useMemo(
    () =>
      registeredSensors.map((sensor) => ({
        id: sensor.id,
        xPct: sensor.xPct,
        yPct: sensor.yPct,
        color: sensor.color,
      })),
    [registeredSensors],
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
    setRegistrationsByDrawing((prev) => ({
      ...prev,
      [activeDrawingId]: mapDrawingSensorsToRegisteredSensors(activeDrawing.sensors ?? []),
    }))
  }, [activeDrawing, activeDrawingId])

  useEffect(() => {
    if (!toastMessage) return
    const timeoutId = window.setTimeout(() => setToastMessage(null), 3500)
    return () => window.clearTimeout(timeoutId)
  }, [toastMessage])

  const unitLabel = unit === 'pressure' ? '압력 (MPa)' : '유량 (L/min)'
  const unitColor: RegisteredSensor['color'] = unit === 'pressure' ? 'green' : 'orange'

  const persistSensors = async (nextSensors: RegisteredSensor[], successMessage: string) => {
    if (!activeDrawingId) {
      setAlertMessage('선택된 도면이 없습니다.')
      return false
    }

    setIsSavingSensors(true)

    try {
      await DefaultService.publishEventApiEventsPublishPost({
        type: 'GAS_LEAK_SENSORS_SAVE',
        payload: {
          drawing_id: activeDrawingId,
          sensors: nextSensors.map((sensor) => {
            const { sensorType, unit } = mapUnitToPayload(sensor)
            return {
              id: sensor.id,
              label: sensor.label,
              zone_id: sensor.zoneId || DEFAULT_ZONE_ID,
              x: Number((sensor.xPct / 100).toFixed(6)),
              y: Number((sensor.yPct / 100).toFixed(6)),
              unit,
              sensor_type: sensorType,
            }
          }),
        },
      })

      setRegistrationsByDrawing((prev) => ({
        ...prev,
        [drawingKey]: nextSensors,
      }))
      setToastMessage(successMessage)
      return true
    } catch (error: any) {
      setAlertMessage(error?.message ?? '센서 저장에 실패했습니다.')
      return false
    } finally {
      setIsSavingSensors(false)
    }
  }

  const openUploadDialog = () => {
    if (isUploadingDrawings) return
    fileInputRef.current?.click()
  }

  const handleDrawingFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''

    if (files.length === 0) return

    const unsupportedFiles = files.filter((file) => !isSupportedDrawingFile(file))
    if (unsupportedFiles.length > 0) {
      setAlertMessage('이미지 파일과 PDF 파일만 업로드할 수 있습니다.')
      return
    }

    setIsUploadingDrawings(true)

    const uploadedNames: string[] = []
    const failedFiles: string[] = []

    try {
      for (const file of files) {
        try {
          const fileBase64 = await readFileAsBase64(file)
          await DefaultService.publishEventApiEventsPublishPost({
            type: 'GAS_LEAK_DRAWING_UPLOAD',
            payload: {
              name: file.name,
              filename: file.name,
              file_base64: fileBase64,
            },
          })
          uploadedNames.push(file.name)
        } catch {
          failedFiles.push(file.name)
        }
      }

      const refreshedDrawings = await refreshDrawings()
      const uploadedDrawing = refreshedDrawings.find((drawing) => uploadedNames.includes(drawing.name))
      if (uploadedDrawing) {
        setActiveDrawingId(uploadedDrawing.id)
      }

      if (uploadedNames.length > 0) {
        setToastMessage(
          uploadedNames.length === 1
            ? `${uploadedNames[0]} 업로드가 완료되었습니다.`
            : `${uploadedNames.length}개의 도면 업로드가 완료되었습니다.`,
        )
      }

      if (failedFiles.length > 0) {
        setAlertMessage(`일부 파일 업로드에 실패했습니다: ${failedFiles.join(', ')}`)
      }
    } finally {
      setIsUploadingDrawings(false)
    }
  }

  const onAdd = async () => {
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
      setAlertMessage('같은 도면에서 이미 사용 중인 라벨명입니다.')
      return
    }

    const sensorId = `S${Date.now()}`
    const nextSensors = [
      ...registeredSensors,
      {
        id: sensorId,
        label: trimmed,
        color: unitColor,
        unitLabel,
        posText: `(${pendingPlacement.leftPct.toFixed(3)}%, ${pendingPlacement.topPct.toFixed(3)}%)`,
        xPct: pendingPlacement.leftPct,
        yPct: pendingPlacement.topPct,
        zoneId: DEFAULT_ZONE_ID,
      },
    ]

    const persisted = await persistSensors(nextSensors, '센서가 저장되었습니다.')
    if (!persisted) return

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

  const saveEdit = async () => {
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
      setAlertMessage('같은 도면에서 이미 사용 중인 라벨명입니다.')
      return
    }

    const nextUnitLabel = editUnit === 'pressure' ? '압력 (MPa)' : '유량 (L/min)'
    const nextColor: RegisteredSensor['color'] = editUnit === 'pressure' ? 'green' : 'orange'
    const nextSensors = registeredSensors.map((sensor) =>
      sensor.id === editingId
        ? { ...sensor, label: trimmed, unitLabel: nextUnitLabel, color: nextColor }
        : sensor,
    )

    const persisted = await persistSensors(nextSensors, '센서가 수정되었습니다.')
    if (!persisted) return

    setEditingId(null)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return

    const nextSensors = registeredSensors.filter((sensor) => sensor.id !== deleteConfirmId)
    const persisted = await persistSensors(nextSensors, '센서가 삭제되었습니다.')
    if (!persisted) return

    if (editingId === deleteConfirmId) setEditingId(null)
    setDeleteConfirmId(null)
  }

  if (total === 0) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-[24px]">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.png,.jpg,.jpeg,.pdf,application/pdf"
          className="hidden"
          onChange={handleDrawingFilesSelected}
        />
        <div className="flex flex-col items-center justify-center rounded-[12px] bg-white px-[32px] py-[48px] text-center">
          <p className="font-['Pretendard',sans-serif] text-[24px] font-semibold leading-[1.4] text-[color:var(--black_title,#0b1828)]">
            업로드된 도면이 없습니다.
          </p>
          <button
            type="button"
            className="mt-[20px] flex h-[48px] items-center justify-center gap-[8px] rounded-[4px] bg-[var(--blue_icon,#1392ec)] px-[22px] py-[8px] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={openUploadDialog}
            disabled={isUploadingDrawings}
            aria-label="도면 업로드"
          >
            <img alt="" className="block h-[20px] w-[20px]" src={imgAttachFileAdd} />
            <span className="whitespace-nowrap font-['Pretendard',sans-serif] text-[16px] font-medium leading-[15px] tracking-[-0.25px] text-white">
              {isUploadingDrawings ? '업로드 중...' : '도면 업로드'}
            </span>
          </button>
        </div>
        <SensorAlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} />
        <SensorToast message={toastMessage} />
      </div>
    )
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.png,.jpg,.jpeg,.pdf,application/pdf"
        className="hidden"
        onChange={handleDrawingFilesSelected}
      />

      <PageContentGrid>
        <DrawingSensorCanvas
          drawingName={drawingName}
          activeDrawing={activeDrawing}
          displaySensors={displaySensors}
          enabled={enabled}
          onToggleEnabled={() => {
            if (activeDrawingId) toggleDrawingActive(activeDrawingId)
          }}
          onOpenUploadDialog={openUploadDialog}
          isUploadingDrawings={isUploadingDrawings}
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
        onClose={() => {
          if (!isSavingSensors) setDeleteConfirmId(null)
        }}
        onConfirm={confirmDelete}
      />
      <SensorToast message={toastMessage} />
    </>
  )
}
