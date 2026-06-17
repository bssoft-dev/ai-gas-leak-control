import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { loadServiceYaml } from './load-service-yaml.mjs'
import { resolveUiServerProxyTarget, watchUiServerPortChanges } from '../../vite-resolve-ui-port.mjs'

const yamlDoc = loadServiceYaml(import.meta.url)
const meta = yamlDoc.service ?? {}
const ui = meta.ui_server ?? {}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const env = loadEnv(
  process.env.NODE_ENV === 'production' ? 'production' : 'development',
  projectRoot,
  '',
)

const fallbackPort = String(ui.external_port ?? 26016)
const apiTarget = resolveUiServerProxyTarget(import.meta.url, fallbackPort)
const sayuTarget =
  (env.SAYU_LOCAL_API_URL || process.env.SAYU_LOCAL_API_URL || '').trim() ||
  `http://127.0.0.1:${(env.SAYU_LOCAL_API_PORT || process.env.SAYU_LOCAL_API_PORT || '27100').trim()}`

const hubTarget =
  (typeof ui.event_bus_url === 'string' && ui.event_bus_url.trim()) ||
  `http://${process.env.EVENT_BUS_HOST ?? '127.0.0.1'}:${process.env.EVENT_BUS_PORT ?? '26010'}`

function resolveVitePort() {
  const fromEnv = env.SERVICE_VITE_PORT || process.env.SERVICE_VITE_PORT
  const fromYaml = ui.vite_port
  const n = Number(fromEnv ?? fromYaml ?? 26100)
  return Number.isFinite(n) && n > 0 ? n : 26100
}

const vitePort = resolveVitePort()

export default defineConfig({
  plugins: [react(), watchUiServerPortChanges(import.meta.url, fallbackPort)],
  server: {
    host: ui.host ?? '0.0.0.0',
    port: vitePort,
    proxy: {
      // LLM API 모델 목록 (CORS 회피, /llm-api → 호스트)
      '/llm-api': {
        target: 'https://llm-api.bs-soft.co.kr',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/llm-api/, '') || '/',
      },
      // Sa-Yu 로컬 볼트 API (SagoHub 코어가 아닌 서비스 측 프로세스)
      '/api/sayu': {
        target: sayuTarget,
        changeOrigin: true,
      },
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/event-bus': {
        target: hubTarget,
        changeOrigin: true,
        rewrite: (path) => {
          if (!path.startsWith('/event-bus')) return path
          const suffix = path.slice('/event-bus'.length)
          if (suffix === '' || suffix === '/') return '/'
          return suffix.startsWith('/') ? suffix : `/${suffix}`
        },
      },
    },
    allowedHosts: ['localhost', '127.0.0.1', 'dev.doc.bs-soft.co.kr','doc.bs-soft.co.kr'],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
