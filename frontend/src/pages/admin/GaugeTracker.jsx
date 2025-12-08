import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Space, message, Tag, Popover, Select, DatePicker, Pagination, Input, Tabs, AutoComplete } from 'antd'
import { loadJsPDF, makeHeaderFooter, formatNow } from '../../utils/pdfExport.js'

import { FilterOutlined, ReloadOutlined, CheckOutlined, CloseOutlined, UndoOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import Analytics from './Analytics'

export default function GaugeTracker() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState(null)
  const [sortDir, setSortDir] = useState(null)
  const scrollRef = useRef(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState(undefined) // 'requested' | 'accepted' | 'rejected' | 'returned'
  const [dateFilter, setDateFilter] = useState(null) // [dayjs, dayjs]
  const [nameFilter, setNameFilter] = useState('') // equipment name contains
  const [nameOptions, setNameOptions] = useState([]) // suggestions for equipment names
  const nameFetchRef = useRef(0)
  const [exporting, setExporting] = useState(false)

  const limit = pageSize
  const fetchRows = async (opts = {}) => {
    setLoading(true)
    try {
      const cur = typeof opts.page === 'number' ? opts.page : (currentPage - 1)
      const params = new URLSearchParams({ limit: String(limit), offset: String(cur * limit) })
      if (sortBy) params.set('sort_by', sortBy)
      if (sortDir) params.set('sort_dir', sortDir)
      // Date range filter
      if (Array.isArray(dateFilter) && dateFilter[0] && dateFilter[1]) {
        params.set('from_date', dateFilter[0].format('YYYY-MM-DD'))
        params.set('to_date', dateFilter[1].format('YYYY-MM-DD'))
      }
      // Equipment name contains (server-side)
      if (nameFilter && nameFilter.trim().length > 0) {
        params.set('name', nameFilter.trim())
      }
      const res = await fetch(`/gauge-tracker?${params.toString()}`)
      if (!res.ok) {
        try {
          const txt = await res.text()
          message.error(txt || 'Failed to load gauge tracker')
        } catch {
          message.error('Failed to load gauge tracker')
        }
        setRows([])
        setTotalItems(0)
        return
      }
      const data = await res.json()
      const batch = Array.isArray(data) ? data.map(r=>({ ...r, key: r.id })) : []
      const hdr = res.headers ? res.headers.get('X-Total-Count') : null
      const total = hdr ? Number(hdr) : batch.length
      setTotalItems(Number.isFinite(total) ? total : batch.length)
      setRows(batch)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows({ page: currentPage - 1 }) }, [currentPage, pageSize, sortBy, sortDir, dateFilter, nameFilter])

  const fetchNameSuggest = async (q) => {
    const cur = ++nameFetchRef.current
    try {
      const qs = new URLSearchParams({ q: q || '', limit: '10' }).toString()
      const res = await fetch(`/equipment/suggest?${qs}`)
      const data = await res.json().catch(()=>[])
      if (nameFetchRef.current !== cur) return
      const opts = (Array.isArray(data) ? data : [])
        .filter(s => s && (s.type === 'name') && typeof s.value === 'string')
        .map(s => ({ value: s.value }))
      setNameOptions(opts)
    } catch {
      if (nameFetchRef.current === cur) setNameOptions([])
    }
  }

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
      title: 'Range',
      dataIndex: 'ranges',
      key: 'ranges',
      width: 200,
      ellipsis: true,
      render: (v) => {
        const arr = Array.isArray(v) ? v : []
        return arr.length ? <span title={arr.join(', ')}>{arr.join(', ')}</span> : <span style={{ color: '#999' }}>—</span>
      }
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
      const dOk = Array.isArray(dateFilter) && dateFilter[0] && dateFilter[1]
        ? (() => {
            try {
              const dt = r.requested_at ? dayjs(r.requested_at) : null
              if (!dt) return false
              const fromOk = dt.isSame(dateFilter[0], 'day') || dt.isAfter(dateFilter[0], 'day')
              const toOk = dt.isSame(dateFilter[1], 'day') || dt.isBefore(dateFilter[1], 'day')
              return fromOk && toOk
            } catch { return false }
          })()
        : true
      return sOk && dOk
    })
  }, [rows, statusFilter, dateFilter])

  const handlePageChange = (page, size) => {
    setCurrentPage(page)
    if (size !== pageSize) {
      setPageSize(size)
    }
  }

  const exportTrackerPDF = async () => {
    try {
      setExporting(true)
      // Fetch all rows from server (server filters: date/name; status filter is client-side here)
      const jsPDF = await loadJsPDF()
      const all = []
      let offset = 0
      const pageLimit = 500
      for (let i = 0; i < 200; i++) {
        const params = new URLSearchParams({ limit: String(pageLimit), offset: String(offset) })
        // sort recent first for export
        params.set('sort_by', 'requested_at')
        params.set('sort_dir', 'desc')
        if (Array.isArray(dateFilter) && dateFilter[0] && dateFilter[1]) {
          params.set('from_date', dateFilter[0].format('YYYY-MM-DD'))
          params.set('to_date', dateFilter[1].format('YYYY-MM-DD'))
        }
        if (nameFilter && nameFilter.trim()) params.set('name', nameFilter.trim())
        const res = await fetch(`/gauge-tracker?${params.toString()}`)
        if (!res.ok) break
        const data = await res.json().catch(()=>[])
        const arr = Array.isArray(data) ? data : []
        all.push(...arr)
        if (arr.length < pageLimit) break
        offset += pageLimit
      }
      // Apply client-side status/date filter to match on-screen filteredRows
      const subset = all.filter(r => {
        const sOk = statusFilter ? String(r.status||'').toLowerCase() === String(statusFilter).toLowerCase() : true
        const dOk = Array.isArray(dateFilter) && dateFilter[0] && dateFilter[1]
          ? (() => {
              try {
                const dt = r.requested_at ? dayjs(r.requested_at) : null
                if (!dt) return false
                const fromOk = dt.isSame(dateFilter[0], 'day') || dt.isAfter(dateFilter[0], 'day')
                const toOk = dt.isSame(dateFilter[1], 'day') || dt.isBefore(dateFilter[1], 'day')
                return fromOk && toOk
              } catch { return false }
            })()
          : true
        return sOk && dOk
      })
      if (subset.length === 0) { message.info('No records to export'); return }
      const doc = new jsPDF({ orientation: 'landscape' })
      // Filter summary
      const filters = []
      if (statusFilter) filters.push(`Status=${String(statusFilter).toUpperCase()}`)
      if (Array.isArray(dateFilter) && dateFilter[0] && dateFilter[1]) filters.push(`Date Range=${dateFilter[0].format('YYYY-MM-DD')}–${dateFilter[1].format('YYYY-MM-DD')}`)
      if (nameFilter && nameFilter.trim()) filters.push(`Name~"${nameFilter.trim()}"`)
      if (filters.length) {
        doc.setFontSize(9)
        doc.text(`Filters: ${filters.join(', ')}`, 14, 22)
      }
      const head = [[
        'Equipment', 'Range', 'IDFN', 'Location', 'Make/Model', 'Requested By', 'Requested At', 'Status', 'Accepted By', 'Accepted At', 'Returned By', 'Returned At', 'Purpose', 'Return Condition'
      ]]
      const body = subset.map(r => [
        String(r.name_of_the_equipment ?? ''),
        (Array.isArray(r.ranges) && r.ranges.length ? r.ranges.join(', ') : ''),
        String(r.idfn_no ?? ''),
        String(r.location ?? ''),
        String(r.make_model ?? ''),
        String(r.requested_by ?? ''),
        r.requested_at ? new Date(r.requested_at).toLocaleString() : '',
        String((r.status||'').toUpperCase()),
        String(r.accepted_by ?? ''),
        r.accepted_at ? new Date(r.accepted_at).toLocaleString() : '',
        String(r.returned_by ?? ''),
        r.returned_at ? new Date(r.returned_at).toLocaleString() : '',
        String(r.purpose ?? ''),
        r.return_status ? (r.return_status === 'Custom' && r.return_remarks ? r.return_remarks : r.return_status) : (r.return_remarks || '')
      ])
      doc.autoTable({ head, body, startY: filters.length ? 26 : 24, styles: { fontSize: 8 } })
      makeHeaderFooter(doc, 'Gauge Tracker')
      const anyFilter = Boolean(statusFilter) || (Array.isArray(dateFilter) && dateFilter[0] && dateFilter[1]) || (nameFilter && nameFilter.trim())
      const fname = anyFilter ? `gauge-tracker_filtered_${formatNow()}.pdf` : `gauge-tracker_all_${formatNow()}.pdf`
      doc.save(fname)
    } catch (e) {
      message.error('Failed to generate PDF')
    } finally {
      setExporting(false)
    }
  }
  const logsTab = (
    <div className="table-wrapper">
      <div className="table-controls">
        <div className="search-section">
          <Popover
            title={null}
            trigger="click"
            open={filterOpen}
            onOpenChange={setFilterOpen}
            content={(
              <div style={{display:'grid', gap:8, minWidth:260}}>
                <div>
                  <div style={{fontSize:12, color:'#666'}}>Equipment name</div>
                  <AutoComplete
                    value={nameFilter}
                    options={nameOptions}
                    onSearch={(text)=>{ setNameFilter(text); fetchNameSuggest(text) }}
                    onSelect={(v)=>{ setNameFilter(v) }}
                    allowClear
                    style={{ width: '100%' }}
                    placeholder="Type to search equipment names"
                    filterOption={false}
                  />
                </div>
                <div>
                  <div style={{fontSize:12, color:'#666'}}>Status</div>
                  <Select
                    allowClear
                    placeholder="Select status"
                    value={statusFilter}
                    onChange={(v)=>setStatusFilter(v)}
                    style={{ width: '100%' }}
                    options={[
                      { label: 'Requested', value: 'requested' },
                      { label: 'Accepted', value: 'accepted' },
                      { label: 'Rejected', value: 'rejected' },
                      { label: 'Returned', value: 'returned' },
                    ]}
                  />
                </div>
                <div>
                  <div style={{fontSize:12, color:'#666'}}>Requested date range</div>
                  <Space.Compact style={{ width: '100%' }}>
                    <DatePicker
                      style={{ width: '50%' }}
                      placeholder="From date"
                      value={Array.isArray(dateFilter) ? dateFilter[0] : null}
                      onChange={(d)=> setDateFilter(d ? [d, Array.isArray(dateFilter)? dateFilter[1] : null] : (Array.isArray(dateFilter)? [null, dateFilter[1]] : null))}
                      allowClear
                    />
                    <DatePicker
                      style={{ width: '50%' }}
                      placeholder="To date"
                      value={Array.isArray(dateFilter) ? dateFilter[1] : null}
                      onChange={(d)=> setDateFilter(d ? [Array.isArray(dateFilter)? dateFilter[0] : null, d] : (Array.isArray(dateFilter)? [dateFilter[0], null] : null))}
                      allowClear
                    />
                  </Space.Compact>
                </div>
                <Space>
                  <Button size="small" onClick={()=>{ setStatusFilter(undefined); setDateFilter(null); setNameFilter('') }}>Reset</Button>
                  <Button size="small" type="primary" onClick={()=>{ setCurrentPage(1); fetchRows({ page: 0 }) }}>Apply</Button>
                </Space>
              </div>
            )}
          >
            <Button icon={<FilterOutlined />}>
              Filters
            </Button>
          </Popover>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
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
            <Button size="small" type="primary" onClick={exportTrackerPDF} loading={exporting} disabled={exporting} style={{ padding: '0 8px', width: 'auto', flex: '0 0 auto', whiteSpace: 'nowrap' }}>
              {exporting ? 'Generating...' : 'Download PDF'}
            </Button>
          </div>
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
  )

  return (
    <div className="equipment-table-container">
      <div className="table-header">
        <h2>Gauge Tracker</h2>
      </div>
      <Tabs
        items={[
          {
            key: 'logs',
            label: <span style={{ padding: '0 24px', fontSize: '15px', fontWeight: 500 }}>Logs</span>,
            children: logsTab,
          },
          {
            key: 'analytics',
            label: <span style={{ padding: '0 24px', fontSize: '15px', fontWeight: 500 }}>Analytics</span>,
            children: <div style={{ marginTop: '8px' }}><Analytics /></div>,
          },
        ]}
      />
    </div>
  )
}
