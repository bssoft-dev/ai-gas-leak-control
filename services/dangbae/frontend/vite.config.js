import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolveUiServerProxyTarget, watchUiServerPortChanges } from '../../vite-resolve-ui-port.mjs'

// 카카오맵 SDK가 eval/Function을 사용하므로 CSP에서 script-src 'unsafe-eval' 허용
const cspPlugin = () => ({
  name: 'csp-allow-eval',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/' || req.url?.startsWith('/index.html')) {
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; " +
            "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://dapi.kakao.com https://t1.daumcdn.net; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: https: blob:; " +
            "connect-src 'self' https://dapi.kakao.com https://*.kakao.com https://t1.daumcdn.net wss:; " +
            "frame-src 'self' https:; " +
            "child-src 'self' https:;"
        )
      }
      next()
    })
  }
})

// 우선순위: env(UI_SERVER_PORT) → ../.ui-server-port(ui_server 실제 포트) → service.yaml
const apiTarget = resolveUiServerProxyTarget(import.meta.url, '26015')

export default defineConfig({
  plugins: [
    react(),
    cspPlugin(),
    watchUiServerPortChanges(import.meta.url, '26015'),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['oauth-callback.html', 'pwa-icon.svg', 'apple-touch-icon.svg'],
      manifest: {
        name: '당배 - 당신의 배송',
        short_name: '당배',
        description: '중고거래 배송을 빠르게 연결하는 당배 서비스 - 계좌이체·만나서 결제 지원',
        theme_color: '#1A56DB',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/#/landing',
        scope: '/',
        lang: 'ko',
        icons: [
          {
            src: '/pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'dangbae-api-cache',
              networkTimeoutSeconds: 6,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5,
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 36015,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      }
    },
    allowedHosts: ['dangbae.bs-soft.co.kr', 'dev.dangbae.bs-soft.co.kr'],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
