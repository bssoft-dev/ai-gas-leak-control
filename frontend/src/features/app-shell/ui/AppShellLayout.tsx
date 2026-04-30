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

export default function AppShellLayout() {
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

  return (
    <EventStreamProvider>
      <ActiveDrawingProvider>
        <div className="min-h-screen w-full bg-white">
          <div className="relative min-h-screen w-full">
            <AppShellSidebar
              sidebarWidth={sidebarWidth}
              isSidebarCollapsed={isSidebarCollapsed}
              isMenuExpanded={isMenuExpanded}
              isDrawingsExpanded={isDrawingsExpanded}
              isResizingSidebar={isResizingSidebar}
              resizeHandleHover={resizeHandleHover}
              onExpandSidebar={() => setIsSidebarCollapsed(false)}
              onCollapseSidebar={() => setIsSidebarCollapsed(true)}
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

            <AppShellHeader sidebarWidth={sidebarWidth} isResizingSidebar={isResizingSidebar} />

            <main
              className={`flex min-h-screen flex-col bg-white pt-[64px] ${isResizingSidebar ? '' : 'transition-[margin-left] duration-200'}`}
              style={{ marginLeft: sidebarWidth }}
            >
              <div className="min-h-0 flex-1">
                <Outlet />
              </div>
              <footer className="shrink-0 border-t border-[#e8edf5] px-[24px] py-[8px] text-right font-['Pretendard',sans-serif] text-[11px] leading-[1.4] text-[#94a3b8]">
                Copyright © BLUESP. All rights reserved. / Designed & Developed by BSSOFT
              </footer>
            </main>
          </div>
        </div>
      </ActiveDrawingProvider>
    </EventStreamProvider>
  )
}
