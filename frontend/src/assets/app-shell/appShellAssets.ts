import imgAnalyticsCollapsed from './analytics.svg?url'
import imgContentPasteCollapsed from './content-paste.svg?url'
import imgDrawingsChevron from './drawings-chevron.svg?url'
import emergencyCaret from './emergency-caret.svg?url'
import imgHistory2Collapsed from './history.svg?url'
import imgLogo1 from './logo-mark.svg?url'
import imgMenuChevron from './menu-chevron.svg?url'
import imgRunDot from './run-dot.svg?url'

/** `public/app-shell/*` — 이중 화살표는 Vite `?url`이 `/src/assets/...`로 잡혀 깨지는 경우가 있어 정적 경로 사용 */
function appShellIconUrl(name: string) {
  return `${import.meta.env.BASE_URL}app-shell/${name}`
}

/**
 * - 접힌 사이드바·펼치기: >> (`keyboard_double_arrow_right-1.svg`)
 * - 펼친 사이드바·접기: << (`keyboard_double_arrow_right.svg`)
 */
export const appShellAssets = {
  imgLogo1,
  imgRunDot,
  imgEmergencyCaret: emergencyCaret,
  /** 펼침 → 접기 (<<) */
  imgKeyboardDoubleArrowRight: appShellIconUrl('keyboard_double_arrow_right.svg'),
  imgMenuChevron,
  imgDrawingsChevron,

  /** 접힘 → 펼치기 (>>) */
  imgKeyboardDoubleArrowRightCollapsed: appShellIconUrl('keyboard_double_arrow_right-1.svg'),
  imgAnalyticsCollapsed,
  imgContentPasteCollapsed,
  imgHistory2Collapsed,
} as const
