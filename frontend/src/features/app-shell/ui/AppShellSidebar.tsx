import { type PointerEvent as ReactPointerEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import { appShellAssets } from '../assets/appShellAssets'
import { DrawingManagementSection } from './DrawingManagementSection'

type AppShellSidebarProps = {
  sidebarWidth: number
  isSidebarCollapsed: boolean
  isMenuExpanded: boolean
  isDrawingsExpanded: boolean
  isResizingSidebar: boolean
  resizeHandleHover: boolean
  onExpandSidebar: () => void
  onCollapseSidebar: () => void
  onToggleMenu: () => void
  onToggleDrawings: () => void
  onResizeHandleEnter: () => void
  onResizeHandleLeave: () => void
  onResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => void
}

type NavItem = {
  to: string
  label: string
  iconSrc: string
  end?: boolean
}

type NavSection = {
  label: string
  iconSrc: string
  basePath: string
  items: NavItem[]
}

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { to: '/', label: '관제', iconSrc: appShellAssets.imgAnalyticsCollapsed, end: true },
  { to: '/drawing-sensor', label: '도면/센서 생성', iconSrc: appShellAssets.imgContentPasteCollapsed },
]

const HISTORY_SECTION: NavSection = {
  label: '이력',
  iconSrc: appShellAssets.imgHistory2Collapsed,
  basePath: '/history',
  items: [
    { to: '/history/ai', label: 'AI 판단 이력', iconSrc: appShellAssets.imgHistory2Collapsed },
    { to: '/history/control-alarm', label: '제어·알람 이력', iconSrc: appShellAssets.imgHistory2Collapsed },
  ],
}

const SETTINGS_ITEM: NavItem = {
  to: '/settings',
  label: '설정',
  iconSrc: appShellAssets.imgContentPasteCollapsed,
}

