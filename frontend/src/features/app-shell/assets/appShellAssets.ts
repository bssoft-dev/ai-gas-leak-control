import { publicIconUrl } from '../../../shared/lib/publicIconUrl'

const icon = publicIconUrl

export const appShellAssets = {
  imgLogo1: '/logo-bluesp.png',
  imgRunDot: icon('run-dot.svg'),
  imgEmergencyCaret: icon('emergency-caret.svg'),
  /** 사이드바 열림(헤더) — 접기 « */
  imgKeyboardDoubleArrowRight: icon('keyboard_double_arrow_right.svg'),
  imgMenuChevron: icon('menu-chevron.svg'),
  imgDrawingsChevron: icon('drawings-chevron.svg'),

  /** 사이드바 닫힘(좁은 헤더) — 펼치기 » */
  imgKeyboardDoubleArrowRightCollapsed: icon('keyboard_double_arrow_right-1.svg'),

  // Collapsed 사이드바 네비 — 20x20 마스크 아이콘 (node 227:1705)
  imgAnalyticsCollapsed: icon('mask-analytics.svg'),
  imgContentPasteCollapsed: icon('mask-content-paste.svg'),
  imgHistory2Collapsed: icon('mask-history.svg'),
  /** 도면 목록 행 삭제 (Figma sidebar drawing row) */
  imgDrawingDelete: icon('drawing-delete.svg'),
} as const
