import React, { useEffect, useMemo, useRef, useState } from 'react'
import PdfJsViewer from '../../components/PdfViewer/PdfJsViewer'
import '../../components/PdfViewer/pdf-viewer.css'
import { Table, Button, Space, Input, DatePicker, InputNumber, Upload, message, Typography, Tag, Modal, Form, Pagination, AutoComplete, List, Divider, Popconfirm, Tabs, Spin } from 'antd'
import { ReloadOutlined, UploadOutlined, DownloadOutlined, EyeOutlined, FolderOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

function TextFilePreview({ url }) {
  const [content, setContent] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setContent(null)
    setError('')
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Unable to load file (${res.status})`)
        return res.text()
      })
      .then(setContent)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Unable to load file')
      })
    return () => controller.abort()
  }, [url])

  if (error) return <div style={{ padding: 16, color: '#cf1322' }}>{error}</div>
  if (content === null) return <div style={{ padding: 16 }}>Loading file...</div>
  if (!content) return <div style={{ padding: 16, color: '#8c8c8c' }}>This file is empty.</div>
  return <pre style={{ flex: 1, width: '100%', margin: 0, padding: 16, overflow: 'auto', whiteSpace: 'pre-wrap', textAlign: 'left' }}>{content}</pre>
}

export default function ReportManager() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [activeRow, setActiveRow] = useState(null)
  const [form] = Form.useForm()
  const folderWatch = Form.useWatch ? Form.useWatch('folder', form) : undefined
  const [selectedFiles, setSelectedFiles] = useState([])
  const [reportTitle, setReportTitle] = useState('')
  const [reportNotes, setReportNotes] = useState('')
  const [titleOptions, setTitleOptions] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState('name_of_the_equipment')
  const [sortDir, setSortDir] = useState('asc')
  // When opened from a folder in Files modal, store that folder to hide the folder input
  const [uploadPrefilledFolder, setUploadPrefilledFolder] = useState('')
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false)
  const [pdfViewerUrl, setPdfViewerUrl] = useState(null)
  const [pdfViewerTitle, setPdfViewerTitle] = useState('')
  const [filesModalOpen, setFilesModalOpen] = useState(false)
  const [filesModalGauge, setFilesModalGauge] = useState(null)
  const [filesModalData, setFilesModalData] = useState([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerGauge, setViewerGauge] = useState(null)
  const [viewerData, setViewerData] = useState({ reports: [] })
  const [viewerLoading, setViewerLoading] = useState(false)
  const [viewerTitle, setViewerTitle] = useState('')
  const scrollRef = useRef(null)
  const bcRef = useRef(null)
  const normalizeFolderName = (s) => {
    try {
      const v = String(s||'').trim().toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9-_]/g, '_')
        .replace(/_+/g, '_')
      return v || 'untitled'
    } catch { return 'untitled' }
  }

  const hasAnyFilesForGauge = async (gauge_id) => {
    try {
      const reps = await fetch(`/gauges/${gauge_id}/reports`)
      const arr = reps.ok ? await reps.json().catch(()=>[]) : []
      const reports = Array.isArray(arr) ? arr : []
      for (const r of reports) {
        const fr = await fetch(`/gauges/${gauge_id}/reports/${r.id}/files`)
        if (!fr.ok) continue
        const files = await fr.json().catch(()=>[])
        if (Array.isArray(files) && files.length) return true
      }
      return false
    } catch { return false }
  }

  // Open upload modal prefilled with a folder name from Files modal
  const openUploadForFolder = (folderName) => {
    if (!filesModalGauge) return
    try {
      setActiveRow(filesModalGauge)
      setSelectedFiles([])
      setReportTitle(folderName || '')
      setUploadPrefilledFolder(folderName || '')
      setModalOpen(true)
      // Prefill form field for validation UI (after modal mounts as well)
      try { form.setFieldsValue({ folder: folderName || '' }) } catch {}
      setTimeout(() => { try { form.setFieldsValue({ folder: folderName || '' }) } catch {} }, 0)
    } catch {}
  }
      // Open files modal and load files for a gauge
  const openFilesModal = async (row) => {
    setFilesModalGauge(row)
    setFilesModalOpen(true)
    setFilesLoading(true)
    try {
      const reps = await fetch(`/gauges/${row.gauge_id}/reports`)
      let reports = []
      if (reps.ok) {
        reports = await reps.json().catch(()=>[])
        reports = Array.isArray(reports) ? reports : []
      }
      const all = []
      for (const r of reports) {
        const fr = await fetch(`/gauges/${row.gauge_id}/reports/${r.id}/files`)
        if (fr.ok) {
          const files = await fr.json().catch(()=>[])
          if (Array.isArray(files) && files.length) {
            all.push({ report: r, files })
          }
        }
      }
      // Group by folder name (report.title), normalized
      const groupMap = new Map()
      for (const entry of all) {
        const folder = normalizeFolderName((entry.report?.title || `report_${entry.report?.id}`))
        if (!groupMap.has(folder)) groupMap.set(folder, [])
        for (const f of entry.files) {
          groupMap.get(folder).push({ reportId: entry.report.id, file: f })
        }
      }
      const grouped = Array.from(groupMap.entries()).map(([folder, items]) => {
        // Sort files inside a folder by original_name then uploaded_at
        const sorted = [...items].sort((a,b) => {
          const an = (a.file?.original_name||'').toLowerCase()
          const bn = (b.file?.original_name||'').toLowerCase()
          const byName = an.localeCompare(bn)
          if (byName !== 0) return byName
          const ad = new Date(a.file?.uploaded_at||0).getTime()||0
          const bd = new Date(b.file?.uploaded_at||0).getTime()||0
          return ad - bd
        })
        return ({ folder, items: sorted })
      })
      // Sort folders alphabetically
      grouped.sort((a,b) => String(a.folder).localeCompare(String(b.folder)))
      setFilesModalData(grouped)
    } catch {
      message.error('Failed to load files')
      setFilesModalData([])
    } finally {
      setFilesLoading(false)
    }
  }

  // Open overlay viewer (tabs + preview)
  const openViewer = async (row) => {
    setViewerGauge(row)
    setViewerOpen(true)
    setViewerLoading(true)
    setViewerTitle('')
    try {
      const reps = await fetch(`/gauges/${row.gauge_id}/reports`)
      let reports = []
      if (reps.ok) {
        reports = await reps.json().catch(()=>[])
        reports = Array.isArray(reports) ? reports : []
      }
      const all = []
      for (const r of reports) {
        const fr = await fetch(`/gauges/${row.gauge_id}/reports/${r.id}/files`)
        const files = fr.ok ? await fr.json().catch(()=>[]) : []
        const arr = Array.isArray(files) ? files : []
        if (arr.length) {
          all.push({ report: r, files: arr })
        }
      }
      // If overall there is only one file, collapse to a single pseudo-tab
      const totalFiles = all.reduce((n, it) => n + (Array.isArray(it.files) ? it.files.length : 0), 0)
      if (totalFiles <= 1) {
        const single = all.find(it => (it.files||[]).length)
        setViewerData({ reports: single ? [{ report: { id: (single.report?.id), title: `Report for ${row.gauge_id}` }, files: single.files }] : [] })
        try { const f = single && Array.isArray(single.files) ? (single.files[0] || null) : null; if (f) setViewerTitle(f.original_name || '') } catch {}
      } else {
        setViewerData({ reports: all })
        try {
          const firstEntry = all[0]
          const f = firstEntry && Array.isArray(firstEntry.files) ? (firstEntry.files[0] || null) : null
          setViewerTitle((f && f.original_name) || (firstEntry?.report?.title) || '')
        } catch {}
      }
    } catch {
      setViewerData({ reports: [] })
    } finally {
      setViewerLoading(false)
    }
  }

  // Open viewer focused on a single file from the Files modal
  const openFileInViewer = (gauge_id, reportEntry, file) => {
    try {
      setViewerGauge({ gauge_id, name_of_the_equipment: filesModalGauge?.name_of_the_equipment })
    } catch {
      setViewerGauge({ gauge_id })
    }
    setViewerData({ reports: [{ report: { id: reportEntry.id, title: reportEntry.title }, files: [file] }] })
    setViewerOpen(true)
    setViewerLoading(false)
    try { setViewerTitle(file?.original_name || '') } catch {}
  }

  // Delete a file from a report
  const deleteFile = async (gauge_id, report_id, file_id) => {
    try {
      const res = await fetch(`/gauges/${gauge_id}/reports/${report_id}/files/${file_id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text() || 'Delete failed')
      if (filesModalGauge) await openFilesModal(filesModalGauge)
      message.success('File deleted')
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Delete failed')
    }
  }
  const [suggestions, setSuggestions] = useState([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const qDebounceRef = useRef(null)

  // Debounced dynamic fetch on query change (top-level)
  useEffect(() => {
    if (qDebounceRef.current) clearTimeout(qDebounceRef.current)
    qDebounceRef.current = setTimeout(() => {
      setCurrentPage(1)
      fetchRows({ page: 0, reset: true })
    }, 300)
    return () => { if (qDebounceRef.current) clearTimeout(qDebounceRef.current) }
  }, [q])

  // Ensure form fields are prefilled when modal opens
  useEffect(() => {
    if (modalOpen && activeRow) {
      try { form.resetFields() } catch {}
      const freqVal = (activeRow.calibration_freq_months != null)
        ? Number(activeRow.calibration_freq_months)
        : (activeRow.freq != null ? Number(activeRow.freq) : undefined)
      form.setFieldsValue({
        last: activeRow.date_of_last_calibration ? dayjs(activeRow.date_of_last_calibration) : null,
        freq: isNaN(freqVal) ? undefined : freqVal,
        // also set folder here so reset doesn't clear prefill
        folder: (uploadPrefilledFolder || reportTitle || '')
      })
      // If frequency could not be derived, fetch it from server
      if (freqVal == null || isNaN(freqVal)) {
        (async () => {
          try {
            // Try reports for exact gauge
            const r1 = await fetch(`/reports?limit=1&offset=0&q=${encodeURIComponent(activeRow.idfn_no || activeRow.name_of_the_equipment || '')}`)
            if (r1.ok) {
              const d1 = await r1.json()
              const item = Array.isArray(d1.items) ? d1.items.find(x => x.gauge_id === activeRow.gauge_id) : null
              const f1 = item && item.calibration_freq_months != null ? Number(item.calibration_freq_months) : undefined
              if (f1 != null && !isNaN(f1)) { form.setFieldsValue({ freq: f1 }); return }
            }
          } catch {}
          try {
            // Fallback: search equipment
            const r2 = await fetch(`/equipment?limit=1&offset=0&q=${encodeURIComponent(activeRow.idfn_no || activeRow.name_of_the_equipment || '')}`)
            if (r2.ok) {
              const d2 = await r2.json()
              const item2 = Array.isArray(d2.items) ? d2.items.find(x => x.gauge_id === activeRow.gauge_id) : null
              const f2 = item2 && item2.calibration_freq_months != null ? Number(item2.calibration_freq_months) : undefined
              if (f2 != null && !isNaN(f2)) { form.setFieldsValue({ freq: f2 }) }
            }
          } catch {}
        })()
      }
    }
  }, [modalOpen, activeRow])

  // Sync folder field with selected folder name (prefill when opening from Files modal)
  useEffect(() => {
    if (modalOpen) {
      try { form.setFieldsValue({ folder: (uploadPrefilledFolder || reportTitle || '') }) } catch {}
    }
  }, [modalOpen, reportTitle, uploadPrefilledFolder])

  // Load existing titles for this gauge to allow selecting an existing folder name
  useEffect(() => {
    let cancelled = false
    const loadTitles = async () => {
      if (!modalOpen || !activeRow?.gauge_id) { setTitleOptions([]); return }
      try {
        const res = await fetch(`/gauges/${activeRow.gauge_id}/reports`)
        const arr = res.ok ? await res.json().catch(()=>[]) : []
        const titles = Array.isArray(arr) ? Array.from(new Set(arr.map(it => (it.title || '').trim()).filter(Boolean))) : []
        if (!cancelled) setTitleOptions(titles.map(t => ({ value: t })))
      } catch {
        if (!cancelled) setTitleOptions([])
      }
    }
    loadTitles()
    return () => { cancelled = true }
  }, [modalOpen, activeRow])

  const fetchRows = async (opts = {}) => {
    setLoading(true)
    try {
      const cur = typeof opts.page === 'number' ? opts.page : (currentPage - 1)
      const limit = pageSize
      const offset = cur * limit
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (q?.trim()) params.set('q', q.trim())
      if (sortBy) params.set('sort_by', sortBy)
      if (sortDir) params.set('sort_dir', sortDir)
      // Try reports endpoint first
      let items = []
      let total = 0
      try {
        const res = await fetch(`/reports?${params.toString()}`)
        if (res.ok) {
          const data = await res.json()
          items = Array.isArray(data.items) ? data.items : []
          total = data.total || items.length
        }
      } catch {}
      // Fallback to equipment if reports empty (keep pagination)
      if (!items.length) {
        const eres = await fetch(`/equipment?${params.toString()}`)
        if (!eres.ok) throw new Error(await eres.text() || 'Failed to load equipment')
        const edata = await eres.json()
        const eq = Array.isArray(edata.items) ? edata.items : []
        items = eq.map(r => ({
          gauge_id: r.gauge_id,
          name_of_the_equipment: r.name_of_the_equipment,
          idfn_no: r.idfn_no,
          location: r.location,
          make_model: r.make_model,
          date_of_last_calibration: r.date_of_last_calibration,
          calibration_due: r.calibration_due,
          calibration_freq_months: r.calibration_freq_months,
          object_key: null,
          updated_by: null,
          updated_at: null,
        }))
        total = edata.total || items.length
      }
      let batch = items.map(r => ({ ...r, key: r.gauge_id }))
      // Merge cached updated_by/updated_at from localStorage so it persists after refresh
      try {
        const cache = JSON.parse(localStorage.getItem('gaugeUpdated') || '{}')
        if (cache && typeof cache === 'object') {
          batch = batch.map(row => {
            const hit = cache[String(row.gauge_id)]
            return hit ? { ...row, updated_by: hit.updated_by, updated_at: hit.updated_at } : row
          })
        }
      } catch {}
      setTotalItems(total)
      setRows(batch)
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows({ page: currentPage - 1 }) }, [currentPage, pageSize, sortBy, sortDir])

  useEffect(() => {
    try { bcRef.current = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('equipment-events') : null } catch { bcRef.current = null }
    const onMsg = (ev) => {
      try { if (ev && ev.data && ev.data.type === 'equipment:changed') { setCurrentPage(1); fetchRows({ page: 0 }) } } catch {}
    }
    try { bcRef.current && bcRef.current.addEventListener('message', onMsg) } catch {}
    return () => { try { bcRef.current && bcRef.current.removeEventListener('message', onMsg); bcRef.current.close() } catch {} }
  }, [])

  const handlePageChange = (page, size) => {
    setCurrentPage(page)
    if (size !== pageSize) {
      setPageSize(size)
    }
  }

  // Typeahead: fetch suggestions from backend
  const fetchSuggest = async (text) => {
    const s = (text || '').trim()
    if (!s) { setSuggestions([]); return }
    setSuggestLoading(true)
    try {
      const res = await fetch(`/equipment/suggest?q=${encodeURIComponent(s)}&limit=10`)
      const data = await res.json().catch(()=>[])
      const opts = Array.isArray(data) ? data.map((it, idx) => ({
        value: it.value,
        label: (
          <div key={`${it.type}-${idx}`} style={{ display:'flex', justifyContent:'space-between' }}>
            <span>{it.value}</span>
            <Tag color={it.type === 'idfn' ? 'blue' : 'default'} style={{ marginLeft: 8 }}>{it.type}</Tag>
          </div>
        )
      })) : []
      setSuggestions(opts)
    } catch { setSuggestions([]) }
    finally { setSuggestLoading(false) }
  }

  const onUpload = async (row, state) => {
    try {
      if (!Array.isArray(state.files) || state.files.length === 0) { message.warning('Select at least one file'); return }
      if (!state.last || !state.freq) { message.warning('Provide last calibration date and frequency'); return }
      // Client-side size validation (20 MB per file)
      const MAX_BYTES = 20 * 1024 * 1024
      const tooBig = (state.files || []).find(f => (f && typeof f.size === 'number' && f.size > MAX_BYTES))
      if (tooBig) {
        message.error('File size must not exceed 20 MB')
        return
      }
      const fd = new FormData()
      fd.append('title', (state.folder || reportTitle || `Report for ${row.gauge_id}`))
      fd.append('notes', (reportNotes || ''))
      // Optional equipment fields (keeps legacy behavior)
      fd.append('last_calibration_date', dayjs(state.last).format('YYYY-MM-DD'))
      fd.append('calibration_freq_months', String(state.freq))
      state.files.forEach(f => { if (f) fd.append('files', f) })
      const res = await fetch(`/gauges/${row.gauge_id}/reports`, { method: 'POST', body: fd })
      if (!res.ok) {
        const raw = await res.text()
        let msg = raw || 'Upload failed'
        try {
          const j = JSON.parse(raw)
          msg = j?.detail || msg
        } catch {}
        const norm = /413|exceeds\s*20\s*MB/i.test(msg) ? 'File size must not exceed 20 MB' : msg
        throw new Error(norm)
      }
      const payload = await res.json().catch(()=>null)
      message.success('Reports uploaded')
      // Optionally open files viewer for this gauge to show results
      try {
        await openFilesModal(row)
      } catch {}
      // Refresh rows from backend, then overlay updated_by/updated_at so values remain visible
      try { await fetchRows() } catch {}
      try {
        const uname = (()=>{ try { return localStorage.getItem('username') || 'admin' } catch { return 'admin' } })()
        const nowIso = new Date().toISOString()
        // update UI
        setRows(prev => prev.map(r => r.gauge_id === row.gauge_id ? { ...r, updated_by: uname, updated_at: nowIso } : r))
        // persist cache
        const cache = (()=>{ try { return JSON.parse(localStorage.getItem('gaugeUpdated')||'{}') } catch { return {} } })()
        cache[String(row.gauge_id)] = { updated_by: uname, updated_at: nowIso }
        try { localStorage.setItem('gaugeUpdated', JSON.stringify(cache)) } catch {}
      } catch {}
      setModalOpen(false)
      setActiveRow(null)
      setSelectedFiles([])
      setReportTitle('')
      setReportNotes('')
      try { form.resetFields() } catch {}
    } catch (e) {
      const m = typeof e?.message === 'string' ? e.message : 'Upload failed'
      const friendly = /413|exceeds\s*20\s*MB/i.test(m) ? 'File size must not exceed 20 MB' : m
      message.error(friendly)
    }
  }

  const columns = useMemo(() => [
    { 
      title: 'Sl. No.', 
      key: 'sl_no', 
      width: 90, 
      align: 'center',
      render: (_val, _row, index) => ((currentPage - 1) * pageSize) + index + 1,
    },
    { 
      title: 'Equipment', 
      dataIndex: 'name_of_the_equipment', 
      key: 'name', 
      ellipsis: true,
      width: 200,
      sorter: (a,b) => String(a.name_of_the_equipment||'').localeCompare(String(b.name_of_the_equipment||'')),
      defaultSortOrder: 'ascend',
      sortDirections: ['ascend', 'descend']
    },
    { 
      title: 'IDFN', 
      dataIndex: 'idfn_no', 
      key: 'idfn', 
      width: 140, 
      align: 'center',
      render:(v)=> v ? <Tag color="blue">{v}</Tag> : <Tag>—</Tag> 
    },
    { 
      title: 'Last Calibration', 
      dataIndex: 'date_of_last_calibration', 
      key: 'last', 
      width: 160, 
      align: 'center',
      render:(v)=> v ? new Date(v).toLocaleDateString() : '' 
    },
    { 
      title: 'Freq (months)', 
      dataIndex: 'calibration_freq_months', 
      key: 'freq', 
      width: 130, 
      align: 'center',
      sorter: (a,b) => (a.calibration_freq_months || 0) - (b.calibration_freq_months || 0)
    },
    { 
      title: 'Due', 
      dataIndex: 'calibration_due', 
      key: 'due', 
      width: 160, 
      align: 'center',
      render:(v)=> v ? new Date(v).toLocaleDateString() : '' 
    },
    { 
      title: 'Updated By', 
      dataIndex: 'updated_by', 
      key: 'updated_by', 
      width: 140, 
      ellipsis: true
    },
    { 
      title: 'Updated At', 
      dataIndex: 'updated_at', 
      key: 'updated_at', 
      width: 180, 
      align: 'center',
      render:(v)=> v ? new Date(v).toLocaleString() : '' 
    },
    { 
      title: 'Gauge ID', 
      dataIndex: 'gauge_id', 
      key: 'gauge_id', 
      width: 110, 
      align: 'center',
      sorter: (a,b) => (a.gauge_id || 0) - (b.gauge_id || 0)
    },
    { 
      title: 'Report', 
      dataIndex: 'object_key', 
      key: 'report', 
      width: 180, 
      align: 'center',
      render:(_,row)=> (
        <Space size="small">
          <Button 
            type="text" 
            onClick={() => openFilesModal(row)}
            title="View uploaded files"
          >Files</Button>
          <Button 
            type="text" 
            icon={<DownloadOutlined />} 
            onClick={async ()=> { const ok = await hasAnyFilesForGauge(row.gauge_id); if (!ok) { message.info('No files to download'); return } window.open(`/gauges/${row.gauge_id}/reports/zip`, '_self') }}
            title="Download ZIP"
            style={{ color: '#52c41a' }}
          />
        </Space>
      )
    },
  ], [currentPage, pageSize])

  return (
    <div className="equipment-table-container">
      <div className="table-header">
        <h2>Report Manager</h2>
      </div>

      <div className="table-wrapper">
        <div className="table-controls">
          <div className="search-section">
            <AutoComplete
              options={suggestions}
              value={q}
              onChange={(val)=> setQ(val)}
              onSearch={fetchSuggest}
              onSelect={(val)=> { setQ(val); setCurrentPage(1); fetchRows({ page:0, reset: true }) }}
              style={{ minWidth: 360 }}
            >
              <Input.Search
                allowClear
                loading={suggestLoading}
                placeholder="Search by name, IDFN, or location"
                onChange={(e)=> setQ(e.target.value)}
                onSearch={()=>{ setCurrentPage(1); fetchRows({ page:0, reset: true }) }}
                enterButton
              />
            </AutoComplete>
          </div>
          <div className="action-buttons">
            <Button 
              icon={<ReloadOutlined />} 
              onClick={()=>{ setCurrentPage(1); fetchRows({ page:0, reset: true }) }}
            >
              Refresh
            </Button>
          </div>
        </div>

        <div className="table-container">
          <Table
            columns={columns}
            dataSource={rows}
            loading={loading}
            pagination={false}
            size="middle"
            bordered
            className="ant-table-striped professional-table"
            rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-light' : 'table-row-dark')}
            scroll={{ x: 1200 }}
            onChange={(_, __, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter
              const field = s && s.field ? s.field : null
              const order = s && s.order ? (s.order === 'descend' ? 'desc' : 'asc') : null
              setSortBy(field)
              setSortDir(order)
              setCurrentPage(1)
              fetchRows({ page: 0 })
            }}
          />
        </div>

        <div className="pagination-container">
          <Pagination
            current={currentPage}
            total={totalItems}
            pageSize={pageSize}
            showSizeChanger
            showQuickJumper
            showTotal={(total, range) => `${range[0]}-${range[1]} of ${total} items`}
            onChange={handlePageChange}
            onShowSizeChange={handlePageChange}
            pageSizeOptions={['10', '20', '50', '100']}
          />
        </div>
      </div>

      <Modal
        key={activeRow ? `upload-${activeRow.gauge_id}` : 'upload-none'}
        title={activeRow ? `Upload calibration report - ${activeRow.name_of_the_equipment || ''}` : 'Upload calibration report'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setActiveRow(null); setSelectedFiles([]); setUploadPrefilledFolder(''); try { form.resetFields() } catch {} }}
        onOk={async () => {
          try {
            const values = await form.validateFields()
            // decide folder: when prefilled from Files modal use that, otherwise use form entry
            const folderVal = (uploadPrefilledFolder || values.folder || '')
            try { setReportTitle(folderVal) } catch {}
            const state = { last: values.last, freq: values.freq, files: selectedFiles, folder: folderVal }
            await onUpload(activeRow, state)
          } catch {}
        }}
        okText="Upload"
        destroyOnClose
      >
        <Form
          key={activeRow ? `form-${activeRow.gauge_id}` : 'form-none'}
          layout="vertical"
          form={form}
          preserve={false}
          initialValues={{
            last: activeRow && activeRow.date_of_last_calibration ? dayjs(activeRow.date_of_last_calibration) : null,
            freq: (() => {
              if (!activeRow) return undefined
              const v = activeRow.calibration_freq_months ?? activeRow.freq
              const n = Number(v)
              return isNaN(n) ? undefined : n
            })()
          }}
        >
          {!uploadPrefilledFolder && (
            <Form.Item 
              label="Folder" 
              name="folder"
              rules={[{ required: true, message: 'Please enter folder name' }]}
              required
            >
              <AutoComplete
                options={titleOptions}
                value={folderWatch}
                onChange={(val)=> { setReportTitle(val); try { form.setFieldsValue({ folder: val || '' }) } catch {} }}
                placeholder={`Folder name`}
                style={{ width: '100%' }}
                allowClear
                filterOption={(input, option) => (option?.value || '').toLowerCase().includes((input||'').toLowerCase())}
              />
            </Form.Item>
          )}
          {/* <Form.Item label="Notes">
            <Input.TextArea rows={3} placeholder="Optional notes" value={reportNotes} onChange={(e)=>setReportNotes(e.target.value)} />
          </Form.Item> */}
          <Form.Item label="Report files" required>
            <Upload.Dragger
              beforeUpload={(file)=>{ 
                const MAX_BYTES = 20 * 1024 * 1024
                if (file && typeof file.size === 'number' && file.size > MAX_BYTES) {
                  message.error('File size must not exceed 20 MB')
                  return Upload.LIST_IGNORE
                }
                setSelectedFiles(prev=>[...prev, file]); 
                return false 
              }}
              maxCount={10}
              accept=".pdf,.png,.jpg,.jpeg,.docx,.csv,.txt"
              multiple
              onChange={(info)=>{
                const MAX_BYTES = 20 * 1024 * 1024
                const list = (info?.fileList || []).map(it => it.originFileObj || it.file || it)
                const filtered = list.filter(f => f && (typeof f.size !== 'number' || f.size <= MAX_BYTES))
                setSelectedFiles(filtered.filter(Boolean))
              }}
            >
              <p className="ant-upload-drag-icon">Drop files here or click to select</p>
              <p className="ant-upload-hint">Allowed: PDF, PNG, JPG, DOCX, CSV, TXT. Max 10 files. Max size per file: 20 MB.</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item 
            name="last" 
            label="Last calibration date" 
            initialValue={activeRow && activeRow.date_of_last_calibration ? dayjs(activeRow.date_of_last_calibration) : null}
            rules={[{ required: true, message: 'Please select last calibration date' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item 
            name="freq" 
            label="Calibration frequency (months)" 
            initialValue={(activeRow && !isNaN(Number(activeRow.calibration_freq_months ?? activeRow.freq))) ? Number(activeRow.calibration_freq_months ?? activeRow.freq) : undefined}
            rules={[{ required: true, message: 'Please enter frequency in months' }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={pdfViewerTitle || 'View Report'}
        open={pdfViewerOpen}
        onCancel={() => { setPdfViewerOpen(false); setPdfViewerUrl(null); setPdfViewerTitle('') }}
        footer={null}
        width="90%"
        style={{ top: 20 }}
        destroyOnClose
        centered
      >
        {pdfViewerUrl && (
          <iframe
            src={pdfViewerUrl}
            style={{ width: '100%', height: '80vh', border: 'none' }}
            title="PDF Viewer"
          />
        )}
      </Modal>

      <Modal
        title={filesModalGauge ? `Files - ${filesModalGauge.name_of_the_equipment || ''} (Gauge ${filesModalGauge.gauge_id})` : 'Files'}
        open={filesModalOpen}
        onCancel={() => { setFilesModalOpen(false); setFilesModalGauge(null); setFilesModalData([]) }}
        footer={null}
        width="80%"
        destroyOnClose
      >
        {filesLoading ? (
          <div>Loading...</div>
        ) : (
          filesModalData.length === 0 ? (
            <div>
              <div>No files found for this gauge</div>
              <Divider />
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="dashed" icon={<UploadOutlined />} onClick={() => openUploadForFolder('')}>
                  Create new folder
                </Button>
              </div>
            </div>
          ) : (
            <div>
              {filesModalData.map((group) => (
                <div key={`folder-${group.folder}`} style={{ marginBottom: 16 }}>
                  <div style={{ display:'flex', alignItems:'center', gap: 12, padding: '4px 0' }}>
                    <span style={{ display:'flex', alignItems:'center', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <FolderOutlined style={{ color: '#faad14', marginRight: 8 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.folder}</span>
                    </span>
                    <Button
                      size="small"
                      type="primary"
                      onClick={()=> openUploadForFolder(group.folder)}
                      style={{ marginLeft: 'auto', width: 'auto', whiteSpace: 'nowrap', padding: '0 10px' }}
                    >
                      Upload
                    </Button>
                  </div>
                  <Divider style={{ margin: '8px 0' }} />
                  <List
                    size="small"
                    dataSource={group.items}
                    bordered
                    renderItem={(it) => (
                      <List.Item
                        actions={[
                          <a key="open" href="#" onClick={(e)=>{ e.preventDefault(); openFileInViewer(filesModalGauge.gauge_id, { id: it.reportId, title: group.folder }, it.file) }}>Open</a>,
                          <a key="stream" href={`/gauges/${filesModalGauge.gauge_id}/reports/${it.reportId}/files/${it.file.id}/stream?download=1`}>Download</a>,
                          <Popconfirm key="del" title="Delete this file?" onConfirm={() => deleteFile(filesModalGauge.gauge_id, it.reportId, it.file.id)}>
                            <a style={{ color:'#ff4d4f' }}>Delete</a>
                          </Popconfirm>
                        ]}
                      >
                        <List.Item.Meta
                          title={it.file.original_name || it.file.content_type || 'file'}
                          description={`${(it.file.size_bytes||0)} bytes • ${it.file.content_type || ''} • ${it.file.uploaded_at || ''}`}
                        />
                      </List.Item>
                    )}
                  />
                </div>
              ))}
              <Divider />
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="dashed" icon={<UploadOutlined />} onClick={() => openUploadForFolder('')}>
                  Create new folder
                </Button>
              </div>
            </div>
          )
        )}
      </Modal>

      {/* PDF.js Modal viewer */}
      <Modal
        title={viewerTitle || (viewerGauge ? `Reports - ${viewerGauge.name_of_the_equipment || ''} (Gauge ${viewerGauge.gauge_id})` : 'Reports')}
        open={viewerOpen}
        onCancel={() => { setViewerOpen(false); setViewerGauge(null); setViewerData({ reports: [] }); setViewerTitle('') }}
        footer={null}
        width="90%"
        style={{ top: 20, padding: 0 }}
        bodyStyle={{ padding: 0, margin: 0, display: 'flex', flexDirection: 'column', height: '90vh' }}
        destroyOnClose
        centered
      >
        {viewerLoading ? (
          <div style={{ padding: 16 }}><Spin /> Loading...</div>
        ) : (
          (Array.isArray(viewerData.reports) && viewerData.reports.length) ? (
            (() => {
              const items = viewerData.reports
              const ext = (name='') => String(name).toLowerCase().split('.').pop()
              const isPdf = (f) => (f?.content_type||'').startsWith('application/pdf') || ['pdf'].includes(ext(f?.original_name||''))
              const isImg = (f) => (f?.content_type||'').startsWith('image/') || ['png','jpg','jpeg','gif','webp','bmp'].includes(ext(f?.original_name||''))
              const isText = (f) => (f?.content_type||'').startsWith('text/') || ['txt','csv'].includes(ext(f?.original_name||''))
              const renderPreviewForFile = (entry, file) => {
                const previewUrl = file ? `/gauges/${viewerGauge.gauge_id}/reports/${entry.report.id}/files/${file.id}/stream?download=0` : null
                return (
                  <div style={{ flex:1, minHeight:0, height:'100%', display:'flex' }}>
                    {file ? (
                      isPdf(file) ? (
                        <div style={{ flex:1, minHeight:0 }}>
                          <PdfJsViewer url={previewUrl} height={'calc(90vh - 56px)'} initialScale={1.0} />
                        </div>
                      ) : (
                        isImg(file) ? (
                          <img src={previewUrl} alt={file.original_name||'preview'} style={{ width: '100%', height: '100%', objectFit: 'contain', border: '1px solid #eee' }} />
                        ) : (
                          isText(file) ? <TextFilePreview url={previewUrl} /> : <div style={{ padding:16 }}>
                            <div style={{ marginBottom:8 }}>Preview not available for this file type.</div>
                            <a href={previewUrl} target="_blank" rel="noreferrer">Open in new tab</a>
                          </div>
                        )
                      )
                    ) : (
                      <div style={{ height:'100%', width:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#888' }}>No previewable file</div>
                    )}
                  </div>
                )
              }
              // If only one report but it has multiple files, show per-file tabs
              if (items.length === 1) {
                const entry = items[0]
                const files = Array.isArray(entry.files) ? entry.files : []
                if (files.length > 1) {
                  return (
                    <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', height:'100%' }}>
                      <Tabs
                        style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', height:'100%' }}
                        tabBarStyle={{ marginBottom: 8 }}
                        onChange={(activeKey) => {
                          try {
                            const f = files.find(ff => String(ff.id ?? '') === String(activeKey) || String(files.indexOf(ff)) === String(activeKey))
                            if (f) setViewerTitle(f.original_name || '')
                          } catch {}
                        }}
                        items={files.map((file, idx) => ({
                          key: String(file.id || idx),
                          label: file.original_name || `File ${idx+1}`,
                          children: (
                            <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', height:'100%' }}>
                              {renderPreviewForFile(entry, file)}
                            </div>
                          )
                        }))}
                      />
                    </div>
                  )
                }
                // Single file only
                const first = files[0] || null
                return (
                  <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', height:'100%' }}>
                    {renderPreviewForFile(entry, first)}
                  </div>
                )
              }
              // Multiple reports: keep per-report tabs as before
              return (
                <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', height:'100%' }}>
                  <Tabs
                    style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', height:'100%' }}
                    tabBarStyle={{ marginBottom: 8 }}
                    onChange={(activeKey) => {
                      try {
                        const sel = items.find(en => String(en.report.id || '') === String(activeKey))
                        if (sel) {
                          const fs = Array.isArray(sel.files) ? sel.files : []
                          const ext = (name='') => String(name).toLowerCase().split('.').pop()
                          const isPdf = (f) => (f?.content_type||'').startsWith('application/pdf') || ['pdf'].includes(ext(f?.original_name||''))
                          const isImg = (f) => (f?.content_type||'').startsWith('image/') || ['png','jpg','jpeg','gif','webp','bmp'].includes(ext(f?.original_name||''))
                          const first = fs.find(isPdf) || fs.find(isImg) || fs[0] || null
                          setViewerTitle((first && first.original_name) || (sel.report?.title) || '')
                        }
                      } catch {}
                    }}
                    items={items.map((entry, idx) => ({
                      key: String(entry.report.id || idx),
                      label: (() => {
                        const files = Array.isArray(entry.files) ? entry.files : []
                        const ext = (name='') => String(name).toLowerCase().split('.').pop()
                        const isPdf = (f) => (f?.content_type||'').startsWith('application/pdf') || ['pdf'].includes(ext(f?.original_name||''))
                        const isImg = (f) => (f?.content_type||'').startsWith('image/') || ['png','jpg','jpeg','gif','webp','bmp'].includes(ext(f?.original_name||''))
                        const first = files.find(isPdf) || files.find(isImg) || files[0] || null
                        return (first?.original_name) || (entry.report.title) || `Report ${entry.report.id}`
                      })(),
                      children: (
                        <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', height:'100%' }}>
                          {(() => {
                            const files = Array.isArray(entry.files) ? entry.files : []
                            const first = files.find(isPdf) || files.find(isImg) || files[0] || null
                            return renderPreviewForFile(entry, first)
                          })()}
                        </div>
                      )
                    }))}
                  />
                </div>
              )
            })()
          ) : (
            <div>No reports/files for this gauge</div>
          )
        )}
      </Modal>
    </div>
  )
}
