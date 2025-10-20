import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Space, message, Tag, Popover, Select, DatePicker, Pagination } from 'antd'
import { FilterOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, UndoOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function GaugeTracker() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const scrollRef = useRef(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState(undefined) // 'requested' | 'accepted' | 'rejected' | 'returned'
  const [dateFilter, setDateFilter] = useState(null) // dayjs

  const limit = pageSize
  const fetchRows = async (opts = {}) => {
    setLoading(true)
    try {
      const cur = typeof opts.page === 'number' ? opts.page : (currentPage - 1)
      const params = new URLSearchParams({ limit: String(limit), offset: String(cur * limit) })
      const res = await fetch(`/gauge-tracker?${params.toString()}`)
      const data = await res.json()
      const batch = Array.isArray(data) ? data.map(r=>({ ...r, key: r.id })) : []
      setTotalItems(batch.length) // Note: This API doesn't return total count
      setRows(batch)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows({ page: currentPage - 1 }) }, [currentPage, pageSize])

  const onAccept = async (row) => {
    try {
      const accepted_by = (()=>{ try { return localStorage.getItem('username') || 'admin' } catch { return 'admin' } })()
      const res = await fetch(`/gauge-tracker/${row.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_by })
      })
      if (!res.ok) throw new Error(await res.text() || 'Failed to accept')
      message.success('Accepted')
      setCurrentPage(1); fetchRows({ page:0, reset:true })
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
      setCurrentPage(1); fetchRows({ page:0, reset:true })
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to reject')
    }
  }

  const columns = useMemo(() => [
    { title: 'Sl. No.', key: 'slno', width: 70, render:(_, __, index)=> index + 1 },
    { title: 'Equipment', dataIndex: 'name_of_the_equipment', key: 'name_of_the_equipment', width: 220, ellipsis: true },
    { 
      title: 'IDFN', 
      dataIndex: 'idfn_no', 
      key: 'idfn_no', 
      width: 120, 
      align: 'center',
      ellipsis: true,
      sorter: (a,b) => String(a.idfn_no||'').localeCompare(String(b.idfn_no||'')),
      render: (text) => text ? <span className="idfn-tag">{text}</span> : ''
    },
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
    { 
      title: 'Actions', 
      key: 'actions', 
      className: 'actions-col', 
      width: 180, 
      fixed: 'right', 
      align: 'center', 
      render: (_, row) => {
      const s = (row.status||'').toLowerCase()
      const disabled = s === 'accepted' || s === 'rejected' || s === 'returned'
      return (
          <Space size="small">
            <Button 
              type="text" 
              icon={<CheckOutlined />} 
              onClick={()=>onAccept(row)} 
              disabled={disabled}
              title="Accept"
              style={{ color: disabled ? '#d9d9d9' : '#52c41a' }}
            />
            <Button 
              type="text" 
              icon={<CloseOutlined />} 
              onClick={()=>onReject(row)} 
              disabled={disabled}
              title="Reject"
              style={{ color: disabled ? '#d9d9d9' : '#ff4d4f' }}
            />
        </Space>
      )
      }
    },
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

  const handlePageChange = (page, size) => {
    setCurrentPage(page)
    if (size !== pageSize) {
      setPageSize(size)
    }
  }

  return (
    <div className="equipment-table-container">
      <div className="table-header">
        <h2>Gauge Tracker</h2>
      </div>

      <div className="table-wrapper">
        <div className="table-controls">
          <div className="search-section">
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
          </div>
          <div className="action-buttons">
            <Button 
              icon={<ReloadOutlined />} 
              onClick={() => { setCurrentPage(1); fetchRows({ page:0, reset:true }) }}
            >
              Refresh
            </Button>
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
          </div>
        </div>

        <div className="table-container">
          <Table
            columns={columns}
            dataSource={filteredRows}
            loading={loading}
            pagination={false}
            bordered
            size="middle"
            className="ant-table-striped professional-table"
            rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-light' : 'table-row-dark')}
            scroll={{ x: 1000 }}
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
    </div>
  )
}
