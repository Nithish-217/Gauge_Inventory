import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Space, Tag, message, Popover, Select, DatePicker } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function OperatorGaugeTracker() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const scrollRef = useRef(null)
  const username = (()=>{ try { return localStorage.getItem('username') || '' } catch { return '' } })()
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState(undefined)
  const [dateFilter, setDateFilter] = useState(null)

  const limit = 50
  const fetchRows = async (opts = {}) => {
    if (!username) return
    setLoading(true)
    try {
      const cur = typeof opts.page === 'number' ? opts.page : page
      const params = new URLSearchParams({ requested_by: username, limit: String(limit), offset: String(cur * limit) })
      const res = await fetch(`/gauge-tracker?${params.toString()}`)
      if (!res.ok) throw new Error(await res.text() || 'Failed to load')
      const data = await res.json()
      const batch = Array.isArray(data) ? data.map(r=>({ ...r, key: r.id })) : []
      setHasMore(batch.length === limit)
      if (cur === 0 || opts.reset) setRows(batch)
      else setRows(prev => [...prev, ...batch])
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows({ page }) }, [username, page])

  const onReturn = async (row) => {
    try {
      const res = await fetch(`/gauge-tracker/${row.id}/return`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_by: username || 'operator' })
      })
      if (!res.ok) throw new Error(await res.text() || 'Failed to return')
      message.success('Marked as returned')
      setPage(0); setHasMore(true); fetchRows({ page:0, reset:true })
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to return')
    }
  }

  const columns = useMemo(() => [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: 'Equipment', dataIndex: 'name_of_the_equipment', key: 'name_of_the_equipment', width: 220, ellipsis: true },
    { title: 'IDFN', dataIndex: 'idfn_no', key: 'idfn_no', width: 120, ellipsis: true },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 120, render:(v)=> (v||'').toUpperCase() },
    { title: 'Holder', key: 'holder', width: 260, render:(_,row)=> {
      const s = (row.status||'').toLowerCase()
      if (s === 'accepted') {
        return <span>Accepted by <Tag color="blue">{row.accepted_by || '-'}</Tag> on {row.accepted_at ? new Date(row.accepted_at).toLocaleString() : '-'}</span>
      }
      if (s === 'rejected') {
        return <span>Rejected by <Tag color="red">{row.accepted_by || '-'}</Tag> on {row.accepted_at ? new Date(row.accepted_at).toLocaleString() : '-'}</span>
      }
      if (s === 'returned') {
        return <span>Returned on {row.returned_at ? new Date(row.returned_at).toLocaleString() : '-'}</span>
      }
      return <span>Pending</span>
    }},
    { title: 'Actions', key: 'actions', width: 160, fixed: 'right', align: 'right', render: (_, row) => {
      const s = (row.status||'').toLowerCase()
      const canReturn = s === 'accepted' && (row.requested_by || '').toLowerCase() === (username||'').toLowerCase()
      return (
        <Space>
          <Button onClick={fetchRows}>Refresh</Button>
          <Button type="primary" onClick={()=>onReturn(row)} disabled={!canReturn}>Return</Button>
        </Space>
      )
    }},
  ], [username])

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      const sOk = statusFilter ? String(r.status||'').toLowerCase() === String(statusFilter).toLowerCase() : true
      const dOk = dateFilter ? (()=>{
        try {
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
        <h2 style={{margin:0}}>My Gauge Requests</h2>
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
      <div style={{ height: 'calc(100vh - 260px)', overflow: 'auto', border:'1px solid rgba(0,0,0,0.06)', borderRadius:12 }} onScroll={onScroll} ref={scrollRef}>
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
        <div style={{ textAlign:'center', padding:8, color:'#888' }}>
          {loading ? 'Loading…' : (hasMore ? 'Scroll to load more' : 'End of list')}
        </div>
      </div>
    </div>
  )
}