export function AppShellSidebar({
  sidebarWidth,
  isSidebarCollapsed,
  isMenuExpanded,
  isDrawingsExpanded,
  isResizingSidebar,
  resizeHandleHover,
  onExpandSidebar,
  onCollapseSidebar,
  onToggleMenu,
  onToggleDrawings,
  onResizeHandleEnter,
  onResizeHandleLeave,
  onResizeStart,
}: AppShellSidebarProps) {
  const BLUE_PRIMARY_800 = '#4370ac'
  const ICON_INACTIVE = '#0b1828'
  const location = useLocation()
  const navigate = useNavigate()
  const {
    imgLogo1,
    imgKeyboardDoubleArrowRight,
    imgKeyboardDoubleArrowRightCollapsed,
    imgMenuChevron,
  } = appShellAssets

  const isHistoryActive = location.pathname.startsWith(HISTORY_SECTION.basePath)

  const MaskIcon20 = ({ maskSrc, isActive }: { maskSrc: string; isActive: boolean }) => (
    <span
      className="block h-5 w-5 shrink-0"
      style={{
        backgroundColor: isActive ? BLUE_PRIMARY_800 : ICON_INACTIVE,
        WebkitMaskImage: `url(${maskSrc})`,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        WebkitMaskSize: 'contain',
        WebkitMaskMode: 'alpha',
        maskImage: `url(${maskSrc})`,
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        maskSize: 'contain',
        maskMode: 'alpha',
      }}
    />
  )

  const renderNavLink = ({ to, label, iconSrc, end }: NavItem, compact = false, nested = false) => (
    <NavLink
      key={to}
      to={to}
      end={end}
      className={({ isActive }) =>
        compact
          ? isActive
            ? 'flex h-[36px] w-[44px] items-center justify-center rounded-[4px] border border-[var(--blue_primary_500,#61a0e1)] bg-[var(--blue_primary_50,#e6f3fb)] px-[13px] py-[9px]'
            : 'flex h-[36px] w-[44px] items-center justify-center rounded-[8px] px-[12px] py-[8px]'
          : isActive
            ? `flex w-full items-center gap-[8px] rounded-[4px] border border-[var(--blue_primary_500,#61a0e1)] bg-[var(--blue_primary_50,#e6f3fb)] ${nested ? 'px-[12px] py-[8px]' : 'px-[13px] py-[9px]'}`
            : `flex w-full items-center gap-[8px] rounded-[4px] ${nested ? 'px-[12px] py-[8px]' : 'px-[12px] py-[8px]'} hover:bg-[#f1f5f9]`
      }
    >
      {({ isActive }) => (
        <>
          <MaskIcon20 maskSrc={iconSrc} isActive={isActive} />
          {!compact && (
            <span
              className={`font-['Pretendard',sans-serif] text-[16px] leading-[20px] ${
                isActive
                  ? 'font-semibold text-[color:var(--blue_primary_800,#4370ac)]'
                  : 'font-medium text-[color:var(--black_title,#0b1828)]'
              }`}
            >
              {label}
            </span>
          )}
        </>
      )}
    </NavLink>
  )

  const renderHistorySection = (compact = false) => {
    if (compact) {
      return (
        <button
          type="button"
          className={
            isHistoryActive
              ? 'flex h-[36px] w-[44px] items-center justify-center rounded-[4px] border border-[var(--blue_primary_500,#61a0e1)] bg-[var(--blue_primary_50,#e6f3fb)] px-[13px] py-[9px]'
              : 'flex h-[36px] w-[44px] items-center justify-center rounded-[8px] px-[12px] py-[8px]'
          }
          aria-label={HISTORY_SECTION.label}
          onClick={() => navigate(HISTORY_SECTION.items[0].to)}
        >
          <MaskIcon20 maskSrc={HISTORY_SECTION.iconSrc} isActive={isHistoryActive} />
        </button>
      )
    }

    return (
      <div className="flex flex-col gap-[4px]">
        <button
          type="button"
          className={
            isHistoryActive
              ? 'flex w-full items-center gap-[8px] rounded-[4px] border border-[var(--blue_primary_500,#61a0e1)] bg-[var(--blue_primary_50,#e6f3fb)] px-[13px] py-[9px]'
              : 'flex w-full items-center gap-[8px] rounded-[4px] px-[12px] py-[8px] hover:bg-[#f1f5f9]'
          }
          onClick={() => navigate(HISTORY_SECTION.items[0].to)}
        >
          <MaskIcon20 maskSrc={HISTORY_SECTION.iconSrc} isActive={isHistoryActive} />
          <span
            className={`font-['Pretendard',sans-serif] text-[16px] leading-[20px] ${
              isHistoryActive
                ? 'font-semibold text-[color:var(--blue_primary_800,#4370ac)]'
                : 'font-medium text-[color:var(--black_title,#0b1828)]'
            }`}
          >
            {HISTORY_SECTION.label}
          </span>
        </button>

        <div className="ml-[16px] flex flex-col gap-[4px] border-l border-[#dbe4f0] pl-[12px]">
          {HISTORY_SECTION.items.map((item) => renderNavLink(item, false, true))}
        </div>
      </div>
    )
  }

  return (
    <aside
      className={`fixed left-0 top-0 z-20 flex h-screen flex-col border-r border-[var(--gray_sidebar_stroke,#e2e8f0)] bg-[var(--gray_sidebar,#fafafa)] ${
        isResizingSidebar ? '' : 'transition-[width] duration-200'
      }`}
      style={{ width: sidebarWidth }}
    >
      {isSidebarCollapsed ? (
        <div className="h-[64px] w-[69px] border-b border-r border-[var(--gray_sidebar_stroke,#e2e8f0)] bg-white">
          <div className="flex h-full items-center justify-center px-[16px]">
            <button
              type="button"
              className="flex h-[36px] w-[36px] items-center justify-center"
              aria-label="사이드바 펼치기"
              onClick={onExpandSidebar}
            >
              <img alt="" className="block h-[20px] w-[20px] object-contain" src={imgKeyboardDoubleArrowRightCollapsed} />
            </button>
          </div>
        </div>
      ) : (
        <div className="h-[64px] border-b border-[var(--gray_sidebar_stroke,#e2e8f0)] bg-white">
          <div className="relative flex h-full items-center px-[24px] pr-[60px]">
            <div className="flex min-w-0 items-center gap-[12px]">
              <div className="relative h-[15px] w-[36px] shrink-0 overflow-hidden">
                <img alt="" className="absolute left-0 top-[-0.4%] h-[160.8%] w-full max-w-none" src={imgLogo1} />
              </div>
              <div className="min-w-0 pr-[3.2px]">
                <div className="truncate font-['Pretendard',sans-serif] text-[16px] font-semibold leading-[20px] tracking-[-0.35px] text-[color:var(--black_title,#0b1828)]">
                  AI 가스 누출 감지 시스템
                </div>
              </div>
            </div>
            <button
              type="button"
              className="absolute right-[24px] top-1/2 flex h-[36px] w-[36px] -translate-y-1/2 items-center justify-center"
              aria-label="사이드바 접기"
              onClick={onCollapseSidebar}
            >
              <img alt="" className="block h-[20px] w-[20px] object-contain" src={imgKeyboardDoubleArrowRight} />
            </button>
          </div>
        </div>
      )}

      {isSidebarCollapsed ? (
        <div className="shrink-0">
          <div className="flex h-full flex-col items-center overflow-hidden px-[16px] pb-[24px] pt-[16px]">
            <nav className="flex flex-col gap-[4px]">
              {PRIMARY_NAV_ITEMS.map((item) => renderNavLink(item, true))}
              {renderHistorySection(true)}
              {renderNavLink(SETTINGS_ITEM, true)}
            </nav>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[16px] px-[16px] pb-[24px] pt-[16px]">
          <div className="flex items-center justify-between px-[8px]">
            <div className="font-['Pretendard',sans-serif] text-[16px] font-semibold leading-[1.2] text-[color:var(--black_300,#7a89a1)]">
              메뉴
            </div>
            <button
              type="button"
              className="flex h-[20px] w-[20px] items-center justify-center"
              aria-label="메뉴 접기/펼치기"
              onClick={onToggleMenu}
            >
              <img
                alt=""
                className={`block h-[10px] w-[6px] shrink-0 self-center object-contain transition-transform rotate-90 ${isMenuExpanded ? '' : 'rotate-180'}`}
                src={imgMenuChevron}
              />
            </button>
          </div>

          {isMenuExpanded && (
            <nav className="flex flex-col gap-[4px]">
              {PRIMARY_NAV_ITEMS.map((item) => renderNavLink(item))}
              {renderHistorySection(false)}
              {renderNavLink(SETTINGS_ITEM)}
            </nav>
          )}

          <DrawingManagementSection isExpanded={isDrawingsExpanded} onToggle={onToggleDrawings} />
        </div>
      )}

      {!isSidebarCollapsed && (
        <div
          className="absolute right-0 top-0 z-30 h-full w-[6px]"
          onMouseEnter={onResizeHandleEnter}
          onMouseLeave={onResizeHandleLeave}
        >
          {resizeHandleHover && !isResizingSidebar && (
            <div className="pointer-events-none absolute left-full top-1/2 z-[100] ml-[8px] -translate-y-1/2" aria-hidden>
              <div className="rounded-[12px] bg-[#2f2f2f] px-[14px] py-[10px] text-white shadow-[0px_8px_24px_rgba(0,0,0,0.2)]">
                <div className="whitespace-nowrap font-['Pretendard',sans-serif] text-[18px] font-semibold leading-[1.2]">
                  크기 조정 드래그
                </div>
              </div>
            </div>
          )}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuemin={268}
            aria-valuemax={445}
            aria-valuenow={Math.round(sidebarWidth)}
            aria-label="사이드바 너비 조절"
            className="h-full w-full cursor-col-resize select-none touch-none"
            onPointerDown={onResizeStart}
          />
        </div>
      )}
    </aside>
  )
}
