import React, { useEffect, useMemo, useState } from 'react'
import { Table, Button, Space, Tag, message, Input } from 'antd'

export default function CalibrationReport() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const username = (()=>{ try { return localStorage.getItem('username') || '' } catch { return '' } })()

  const fetchRows = async () => {
    if (!username) return
    setLoading(true)
    try {
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
      const res = await fetch(`/reports?limit=500&offset=0${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      if (!res.ok) throw new Error(await res.text() || 'Failed to load reports')
      const data = await res.json()
      const items = Array.isArray(data.items) ? data.items : []
      const filtered = items.filter(r => heldIds.has(r.gauge_id))
      setRows(filtered.map(r => ({ ...r, key: r.gauge_id })))
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows() }, [username])

  const columns = useMemo(() => [
    { title: 'Sl. No.', dataIndex: 'gauge_id', key: 'gauge_id', width: 90 },
    { title: 'Equipment', dataIndex: 'name_of_the_equipment', key: 'name', ellipsis: true },
    { title: 'IDFN', dataIndex: 'idfn_no', key: 'idfn', width: 140, render:(v)=> v ? <Tag color="blue">{v}</Tag> : <Tag>—</Tag> },
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
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
        <h2 style={{margin:0}}>My Calibration Reports</h2>
        <Space>
          <Input.Search
            placeholder="Search by name, IDFN, or location"
            value={q}
            onChange={(e)=>setQ(e.target.value)}
            onSearch={fetchRows}
            style={{ width: 320 }}
            allowClear
          />
          <Button onClick={fetchRows}>Refresh</Button>
        </Space>
      </div>
      <Table
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={false}
        size="middle"
        bordered
        scroll={{ x: 1000 }}
      />
    </div>
  )
}
