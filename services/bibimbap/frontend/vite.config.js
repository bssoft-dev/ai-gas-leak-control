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

const fallbackPort = String(ui.external_port ?? 26030)
const apiTarget = resolveUiServerProxyTarget(import.meta.url, fallbackPort)

function resolveVitePort() {
  const fromEnv = env.SERVICE_VITE_PORT || process.env.SERVICE_VITE_PORT
  const fromYaml = ui.vite_port
  const n = Number(fromEnv ?? fromYaml ?? 26130)
  return Number.isFinite(n) && n > 0 ? n : 26130
}

const vitePort = resolveVitePort()

export default defineConfig({
  plugins: [react(), watchUiServerPortChanges(import.meta.url, fallbackPort)],
  server: {
    host: ui.host ?? '0.0.0.0',
    port: vitePort,
    proxy: {
      '/llm-api': {
        target: 'https://llm-api.bs-soft.co.kr',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/llm-api/, '') || '/',
      },
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
    allowedHosts: ['localhost', '127.0.0.1', 'dev.doc.bs-soft.co.kr'],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
