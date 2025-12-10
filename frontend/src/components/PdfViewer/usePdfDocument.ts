import { useEffect, useRef, useState } from 'react'
import '../../pdfjsSetup'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist'

export interface UsePdfDocumentResult {
  doc: PDFDocumentProxy | null
  numPages: number
  loading: boolean
  error: Error | null
}

export function usePdfDocument(url: string): UsePdfDocumentResult {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false })

  useEffect(() => {
    let alive = true
    cancelRef.current.cancelled = false
    setLoading(true)
    setError(null)
    setDoc(null)
    setNumPages(0)

    // Timeout guard to avoid infinite loading if server never resolves
    const TIMEOUT_MS = 20000
    const timeoutId = setTimeout(() => {
      if (!alive || cancelRef.current.cancelled) return
      setError(new Error('Timed out while loading PDF'))
      setLoading(false)
    }, TIMEOUT_MS)

    // Be conservative with transport features to maximize compatibility
    const task = getDocument({ url, disableAutoFetch: true, disableStream: true })
    task.promise
      .then((pdf) => {
        if (!alive || cancelRef.current.cancelled) return
        setDoc(pdf)
        setNumPages(pdf.numPages || 0)
      })
      .catch((e: any) => {
        if (!alive || cancelRef.current.cancelled) return
        setError(e instanceof Error ? e : new Error(String(e)))
      })
      .finally(() => {
        if (!alive || cancelRef.current.cancelled) return
        setLoading(false)
        try { clearTimeout(timeoutId) } catch {}
      })

    return () => {
      alive = false
      cancelRef.current.cancelled = true
      try { task.destroy(); } catch {}
      try { clearTimeout(timeoutId) } catch {}
      try { setDoc(null) } catch {}
    }
  }, [url])

  return { doc, numPages, loading, error }
}
