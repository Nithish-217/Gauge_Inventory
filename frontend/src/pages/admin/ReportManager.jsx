import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Space, Input, DatePicker, InputNumber, Upload, message, Typography, Tag, Modal, Form, Pagination } from 'antd'
import { ReloadOutlined, UploadOutlined, DownloadOutlined, EyeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function ReportManager() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [activeRow, setActiveRow] = useState(null)
  const [form] = Form.useForm()
  const [selectedFile, setSelectedFile] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false)
  const [pdfViewerUrl, setPdfViewerUrl] = useState(null)
  const [pdfViewerTitle, setPdfViewerTitle] = useState('')
  const scrollRef = useRef(null)

  // Ensure form fields are prefilled when modal opens
  useEffect(() => {
    if (modalOpen && activeRow) {
      try { form.resetFields() } catch {}
      const freqVal = (activeRow.calibration_freq_months != null)
        ? Number(activeRow.calibration_freq_months)
        : (activeRow.freq != null ? Number(activeRow.freq) : undefined)
      form.setFieldsValue({
        last: activeRow.date_of_last_calibration ? dayjs(activeRow.date_of_last_calibration) : null,
        freq: isNaN(freqVal) ? undefined : freqVal,
      })
      // If frequency could not be derived, fetch it from server
      if (freqVal == null || isNaN(freqVal)) {
        (async () => {
          try {
            // Try reports for exact gauge
            const r1 = await fetch(`/reports?limit=1&offset=0&q=${encodeURIComponent(activeRow.idfn_no || activeRow.name_of_the_equipment || '')}`)
            if (r1.ok) {
              const d1 = await r1.json()
              const item = Array.isArray(d1.items) ? d1.items.find(x => x.gauge_id === activeRow.gauge_id) : null
              const f1 = item && item.calibration_freq_months != null ? Number(item.calibration_freq_months) : undefined
              if (f1 != null && !isNaN(f1)) { form.setFieldsValue({ freq: f1 }); return }
            }
          } catch {}
          try {
            // Fallback: search equipment
            const r2 = await fetch(`/equipment?limit=1&offset=0&q=${encodeURIComponent(activeRow.idfn_no || activeRow.name_of_the_equipment || '')}`)
            if (r2.ok) {
              const d2 = await r2.json()
              const item2 = Array.isArray(d2.items) ? d2.items.find(x => x.gauge_id === activeRow.gauge_id) : null
              const f2 = item2 && item2.calibration_freq_months != null ? Number(item2.calibration_freq_months) : undefined
              if (f2 != null && !isNaN(f2)) { form.setFieldsValue({ freq: f2 }) }
            }
          } catch {}
        })()
      }
    }
  }, [modalOpen, activeRow])

  const fetchRows = async (opts = {}) => {
    setLoading(true)
    try {
      const cur = typeof opts.page === 'number' ? opts.page : (currentPage - 1)
      const limit = pageSize
      const offset = cur * limit
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (q?.trim()) params.set('q', q.trim())
      // Try reports endpoint first
      let items = []
      let total = 0
      try {
        const res = await fetch(`/reports?${params.toString()}`)
        if (res.ok) {
          const data = await res.json()
          items = Array.isArray(data.items) ? data.items : []
          total = data.total || items.length
        }
      } catch {}
      // Fallback to equipment if reports empty (keep pagination)
      if (!items.length) {
        const eres = await fetch(`/equipment?${params.toString()}`)
        if (!eres.ok) throw new Error(await eres.text() || 'Failed to load equipment')
        const edata = await eres.json()
        const eq = Array.isArray(edata.items) ? edata.items : []
        items = eq.map(r => ({
          gauge_id: r.gauge_id,
          name_of_the_equipment: r.name_of_the_equipment,
          idfn_no: r.idfn_no,
          location: r.location,
          make_model: r.make_model,
          date_of_last_calibration: r.date_of_last_calibration,
          calibration_due: r.calibration_due,
          calibration_freq_months: r.calibration_freq_months,
          object_key: null,
          updated_by: null,
          updated_at: null,
        }))
        total = edata.total || items.length
      }
      const batch = items.map(r => ({ ...r, key: r.gauge_id }))
      setTotalItems(total)
      setRows(batch)
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRows({ page: currentPage - 1 }) }, [currentPage, pageSize])

  const handlePageChange = (page, size) => {
    setCurrentPage(page)
    if (size !== pageSize) {
      setPageSize(size)
    }
  }

  const onUpload = async (row, state) => {
    try {
      if (!state.file) { message.warning('Select a file'); return }
      if (!state.last || !state.freq) { message.warning('Provide last calibration date and frequency'); return }
      const fd = new FormData()
      fd.append('report', state.file)
      fd.append('last_calibration_date', dayjs(state.last).format('YYYY-MM-DD'))
      fd.append('calibration_freq_months', String(state.freq))
      const user = (()=>{ try { return localStorage.getItem('username') || 'admin' } catch { return 'admin' } })()
      fd.append('updated_by', user)
      const res = await fetch(`/reports/${row.gauge_id}`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text() || 'Upload failed')
      message.success('Report uploaded and equipment updated')
      fetchRows()
      setModalOpen(false)
      setActiveRow(null)
      setSelectedFile(null)
      try { form.resetFields() } catch {}
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Upload failed')
    }
  }

  const columns = useMemo(() => [
    { 
      title: 'Sl. No.', 
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
      width: 140, 
      align: 'center',
      render:(v)=> v ? <Tag color="blue">{v}</Tag> : <Tag>—</Tag> 
    },
    { 
      title: 'Last Calibration', 
      dataIndex: 'date_of_last_calibration', 
      key: 'last', 
      width: 160, 
      align: 'center',
      render:(v)=> v ? new Date(v).toLocaleDateString() : '' 
    },
    { 
      title: 'Freq (months)', 
      dataIndex: 'calibration_freq_months', 
      key: 'freq', 
      width: 130, 
      align: 'center',
      sorter: (a,b) => (a.calibration_freq_months || 0) - (b.calibration_freq_months || 0)
    },
    { 
      title: 'Due', 
      dataIndex: 'calibration_due', 
      key: 'due', 
      width: 160, 
      align: 'center',
      render:(v)=> v ? new Date(v).toLocaleDateString() : '' 
    },
    { 
      title: 'Updated By', 
      dataIndex: 'updated_by', 
      key: 'updated_by', 
      width: 140, 
      ellipsis: true
    },
    { 
      title: 'Updated At', 
      dataIndex: 'updated_at', 
      key: 'updated_at', 
      width: 180, 
      align: 'center',
      render:(v)=> v ? new Date(v).toLocaleString() : '' 
    },
    { 
      title: 'Report', 
      dataIndex: 'object_key', 
      key: 'report', 
      width: 180, 
      align: 'center',
      render:(_,row)=> (
        <Space size="small">
          <Button 
            type="text" 
            icon={<EyeOutlined />} 
            disabled={!row.object_key} 
            onClick={()=> {
              setPdfViewerUrl(`/reports/${row.gauge_id}/view`)
              setPdfViewerTitle(row.name_of_the_equipment || `Report - ${row.gauge_id}`)
              setPdfViewerOpen(true)
            }}
            title="View Report"
            style={{ color: '#1890ff' }}
          />
          <Button 
            type="text" 
            icon={<DownloadOutlined />} 
            disabled={!row.object_key} 
            onClick={()=> window.open(`/reports/${row.gauge_id}/download`, '_self')}
            title="Download Report"
            style={{ color: '#52c41a' }}
          />
        </Space>
      )
    },
    { 
      title: 'Upload', 
      key: 'upload', 
      fixed: 'right', 
      align: 'center', 
      width: 120, 
      render:(_,row)=> (
        <Button 
          type="text" 
          icon={<UploadOutlined />} 
          onClick={() => {
            setActiveRow(row)
            setSelectedFile(null)
            setModalOpen(true)
            const freqVal = (row.calibration_freq_months !== undefined && row.calibration_freq_months !== null)
              ? Number(row.calibration_freq_months)
              : (row.freq !== undefined && row.freq !== null ? Number(row.freq) : undefined)
            setTimeout(() => {
              try {
                form.setFieldsValue({
                  last: row.date_of_last_calibration ? dayjs(row.date_of_last_calibration) : null,
                  freq: isNaN(freqVal) ? undefined : freqVal,
                })
              } catch {}
            }, 0)
          }}
          title="Upload Report"
          style={{ color: '#722ed1' }}
        >
          Upload
        </Button>
      )
    },
  ], [])

  return (
    <div className="equipment-table-container">
      <div className="table-header">
        <h2>Report Manager</h2>
      </div>

      <div className="table-wrapper">
        <div className="table-controls">
          <div className="search-section">
            <Input.Search
              placeholder="Search by name, IDFN, or location"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              onSearch={()=>{ setCurrentPage(1); fetchRows({ page:0, reset: true }) }}
              style={{ width: 320 }}
              allowClear
            />
          </div>
          <div className="action-buttons">
            <Button 
              icon={<ReloadOutlined />} 
              onClick={()=>{ setCurrentPage(1); fetchRows({ page:0, reset: true }) }}
            >
              Refresh
            </Button>
          </div>
        </div>

        <div className="table-container">
          <Table
            columns={columns}
            dataSource={rows}
            loading={loading}
            pagination={false}
            size="middle"
            bordered
            className="ant-table-striped professional-table"
            rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-light' : 'table-row-dark')}
            scroll={{ x: 1200 }}
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
        key={activeRow ? `upload-${activeRow.gauge_id}` : 'upload-none'}
        title={activeRow ? `Upload calibration report - ${activeRow.name_of_the_equipment || ''}` : 'Upload calibration report'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setActiveRow(null); setSelectedFile(null); try { form.resetFields() } catch {} }}
        onOk={async () => {
          try {
            const values = await form.validateFields()
            const state = { last: values.last, freq: values.freq, file: selectedFile }
            await onUpload(activeRow, state)
          } catch {}
        }}
        okText="Upload"
        destroyOnClose
      >
        <Form
          key={activeRow ? `form-${activeRow.gauge_id}` : 'form-none'}
          layout="vertical"
          form={form}
          preserve={false}
          initialValues={{
            last: activeRow && activeRow.date_of_last_calibration ? dayjs(activeRow.date_of_last_calibration) : null,
            freq: (() => {
              if (!activeRow) return undefined
              const v = activeRow.calibration_freq_months ?? activeRow.freq
              const n = Number(v)
              return isNaN(n) ? undefined : n
            })()
          }}
        >
          <Form.Item label="Report file" required>
            <Upload.Dragger
              beforeUpload={(file)=>{ setSelectedFile(file); return false }}
              maxCount={1}
              accept=".pdf,.doc,.docx,.csv"
              multiple={false}
              onChange={(info)=>{
                const f = info?.file?.originFileObj || (info?.fileList?.[0] && info.fileList[0].originFileObj) || info?.file
                if (f) setSelectedFile(f)
              }}
            >
              <p className="ant-upload-drag-icon">Drop file here or click to select</p>
              <p className="ant-upload-hint">Allowed: PDF, DOC, DOCX, CSV</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item 
            name="last" 
            label="Last calibration date" 
            initialValue={activeRow && activeRow.date_of_last_calibration ? dayjs(activeRow.date_of_last_calibration) : null}
            rules={[{ required: true, message: 'Please select last calibration date' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item 
            name="freq" 
            label="Calibration frequency (months)" 
            initialValue={(activeRow && !isNaN(Number(activeRow.calibration_freq_months ?? activeRow.freq))) ? Number(activeRow.calibration_freq_months ?? activeRow.freq) : undefined}
            rules={[{ required: true, message: 'Please enter frequency in months' }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={pdfViewerTitle || 'View Report'}
        open={pdfViewerOpen}
        onCancel={() => { setPdfViewerOpen(false); setPdfViewerUrl(null); setPdfViewerTitle('') }}
        footer={null}
        width="90%"
        style={{ top: 20 }}
        destroyOnClose
        centered
      >
        {pdfViewerUrl && (
          <iframe
            src={pdfViewerUrl}
            style={{ width: '100%', height: '80vh', border: 'none' }}
            title="PDF Viewer"
          />
        )}
      </Modal>
    </div>
  )
}
