import React, { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react'
import { Button, InputNumber, Space, Tooltip } from 'antd'
import { LeftOutlined, RightOutlined, ReloadOutlined, ZoomInOutlined, ZoomOutOutlined, CompressOutlined, ExpandOutlined, DownloadOutlined, LinkOutlined } from '@ant-design/icons'
import { usePdfDocument } from './usePdfDocument'
import { PdfPageCanvas } from './PdfPageCanvas'
import './pdf-viewer.css'

export interface PdfJsViewerProps {
  url: string
  height?: number | string
  initialScale?: number
  onLoadError?: (err: Error) => void
  renderToolbar?: boolean
  className?: string
  style?: React.CSSProperties
}

export interface PdfJsViewerRef {
  setScale: (scale: number) => void
  nextPage: () => void
  prevPage: () => void
  goToPage: (n: number) => void
  toggleFitWidth: (fit: boolean) => void
}

export const PdfJsViewer = forwardRef<PdfJsViewerRef, PdfJsViewerProps>(function PdfJsViewer(props, ref) {
  const { url, height = 'calc(90vh - 56px)', initialScale = 1.0, onLoadError, renderToolbar = true, className, style } = props
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pageRefMap = useRef<Map<number, HTMLDivElement>>(new Map())
  const { doc, numPages, loading, error } = usePdfDocument(url)
  const [scale, setScale] = useState<number>(initialScale)
  const scaleRef = useRef<number>(initialScale)
  useEffect(() => { scaleRef.current = scale }, [scale])
  const [fitWidth, setFitWidth] = useState<boolean>(true)
  const [page, setPage] = useState<number>(1)

  // Debounced scale update helper
  const debounceRef = useRef<number | null>(null)
  const setScaleDebounced = (next: number) => {
    if (debounceRef.current) cancelAnimationFrame(debounceRef.current)
    debounceRef.current = requestAnimationFrame(() => setScale(next))
  }

  // Helper to compute fit-to-width scale immediately
  const computeFitWidth = async () => {
    if (!fitWidth || !doc || !scrollRef.current) return
    try {
      const first = await doc.getPage(1)
      const vw = first.getViewport({ scale: 1.0 })
      const next = Math.max(0.1, (scrollRef.current.clientWidth - 24) / vw.width)
      setScale(next)
    } catch {}
  }

  // Recompute scale on container resize when fitWidth
  useEffect(() => {
    if (!fitWidth || !doc) return
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      computeFitWidth()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitWidth, doc])

  // When toggling to fit width, compute once immediately
  useEffect(() => { computeFitWidth() }, [fitWidth])

  useEffect(() => { if (error && onLoadError) onLoadError(error) }, [error])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+') { const next = Math.min(5, (scaleRef.current || 1) + 0.1); setScaleDebounced(next) }
      if (e.key === '-') { const next = Math.max(0.1, (scaleRef.current || 1) - 0.1); setScaleDebounced(next) }
      if (e.key === 'ArrowDown') { setPage(p => Math.min(numPages || 1, p + 1)) }
      if (e.key === 'ArrowUp') { setPage(p => Math.max(1, p - 1)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [numPages])

  useImperativeHandle(ref, () => ({
    setScale: (s: number) => setScaleDebounced(Math.max(0.1, Math.min(5, s))),
    nextPage: () => setPage(p => Math.min(numPages || 1, p + 1)),
    prevPage: () => setPage(p => Math.max(1, p - 1)),
    goToPage: (n: number) => setPage(Math.min(Math.max(1, Math.floor(n)), numPages || 1)),
    toggleFitWidth: (fit: boolean) => setFitWidth(!!fit),
  }), [numPages])

  // Toolbar intentionally hidden per request
  const toolbar = null

  const content = useMemo(() => {
    if (loading) return <div className="pdfv-loading">Rendering…</div>
    // Fallback to iframe if PDF.js errored or doc is missing
    if (error) {
      return (
        <div className="pdfv-scroll" ref={scrollRef}>
          <div style={{ height: '100%', minHeight: 400 }}>
            <iframe src={url} title="pdf-fallback" style={{ width: '100%', height: '80vh', border: 'none' }} />
          </div>
        </div>
      )
    }
    if (!doc) {
      // Render minimal fallback to avoid blank screen while doc is null
      return (
        <div className="pdfv-scroll" ref={scrollRef}>
          <iframe src={url} title="pdf-fallback" style={{ width: '100%', height: '80vh', border: 'none' }} />
        </div>
      )
    }

    return (
      <div className="pdfv-scroll" ref={scrollRef}>
        {/* Thumbnails panel could be added here later */}
        <div className="pdfv-pages">
          {/* Render current, previous and next pages early; others rely on IO */}
          {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
            <div key={n} ref={(el) => { if (el) pageRefMap.current.set(n, el) }}>
              <PdfPageCanvas doc={doc} pageNumber={n} scale={scale} fitWidthContainer={scrollRef.current} observe={Math.abs(n - page) > 1} />
            </div>
          ))}
        </div>
      </div>
    )
  }, [doc, loading, error, url, scale, page])

  // Scroll to current page when page changes
  useEffect(() => {
    const el = pageRefMap.current.get(page)
    if (el && scrollRef.current) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { el.scrollIntoView() }
    }
  }, [page])

  return (
    <div className={['pdfv-root', className].filter(Boolean).join(' ')} style={{ height, ...style }} ref={wrapRef}>
      {toolbar}
      {content}
    </div>
  )
})

export default PdfJsViewer
