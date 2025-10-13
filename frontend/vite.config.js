import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/auth': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false
      },
      '/users': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false
      },
      '/equipment': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false
      },
      '/gauge-tracker': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false
      },
      '/requests': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false
      },
      '/barcode': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false
      },
      '/qrcode': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
