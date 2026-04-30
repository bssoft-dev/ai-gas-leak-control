import { useMemo, useState, type DragEvent } from 'react'

import { useActiveDrawing } from '../../../entities/drawing/model/activeDrawing'
import { formatDrawingName } from '../../../shared/lib/formatDrawingName'
import { drawingSensorAssets } from '../../drawing-sensor/assets/drawingSensorAssets'
import { appShellAssets } from '../assets/appShellAssets'
import { normalizeSearchText } from '../model/sidebar'

const DRAWING_ID_MIME = 'application/x-ai-gas-drawing-id'

type DrawingListProps = {
  listKind: 'active' | 'inactive'
  filter: (id: string) => boolean
  showGreenDot?: (id: string) => boolean
  allowIds?: Set<string>
}

function DrawingDeleteDialog({
  drawingName,
  open,
  isDeleting,
  errorMessage,
  onClose,
  onConfirm,
}: {
  drawingName: string
  open: boolean
  isDeleting: boolean
  errorMessage: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 px-[24px]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="drawing-delete-title"
      onClick={() => {
        if (!isDeleting) onClose()
      }}
    >
      <div
        className="w-full max-w-[500px] rounded-[12px] bg-white p-[40px] shadow-[0px_12px_40px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center">
          <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#fef2f2]" aria-hidden>
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
            </svg>
          </div>
        </div>
        <h2
          id="drawing-delete-title"
          className="mt-[24px] text-center font-['Pretendard',sans-serif] text-[18px] font-semibold leading-[1.35] text-[color:var(--black_title,#0b1828)]"
        >
          해당 도면을 삭제하시겠습니까?
        </h2>
        {drawingName ? (
          <p className="mt-[8px] text-center font-['Pretendard',sans-serif] text-[14px] leading-[1.4] text-[color:var(--black_300,#7a89a1)]">
            {drawingName}
          </p>
        ) : null}
        <p className="mt-[12px] text-center font-['Pretendard',sans-serif] text-[14px] leading-[1.5] text-[color:var(--black_500,#485b77)]">
          삭제 후에는 도면과 연결된 센서 정보를 복구할 수 없습니다.
        </p>
        {errorMessage ? (
          <p className="mt-[12px] text-center font-['Pretendard',sans-serif] text-[13px] leading-[1.5] text-[#dc2626]">
            {errorMessage}
          </p>
        ) : null}
        <div className="mt-[28px] flex gap-[12px]">
          <button
            type="button"
            className="h-[52px] flex-1 rounded-[8px] border border-[#e2e8f0] bg-white font-['Pretendard',sans-serif] text-[16px] font-medium text-[color:var(--black_700,#2c3c53)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isDeleting}
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="h-[52px] flex-1 rounded-[8px] bg-[#ef4444] font-['Pretendard',sans-serif] text-[16px] font-medium text-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DrawingList({ listKind, filter, showGreenDot, allowIds }: DrawingListProps) {
  const { drawings, activeDrawingId, setActiveDrawingId, toggleDrawingActive, removeDrawing } = useActiveDrawing()
  const { imgDelete } = drawingSensorAssets
  const [pendingDeleteDrawingId, setPendingDeleteDrawingId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)

  const pendingDeleteName = useMemo(
    () => formatDrawingName(drawings.find((drawing) => drawing.id === pendingDeleteDrawingId)?.name),
    [drawings, pendingDeleteDrawingId],
  )

  const readDraggedDrawingId = (e: DragEvent) =>
    e.dataTransfer.getData(DRAWING_ID_MIME) || e.dataTransfer.getData('text/plain')

  const handleListDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleListDragEnter = (e: DragEvent) => {
    e.preventDefault()
    setIsDropTarget(true)
  }

  const handleListDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDropTarget(false)
    }
  }

  const handleListDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDropTarget(false)
    const id = readDraggedDrawingId(e)
    if (!id) return
    const drawing = drawings.find((d) => d.id === id)
    if (!drawing) return

    if (listKind === 'active') {
      if (!drawing.isActive) {
        toggleDrawingActive(id)
      }
      setActiveDrawingId(id)
      return
    }

    if (drawing.isActive) {
      toggleDrawingActive(id)
      if (activeDrawingId === id) {
        const nextActive = drawings.find((d) => d.id !== id && d.isActive)
        setActiveDrawingId(nextActive?.id ?? '')
      }
    }
  }

  return (
    <>
      <div
        className={`flex min-h-[40px] flex-col gap-[4px] rounded-[8px] transition-colors ${
          isDropTarget
            ? listKind === 'active'
              ? 'bg-[var(--blue_primary_50,#e6f3fb)] ring-2 ring-[var(--blue_primary_500,#61a0e1)] ring-offset-2 ring-offset-[var(--gray_sidebar,#fafafa)]'
              : 'bg-[#f1f5f9] ring-2 ring-[#94a3b8] ring-offset-2 ring-offset-[var(--gray_sidebar,#fafafa)]'
            : ''
        }`}
        onDragOver={handleListDragOver}
        onDragEnter={handleListDragEnter}
        onDragLeave={handleListDragLeave}
        onDrop={handleListDrop}
      >
        {drawings
          .filter((drawing) => filter(drawing.id) && (allowIds ? allowIds.has(drawing.id) : true))
          .map((drawing) => {
            const isSelected = drawing.id === activeDrawingId
            const isEnabled = Boolean(drawing.isActive)
            const shouldShowGreenDot = showGreenDot?.(drawing.id) ?? false

            return (
              <div
                key={drawing.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAWING_ID_MIME, drawing.id)
                  e.dataTransfer.setData('text/plain', drawing.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                className={`cursor-grab active:cursor-grabbing ${
                  isSelected
                    ? 'flex w-full items-center justify-between gap-[8px] rounded-[4px] border border-[var(--blue_primary_500,#61a0e1)] bg-[var(--blue_primary_50,#e6f3fb)] px-[13px] py-[9px]'
                    : 'flex w-full items-center justify-between gap-[8px] rounded-[8px] px-[12px] py-[8px] hover:bg-[#f1f5f9]'
                }`}
              >
                <button
                  type="button"
                  className={`min-w-0 flex-1 truncate text-left font-['Pretendard',sans-serif] text-[16px] leading-[20px] ${
                    isSelected
                      ? 'font-semibold text-[color:var(--blue_primary_800,#4370ac)]'
                      : 'font-medium text-[color:var(--black_title,#0b1828)]'
                  }`}
                  onClick={() => setActiveDrawingId(drawing.id)}
                >
                  {formatDrawingName(drawing.name) || drawing.name}
                </button>

                <div className="flex shrink-0 items-center gap-[12px]">
                  {listKind === 'active' ? (
                    <div
                      className="relative flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[9999px] bg-[rgba(34,197,94,0.16)]"
                      role="status"
                      aria-label={`${formatDrawingName(drawing.name) || drawing.name} 활성`}
                    >
                      {shouldShowGreenDot ? (
                        <span className="relative h-[8px] w-[8px] shrink-0 rounded-[9999px] bg-[var(--green,#22c55e)]">
                          <span className="absolute left-0 top-1/2 h-[8px] w-[8px] -translate-y-1/2 rounded-[9999px] shadow-[0px_0px_0px_4px_rgba(34,197,94,0.2)]" />
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`relative flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[9999px] ${
                        isEnabled ? 'bg-[rgba(34,197,94,0.16)]' : 'bg-transparent'
                      }`}
                      aria-label={`${formatDrawingName(drawing.name) || drawing.name} 활성 설정`}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        toggleDrawingActive(drawing.id)
                      }}
                    >
                      {shouldShowGreenDot ? (
                        <span className="relative h-[8px] w-[8px] shrink-0 rounded-[9999px] bg-[var(--green,#22c55e)]">
                          <span className="absolute left-0 top-1/2 h-[8px] w-[8px] -translate-y-1/2 rounded-[9999px] shadow-[0px_0px_0px_4px_rgba(34,197,94,0.2)]" />
                        </span>
                      ) : null}
                    </button>
                  )}

                  <button
                    type="button"
                    className="group flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[4px] hover:bg-[#fef2f2]"
                    aria-label={`${formatDrawingName(drawing.name) || drawing.name} 삭제`}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDeleteErrorMessage(null)
                      setPendingDeleteDrawingId(drawing.id)
                    }}
                  >
                    <img
                      alt=""
                      className="block h-[20px] w-[20px] transition-[filter] group-hover:[filter:invert(32%)_sepia(95%)_saturate(2582%)_hue-rotate(331deg)_brightness(99%)_contrast(96%)]"
                      src={imgDelete}
                    />
                  </button>
                </div>
              </div>
            )
          })}
      </div>

      <DrawingDeleteDialog
        drawingName={pendingDeleteName}
        open={pendingDeleteDrawingId != null}
        isDeleting={isDeleting}
        errorMessage={deleteErrorMessage}
        onClose={() => {
          if (isDeleting) return
          setPendingDeleteDrawingId(null)
          setDeleteErrorMessage(null)
        }}
        onConfirm={async () => {
          if (!pendingDeleteDrawingId) return
          setIsDeleting(true)
          setDeleteErrorMessage(null)
          try {
            await removeDrawing(pendingDeleteDrawingId)
            setPendingDeleteDrawingId(null)
          } catch (error: any) {
            setDeleteErrorMessage(error?.message ?? '도면 삭제에 실패했습니다.')
          } finally {
            setIsDeleting(false)
          }
        }}
      />
    </>
  )
}

