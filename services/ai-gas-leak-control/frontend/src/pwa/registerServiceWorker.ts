export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
    return registration
  } catch (error) {
    console.warn('[PWA] service worker registration failed', error)
    return null
  }
}

export function isStandaloneDisplayMode(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function redirectStandaloneToMobileHome(): void {
  if (!isStandaloneDisplayMode()) return
  const hash = window.location.hash || ''
  if (hash.includes('/mobile')) return
  window.location.replace(`${window.location.pathname}${window.location.search}#/mobile/home`)
}
