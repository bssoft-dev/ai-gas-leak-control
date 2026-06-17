import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveUiServerProxyTarget, watchUiServerPortChanges } from '../../vite-resolve-ui-port.mjs'

const apiTarget = resolveUiServerProxyTarget(import.meta.url, '26028')

export default defineConfig({
  plugins: [react(), watchUiServerPortChanges(import.meta.url, '26028')],
  server: {
    host: '0.0.0.0',
    port: 36028,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
    allowedHosts: ['bluesp.bs-soft.co.kr', 'dev.bluesp.bs-soft.co.kr'],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