type DrawingManagementSectionProps = {
  isExpanded: boolean
  onToggle: () => void
}

function SectionToggle({
  title,
  expanded,
  onToggle,
}: {
  title: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="mb-[8px] flex items-center justify-between px-[2px]">
      <div className="font-['Pretendard',sans-serif] text-[12px] font-semibold leading-[16px] text-[color:var(--black_300,#7a89a1)]">
        {title}
      </div>
      <button
        type="button"
        className="font-['Pretendard',sans-serif] text-[11px] font-medium leading-[16px] text-[color:var(--black_300,#7a89a1)]"
        onClick={onToggle}
      >
        {expanded ? '숨기기' : '보이기'}
      </button>
    </div>
  )
}

export function DrawingManagementSection({ isExpanded, onToggle }: DrawingManagementSectionProps) {
  const { drawings } = useActiveDrawing()
  const { imgDrawingsChevron } = appShellAssets
  const [drawingSearch, setDrawingSearch] = useState('')
  const [isDrawingListExpanded, setIsDrawingListExpanded] = useState(true)
  const [isInactiveListExpanded, setIsInactiveListExpanded] = useState(true)

  const activeIdSet = useMemo(
    () => new Set(drawings.filter((drawing) => drawing.isActive).map((drawing) => drawing.id)),
    [drawings],
  )

  const activeDrawingCount = useMemo(() => drawings.filter((drawing) => drawing.isActive).length, [drawings])
  const inactiveDrawingCount = useMemo(() => drawings.filter((drawing) => !drawing.isActive).length, [drawings])

  const searchedIdSet = useMemo(() => {
    const query = normalizeSearchText(drawingSearch)
    if (!query) return null

    return new Set(
      drawings
        .filter((drawing) => normalizeSearchText(String(drawing.name ?? '')).includes(query))
        .map((drawing) => drawing.id),
    )
  }, [drawingSearch, drawings])

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-[#c0ccde] pt-[16px]">
      <div className="flex shrink-0 items-center justify-between px-[8px] pb-[16px]">
        <div className="font-['Pretendard',sans-serif] text-[16px] font-semibold leading-[1.2] text-[color:var(--black_300,#7a89a1)]">
          도면 관리
        </div>
        <button
          type="button"
          className="flex h-[20px] w-[20px] items-center justify-center"
          aria-label="도면 관리 접기/펼치기"
          onClick={onToggle}
        >
          <img
            alt=""
            className={`block h-[10px] w-[6px] shrink-0 self-center object-contain transition-transform rotate-90 ${isExpanded ? '' : 'rotate-180'}`}
            src={imgDrawingsChevron}
          />
        </button>
      </div>

      {isExpanded && (
        <div className="notion-scrollbar min-h-0 flex-1 overflow-y-auto pr-[4px]">
          <div className="flex flex-col gap-[12px]">
            <div className="sticky top-0 z-10 bg-[var(--gray_sidebar,#fafafa)] pb-[12px] pt-[8px]">
              <div className="px-[8px]">
                <input
                  value={drawingSearch}
                  onChange={(e) => setDrawingSearch(e.target.value)}
                  placeholder="도면 이름 검색"
                  className="h-[40px] w-full rounded-[4px] border border-[#e2e8f0] bg-white px-[12px] font-['Pretendard',sans-serif] text-[16px] leading-[20px] text-[color:var(--black_title,#0b1828)] outline-none focus-visible:border-[var(--blue_primary_500,#61a0e1)] focus-visible:ring-2 focus-visible:ring-[color:var(--blue_primary_500,#61a0e1)]/25 focus-visible:ring-offset-[3px] focus-visible:ring-offset-[var(--gray_sidebar,#fafafa)]"
                />
              </div>
            </div>

            <div className="px-[8px]">
              <SectionToggle
                title={`활성화 도면 (${activeDrawingCount}개)`}
                expanded={isDrawingListExpanded}
                onToggle={() => setIsDrawingListExpanded((prev) => !prev)}
              />
              {isDrawingListExpanded && (
                <DrawingList
                  listKind="active"
                  filter={(id) => activeIdSet.has(id)}
                  showGreenDot={() => true}
                  allowIds={searchedIdSet ?? undefined}
                />
              )}
            </div>

            <div className="my-[8px] border-t border-[#c0ccde]" />

            <div className="px-[8px] pb-[8px]">
              <SectionToggle
                title={`비활성도면 (${inactiveDrawingCount}개)`}
                expanded={isInactiveListExpanded}
                onToggle={() => setIsInactiveListExpanded((prev) => !prev)}
              />
              {isInactiveListExpanded && (
                <DrawingList
                  listKind="inactive"
                  filter={(id) => !activeIdSet.has(id)}
                  allowIds={searchedIdSet ?? undefined}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
