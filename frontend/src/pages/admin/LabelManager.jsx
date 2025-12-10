import React, { useEffect, useRef, useState } from 'react'
import { Card, Button, Space, Typography, Table, Input, message, Modal, Image, Tag, Pagination, AutoComplete, Segmented } from 'antd'
import { ReloadOutlined, DownloadOutlined, EyeOutlined } from '@ant-design/icons'

export default function LabelManager() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState(null)
  const [sortDir, setSortDir] = useState(null)
  const [preview, setPreview] = useState({ open: false, idfn: '', imgUrl: '' })
  const [labelType, setLabelType] = useState('qr') // 'qr' | 'barcode' | 'rfid'
  const canvasRef = useRef(null)
  const bcRef = useRef(null)
  const [suggestions, setSuggestions] = useState([])
  const [suggestLoading, setSuggestLoading] = useState(false)

  async function fetchEquipment(params = {}) {
    setLoading(true)
    const current = params.current ?? currentPage
    const limit = params.pageSize ?? pageSize
    const offset = (current - 1) * limit
    const qs = new URLSearchParams()
    qs.set('limit', String(limit))
    qs.set('offset', String(offset))
    if (q?.trim()) qs.set('q', q.trim())
    if (sortBy) qs.set('sort_by', sortBy)
    if (sortDir) qs.set('sort_dir', sortDir)
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
  }, [currentPage, pageSize, sortBy, sortDir])

  useEffect(() => {
    try { bcRef.current = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('equipment-events') : null } catch { bcRef.current = null }
    const onMsg = (ev) => {
      try { if (ev && ev.data && ev.data.type === 'equipment:changed') { setCurrentPage(1); fetchEquipment({ current: 1, pageSize }) } } catch {}
    }
    try { bcRef.current && bcRef.current.addEventListener('message', onMsg) } catch {}
    return () => { try { bcRef.current && bcRef.current.removeEventListener('message', onMsg); bcRef.current.close() } catch {} }
  }, [])

  const handlePageChange = (page, size) => {
    setCurrentPage(page)
    setPageSize(size)
  }

  // Typeahead: fetch suggestions from backend
  const fetchSuggest = async (text) => {
    const s = (text || '').trim()
    if (!s) { setSuggestions([]); return }
    setSuggestLoading(true)
    try {
      const res = await fetch(`/equipment/suggest?q=${encodeURIComponent(s)}&limit=10`)
      const data = await res.json().catch(()=>[])
      const opts = Array.isArray(data) ? data.map((it, idx) => ({
        value: it.value,
        label: (
          <div key={`${it.type}-${idx}`} style={{ display:'flex', justifyContent:'space-between' }}>
            <span>{it.value}</span>
            <Tag color={it.type === 'idfn' ? 'blue' : 'default'} style={{ marginLeft: 8 }}>{it.type}</Tag>
          </div>
        )
      })) : []
      setSuggestions(opts)
    } catch { setSuggestions([]) }
    finally { setSuggestLoading(false) }
  }

  const renderRFIDCard = (idfn, name) => {
    try {
      const w = 480, h = 300
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      // Background
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      // Border
      ctx.strokeStyle = '#1677ff'
      ctx.lineWidth = 4
      ctx.strokeRect(6, 6, w - 12, h - 12)
      // Title
      ctx.fillStyle = '#1677ff'
      ctx.font = 'bold 28px Arial'
      ctx.fillText('RFID CARD', 24, 54)
      // Divider
      ctx.strokeStyle = '#e6f4ff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(24, 70)
      ctx.lineTo(w - 24, 70)
      ctx.stroke()
      // IDFN label
      ctx.fillStyle = '#333333'
      ctx.font = 'bold 22px Arial'
      ctx.fillText('IDFN:', 24, 120)
      ctx.fillStyle = '#000000'
      ctx.font = 'bold 34px Arial'
      ctx.fillText(String(idfn || ''), 24, 165)
      // Name
      if (name) {
        ctx.fillStyle = '#666666'
        ctx.font = '16px Arial'
        const label = 'Equipment:'
        ctx.fillText(label, 24, 205)
        ctx.fillStyle = '#000000'
        ctx.font = '18px Arial'
        const maxWidth = w - 48
        let text = String(name)
        if (ctx.measureText(text).width > maxWidth) {
          while (text.length > 0 && ctx.measureText(text + '…').width > maxWidth) {
            text = text.slice(0, -1)
          }
          text = text + '…'
        }
        ctx.fillText(text, 24, 232)
      }
      return canvas.toDataURL('image/png')
    } catch {
      return ''
    }
  }

  const openPreview = (record) => {
    const idfn = record?.idfn_no
    if (!idfn) { message.warning('No IDFN for this item'); return }
    if (labelType === 'qr') {
      const url = `/qrcode/by-idfn/${encodeURIComponent(idfn)}.png?t=${Date.now()}`
      setPreview({ open: true, idfn, imgUrl: url })
    } else if (labelType === 'barcode') {
      const url = `/barcode/code128/by-idfn/${encodeURIComponent(idfn)}.png?t=${Date.now()}`
      setPreview({ open: true, idfn, imgUrl: url })
    } else {
      const dataUrl = renderRFIDCard(idfn, record?.name_of_the_equipment)
      setPreview({ open: true, idfn, imgUrl: dataUrl })
    }
  }

  const downloadLabel = async (record) => {
    const idfn = record?.idfn_no || preview.idfn
    if (!idfn) return
    try {
      if (labelType === 'qr') {
        const res = await fetch(`/qrcode/by-idfn/${encodeURIComponent(idfn)}.png`)
        if (!res.ok) { message.error('Failed to generate QR'); return }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `idfn-${idfn}-qr.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      } else if (labelType === 'barcode') {
        const res = await fetch(`/barcode/code128/by-idfn/${encodeURIComponent(idfn)}.png`)
        if (!res.ok) { message.error('Failed to generate barcode'); return }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `idfn-${idfn}-barcode.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      } else {
        const dataUrl = renderRFIDCard(idfn, record?.name_of_the_equipment)
        if (!dataUrl) { message.error('Failed to render RFID card'); return }
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `idfn-${idfn}-rfid.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
    } catch {
      message.error('Failed to download label')
    }
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
            title="Preview Label"
            style={{ color: '#1890ff' }}
          />
          <Button 
            type="text" 
            icon={<DownloadOutlined />} 
            onClick={() => downloadLabel(record)} 
            disabled={!record.idfn_no}
            title="Download Label"
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
            <AutoComplete
              options={suggestions}
              value={q}
              onChange={(val)=> setQ(val)}
              onSearch={fetchSuggest}
              onSelect={(val)=> { setQ(val); setCurrentPage(1); fetchEquipment({ current: 1, pageSize, reset: true }) }}
              style={{ minWidth: 360 }}
            >
              <Input.Search
                allowClear
                placeholder="Search by name, IDFN, or location"
                onSearch={() => { setCurrentPage(1); fetchEquipment({ current: 1, pageSize, reset: true }) }}
                enterButton
              />
            </AutoComplete>
          </div>
          <div className="action-buttons" style={{ display:'flex', alignItems:'center', gap:12 }}>
            <Segmented 
              value={labelType}
              onChange={setLabelType}
              options={[
                { label: 'QR', value: 'qr' },
                { label: 'Barcode', value: 'barcode' },
                { label: 'RFID', value: 'rfid' },
              ]}
            />
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
            onChange={(_, __, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter
              const field = s && s.field ? s.field : null
              const order = s && s.order ? (s.order === 'descend' ? 'desc' : 'asc') : null
              setSortBy(field)
              setSortDir(order)
              setCurrentPage(1)
              fetchEquipment({ current: 1, pageSize })
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

      <Modal
        title={`Label Preview (IDFN ${preview.idfn || ''})`}
        open={preview.open}
        onCancel={() => setPreview({ open: false, idfn: '', imgUrl: '' })}
        footer={
          <Space>
            <Button onClick={() => setPreview({ open: false, idfn: '', imgUrl: '' })}>Close</Button>
            <Button type="primary" onClick={() => downloadLabel({ idfn_no: preview.idfn })} disabled={!preview.idfn}>Print</Button>
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
