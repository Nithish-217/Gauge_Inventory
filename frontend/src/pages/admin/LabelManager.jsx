import React, { useEffect, useRef, useState } from 'react'
import { Card, Button, Space, Typography, Table, Input, message, Modal, Image, Tag } from 'antd'

export default function LabelManager() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState({ current: 1, pageSize: 50 })
  const [hasMore, setHasMore] = useState(true)
  const scrollRef = useRef(null)
  const [preview, setPreview] = useState({ open: false, idfn: '', imgUrl: '' })

  async function fetchEquipment(params = {}) {
    setLoading(true)
    const current = params.current ?? page.current
    const limit = params.pageSize ?? page.pageSize
    const offset = (current - 1) * limit
    const qs = new URLSearchParams()
    qs.set('limit', String(limit))
    qs.set('offset', String(offset))
    if (q?.trim()) qs.set('q', q.trim())
    try {
      const res = await fetch(`/equipment?${qs.toString()}`)
      const json = await res.json()
      const batch = json.items ?? []
      if (current === 1 || params.reset) {
        setItems(batch)
      } else {
        setItems(prev => [...prev, ...batch])
      }
      setHasMore(batch.length >= limit)
    } catch (e) {
      message.error('Failed to load equipment')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEquipment({ current: 1, pageSize: page.pageSize })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleScroll = (e) => {
    const el = e.currentTarget
    if (!hasMore || loading) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
    if (nearBottom) {
      const next = { current: page.current + 1, pageSize: page.pageSize }
      setPage(next)
      fetchEquipment(next)
    }
  }

  const openPreview = (record) => {
    const idfn = record?.idfn_no
    if (!idfn) { message.warning('No IDFN for this item'); return }
    const url = `/qrcode/by-idfn/${encodeURIComponent(idfn)}.png?t=${Date.now()}`
    setPreview({ open: true, idfn, imgUrl: url })
  }

  const downloadBarcode = async (idfn) => {
    if (!idfn) return
    const res = await fetch(`/qrcode/by-idfn/${encodeURIComponent(idfn)}.png`)
    if (!res.ok) { message.error('Failed to generate barcode'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `idfn-${idfn}-qr.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const columns = [
    { title: 'Gauge ID', dataIndex: 'gauge_id', key: 'gauge_id', width: 100 },
    { title: 'Equipment', dataIndex: 'name_of_the_equipment', key: 'name', ellipsis: true },
    { title: 'IDFN', dataIndex: 'idfn_no', key: 'idfn', width: 160, render: (v)=> v ? <Tag color="blue">{v}</Tag> : <Tag>—</Tag> },
    { title: 'Last Calibration', dataIndex: 'date_of_last_calibration', key: 'last', width: 160 },
    { title: 'Calibration Due', dataIndex: 'calibration_due', key: 'due', width: 160 },
    {
      title: 'Action', key: 'action', width: 160,
      render: (_, record) => (
        <Space>
          <Button type="primary" onClick={() => openPreview(record)} disabled={!record.idfn_no}>Generate QR</Button>
        </Space>
      )
    }
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>Label Manager</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        Generate a QR code for each gauge based on IDFN. The QR encodes IDFN, last/due dates, and a direct report download URL.
      </Typography.Paragraph>

      <Card>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Input.Search
            placeholder="Search by name, IDFN, or location"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onSearch={() => { setPage({ current:1, pageSize: page.pageSize }); setHasMore(true); fetchEquipment({ current: 1, pageSize: page.pageSize, reset: true }) }}
            allowClear
            style={{ maxWidth: 420 }}
          />
          <Button onClick={() => { setPage({ current:1, pageSize: page.pageSize }); setHasMore(true); fetchEquipment({ current: 1, pageSize: page.pageSize, reset: true }) }}>Refresh</Button>
        </Space>
      </Card>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ height: 'calc(100vh - 260px)', overflow: 'auto', border:'1px solid rgba(0,0,0,0.06)', borderRadius:12 }}
      >
        <Table
          rowKey={(r) => `${r.gauge_id}`}
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={false}
          bordered
          size="middle"
          sticky
          className="ant-table-striped"
          rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-light' : 'table-row-dark')}
          scroll={{ x: 1000 }}
        />
        <div style={{ textAlign: 'center', padding: 8, color: '#888' }}>
          {loading ? 'Loading…' : (hasMore ? 'Scroll to load more' : 'End of list')}
        </div>
      </div>

      <Modal
        title={`QR Preview (IDFN ${preview.idfn || ''})`}
        open={preview.open}
        onCancel={() => setPreview({ open: false, idfn: '', imgUrl: '' })}
        footer={
          <Space>
            <Button onClick={() => setPreview({ open: false, idfn: '', imgUrl: '' })}>Close</Button>
            <Button type="primary" onClick={() => downloadBarcode(preview.idfn)} disabled={!preview.idfn}>Print QR</Button>
          </Space>
        }
      >
        {preview.imgUrl ? (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Image src={preview.imgUrl} width={240} height={240} style={{ objectFit: 'contain' }} />
          </div>
        ) : (
          <Typography.Text type="secondary">No preview available.</Typography.Text>
        )}
      </Modal>
    </Space>
  )
}
