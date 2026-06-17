/* SagoHub 가스누출 PWA — 앱 셸 캐시 + API는 네트워크 우선 */
const CACHE_VERSION = 'gas-leak-pwa-v1'
const SHELL_CACHE = `${CACHE_VERSION}-shell`

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/logo.svg',
  '/icons/logo.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('gas-leak-pwa-') && k !== SHELL_CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((r) => r || new Response('오프라인', { status: 503 })),
      ),
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html').then((r) => r || fetch(request))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((res) => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res
        const copy = res.clone()
        caches.open(SHELL_CACHE).then((c) => c.put(request, copy))
        return res
      })
    }),
  )
})

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: '가스 누출 알림', body: '위험 상태가 감지되었습니다.' }
  event.waitUntil(
    self.registration.showNotification(data.title || '가스 누출', {
      body: data.body || '',
      icon: '/icons/logo.svg',
      badge: '/icons/logo.svg',
      tag: data.tag || 'gas-leak-alert',
      data: data,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/#/mobile/alerts'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return clients.openWindow(target)
    }),
  )
})
