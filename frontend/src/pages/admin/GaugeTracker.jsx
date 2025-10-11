import React, { useEffect, useMemo, useState } from 'react'
import { Table, Button, Space, message, Tag } from 'antd'

export default function GaugeTracker() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchRows = async () => {
    setLoading(true)
    try {
      const res = await fetch('/gauge-tracker')
      const data = await res.json()
      setRows(Array.isArray(data) ? data.map(r=>({ ...r, key: r.id })) : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows() }, [])

  const onAccept = async (row) => {
    try {
      const accepted_by = (()=>{ try { return localStorage.getItem('username') || 'admin' } catch { return 'admin' } })()
      const res = await fetch(`/gauge-tracker/${row.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_by })
      })
      if (!res.ok) throw new Error(await res.text() || 'Failed to accept')
      message.success('Accepted')
      fetchRows()
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to accept')
    }
  }

  const onReject = async (row) => {
    try {
      const res = await fetch(`/gauge-tracker/${row.id}/reject`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text() || 'Failed to reject')
      message.success('Rejected')
      fetchRows()
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to reject')
    }
  }

  const columns = useMemo(() => [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: 'Gauge ID', dataIndex: 'gauge_id', key: 'gauge_id', width: 90 },
    { title: 'Equipment', dataIndex: 'name_of_the_equipment', key: 'name_of_the_equipment', width: 220, ellipsis: true },
    { title: 'IDFN', dataIndex: 'idfn_no', key: 'idfn_no', width: 120, ellipsis: true },
    { title: 'Location', dataIndex: 'location', key: 'location', width: 140, ellipsis: true },
    { title: 'Make/Model', dataIndex: 'make_model', key: 'make_model', width: 150, ellipsis: true },
    { title: 'Qty', dataIndex: 'quantity', key: 'quantity', width: 70 },
    { title: 'Requested By', dataIndex: 'requested_by', key: 'requested_by', width: 140, ellipsis: true },
    { title: 'Requested At', dataIndex: 'requested_at', key: 'requested_at', width: 180, render:(v)=> v ? new Date(v).toLocaleString() : '' },
    { title: 'Holder', key: 'holder', width: 200, render:(_,row)=> (
      row.accepted_by
        ? <span>With <Tag color="blue">{row.accepted_by}</Tag> since {row.accepted_at ? new Date(row.accepted_at).toLocaleString() : '-'}</span>
        : <span>Not taken</span>
    )},
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110, render:(v)=> (v||'').toUpperCase() },
    { title: 'Actions', key: 'actions', width: 200, fixed: 'right', align: 'right', render: (_, row) => (
      <Space>
        <Button type="primary" onClick={()=>onAccept(row)} disabled={!!row.accepted_by}>Accept</Button>
        <Button danger onClick={()=>onReject(row)} disabled={!!row.accepted_by}>Reject</Button>
      </Space>
    )},
  ], [])

  return (
    <div>
      <h2>Gauge Tracker</h2>
      <div style={{marginBottom:12}}>
        <Space>
          <Button onClick={fetchRows}>Refresh</Button>
        </Space>
      </div>
      <Table
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={false}
        bordered
        size="small"
        tableLayout="fixed"
        scroll={{ x: 1000 }}
      />
    </div>
  )
}
