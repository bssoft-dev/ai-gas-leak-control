import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 6025,
    proxy: {
      '/api': {
        target: 'http://0.0.0.0:26025',
        changeOrigin: true
      }
    },
    allowedHosts: ['gas-leak.bs-soft.co.kr'],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
