import React, { useEffect, useMemo, useState } from 'react'
import { Table, Button, Space, Tag, message } from 'antd'

export default function OperatorGaugeTracker() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const username = (()=>{ try { return localStorage.getItem('username') || '' } catch { return '' } })()

  const fetchRows = async () => {
    if (!username) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ requested_by: username })
      const res = await fetch(`/gauge-tracker?${params.toString()}`)
      if (!res.ok) throw new Error(await res.text() || 'Failed to load')
      const data = await res.json()
      setRows(Array.isArray(data) ? data.map(r=>({ ...r, key: r.id })) : [])
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows() }, [username])

  const onReturn = async (row) => {
    try {
      const res = await fetch(`/gauge-tracker/${row.id}/return`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted_by: username || 'operator' })
      })
      if (!res.ok) throw new Error(await res.text() || 'Failed to return')
      message.success('Marked as returned')
      fetchRows()
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to return')
    }
  }

  const columns = useMemo(() => [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: 'Gauge ID', dataIndex: 'gauge_id', key: 'gauge_id', width: 90 },
    { title: 'Equipment', dataIndex: 'name_of_the_equipment', key: 'name_of_the_equipment', width: 220, ellipsis: true },
    { title: 'IDFN', dataIndex: 'idfn_no', key: 'idfn_no', width: 120, ellipsis: true },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 120, render:(v)=> (v||'').toUpperCase() },
    { title: 'Holder', key: 'holder', width: 260, render:(_,row)=> {
      const s = (row.status||'').toLowerCase()
      if (s === 'accepted') {
        return <span>With <Tag color="blue">{row.accepted_by || '-'}</Tag> since {row.accepted_at ? new Date(row.accepted_at).toLocaleString() : '-'}</span>
      }
      if (s === 'rejected') {
        return <span>Rejected by <Tag color="red">{row.accepted_by || '-'}</Tag> at {row.accepted_at ? new Date(row.accepted_at).toLocaleString() : '-'}</span>
      }
      if (s === 'returned') {
        return <span>Returned at {row.returned_at ? new Date(row.returned_at).toLocaleString() : '-'}</span>
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

  return (
    <div>
      <h2>My Gauge Requests</h2>
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
        scroll={{ x: 900 }}
      />
    </div>
  )
}
