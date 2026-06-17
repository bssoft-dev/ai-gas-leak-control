import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveUiServerProxyTarget, watchUiServerPortChanges } from '../../vite-resolve-ui-port.mjs'

const apiTarget = resolveUiServerProxyTarget(import.meta.url, '26011')

export default defineConfig({
  plugins: [react(), watchUiServerPortChanges(import.meta.url, '26011')],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
