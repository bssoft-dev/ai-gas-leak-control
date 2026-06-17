export const SIDEBAR_COLLAPSED_W = 69
export const SIDEBAR_MIN_EXPANDED_W = 268
export const SIDEBAR_MAX_EXPANDED_W = 445
export const SIDEBAR_WIDTH_STORAGE_KEY = 'gl-app-shell-sidebar-expanded-w'

export function readStoredSidebarWidth(): number | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (!raw) return null
    const width = Number(raw)
    if (!Number.isFinite(width)) return null
    return width
  } catch {
    return null
  }
}

export function normalizeSearchText(value: string) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim()
}
