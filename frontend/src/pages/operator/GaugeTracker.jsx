import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Space, Tag, message, Popover, Select, DatePicker, Pagination, Input } from 'antd'
import { FilterOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, UndoOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function OperatorGaugeTracker() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const scrollRef = useRef(null)
  const username = (()=>{ try { return localStorage.getItem('username') || '' } catch { return '' } })()
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState(undefined)
  const [dateFilter, setDateFilter] = useState(null)

  const limit = pageSize
  const fetchRows = async (opts = {}) => {
    if (!username) return
    setLoading(true)
    try {
      const cur = typeof opts.page === 'number' ? opts.page : (currentPage - 1)
      const params = new URLSearchParams({ requested_by: username, limit: String(limit), offset: String(cur * limit) })
      const res = await fetch(`/gauge-tracker?${params.toString()}`)
      if (!res.ok) throw new Error(await res.text() || 'Failed to load')
      const data = await res.json()
      const batch = Array.isArray(data) ? data.map(r=>({ ...r, key: r.id })) : []
      setTotalItems(batch.length) // Note: This API doesn't return total count, using current batch length
      setRows(batch)
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows({ page: currentPage - 1 }) }, [username, currentPage, pageSize])

  const onReturn = async (row) => {
    try {
      const res = await fetch(`/gauge-tracker/${row.id}/return`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_by: username || 'operator' })
      })
      if (!res.ok) throw new Error(await res.text() || 'Failed to return')
      message.success('Marked as returned')
      setCurrentPage(1); fetchRows({ page: 0, reset: true })
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to return')
    }
  }

  const columns = useMemo(() => [
    { 
      title: 'ID', 
      dataIndex: 'id', 
      key: 'id', 
      width: 80, 
      align: 'center',
      sorter: (a,b) => a.id - b.id
    },
    { 
      title: 'Equipment', 
      dataIndex: 'name_of_the_equipment', 
      key: 'name_of_the_equipment', 
      width: 200, 
      ellipsis: true,
      sorter: (a,b) => String(a.name_of_the_equipment||'').localeCompare(String(b.name_of_the_equipment||''))
    },
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
    { 
      title: 'Status', 
      dataIndex: 'status', 
      key: 'status', 
      width: 120, 
      align: 'center',
      render:(v)=> {
        const status = (v||'').toLowerCase()
        const color = status === 'accepted' ? 'green' : status === 'rejected' ? 'red' : status === 'returned' ? 'blue' : 'orange'
        return <Tag color={color}>{(v||'').toUpperCase()}</Tag>
      }
    },
    { 
      title: 'Holder', 
      key: 'holder', 
      width: 280, 
      render:(_,row)=> {
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
      }
    },
    { 
      title: 'Actions', 
      key: 'actions', 
      width: 120, 
      fixed: 'right', 
      align: 'center',
      render: (_, row) => {
        const s = (row.status||'').toLowerCase()
        const canReturn = s === 'accepted' && (row.requested_by || '').toLowerCase() === (username||'').toLowerCase()
        return (
          <Space size="small">
            <Button 
              type="text" 
              icon={<ReloadOutlined />} 
              onClick={fetchRows}
              title="Refresh"
              style={{ color: '#1890ff' }}
            />
            <Button 
              type="text" 
              icon={<UndoOutlined />} 
              onClick={()=>onReturn(row)} 
              disabled={!canReturn}
              title="Return"
              style={{ color: canReturn ? '#52c41a' : '#d9d9d9' }}
            />
          </Space>
        )
      }
    },
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

  const handlePageChange = (page, size) => {
    setCurrentPage(page)
    if (size !== pageSize) {
      setPageSize(size)
    }
  }

  return (
    <div className="equipment-table-container">
      <div className="table-header">
        <h2>My Gauge Requests</h2>
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
