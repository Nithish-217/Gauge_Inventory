import React, { useEffect, useState } from 'react'
import { Card, Button, Space, Typography, Table, Input, message, Modal, Image, Tag } from 'antd'

export default function LabelManager() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [page, setPage] = useState({ current: 1, pageSize: 10 })
  const [preview, setPreview] = useState({ open: false, idfn: '', imgUrl: '' })

  async function fetchEquipment(params = {}) {
    setLoading(true)
    const limit = params.pageSize ?? page.pageSize
    const offset = ((params.current ?? page.current) - 1) * limit
    const qs = new URLSearchParams()
    qs.set('limit', String(limit))
    qs.set('offset', String(offset))
    if (q?.trim()) qs.set('q', q.trim())
    try {
      const res = await fetch(`/equipment?${qs.toString()}`)
      const json = await res.json()
      setItems(json.items ?? [])
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

  const handleTableChange = (pagination) => {
    setPage(pagination)
    fetchEquipment({ current: pagination.current, pageSize: pagination.pageSize })
  }

  const openPreview = (idfn) => {
    if (!idfn) { message.warning('No IDFN for this item'); return }
    const url = `/barcode/code128/by-idfn/${encodeURIComponent(idfn)}.png?t=${Date.now()}`
    setPreview({ open: true, idfn, imgUrl: url })
  }

  const downloadBarcode = async (idfn) => {
    if (!idfn) return
    const res = await fetch(`/barcode/code128/by-idfn/${encodeURIComponent(idfn)}.png`)
    if (!res.ok) { message.error('Failed to generate barcode'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `idfn-${idfn}.png`
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
          <Button type="primary" onClick={() => openPreview(record.idfn_no)} disabled={!record.idfn_no}>Generate</Button>
        </Space>
      )
    }
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>Label Manager</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        Generate a Code128 barcode for each gauge based on IDFN. Barcode payload: IDFN_LASTCAL_DUE
      </Typography.Paragraph>

      <Card>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Input.Search
            placeholder="Search by name, IDFN, or location"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onSearch={() => fetchEquipment({ current: 1, pageSize: page.pageSize })}
            allowClear
            style={{ maxWidth: 420 }}
          />
          <Button onClick={() => fetchEquipment({ current: 1, pageSize: page.pageSize })}>Refresh</Button>
        </Space>
      </Card>

      <Card>
        <Table
          rowKey={(r) => `${r.gauge_id}`}
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={{ current: page.current, pageSize: page.pageSize, showSizeChanger: true }}
          onChange={handleTableChange}
        />
      </Card>

      <Modal
        title={`Barcode Preview (IDFN ${preview.idfn || ''})`}
        open={preview.open}
        onCancel={() => setPreview({ open: false, idfn: '', imgUrl: '' })}
        footer={
          <Space>
            <Button onClick={() => setPreview({ open: false, idfn: '', imgUrl: '' })}>Close</Button>
            <Button type="primary" onClick={() => downloadBarcode(preview.idfn)} disabled={!preview.idfn}>Download PNG</Button>
          </Space>
        }
      >
        {preview.imgUrl ? (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Image src={preview.imgUrl} width={420} height={120} style={{ objectFit: 'contain' }} />
          </div>
        ) : (
          <Typography.Text type="secondary">No preview available.</Typography.Text>
        )}
      </Modal>
    </Space>
  )
}
