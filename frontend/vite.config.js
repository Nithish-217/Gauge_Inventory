import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/auth': {
        target: 'http://localhost:5657',
        changeOrigin: true,
        secure: false
      },
      '/users': {
        target: 'http://localhost:5657',
        changeOrigin: true,
        secure: false
      },
      '/equipment': {
        target: 'http://localhost:5657',
        changeOrigin: true,
        secure: false
      },
      '/gauge-tracker': {
        target: 'http://localhost:5657',
        changeOrigin: true,
        secure: false
      },
      '/requests': {
        target: 'http://localhost:5657',
        changeOrigin: true,
        secure: false
      },
      '/barcode': {
        target: 'http://localhost:5657',
        changeOrigin: true,
        secure: false
      },
      '/qrcode': {
        target: 'http://localhost:5657',
        changeOrigin: true,
        secure: false
      },
      '/reports': {
        target: 'http://localhost:5657',
        changeOrigin: true,
        secure: false
      },
      '/reminders': {
        target: 'http://localhost:5657',
        changeOrigin: true,
        secure: false
      },
      // Note: Do not proxy '/admin' because frontend client-side routes like
      // '/admin/report-manager' must be served by Vite (SPA). If you add specific
      // admin API endpoints later, proxy those exact paths instead (e.g. '/admin/reminders').
    }
  }
})
