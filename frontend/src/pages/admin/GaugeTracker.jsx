import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Space, message, Tag, Popover, Select, DatePicker } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function GaugeTracker() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const scrollRef = useRef(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState(undefined) // 'requested' | 'accepted' | 'rejected' | 'returned'
  const [dateFilter, setDateFilter] = useState(null) // dayjs

  const limit = 50
  const fetchRows = async (opts = {}) => {
    setLoading(true)
    try {
      const cur = typeof opts.page === 'number' ? opts.page : page
      const params = new URLSearchParams({ limit: String(limit), offset: String(cur * limit) })
      const res = await fetch(`/gauge-tracker?${params.toString()}`)
      const data = await res.json()
      const batch = Array.isArray(data) ? data.map(r=>({ ...r, key: r.id })) : []
      setHasMore(batch.length === limit)
      if (cur === 0 || opts.reset) setRows(batch)
      else setRows(prev => [...prev, ...batch])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows({ page }) }, [page])

  const onAccept = async (row) => {
    try {
      const accepted_by = (()=>{ try { return localStorage.getItem('username') || 'admin' } catch { return 'admin' } })()
      const res = await fetch(`/gauge-tracker/${row.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_by })
      })
      if (!res.ok) throw new Error(await res.text() || 'Failed to accept')
      message.success('Accepted')
      setPage(0); setHasMore(true); fetchRows({ page:0, reset:true })
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to accept')
    }
  }

  const onReject = async (row) => {
    try {
      const accepted_by = (()=>{ try { return localStorage.getItem('username') || 'admin' } catch { return 'admin' } })()
      const res = await fetch(`/gauge-tracker/${row.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_by })
      })
      if (!res.ok) throw new Error(await res.text() || 'Failed to reject')
      message.success('Rejected')
      setPage(0); setHasMore(true); fetchRows({ page:0, reset:true })
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to reject')
    }
  }

  const columns = useMemo(() => [
    { title: 'Sl. No.', key: 'slno', width: 70, render:(_, __, index)=> index + 1 },
    { title: 'Equipment', dataIndex: 'name_of_the_equipment', key: 'name_of_the_equipment', width: 220, ellipsis: true },
    { title: 'IDFN', dataIndex: 'idfn_no', key: 'idfn_no', width: 120, ellipsis: true },
    { title: 'Location', dataIndex: 'location', key: 'location', width: 140, ellipsis: true },
    { title: 'Make/Model', dataIndex: 'make_model', key: 'make_model', width: 150, ellipsis: true },
    { title: 'Request ID', key: 'request_id', width: 180, render:(_,row)=> {
      try {
        const d = row.requested_at ? new Date(row.requested_at) : null
        if (!d) return 'REQ_—'
        const pad = (n)=> String(n).padStart(2,'0')
        const req = `REQ_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
        return req
      } catch { return 'REQ_—' }
    }},
    { title: 'Requested By', dataIndex: 'requested_by', key: 'requested_by', width: 140, ellipsis: true },
    { title: 'Requested At', dataIndex: 'requested_at', key: 'requested_at', width: 180, render:(v)=> v ? new Date(v).toLocaleString() : '' },
    { title: 'Actions', key: 'holder', width: 260, render:(_,row)=> {
      const s = (row.status||'').toLowerCase()
      if (s === 'accepted') {
        return <span>Accepted by <Tag color="blue">{row.accepted_by || '-'}</Tag> on {row.accepted_at ? new Date(row.accepted_at).toLocaleString() : '-'}</span>
      }
      if (s === 'rejected') {
        return <span>Rejected by <Tag color="red">{row.accepted_by || '-'}</Tag> on {row.accepted_at ? new Date(row.accepted_at).toLocaleString() : '-'}</span>
      }
      if (s === 'returned') {
        return <span>Returned by <Tag color="green">{row.returned_by || '-'}</Tag> on {row.returned_at ? new Date(row.returned_at).toLocaleString() : '-'}</span>
      }
      return <span>Not taken</span>
    }},
    { title: 'Status', dataIndex: 'status', key: 'status', width: 120, render:(v)=> (v||'').toUpperCase() },
    { title: 'Actions', key: 'actions', className: 'actions-col', width: 200, fixed: 'right', align: 'right', render: (_, row) => {
      const s = (row.status||'').toLowerCase()
      const disabled = s === 'accepted' || s === 'rejected' || s === 'returned'
      return (
        <Space>
          <Button type="primary" onClick={()=>onAccept(row)} disabled={disabled}>Accept</Button>
          <Button danger onClick={()=>onReject(row)} disabled={disabled}>Reject</Button>
        </Space>
      )
    }},
  ], [])

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      const sOk = statusFilter ? String(r.status||'').toLowerCase() === String(statusFilter).toLowerCase() : true
      const dOk = dateFilter ? (()=>{
        try {
          // Compare against requested_at by default
          const dt = r.requested_at ? dayjs(r.requested_at) : null
          return dt ? dt.isSame(dateFilter, 'day') : false
        } catch { return false }
      })() : true
      return sOk && dOk
    })
  }, [rows, statusFilter, dateFilter])

  const onScroll = (e) => {
    const el = e.currentTarget
    if (!hasMore || loading) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
    if (nearBottom) setPage(p=>p+1)
  }

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
        <h2 style={{margin:0}}>Gauge Tracker</h2>
        <Space>
          <Popover
            title={null}
            trigger="click"
            open={filterOpen}
            onOpenChange={setFilterOpen}
            content={(
              <div style={{display:'grid', gap:8, minWidth:240}}>
                <div>
                  <div style={{fontSize:12, color:'#666'}}>Status</div>
                  <Select
                    allowClear
                    placeholder="Select status"
                    value={statusFilter}
                    onChange={(v)=>setStatusFilter(v)}
                    options={[
                      {label:'Requested', value:'requested'},
                      {label:'Accepted', value:'accepted'},
                      {label:'Rejected', value:'rejected'},
                      {label:'Returned', value:'returned'},
                    ]}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div style={{fontSize:12, color:'#666'}}>Date</div>
                  <DatePicker
                    allowClear
                    value={dateFilter}
                    onChange={(d)=>setDateFilter(d)}
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
                  <Button onClick={()=>{ setStatusFilter(undefined); setDateFilter(null) }}>Clear</Button>
                  <Button type="primary" onClick={()=>setFilterOpen(false)}>Apply</Button>
                </div>
              </div>
            )}
          >
            <Button icon={<FilterOutlined />}>Filter</Button>
          </Popover>
          <Button onClick={() => { setPage(0); setHasMore(true); fetchRows({ page:0, reset:true }) }}>Refresh</Button>
        </Space>
      </div>
      <div style={{ height: 'calc(100vh - 260px)', overflow: 'auto' }} onScroll={onScroll} ref={scrollRef}>
        <Table
          columns={columns}
          dataSource={filteredRows}
          loading={loading}
          pagination={false}
          bordered
          size="middle"
          sticky
          tableLayout="fixed"
          scroll={{ x: 1000 }}
          className="ant-table-striped"
          rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-light' : 'table-row-dark')}
        />
        <div style={{ textAlign:'center', padding: 8, color:'#888' }}>
          {loading ? 'Loading…' : (hasMore ? 'Scroll to load more' : 'End of list')}
        </div>
      </div>
      <div style={{display:'flex', justifyContent:'flex-end', marginTop: 12}}>
        <Space>
          <Button
            danger
            onClick={async ()=>{
              try {
                const res = await fetch('/admin/free-all-tools', { method: 'POST' })
                if (!res.ok) throw new Error(await res.text() || 'Failed to reset')
                const data = await res.json().catch(()=>({}))
                message.success(`All tools freed${data?.gauge_requests_updated!=null?` (${data.gauge_requests_updated})`:''}`)
                fetchRows()
              } catch (e) {
                message.error(typeof e?.message === 'string' ? e.message : 'Failed to reset')
              }
            }}
          >
            Reset: Free All Tools
          </Button>
        </Space>
      </div>
    </div>
  )
}
