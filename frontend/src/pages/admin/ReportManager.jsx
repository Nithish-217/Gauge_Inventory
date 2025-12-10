import React, { useEffect, useMemo, useRef, useState } from 'react'
import PdfJsViewer from '../../components/PdfViewer/PdfJsViewer'
import '../../components/PdfViewer/pdf-viewer.css'
import { Table, Button, Space, Input, DatePicker, InputNumber, Upload, message, Typography, Tag, Modal, Form, Pagination, AutoComplete, List, Divider, Popconfirm, Tabs, Spin } from 'antd'
import { ReloadOutlined, UploadOutlined, DownloadOutlined, EyeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function ReportManager() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [activeRow, setActiveRow] = useState(null)
  const [form] = Form.useForm()
  const [selectedFiles, setSelectedFiles] = useState([])
  const [reportTitle, setReportTitle] = useState('')
  const [reportNotes, setReportNotes] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState(null)
  const [sortDir, setSortDir] = useState(null)
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
  const scrollRef = useRef(null)
  const bcRef = useRef(null)
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
      setFilesModalData(all)
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
      } else {
        setViewerData({ reports: all })
      }
    } catch {
      setViewerData({ reports: [] })
    } finally {
      setViewerLoading(false)
    }
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
      const fd = new FormData()
      fd.append('title', (reportTitle || `Report for ${row.gauge_id}`))
      fd.append('notes', (reportNotes || ''))
      // Optional equipment fields (keeps legacy behavior)
      fd.append('last_calibration_date', dayjs(state.last).format('YYYY-MM-DD'))
      fd.append('calibration_freq_months', String(state.freq))
      state.files.forEach(f => { if (f) fd.append('files', f) })
      const res = await fetch(`/gauges/${row.gauge_id}/reports`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text() || 'Upload failed')
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
      message.error(typeof e?.message === 'string' ? e.message : 'Upload failed')
    }
  }

  const columns = useMemo(() => [
    { 
      title: 'Sl. No.', 
      dataIndex: 'gauge_id', 
      key: 'gauge_id', 
      width: 100, 
      align: 'center',
      sorter: (a,b) => a.gauge_id - b.gauge_id
    },
    { 
      title: 'Equipment', 
      dataIndex: 'name_of_the_equipment', 
      key: 'name', 
      ellipsis: true,
      width: 200,
      sorter: (a,b) => String(a.name_of_the_equipment||'').localeCompare(String(b.name_of_the_equipment||''))
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
            icon={<EyeOutlined />} 
            onClick={()=> openViewer(row)}
            title="View"
            style={{ color: '#1890ff' }}
          />
          <Button 
            type="text" 
            icon={<DownloadOutlined />} 
            onClick={()=> window.open(`/gauges/${row.gauge_id}/reports/zip`, '_self')}
            title="Download ZIP"
            style={{ color: '#52c41a' }}
          />
        </Space>
      )
    },
    { 
      title: 'Upload', 
      key: 'upload', 
      fixed: 'right', 
      align: 'center', 
      width: 120, 
      render:(_,row)=> (
        <Button 
          type="text" 
          icon={<UploadOutlined />} 
          onClick={() => {
            setActiveRow(row)
            setSelectedFiles([])
            setModalOpen(true)
            const freqVal = (row.calibration_freq_months !== undefined && row.calibration_freq_months !== null)
              ? Number(row.calibration_freq_months)
              : (row.freq !== undefined && row.freq !== null ? Number(row.freq) : undefined)
            setTimeout(() => {
              try {
                form.setFieldsValue({
                  last: row.date_of_last_calibration ? dayjs(row.date_of_last_calibration) : null,
                  freq: isNaN(freqVal) ? undefined : freqVal,
                })
              } catch {}
            }, 0)
          }}
          title="Upload Report"
          style={{ color: '#722ed1' }}
        >
          Upload
        </Button>
      )
    },
  ], [])

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
        onCancel={() => { setModalOpen(false); setActiveRow(null); setSelectedFiles([]); try { form.resetFields() } catch {} }}
        onOk={async () => {
          try {
            const values = await form.validateFields()
            const state = { last: values.last, freq: values.freq, files: selectedFiles }
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
          <Form.Item label="Title">
            <Input placeholder={`Report for ${activeRow?.gauge_id || ''}`} value={reportTitle} onChange={(e)=>setReportTitle(e.target.value)} />
          </Form.Item>
          <Form.Item label="Notes">
            <Input.TextArea rows={3} placeholder="Optional notes" value={reportNotes} onChange={(e)=>setReportNotes(e.target.value)} />
          </Form.Item>
          <Form.Item label="Report files" required>
            <Upload.Dragger
              beforeUpload={(file)=>{ setSelectedFiles(prev=>[...prev, file]); return false }}
              maxCount={10}
              accept=".pdf,.png,.jpg,.jpeg,.docx,.csv,.txt"
              multiple
              onChange={(info)=>{
                const list = (info?.fileList || []).map(it => it.originFileObj || it.file || it)
                setSelectedFiles(list.filter(Boolean))
              }}
            >
              <p className="ant-upload-drag-icon">Drop files here or click to select</p>
              <p className="ant-upload-hint">Allowed: PDF, PNG, JPG, DOCX, CSV, TXT. Max 10 files.</p>
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
            <div>No files found for this gauge</div>
          ) : (
            <div>
              {filesModalData.map(({ report, files }) => (
                <div key={`report-${report.id}`} style={{ marginBottom: 16 }}>
                  <Divider orientation="left">{report.title || `Report ${report.id}`} <span style={{ marginLeft: 8, color:'#888' }}>{report.created_at ? new Date(report.created_at).toLocaleString() : ''}</span></Divider>
                  <List
                    size="small"
                    dataSource={files}
                    bordered
                    renderItem={(f) => (
                      <List.Item
                        actions={[
                          <a key="open" href={f.url} target="_blank" rel="noreferrer">Open</a>,
                          <a key="stream" href={`/gauges/${filesModalGauge.gauge_id}/reports/${report.id}/files/${f.id}/stream?download=1`}>Download</a>,
                          <Popconfirm key="del" title="Delete this file?" onConfirm={() => deleteFile(filesModalGauge.gauge_id, report.id, f.id)}>
                            <a style={{ color:'#ff4d4f' }}>Delete</a>
                          </Popconfirm>
                        ]}
                      >
                        <List.Item.Meta
                          title={f.original_name || f.content_type || 'file'}
                          description={`${(f.size_bytes||0)} bytes • ${f.content_type || ''} • ${f.uploaded_at || ''}`}
                        />
                      </List.Item>
                    )}
                  />
                </div>
              ))}
            </div>
          )
        )}
      </Modal>

      {/* PDF.js Modal viewer */}
      <Modal
        title={viewerGauge ? `Reports - ${viewerGauge.name_of_the_equipment || ''} (Gauge ${viewerGauge.gauge_id})` : 'Reports'}
        open={viewerOpen}
        onCancel={() => { setViewerOpen(false); setViewerGauge(null); setViewerData({ reports: [] }) }}
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
                          <div style={{ padding:16 }}>
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
                    items={items.map((entry, idx) => ({
                      key: String(entry.report.id || idx),
                      label: entry.report.title || `Report ${entry.report.id}`,
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
