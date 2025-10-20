import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Space, Tag, message, Input } from 'antd'

export default function CalibrationReport() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const scrollRef = useRef(null)
  const username = (()=>{ try { return localStorage.getItem('username') || '' } catch { return '' } })()

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
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows({ page: 0 }) }, [username])

  const onScroll = (e) => {
    const el = e.currentTarget
    if (!hasMore || loading) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
    if (nearBottom) { const nxt = page + 1; setPage(nxt); fetchRows({ page: nxt }) }
  }

  const columns = useMemo(() => [
    { title: 'Sl. No.', dataIndex: 'gauge_id', key: 'gauge_id', width: 90 },
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
    { title: 'Report', dataIndex: 'object_key', key: 'report', width: 220, fixed: 'right', align:'right', render:(_,row)=> (
      <Space>
        <Button onClick={async ()=> {
          try { window.open(`/reports/${row.gauge_id}/view`, '_blank') } catch { message.error('Report not available') }
        }}>View</Button>
        <Button onClick={async ()=> {
          try { window.open(`/reports/${row.gauge_id}/download`, '_self') } catch { message.error('Report not available') }
        }}>Download</Button>
      </Space>
    )},
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
    </div>
  )
}
