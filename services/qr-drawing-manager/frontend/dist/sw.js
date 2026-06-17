const SW_VERSION = "v1.0.1"
const APP_SHELL_CACHE = `qdg-app-shell-${SW_VERSION}`
const STATIC_CACHE = `qdg-static-${SW_VERSION}`
const API_CACHE = `qdg-api-${SW_VERSION}`

// addAll은 한 URL이라도 실패하면 전체 reject → 개별 add + 실패 무시
const APP_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/manifest.webmanifest",
  "/offline.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
]

async function precacheAppShell(cache) {
  await Promise.all(
    APP_SHELL_ASSETS.map((url) =>
      cache.add(url).catch(() => {
        /* 개별 자산 404 등으로 install 전체 실패 방지 */
      })
    )
  )
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => precacheAppShell(cache)).then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![APP_SHELL_CACHE, STATIC_CACHE, API_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

function isStaticAsset(reqUrl, request) {
  if (reqUrl.origin !== self.location.origin) return false
  return ["style", "script", "image", "font"].includes(request.destination) || reqUrl.pathname.startsWith("/assets/")
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => null)

  return cached || networkFetch || Response.error()
}

async function networkFirstForApi(request) {
  const cache = await caches.open(API_CACHE)
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch (_) {
    const cached = await cache.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ detail: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const reqUrl = new URL(request.url)

  if (request.method !== "GET") return

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone()
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(async () => {
          const shell =
            (await caches.match(request)) ||
            (await caches.match("/")) ||
            (await caches.match("/index.html")) ||
            (await caches.match("/offline.html"))
          return shell || Response.error()
        })
    )
    return
  }

  if (reqUrl.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstForApi(request))
    return
  }

  if (isStaticAsset(reqUrl, request)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") self.skipWaiting()
})
