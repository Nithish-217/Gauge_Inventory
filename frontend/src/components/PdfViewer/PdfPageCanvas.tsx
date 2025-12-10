import React, { useEffect, useRef, useState } from 'react'
import { type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'

export interface PdfPageCanvasProps {
  doc: PDFDocumentProxy
  pageNumber: number
  scale: number
  fitWidthContainer?: HTMLDivElement | null
  observe?: boolean
}

// Render a single PDF page into a canvas with lazy rendering via IntersectionObserver.
export const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({ doc, pageNumber, scale, fitWidthContainer, observe = true }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const holderRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(!observe)

  // Intersection-based lazy visibility
  useEffect(() => {
    if (!observe) { setVisible(true); return }
    const el = holderRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry && entry.isIntersecting) {
        setVisible(true)
        io.disconnect()
      }
    }, { root: fitWidthContainer || undefined, rootMargin: '200px 0px', threshold: 0.01 })
    io.observe(el)
    return () => io.disconnect()
  }, [observe, fitWidthContainer])

  // Render page when visible/scale changes
  useEffect(() => {
    let cancelled = false
    if (!visible) return

    let running = true
    const render = async () => {
      try {
        const page: PDFPageProxy = await doc.getPage(pageNumber)
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const renderTask = page.render({ canvasContext: ctx, viewport })
        await renderTask.promise
      } catch (_) { /* ignore per-page render errors */ }
    }

    const raf = requestAnimationFrame(() => { if (!cancelled) render() })
    return () => { cancelled = true; running = false; try { cancelAnimationFrame(raf) } catch {} }
  }, [doc, pageNumber, scale, visible])

  // Placeholder keeps layout before rendering
  return (
    <div ref={holderRef} style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
      <canvas ref={canvasRef} style={{ background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.12)' }} />
    </div>
  )
}
