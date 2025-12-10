import * as pdfjs from 'pdfjs-dist'
// Prefer a locally served worker to avoid CDN/CORS/version issues.
// Place `pdf.worker.min.js` in `frontend/public/` so it is served at `/pdf.worker.min.js`.
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'

export { pdfjs }
