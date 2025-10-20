import React, { useEffect, useRef, useState } from 'react'
import { Card, Button, Space, Typography, Table, Input, message, Modal, Image, Tag, Pagination } from 'antd'
import { ReloadOutlined, QrcodeOutlined, DownloadOutlined, EyeOutlined } from '@ant-design/icons'

export default function LabelManager() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [preview, setPreview] = useState({ open: false, idfn: '', imgUrl: '' })

  async function fetchEquipment(params = {}) {
    setLoading(true)
    const current = params.current ?? currentPage
    const limit = params.pageSize ?? pageSize
    const offset = (current - 1) * limit
    const qs = new URLSearchParams()
    qs.set('limit', String(limit))
    qs.set('offset', String(offset))
    if (q?.trim()) qs.set('q', q.trim())
    try {
      const res = await fetch(`/equipment?${qs.toString()}`)
      const json = await res.json()
      const batch = json.items ?? []
      setItems(batch)
      setTotalItems(json.total || 0)
    } catch (e) {
      message.error('Failed to load equipment')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEquipment({ current: currentPage, pageSize: pageSize })
  }, [currentPage, pageSize])

  const handlePageChange = (page, size) => {
    setCurrentPage(page)
    setPageSize(size)
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
    { 
      title: 'Gauge ID', 
      dataIndex: 'gauge_id', 
      key: 'gauge_id', 
      width: 100, 
      align: 'center',
      sorter: (a,b) => a.gauge_id - b.gauge_id
    },
    { 
      title: 'Equipment', 
      dataIndex: 'name_of_the_equipment', 
      key: 'name', 
      ellipsis: true,
      width: 200,
      sorter: (a,b) => String(a.name_of_the_equipment||'').localeCompare(String(b.name_of_the_equipment||''))
    },
    { 
      title: 'IDFN', 
      dataIndex: 'idfn_no', 
      key: 'idfn', 
      width: 160, 
      align: 'center',
      render: (v)=> v ? <Tag color="blue" style={{fontWeight: '600'}}>{v}</Tag> : <Tag color="default">—</Tag> 
    },
    { 
      title: 'Last Calibration', 
      dataIndex: 'date_of_last_calibration', 
      key: 'last', 
      width: 160, 
      align: 'center',
      render: (v)=> v ? new Date(v).toLocaleDateString() : '—'
    },
    { 
      title: 'Calibration Due', 
      dataIndex: 'calibration_due', 
      key: 'due', 
      width: 160, 
      align: 'center',
      render: (v)=> v ? new Date(v).toLocaleDateString() : '—'
    },
    {
      title: 'Actions', 
      key: 'actions', 
      width: 180,
      align: 'center',
      render: (_, record) => (
        <Space size="small">
          <Button 
            type="text" 
            icon={<EyeOutlined />} 
            onClick={() => openPreview(record)} 
            disabled={!record.idfn_no}
            title="Preview QR Code"
            style={{ color: '#1890ff' }}
          />
          <Button 
            type="text" 
            icon={<DownloadOutlined />} 
            onClick={() => downloadBarcode(record.idfn_no)} 
            disabled={!record.idfn_no}
            title="Download QR Code"
            style={{ color: '#52c41a' }}
          />
        </Space>
      )
    }
  ]

  return (
    <div className="equipment-table-container">
      <div className="table-header">
        <h2>Label Manager</h2>
        <p style={{ margin: '8px 0 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
          Generate QR codes for each gauge based on IDFN. The QR encodes IDFN, last/due dates, and a direct report download URL.
        </p>
      </div>

      <div className="table-wrapper">
        <div className="table-controls">
          <div className="search-section">
            <Input.Search
              placeholder="Search by name, IDFN, or location"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onSearch={() => { setCurrentPage(1); fetchEquipment({ current: 1, pageSize: pageSize, reset: true }) }}
              allowClear
              style={{ width: 320 }}
            />
          </div>
          <div className="action-buttons">
            <Button 
              icon={<ReloadOutlined />} 
              onClick={() => { setCurrentPage(1); fetchEquipment({ current: 1, pageSize: pageSize, reset: true }) }}
            >
              Refresh
            </Button>
          </div>
        </div>

        <div className="table-container">
          <Table
            rowKey={(r) => `${r.gauge_id}`}
            loading={loading}
            columns={columns}
            dataSource={items}
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
        title={`QR Preview (IDFN ${preview.idfn || ''})`}
        open={preview.open}
        onCancel={() => setPreview({ open: false, idfn: '', imgUrl: '' })}
        footer={
          <Space>
            <Button onClick={() => setPreview({ open: false, idfn: '', imgUrl: '' })}>Close</Button>
            <Button type="primary" onClick={() => downloadBarcode(preview.idfn)} disabled={!preview.idfn}>Print QR</Button>
          </Space>
        }
        className="professional-modal"
        width={400}
      >
        {preview.imgUrl ? (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Image src={preview.imgUrl} width={240} height={240} style={{ objectFit: 'contain' }} />
          </div>
        ) : (
          <Typography.Text type="secondary">No preview available.</Typography.Text>
        )}
      </Modal>
    </div>
  )
}
