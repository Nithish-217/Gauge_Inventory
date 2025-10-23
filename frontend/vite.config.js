import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3006,
    host: '172.18.100.67',
    open: false,
    proxy: {
      '/auth': {
        target: 'http://172.18.100.67:3432',
        changeOrigin: true,
        secure: false
      },
      '/users': {
        target: 'http://172.18.100.67:3432',
        changeOrigin: true,
        secure: false
      },
      '/equipment': {
        target: 'http://172.18.100.67:3432',
        changeOrigin: true,
        secure: false
      },
      '/gauge-tracker': {
        target: 'http://172.18.100.67:3432',
        changeOrigin: true,
        secure: false
      },
      '/requests': {
        target: 'http://172.18.100.67:3432',
        changeOrigin: true,
        secure: false
      },
      '/barcode': {
        target: 'http://172.18.100.67:3432',
        changeOrigin: true,
        secure: false
      },
      '/qrcode': {
        target: 'http://172.18.100.67:3432',
        changeOrigin: true,
        secure: false
      },
      '/reports': {
        target: 'http://172.18.100.67:3432',
        changeOrigin: true,
        secure: false
      },
      '/reminders': {
        target: 'http://172.18.100.67:3432',
        changeOrigin: true,
        secure: false
      },
      // Note: Do not proxy '/admin' because frontend client-side routes like
      // '/admin/report-manager' must be served by Vite (SPA). If you add specific
      // admin API endpoints later, proxy those exact paths instead (e.g. '/admin/reminders').
    }
  }
})
