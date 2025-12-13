import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Space, Tag, message, Input, Modal, List, Divider } from 'antd'
import { DownloadOutlined, FolderOutlined } from '@ant-design/icons'

export default function CalibrationReport() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false)
  const [pdfViewerUrl, setPdfViewerUrl] = useState(null)
  const [pdfViewerTitle, setPdfViewerTitle] = useState('')
  const [filesModalOpen, setFilesModalOpen] = useState(false)
  const [filesModalGauge, setFilesModalGauge] = useState(null)
  const [filesModalData, setFilesModalData] = useState([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [hasFilesMap, setHasFilesMap] = useState({})
  const [hasFilesLoading, setHasFilesLoading] = useState(false)
  const scrollRef = useRef(null)
  const username = (()=>{ try { return localStorage.getItem('username') || '' } catch { return '' } })()
  const qDebounceRef = useRef(null)

  const fetchRows = async (opts = {}) => {
    if (!username) return
    setLoading(true)
    try {
      const cur = typeof opts.page === 'number' ? opts.page : page
      const limit = 50
      const offset = cur * limit
      // Get gauges currently held by this operator (accepted and not returned)
      const tr = await fetch(`/gauge-tracker?requested_by=${encodeURIComponent(username)}`)
      if (!tr.ok) throw new Error(await tr.text() || 'Failed to load tracker')
      const tdata = await tr.json()
      const heldIds = new Set(
        (Array.isArray(tdata) ? tdata : [])
          .filter(r => String(r.status||'').toLowerCase() === 'accepted' && !r.returned_at)
          .map(r => r.gauge_id)
      )
      if (heldIds.size === 0) { setRows([]); return }

      // Get reports list and filter to those gauge_ids
      const res = await fetch(`/reports?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      if (!res.ok) throw new Error(await res.text() || 'Failed to load reports')
      const data = await res.json()
      const items = Array.isArray(data.items) ? data.items : []
      const filtered = items.filter(r => heldIds.has(r.gauge_id))
      const batch = filtered.map(r => ({ ...r, key: r.gauge_id }))
      setHasMore(items.length === limit) // pagination based on raw fetch length
      if (cur === 0 || opts.reset) setRows(batch)
      else setRows(prev => [...prev, ...batch])
      // Prefetch has-files flags for currently loaded gauges
      try {
        const ids = (cur === 0 || opts.reset) ? batch.map(r=>r.gauge_id) : [...new Set([...(rows||[]).map(r=>r.gauge_id), ...batch.map(r=>r.gauge_id)])]
        await prefetchHasFiles(ids)
      } catch {}
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  // Files modal helpers (view/download only)
  const normalizeFolderName = (s) => {
    try {
      const v = String(s||'').trim().toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9-_]/g, '_')
        .replace(/_+/g, '_')
      return v || 'untitled'
    } catch { return 'untitled' }
  }

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
      const groupMap = new Map()
      for (const entry of all) {
        const folder = normalizeFolderName((entry.report?.title || `report_${entry.report?.id}`))
        if (!groupMap.has(folder)) groupMap.set(folder, [])
        for (const f of entry.files) {
          groupMap.get(folder).push({ reportId: entry.report.id, file: f })
        }
      }
      const grouped = Array.from(groupMap.entries()).map(([folder, items]) => {
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
      grouped.sort((a,b) => String(a.folder).localeCompare(String(b.folder)))
      setFilesModalData(grouped)
    } catch {
      message.error('Failed to load files')
      setFilesModalData([])
    } finally {
      setFilesLoading(false)
    }
  }

  const openFileFromFilesModal = (gauge_id, reportId, folder, file) => {
    const url = `/gauges/${gauge_id}/reports/${reportId}/files/${file.id}/stream?download=0`
    setPdfViewerUrl(url)
    setPdfViewerTitle(file?.original_name || folder || 'Report')
    setPdfViewerOpen(true)
  }

  const prefetchHasFiles = async (gaugeIds=[]) => {
    const unique = Array.from(new Set((Array.isArray(gaugeIds)?gaugeIds:[]).filter(Boolean)))
    if (!unique.length) return
    setHasFilesLoading(true)
    try {
      const updates = {}
      await Promise.all(unique.map(async (gid) => {
        try {
          const res = await fetch(`/gauges/${gid}/reports`)
          const arr = res.ok ? await res.json().catch(()=>[]) : []
          updates[gid] = Array.isArray(arr) && arr.length > 0
        } catch { updates[gid] = false }
      }))
      setHasFilesMap(prev => ({ ...prev, ...updates }))
    } finally {
      setHasFilesLoading(false)
    }
  }

  useEffect(() => { fetchRows({ page: 0 }) }, [username])

  // Debounced query: refresh results as the user types, preserve infinite scroll logic
  useEffect(() => {
    if (!username) return
    if (qDebounceRef.current) clearTimeout(qDebounceRef.current)
    qDebounceRef.current = setTimeout(() => {
      setPage(0)
      setHasMore(true)
      fetchRows({ page: 0, reset: true })
    }, 300)
    return () => { if (qDebounceRef.current) clearTimeout(qDebounceRef.current) }
  }, [q, username])

  const onScroll = (e) => {
    const el = e.currentTarget
    if (!hasMore || loading) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
    if (nearBottom) { const nxt = page + 1; setPage(nxt); fetchRows({ page: nxt }) }
  }

  const columns = useMemo(() => [
    { title: 'Sl. No.', key: 'sl_no', width: 90, align: 'center', render: (_val, _row, index) => index + 1 },
    { title: 'Equipment', dataIndex: 'name_of_the_equipment', key: 'name', ellipsis: true },
    { 
      title: 'IDFN', 
      dataIndex: 'idfn_no', 
      key: 'idfn', 
      width: 140, 
      align: 'center',
      render:(v)=> v ? <span className="idfn-tag">{v}</span> : <span className="idfn-tag">—</span> 
    },
    { title: 'Last Calibration', dataIndex: 'date_of_last_calibration', key: 'last', width: 160, render:(v)=> v ? new Date(v).toLocaleDateString() : '' },
    { title: 'Freq (months)', dataIndex: 'calibration_freq_months', key: 'freq', width: 130 },
    { title: 'Due', dataIndex: 'calibration_due', key: 'due', width: 160, render:(v)=> v ? new Date(v).toLocaleDateString() : '' },
    { title: 'Report', dataIndex: 'object_key', key: 'report', width: 260, fixed: 'right', align:'right', render:(_,row)=> {
      const val = hasFilesMap[row.gauge_id]
      if (typeof val === 'undefined') {
        return hasFilesLoading ? <span style={{ color:'#999' }}>Checking…</span> : <span style={{ color:'#999' }}>No reports uploaded yet</span>
      }
      if (val === false) return <span style={{ color:'#999' }}>No reports uploaded yet</span>
      return (
        <Space>
          <Button type="text" onClick={()=> openFilesModal(row)}>Files</Button>
          <Button type="text" icon={<DownloadOutlined />} onClick={()=> window.open(`/gauges/${row.gauge_id}/reports/zip`, '_self')} title="Download ZIP" style={{ color: '#52c41a' }} />
        </Space>
      )
    }},
  ], [])

  return (
    <div className="equipment-table-container">
      <div className="table-header">
        <h2>My Calibration Reports</h2>
      </div>

      <div className="table-wrapper">
        <div className="table-controls">
          <div className="search-section">
            <Input.Search
              placeholder="Search by name, IDFN, or location"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              onSearch={()=>{ setPage(0); setHasMore(true); fetchRows({ page:0, reset:true }) }}
              style={{ width: 320 }}
              allowClear
              enterButton
            />
          </div>
          <div className="action-buttons">
            <Button onClick={()=>{ setPage(0); setHasMore(true); fetchRows({ page:0, reset:true }) }}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="table-container">
          <div style={{ maxHeight: 560, overflow: 'auto' }} onScroll={onScroll} ref={scrollRef}>
            <Table
              columns={columns}
              dataSource={rows}
              loading={loading}
              pagination={false}
              size="middle"
              bordered
              sticky
              className="ant-table-striped professional-table"
              rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-light' : 'table-row-dark')}
              scroll={{ x: 1000 }}
            />
            <div style={{ textAlign: 'center', padding: 8, color: '#888' }}>
              {loading ? 'Loading…' : (hasMore ? 'Scroll to load more' : 'End of list')}
            </div>
          </div>
        </div>
      </div>

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
              {filesModalData.map((group) => (
                <div key={`folder-${group.folder}`} style={{ marginBottom: 16 }}>
                  <div style={{ display:'flex', alignItems:'center', gap: 12, padding: '4px 0' }}>
                    <span style={{ display:'flex', alignItems:'center', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <FolderOutlined style={{ color: '#faad14', marginRight: 8 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.folder}</span>
                    </span>
                  </div>
                  <Divider style={{ margin: '8px 0' }} />
                  <List
                    size="small"
                    dataSource={group.items}
                    bordered
                    renderItem={(it) => (
                      <List.Item
                        actions={[
                          <a key="open" href="#" onClick={(e)=>{ e.preventDefault(); openFileFromFilesModal(filesModalGauge.gauge_id, it.reportId, group.folder, it.file) }}>Open</a>,
                          <a key="stream" href={`/gauges/${filesModalGauge.gauge_id}/reports/${it.reportId}/files/${it.file.id}/stream?download=1`}>Download</a>,
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
            </div>
          )
        )}
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
    </div>
  )
}
