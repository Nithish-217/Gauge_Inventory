import React, { useEffect, useMemo, useState } from 'react'
import { Card, Row, Col, Statistic, message, Table, Tag } from 'antd'

export default function OperatorHome() {
  const [available, setAvailable] = useState(0)
  const [mine, setMine] = useState(0)
  const [availableItems, setAvailableItems] = useState([])

  const username = (()=>{ try { return localStorage.getItem('username') || '' } catch { return '' } })()

  const load = async () => {
    try {
      // Total available: equipment where is_unavailable = false
      const eq = await fetch('/equipment?limit=200')
      if (eq.ok) {
        const data = await eq.json()
        const items = Array.isArray(data.items) ? data.items : []
        const avail = items.filter(x => !x.is_unavailable)
        setAvailable(avail.length)
        setAvailableItems(avail.map(r=>({ ...r, key: r.gauge_id })))
      }
      // Mine: accepted and not returned for this operator
      if (username) {
        const tr = await fetch(`/gauge-tracker?requested_by=${encodeURIComponent(username)}`)
        if (tr.ok) {
          const tdata = await tr.json()
          const rows = Array.isArray(tdata) ? tdata : []
          setMine(rows.filter(r => String(r.status||'').toLowerCase()==='accepted' && !r.returned_at).length)
        }
      }
    } catch (e) {
      message.error('Failed to load metrics')
    }
  }

  useEffect(() => { load() }, [])

  const columns = useMemo(() => ([
    { title: 'Sl. No.', dataIndex: 'gauge_id', key: 'gauge_id', width: 90 },
    { title: 'Equipment', dataIndex: 'name_of_the_equipment', key: 'name', ellipsis: true },
    { title: 'IDFN', dataIndex: 'idfn_no', key: 'idfn', width: 140, render:(v)=> v ? <Tag color="blue">{v}</Tag> : <Tag>—</Tag> },
    { title: 'Location', dataIndex: 'location', key: 'location', width: 160, ellipsis: true },
    { title: 'Make/Model', dataIndex: 'make_model', key: 'make_model', width: 180, ellipsis: true },
    { title: 'Due', dataIndex: 'calibration_due', key: 'due', width: 160, render:(v)=> v ? new Date(v).toLocaleDateString() : '' },
  ]), [])

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card
            style={{
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              color: 'white',
              boxShadow: '0 8px 20px rgba(22,163,74,0.25)',
              border: 'none'
            }}
            bodyStyle={{ padding: 18 }}
          >
            <Statistic title={<span style={{color:'rgba(255,255,255,.9)'}}>Total available gauges</span>} value={available} valueStyle={{ color: '#fff' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card
            style={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
              boxShadow: '0 8px 20px rgba(37,99,235,0.25)',
              border: 'none'
            }}
            bodyStyle={{ padding: 18 }}
          >
            <Statistic title={<span style={{color:'rgba(255,255,255,.9)'}}>Gauges with me</span>} value={mine} valueStyle={{ color: '#fff' }} />
          </Card>
        </Col>
      </Row>

      <div style={{marginTop: 16}}>
        <Card title="Available Gauges" bordered={true} bodyStyle={{padding: 0}}>
          <Table
            columns={columns}
            dataSource={availableItems}
            pagination={false}
            size="middle"
            bordered
            scroll={{ x: 1000 }}
          />
        </Card>
      </div>
    </div>
  )
}
