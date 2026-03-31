import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'

import { appShellAssets } from '../../assets/app-shell/appShellAssets'
import { ActiveDrawingProvider, useActiveDrawing } from '../../state/activeDrawing'

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
  } = appShellAssets

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isMenuExpanded, setIsMenuExpanded] = useState(true)
  const [isDrawingsExpanded, setIsDrawingsExpanded] = useState(true)

  const sidebarWidth = isSidebarCollapsed ? 69 : 268
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

  const ActiveDrawingsList = () => {
    const { drawings, activeDrawingId, setActiveDrawingId } = useActiveDrawing()
    const navigate = useNavigate()
    const location = useLocation()

    return (
      <div className="flex flex-col gap-[4px]">
        {drawings.map((d) => {
          const isActive = d.id === activeDrawingId

          return (
            <button
              key={d.id}
              type="button"
              className={
                isActive
                  ? 'w-full rounded-[4px] border border-[var(--blue_primary_500,#61a0e1)] bg-[var(--blue_primary_50,#e6f3fb)] px-[13px] py-[9px] flex items-center justify-between'
                  : 'w-full rounded-[8px] px-[12px] py-[8px] flex items-center justify-between'
              }
              onClick={() => {
                setActiveDrawingId(d.id)
                if (location.pathname !== '/') navigate('/')
              }}
            >
              <span
                className={`font-['Pretendard',sans-serif] text-[16px] leading-[20px] ${
                  isActive ? 'font-semibold text-[color:var(--blue_primary_800,#4370ac)]' : 'font-medium text-[color:var(--black_title,#0b1828)]'
                }`}
              >
                {d.name}
              </span>

              {isActive && (
                <span className="relative w-[8px] h-[8px] rounded-[9999px] bg-[var(--green,#22c55e)]">
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-[9999px] shadow-[0px_0px_0px_4px_rgba(34,197,94,0.2)]" />
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <ActiveDrawingProvider>
      <div className="bg-white min-h-screen w-full">
        <div className="relative w-full min-h-screen">
          {/* Sidebar */}
          <aside
            className="fixed left-0 top-0 h-screen bg-[var(--gray_sidebar,#fafafa)] border-r border-[var(--gray_sidebar_stroke,#e2e8f0)] z-20 transition-[width] duration-200 flex flex-col"
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
            <div className="px-[16px] pt-[16px] pb-[24px] flex flex-col gap-[16px] overflow-y-auto scrollbar-thin">
              <div className="flex items-center justify-between px-[24px]">
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
                        : 'w-full rounded-[4px] px-[12px] py-[8px] flex items-center gap-[8px]'
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
                        : 'w-full rounded-[4px] px-[12px] py-[8px] flex items-center gap-[8px]'
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
                        : 'w-full rounded-[8px] px-[12px] py-[8px] flex items-center gap-[8px]'
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

              {/* Active drawings (only in expanded sidebar) */}
              <div className="border-t border-[#c0ccde] pt-[16px] flex flex-col gap-[16px]">
                <div className="flex items-center justify-between px-[24px]">
                  <div className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[color:var(--black_300,#7a89a1)] uppercase">
                    활성화 도면
                  </div>
                  <button
                    type="button"
                    className="w-[20px] h-[20px] flex items-center justify-center"
                    aria-label="활성화 도면 접기/펼치기"
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
                  <ActiveDrawingsList />
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Header */}
        <header
          className="fixed right-0 top-0 h-[64px] bg-white border-b border-[var(--gray_sidebar_stroke,#e2e8f0)] z-10 transition-[left] duration-200"
          style={{ left: sidebarWidth }}
        >
          <div className="h-full flex items-center justify-end gap-[12px] pl-[24px] pr-[200px]">
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
        <main className="pt-[64px] min-h-screen bg-white" style={{ marginLeft: sidebarWidth }}>
          <Outlet />
        </main>
      </div>
    </div>
    </ActiveDrawingProvider>
  )
}

