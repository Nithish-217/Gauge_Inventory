import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Space, Tag, message, Popover, Select, DatePicker, Pagination, Input, Modal, Radio } from 'antd'
import { FilterOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { TextArea } = Input

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
  const [returnModalOpen, setReturnModalOpen] = useState(false)
  const [returnModalRow, setReturnModalRow] = useState(null)
  const [returnCondition, setReturnCondition] = useState('Good')
  const [returnRemarks, setReturnRemarks] = useState('')

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

  const onReturn = (row) => {
    // Open return modal first
    setReturnModalRow(row)
    setReturnCondition('Good')
    setReturnRemarks('')
    setReturnModalOpen(true)
  }

  const submitReturn = async () => {
    const row = returnModalRow
    if (!row) return
    
    // Validate: remarks required for Bad or Needs Repair
    if ((returnCondition === 'Bad' || returnCondition === 'Needs Repair') && !returnRemarks.trim()) {
      message.warning('Remarks are required for Bad or Needs Repair condition')
      return
    }
    
    setReturnModalOpen(false)
    try {
      const res = await fetch(`/gauge-tracker/${row.id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accepted_by: username || 'operator',
          return_status: returnCondition,
          return_remarks: returnRemarks.trim() || null
        })
      })
      if (!res.ok) throw new Error(await res.text() || 'Failed to return')
      message.success('Marked as returned')
      setCurrentPage(1); fetchRows({ page: 0, reset: true })
      setReturnCondition('Good')
      setReturnRemarks('')
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
      title: 'Purpose', 
      dataIndex: 'purpose', 
      key: 'purpose', 
      width: 200, 
      ellipsis: true,
      render: (text) => text ? <span title={text}>{text}</span> : <span style={{ color: '#999' }}>—</span>
    },
    { 
      title: 'Return Condition', 
      dataIndex: 'return_status', 
      key: 'return_status', 
      width: 200, 
      align: 'center',
      render: (text, record) => {
        if (!text) return <span style={{ color: '#999' }}>—</span>
        // If status is "Custom", show the actual remarks text instead
        if (text === 'Custom' && record.return_remarks) {
          return (
            <span 
              style={{ 
                display: 'inline-block',
                padding: '4px 12px',
                background: '#e6f7ff',
                border: '1px solid #91d5ff',
                borderRadius: '4px',
                color: '#1890ff',
                fontSize: '12px',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={record.return_remarks}
            >
              {record.return_remarks}
            </span>
          )
        }
        const colorMap = {
          'Good': 'green',
          'Bad': 'red',
          'Needs Repair': 'orange',
          'Custom': 'blue'
        }
        const color = colorMap[text] || 'default'
        return <Tag color={color}>{text}</Tag>
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
              type={canReturn ? 'primary' : 'default'}
              onClick={()=>onReturn(row)} 
              disabled={!canReturn}
              title={canReturn ? 'Return' : 'Only accepted requests can be returned'}
            >
              Return
            </Button>
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
            {/* Refresh button hidden */}
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

      <Modal
        title={`Return Gauge - ${returnModalRow?.name_of_the_equipment || ''}`}
        open={returnModalOpen}
        onCancel={() => {
          setReturnModalOpen(false)
          setReturnModalRow(null)
          setReturnCondition('Good')
          setReturnRemarks('')
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setReturnModalOpen(false)
              setReturnModalRow(null)
              setReturnCondition('Good')
              setReturnRemarks('')
            }}
          >
            Cancel
          </Button>,
          <Button
            key="submit"
            type="primary"
            onClick={submitReturn}
          >
            Submit Return
          </Button>
        ]}
        destroyOnClose
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>
              Return Condition <span style={{ color: '#ff4d4f' }}>*</span>
            </label>
            <Radio.Group
              value={returnCondition}
              onChange={(e) => {
                setReturnCondition(e.target.value)
                // Clear remarks when switching to Good
                if (e.target.value === 'Good') {
                  setReturnRemarks('')
                }
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <Radio value="Good">Good</Radio>
              <Radio value="Bad">Bad</Radio>
              <Radio value="Needs Repair">Needs Repair</Radio>
              <Radio value="Custom">Custom</Radio>
            </Radio.Group>
          </div>
          
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 4 }}>
              Remarks
              {(returnCondition === 'Bad' || returnCondition === 'Needs Repair') && (
                <span style={{ color: '#ff4d4f' }}> *</span>
              )}
            </label>
            <p style={{ fontSize: 12, color: '#666', marginTop: 4, marginBottom: 8 }}>
              {(returnCondition === 'Bad' || returnCondition === 'Needs Repair')
                ? 'Remarks are required for this condition'
                : 'Additional details about the return condition (optional)'}
            </p>
            <TextArea
              value={returnRemarks}
              onChange={(e) => setReturnRemarks(e.target.value)}
              placeholder={
                returnCondition === 'Good' ? 'Optional: Any additional notes...' :
                returnCondition === 'Bad' || returnCondition === 'Needs Repair'
                  ? 'Please describe the issue...'
                  : 'Enter custom condition details...'
              }
              rows={4}
              maxLength={500}
              showCount
              required={returnCondition === 'Bad' || returnCondition === 'Needs Repair'}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
