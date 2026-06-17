import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveUiServerProxyTarget, watchUiServerPortChanges } from '../../vite-resolve-ui-port.mjs'

const apiTarget = resolveUiServerProxyTarget(import.meta.url, '26013')

export default defineConfig({
  plugins: [react(), watchUiServerPortChanges(import.meta.url, '26013')],
  server: {
    port: 3001,
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
