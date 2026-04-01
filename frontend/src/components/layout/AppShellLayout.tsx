import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'

import { appShellAssets } from '../../assets/app-shell/appShellAssets'
import { ActiveDrawingProvider, useActiveDrawing } from '../../state/activeDrawing'

/** Figma: Aside — node 266:2730 / 254:2218 (max expanded width). Min matches current UI default. */
const SIDEBAR_COLLAPSED_W = 69
const SIDEBAR_MIN_EXPANDED_W = 268
const SIDEBAR_MAX_EXPANDED_W = 445
const SIDEBAR_WIDTH_STORAGE_KEY = 'gl-app-shell-sidebar-expanded-w'

function readStoredSidebarWidth(): number | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (!raw) return null
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    return n
  } catch {
    return null
  }
}

function normalizeSearchText(v: string) {
  return String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim()
}

export default function AppShellLayout() {
  const BLUE_PRIMARY_800 = '#4370ac'
  const ICON_INACTIVE = '#0b1828'

  const {
    imgLogo1,
    imgRunDot,
    imgEmergencyCaret,
    imgKeyboardDoubleArrowRight,
    imgKeyboardDoubleArrowRightCollapsed,
    imgMenuChevron,
    imgAnalyticsCollapsed,
    imgContentPasteCollapsed,
    imgHistory2Collapsed,
    imgDrawingsChevron,
    imgDrawingDelete,
  } = appShellAssets

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isMenuExpanded, setIsMenuExpanded] = useState(true)
  const [isDrawingsExpanded, setIsDrawingsExpanded] = useState(true)
  const [expandedSidebarWidth, setExpandedSidebarWidth] = useState(() => {
    const stored = readStoredSidebarWidth()
    if (stored == null) return SIDEBAR_MIN_EXPANDED_W
    return Math.min(SIDEBAR_MAX_EXPANDED_W, Math.max(SIDEBAR_MIN_EXPANDED_W, stored))
  })
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [resizeHandleHover, setResizeHandleHover] = useState(false)
  const resizeLastWidthRef = useRef(expandedSidebarWidth)

  useEffect(() => {
    resizeLastWidthRef.current = expandedSidebarWidth
  }, [expandedSidebarWidth])

  const sidebarWidth = isSidebarCollapsed ? SIDEBAR_COLLAPSED_W : expandedSidebarWidth
  const navIcons = useMemo(
    () => ({
      analytics: { mask: imgAnalyticsCollapsed },
      contentPaste: { mask: imgContentPasteCollapsed },
      history2: { mask: imgHistory2Collapsed },
    }),
    [imgAnalyticsCollapsed, imgContentPasteCollapsed, imgHistory2Collapsed],
  )

  const MaskIcon20 = ({ maskSrc, isActive }: { maskSrc: string; isActive: boolean }) => {
    return (
      <span
        className="block w-[20px] h-[20px]"
        style={{
          backgroundColor: isActive ? BLUE_PRIMARY_800 : ICON_INACTIVE,
          WebkitMaskImage: `url(${maskSrc})`,
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          WebkitMaskSize: 'contain',
          maskImage: `url(${maskSrc})`,
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
          maskSize: 'contain',
        }}
      />
    )
  }

  const ActiveDrawingsList = ({
    filter,
    showGreenDot,
    allowIds,
  }: {
    filter: (id: string) => boolean
    showGreenDot?: (id: string) => boolean
    allowIds?: Set<string>
  }) => {
    const { drawings, activeDrawingId, setActiveDrawingId, removeDrawing } = useActiveDrawing()
    const [pendingDeleteDrawingId, setPendingDeleteDrawingId] = useState<string | null>(null)

    const pendingDeleteName = useMemo(
      () => drawings.find((d) => d.id === pendingDeleteDrawingId)?.name ?? '',
      [drawings, pendingDeleteDrawingId],
    )

    const confirmRemoveDrawing = () => {
      if (!pendingDeleteDrawingId) return
      removeDrawing(pendingDeleteDrawingId)
      setPendingDeleteDrawingId(null)
    }

    return (
      <>
        <div className="flex flex-col gap-[4px]">
          {drawings
            .filter((d) => filter(d.id) && (allowIds ? allowIds.has(d.id) : true))
            .map((d) => {
              const isActive = d.id === activeDrawingId
              const shouldShowGreenDot = showGreenDot?.(d.id) ?? false

              return (
                <div
                  key={d.id}
                  className={
                    isActive
                      ? 'w-full rounded-[4px] border border-[var(--blue_primary_500,#61a0e1)] bg-[var(--blue_primary_50,#e6f3fb)] px-[13px] py-[9px] flex items-center justify-between gap-[8px]'
                      : 'w-full rounded-[8px] px-[12px] py-[8px] flex items-center justify-between gap-[8px] hover:bg-[#f1f5f9]'
                  }
                >
                  <button
                    type="button"
                    className={`min-w-0 flex-1 truncate text-left font-['Pretendard',sans-serif] text-[16px] leading-[20px] ${
                      isActive ? 'font-semibold text-[color:var(--blue_primary_800,#4370ac)]' : 'font-medium text-[color:var(--black_title,#0b1828)]'
                    }`}
                    onClick={() => setActiveDrawingId(d.id)}
                  >
                    {d.name}
                  </button>

                  <div className="flex shrink-0 items-center gap-[12px]">
                    {shouldShowGreenDot && (
                      <span className="relative h-[8px] w-[8px] shrink-0 rounded-[9999px] bg-[var(--green,#22c55e)]">
                        <span className="absolute left-0 top-1/2 h-[8px] w-[8px] -translate-y-1/2 rounded-[9999px] shadow-[0px_0px_0px_4px_rgba(34,197,94,0.2)]" />
                      </span>
                    )}
                    <button
                      type="button"
                      className="group flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[4px] hover:bg-[#fef2f2]"
                      aria-label={`${d.name} 삭제`}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setPendingDeleteDrawingId(d.id)
                      }}
                    >
                      <img
                        alt=""
                        className="block h-[20px] w-[20px] transition-[filter] group-hover:[filter:invert(32%)_sepia(95%)_saturate(2582%)_hue-rotate(331deg)_brightness(99%)_contrast(96%)]"
                        src={imgDrawingDelete}
                      />
                    </button>
                  </div>
                </div>
              )
            })}
        </div>

        {pendingDeleteDrawingId && (
          <div
            className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 px-[24px]"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="drawing-delete-title"
            onClick={() => setPendingDeleteDrawingId(null)}
          >
            <div
              className="w-full max-w-[500px] rounded-[12px] bg-white p-[40px] shadow-[0px_12px_40px_rgba(0,0,0,0.18)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center">
                <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#fef2f2]" aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              {pendingDeleteName ? (
                <p className="mt-[8px] text-center font-['Pretendard',sans-serif] text-[14px] leading-[1.4] text-[color:var(--black_300,#7a89a1)]">
                  {pendingDeleteName}
                </p>
              ) : null}
              <p className="mt-[12px] text-center font-['Pretendard',sans-serif] text-[14px] leading-[1.5] text-[color:var(--black_500,#485b77)]">
                삭제 시 도면 내 생성된 센서 정보도 함께 삭제됩니다.
              </p>
              <div className="mt-[28px] flex gap-[12px]">
                <button
                  type="button"
                  className="h-[52px] flex-1 rounded-[8px] border border-[#e2e8f0] bg-white font-['Pretendard',sans-serif] text-[16px] font-medium text-[color:var(--black_700,#2c3c53)]"
                  onClick={() => setPendingDeleteDrawingId(null)}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="h-[52px] flex-1 rounded-[8px] bg-[#ef4444] font-['Pretendard',sans-serif] text-[16px] font-medium text-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)]"
                  onClick={confirmRemoveDrawing}
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  const DrawingManagementSection = () => {
    const { drawings } = useActiveDrawing()
    const [drawingSearch, setDrawingSearch] = useState('')

    const activeIdSet = useMemo(() => {
      const active = drawings.filter((d) => d.isActive).map((d) => d.id)
      return new Set<string>(active)
    }, [drawings])

    const searchedIdSet = useMemo(() => {
      const q = normalizeSearchText(drawingSearch)
      if (!q) return null
      const matched = drawings
        .filter((d) => normalizeSearchText(String(d.name ?? '')).includes(q))
        .map((d) => d.id)
      return new Set<string>(matched)
    }, [drawingSearch, drawings])

    return (
      <div className="border-t border-[#c0ccde] pt-[16px] flex flex-col min-h-0 flex-1">
        <div className="flex shrink-0 items-center justify-between px-[8px] pb-[16px]">
          <div className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[color:var(--black_300,#7a89a1)] uppercase">
            도면 관리
          </div>
          <button
            type="button"
            className="w-[20px] h-[20px] flex items-center justify-center"
            aria-label="도면 관리 접기/펼치기"
            onClick={() => setIsDrawingsExpanded((v) => !v)}
          >
            <img
              alt=""
              className={`block w-[9px] h-[5.55px] object-contain self-center shrink-0 transition-transform ${isDrawingsExpanded ? '' : 'rotate-180'}`}
              src={imgDrawingsChevron}
            />
          </button>
        </div>

        {isDrawingsExpanded && (
          <div className="min-h-0 flex-1 overflow-y-auto notion-scrollbar pr-[4px]">
            <div className="flex flex-col gap-[12px]">
              <div className="sticky top-0 z-10 bg-[var(--gray_sidebar,#fafafa)] pb-[12px] pt-[8px]">
                <div className="px-[8px]">
                  <input
                    value={drawingSearch}
                    onChange={(e) => setDrawingSearch(e.target.value)}
                    placeholder="도면 이름 검색"
                    className="w-full h-[40px] rounded-[4px] border border-[#e2e8f0] bg-white px-[12px] font-['Pretendard',sans-serif] text-[16px] leading-[20px] text-[color:var(--black_title,#0b1828)] outline-none focus-visible:border-[var(--blue_primary_500,#61a0e1)] focus-visible:ring-2 focus-visible:ring-[color:var(--blue_primary_500,#61a0e1)]/25 focus-visible:ring-offset-[3px] focus-visible:ring-offset-[var(--gray_sidebar,#fafafa)]"
                  />
                </div>
              </div>

              <div className="px-[8px]">
                <ActiveDrawingsList
                  filter={(id) => activeIdSet.has(id)}
                  showGreenDot={() => true}
                  allowIds={searchedIdSet ?? undefined}
                />
              </div>

              <div className="border-t border-[#c0ccde] my-[8px]" />

              <div className="px-[8px] pb-[8px]">
                <ActiveDrawingsList
                  filter={(id) => !activeIdSet.has(id)}
                  allowIds={searchedIdSet ?? undefined}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <ActiveDrawingProvider>
      <div className="bg-white min-h-screen w-full">
        <div className="relative w-full min-h-screen">
          {/* Sidebar */}
          <aside
            className={`fixed left-0 top-0 h-screen bg-[var(--gray_sidebar,#fafafa)] border-r border-[var(--gray_sidebar_stroke,#e2e8f0)] z-20 flex flex-col ${
              isResizingSidebar ? '' : 'transition-[width] duration-200'
            }`}
            style={{ width: sidebarWidth }}
          >
          {/* Logo section */}
          {isSidebarCollapsed ? (
            <div className="h-[64px] bg-white border-b border-r border-[var(--gray_sidebar_stroke,#e2e8f0)] w-[69px]">
              <div className="h-full flex items-center justify-center px-[16px]">
                <button
                  type="button"
                  className="w-[46px] h-[38px] flex items-center justify-center"
                  aria-label="사이드바 펼치기"
                  onClick={() => setIsSidebarCollapsed(false)}
                >
                  <img alt="" className="block w-[46px] h-[38px] object-contain" src={imgKeyboardDoubleArrowRightCollapsed} />
                </button>
              </div>
            </div>
          ) : (
            <div className="h-[64px] bg-white border-b border-[var(--gray_sidebar_stroke,#e2e8f0)]">
              <div className="relative h-full px-[24px] pr-[84px] flex items-center">
                <div className="flex items-center gap-[12px] min-w-0">
                  <div className="h-[15px] w-[36px] overflow-hidden relative shrink-0">
                    <img alt="" className="absolute h-[160.8%] left-0 max-w-none top-[-0.4%] w-full" src={imgLogo1} />
                  </div>
                  <div className="pr-[3.2px] min-w-0">
                    <div className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[20px] tracking-[-0.35px] text-[color:var(--black_title,#0b1828)] truncate">
                      AI 가스 누출 감지 시스템
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="absolute right-[24px] top-1/2 -translate-y-1/2 w-[46px] h-[38px] flex items-center justify-center"
                  aria-label="사이드바 접기"
                  onClick={() => setIsSidebarCollapsed(true)}
                >
                  <div className="-scale-y-100 rotate-180 flex items-center justify-center w-[46px] h-[38px]">
                    <img alt="" className="block w-[46px] h-[38px] object-contain self-center" src={imgKeyboardDoubleArrowRight} />
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Menu / Nav */}
          {isSidebarCollapsed ? (
            <div className="h-[153px] w-[69px] shrink-0">
              <div className="h-full flex flex-col items-center overflow-hidden pb-[24px] pt-[16px] px-[16px]">
                <nav className="flex flex-col items-start">
                  <div className="flex flex-col gap-[4px] items-start">
                    <NavLink
                      to="/"
                      end
                      className={({ isActive }) =>
                        isActive
                          ? 'bg-[var(--blue_primary_50,#e6f3fb)] border border-[var(--blue_primary_500,#61a0e1)] border-solid flex h-[36px] items-center justify-center px-[13px] py-[9px] rounded-[4px] w-[44px]'
                          : 'flex h-[36px] w-[44px] items-center justify-center rounded-[8px] px-[12px] py-[8px]'
                      }
                    >
                      {({ isActive }) => <MaskIcon20 maskSrc={navIcons.analytics.mask} isActive={isActive} />}
                    </NavLink>
                    <NavLink
                      to="/drawing-sensor"
                      className={({ isActive }) =>
                        isActive
                          ? 'bg-[var(--blue_primary_50,#e6f3fb)] border border-[var(--blue_primary_500,#61a0e1)] border-solid flex h-[36px] items-center justify-center px-[13px] py-[9px] rounded-[4px] w-[44px]'
                          : 'flex h-[36px] w-[44px] items-center justify-center rounded-[8px] px-[12px] py-[8px]'
                      }
                    >
                      {({ isActive }) => <MaskIcon20 maskSrc={navIcons.contentPaste.mask} isActive={isActive} />}
                    </NavLink>
                    <NavLink
                      to="/ai-history"
                      className={({ isActive }) =>
                        isActive
                          ? 'bg-[var(--blue_primary_50,#e6f3fb)] border border-[var(--blue_primary_500,#61a0e1)] border-solid flex h-[36px] items-center justify-center px-[13px] py-[9px] rounded-[4px] w-[44px]'
                          : 'flex h-[36px] w-[44px] items-center justify-center rounded-[8px] px-[12px] py-[8px]'
                      }
                    >
                      {({ isActive }) => <MaskIcon20 maskSrc={navIcons.history2.mask} isActive={isActive} />}
                    </NavLink>
                  </div>
                </nav>
              </div>
            </div>
          ) : (
            <div className="px-[16px] pt-[16px] pb-[24px] flex flex-col gap-[16px] min-h-0 flex-1">
              <div className="flex items-center justify-between px-[8px]">
                <div className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[color:var(--black_300,#7a89a1)] uppercase">
                  메뉴
                </div>
                <button
                  type="button"
                  className="w-[20px] h-[20px] flex items-center justify-center"
                  aria-label="메뉴 접기/펼치기"
                  onClick={() => setIsMenuExpanded((v) => !v)}
                >
                  <img
                    alt=""
                    className={`block w-[9px] h-[5.55px] object-contain self-center shrink-0 transition-transform ${isMenuExpanded ? '' : 'rotate-180'}`}
                    src={imgMenuChevron}
                  />
                </button>
              </div>

              {isMenuExpanded && (
                <nav className="flex flex-col gap-[4px]">
                  <NavLink
                    to="/"
                    className={({ isActive }) =>
                      isActive
                        ? 'w-full rounded-[4px] border border-[var(--blue_primary_500,#61a0e1)] bg-[var(--blue_primary_50,#e6f3fb)] px-[13px] py-[9px] flex items-center gap-[8px]'
                        : 'w-full rounded-[4px] px-[12px] py-[8px] flex items-center gap-[8px] hover:bg-[#f1f5f9]'
                    }
                    end
                  >
                    {({ isActive }) => (
                      <>
                        <MaskIcon20 maskSrc={navIcons.analytics.mask} isActive={isActive} />
                        <span
                          className={`font-['Pretendard',sans-serif] text-[16px] leading-[20px] ${
                            isActive ? 'font-semibold text-[color:var(--blue_primary_800,#4370ac)]' : 'font-medium text-[color:var(--black_title,#0b1828)]'
                          }`}
                        >
                          관제
                        </span>
                      </>
                    )}
                  </NavLink>
                  <NavLink
                    to="/drawing-sensor"
                    className={({ isActive }) =>
                      isActive
                        ? 'w-full rounded-[4px] border border-[var(--blue_primary_500,#61a0e1)] bg-[var(--blue_primary_50,#e6f3fb)] px-[13px] py-[9px] flex items-center gap-[8px]'
                        : 'w-full rounded-[4px] px-[12px] py-[8px] flex items-center gap-[8px] hover:bg-[#f1f5f9]'
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <MaskIcon20 maskSrc={navIcons.contentPaste.mask} isActive={isActive} />
                        <span
                          className={`font-['Pretendard',sans-serif] text-[16px] leading-[20px] ${
                            isActive ? 'font-semibold text-[color:var(--blue_primary_800,#4370ac)]' : 'font-medium text-[color:var(--black_title,#0b1828)]'
                          }`}
                        >
                          도면/센서 생성
                        </span>
                      </>
                    )}
                  </NavLink>
                  <NavLink
                    to="/ai-history"
                    className={({ isActive }) =>
                      isActive
                        ? 'w-full rounded-[4px] border border-[var(--blue_primary_500,#61a0e1)] bg-[var(--blue_primary_50,#e6f3fb)] px-[13px] py-[9px] flex items-center gap-[8px]'
                        : 'w-full rounded-[8px] px-[12px] py-[8px] flex items-center gap-[8px] hover:bg-[#f1f5f9]'
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <MaskIcon20 maskSrc={navIcons.history2.mask} isActive={isActive} />
                        <span
                          className={`font-['Pretendard',sans-serif] text-[16px] leading-[20px] ${
                            isActive ? 'font-semibold text-[color:var(--blue_primary_800,#4370ac)]' : 'font-medium text-[color:var(--black_title,#0b1828)]'
                          }`}
                        >
                          AI 판단 이력
                        </span>
                      </>
                    )}
                  </NavLink>
                </nav>
              )}

              <DrawingManagementSection />
            </div>
          )}

          {!isSidebarCollapsed && (
            <div
              className="absolute right-0 top-0 z-30 h-full w-[6px]"
              onMouseEnter={() => setResizeHandleHover(true)}
              onMouseLeave={() => setResizeHandleHover(false)}
            >
              {resizeHandleHover && !isResizingSidebar && (
                <div
                  className="pointer-events-none absolute left-full top-1/2 z-[100] ml-[8px] -translate-y-1/2"
                  aria-hidden
                >
                  <div className="bg-[#2f2f2f] text-white rounded-[12px] px-[14px] py-[10px] shadow-[0px_8px_24px_rgba(0,0,0,0.2)]">
                    <div className="font-['Pretendard',sans-serif] font-semibold text-[18px] leading-[1.2] whitespace-nowrap">
                      크기 조정 드래그
                    </div>
                  </div>
                </div>
              )}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-valuemin={SIDEBAR_MIN_EXPANDED_W}
                aria-valuemax={SIDEBAR_MAX_EXPANDED_W}
                aria-valuenow={Math.round(expandedSidebarWidth)}
                aria-label="사이드바 너비 조절"
                className="h-full w-full cursor-col-resize select-none touch-none"
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  setIsResizingSidebar(true)
                  const startX = e.clientX
                  const startW = resizeLastWidthRef.current

                  const onMove = (ev: PointerEvent) => {
                    const delta = ev.clientX - startX
                    const next = Math.min(
                      SIDEBAR_MAX_EXPANDED_W,
                      Math.max(SIDEBAR_MIN_EXPANDED_W, startW + delta),
                    )
                    resizeLastWidthRef.current = next
                    setExpandedSidebarWidth(next)
                  }

                  const onUp = () => {
                    setIsResizingSidebar(false)
                    window.removeEventListener('pointermove', onMove)
                    window.removeEventListener('pointerup', onUp)
                    window.removeEventListener('pointercancel', onUp)
                    try {
                      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(resizeLastWidthRef.current)))
                    } catch {
                      /* ignore */
                    }
                  }

                  window.addEventListener('pointermove', onMove)
                  window.addEventListener('pointerup', onUp)
                  window.addEventListener('pointercancel', onUp)
                }}
              />
            </div>
          )}
        </aside>

        {/* Header */}
        <header
          className={`fixed right-0 top-0 h-[64px] bg-white border-b border-[var(--gray_sidebar_stroke,#e2e8f0)] z-10 ${
            isResizingSidebar ? '' : 'transition-[left] duration-200'
          }`}
          style={{ left: sidebarWidth }}
        >
          <div className="h-full flex items-center justify-end gap-[12px] pl-[24px] pr-[24px]">
            <div className="h-[42px] rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] px-[13px] py-[5px] flex items-center gap-[8px]">
              <span className="font-['Pretendard',sans-serif] font-medium text-[16px] leading-[15px] tracking-[-0.25px] text-[color:var(--black_title,#0b1828)] uppercase whitespace-nowrap">
                MES 설비 가동
              </span>
              <span className="flex items-center gap-[6px]">
                <span className="w-[6px] h-[6px]">
                  <img alt="" className="block w-full h-full" src={imgRunDot} />
                </span>
                <span className="font-['Pretendard',sans-serif] font-medium text-[16px] leading-[15px] tracking-[-0.25px] text-[#22c55e] uppercase whitespace-nowrap">
                  Run
                </span>
              </span>
            </div>

            <div className="flex items-center h-[41px]">
              <button
                type="button"
                className="h-[40px] bg-[#ef4444] border border-[rgba(226,232,240,0.1)] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] rounded-bl-[4px] rounded-tl-[4px] px-[13px] py-[7px] text-white font-['Pretendard',sans-serif] font-medium text-[16px] leading-[15px] tracking-[-0.25px] uppercase whitespace-nowrap"
              >
                비상 제어
              </button>
              <button
                type="button"
                className="h-[40px] bg-[#ef4444] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] rounded-br-[4px] rounded-tr-[4px] p-[6px] flex items-center justify-center"
                aria-label="비상 제어 메뉴"
              >
                <img alt="" className="block w-[6px] h-[3.7px]" src={imgEmergencyCaret} />
              </button>
            </div>
          </div>
        </header>

        {/* Body placeholder (EMPTY as requested) */}
        <main
          className={`pt-[64px] min-h-screen bg-white ${isResizingSidebar ? '' : 'transition-[margin-left] duration-200'}`}
          style={{ marginLeft: sidebarWidth }}
        >
          <Outlet />
        </main>
      </div>
    </div>
    </ActiveDrawingProvider>
  )
}

