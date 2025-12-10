import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3006,
    host: 'localhost',
    open: false,
    proxy: {
      '/api': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/auth': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/users': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/equipment': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/gauge-tracker': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/requests': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/barcode': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/qrcode': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/gauges': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/reports': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/reminders': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/analytics': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/admin/free-all-tools': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      // Proxy specific admin API endpoints (do NOT proxy /admin SPA routes)
      '/admin/email-logs': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      '/admin/due-reminder': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        secure: false
      },
      // Note: Do not proxy '/admin' because frontend client-side routes like
      // '/admin/report-manager' must be served by Vite (SPA). If you add specific
      // admin API endpoints later, proxy those exact paths instead (e.g. '/admin/reminders').

    }
  }
})
