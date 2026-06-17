import { Outlet } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'

import { ActiveDrawingProvider } from '../../../entities/drawing/model/activeDrawing'
import { EventStreamProvider } from '../../../shared/events/EventStreamProvider'
import {
  readStoredSidebarWidth,
  SIDEBAR_COLLAPSED_W,
  SIDEBAR_MAX_EXPANDED_W,
  SIDEBAR_MIN_EXPANDED_W,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from '../model/sidebar'
import { AppShellHeader } from './AppShellHeader'
import { AppShellSidebar } from './AppShellSidebar'

function getViewportTier() {
  if (typeof window === 'undefined') return 'desktop'
  if (window.innerWidth < 768) return 'mobile'
  if (window.innerWidth < 1024) return 'tablet'
  return 'desktop'
}

export default function AppShellLayout() {
  const [viewportTier, setViewportTier] = useState(getViewportTier)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
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

  useEffect(() => {
    const onResize = () => setViewportTier(getViewportTier())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (viewportTier !== 'mobile') {
      setIsMobileSidebarOpen(false)
    }
  }, [viewportTier])

  const isMobileViewport = viewportTier === 'mobile'
  const isTabletViewport = viewportTier === 'tablet'
  const effectiveSidebarCollapsed = isTabletViewport ? true : isSidebarCollapsed
  const sidebarWidth = isMobileViewport
    ? Math.min(320, Math.max(SIDEBAR_MIN_EXPANDED_W, expandedSidebarWidth))
    : effectiveSidebarCollapsed
      ? SIDEBAR_COLLAPSED_W
      : expandedSidebarWidth
  const contentOffset = isMobileViewport ? 0 : sidebarWidth

  return (
    <EventStreamProvider>
      <ActiveDrawingProvider>
        <div className="min-h-screen w-full bg-white">
          <div className="relative min-h-screen w-full">
            <AppShellSidebar
              sidebarWidth={sidebarWidth}
              isSidebarCollapsed={effectiveSidebarCollapsed}
              isMenuExpanded={isMenuExpanded}
              isDrawingsExpanded={isDrawingsExpanded}
              isResizingSidebar={isResizingSidebar}
              resizeHandleHover={resizeHandleHover}
              isMobileViewport={isMobileViewport}
              isMobileSidebarOpen={isMobileSidebarOpen}
              onExpandSidebar={() => setIsSidebarCollapsed(false)}
              onCollapseSidebar={() => setIsSidebarCollapsed(true)}
              onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
              onToggleMenu={() => setIsMenuExpanded((expanded) => !expanded)}
              onToggleDrawings={() => setIsDrawingsExpanded((expanded) => !expanded)}
              onResizeHandleEnter={() => setResizeHandleHover(true)}
              onResizeHandleLeave={() => setResizeHandleHover(false)}
              onResizeStart={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                setIsResizingSidebar(true)
                const startX = e.clientX
                const startWidth = resizeLastWidthRef.current

                const onMove = (event: PointerEvent) => {
                  const delta = event.clientX - startX
                  const nextWidth = Math.min(
                    SIDEBAR_MAX_EXPANDED_W,
                    Math.max(SIDEBAR_MIN_EXPANDED_W, startWidth + delta),
                  )
                  resizeLastWidthRef.current = nextWidth
                  setExpandedSidebarWidth(nextWidth)
                }

                const onStop = () => {
                  setIsResizingSidebar(false)
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onStop)
                  window.removeEventListener('pointercancel', onStop)
                  try {
                    localStorage.setItem(
                      SIDEBAR_WIDTH_STORAGE_KEY,
                      String(Math.round(resizeLastWidthRef.current)),
                    )
                  } catch {
                    /* ignore storage failure */
                  }
                }

                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onStop)
                window.addEventListener('pointercancel', onStop)
              }}
            />

            {isMobileViewport && isMobileSidebarOpen && (
              <button
                type="button"
                className="fixed inset-0 z-[15] cursor-default bg-[#0b1828]/35"
                aria-label="사이드바 닫기"
                onClick={() => setIsMobileSidebarOpen(false)}
              />
            )}

            <AppShellHeader
              sidebarWidth={contentOffset}
              isResizingSidebar={isResizingSidebar}
              isMobileViewport={isMobileViewport}
              onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
            />

            <main
              className={`flex min-h-screen flex-col bg-white pt-[64px] ${isResizingSidebar ? '' : 'transition-[margin-left] duration-200'}`}
              style={{ marginLeft: contentOffset }}
            >
              <div className="min-h-0 flex-1">
                <Outlet />
              </div>
              <footer className="shrink-0 px-[12px] py-[8px] text-right font-['Pretendard',sans-serif] text-[10px] leading-[1.4] text-[#94a3b8] sm:px-[16px] md:px-[24px] md:text-[11px]">
                Copyright © BLUESP. All rights reserved. / Designed & Developed by BSSOFT
              </footer>
            </main>
          </div>
        </div>
      </ActiveDrawingProvider>
    </EventStreamProvider>
  )
}
