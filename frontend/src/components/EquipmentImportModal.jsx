import React, { useMemo, useState } from 'react'
import { Modal, Button, Upload, Typography, Alert, Table, Space, Select, Tabs, Descriptions, Tag } from 'antd'
import { UploadOutlined, FileExcelOutlined, FileTextOutlined, CheckCircleOutlined, ExclamationCircleOutlined, CloudUploadOutlined } from '@ant-design/icons'

export default function EquipmentImportModal({ open, onClose }) {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [validResp, setValidResp] = useState(null)
  const [error, setError] = useState('')
  const [decisions, setDecisions] = useState({}) // row_index -> 'discard' | 'override'
  const [bulkAction, setBulkAction] = useState('')
  const [committing, setCommitting] = useState(false)

  const parsedId = validResp?.parsed_payload_id || null

  const resetAll = () => {
    setFile(null)
    setValidResp(null)
    setError('')
    setDecisions({})
    setBulkAction('')
  }

  const beforeUpload = (f) => {
    const name = (f?.name || '').toLowerCase()
    const ok = name.endsWith('.csv') || name.endsWith('.xlsx')
    if (!ok) {
      setError('Please select a .csv or .xlsx file')
      return Upload.LIST_IGNORE
    }
    setFile(f)
    setError('')
    return false
  }

  const doValidate = async () => {
    if (!file) {
      setError('Choose a file first')
      return
    }
    try {
      setUploading(true)
      setError('')
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/equipment/import/validate', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || 'Validation failed')
      }
      const data = await res.json()
      setValidResp(data)
      // prefill default decisions as empty; user can set bulk later
      setDecisions({})
    } catch (e) {
      setError(typeof e?.message === 'string' ? e.message : 'Validation failed')
    } finally {
      setUploading(false)
    }
  }

  const conflicts = useMemo(() => validResp?.conflicts || [], [validResp])
  const rowErrors = useMemo(() => validResp?.row_errors || [], [validResp])

  const setRowDecision = (rowIndex, action) => {
    setDecisions((prev) => ({ ...prev, [rowIndex]: action }))
  }

  const applyBulk = (action) => {
    setBulkAction(action)
  }

  const doCommit = async () => {
    if (!parsedId) {
      setError('Nothing to commit. Please validate first.')
      return
    }
    try {
      setCommitting(true)
      setError('')
      const actor = localStorage.getItem('username') || 'admin'
      const payload = {
        parsed_payload_id: parsedId,
        file_name: file?.name || null,
        actor,
        bulk: bulkAction ? { action: bulkAction } : {},
        decisions: Object.entries(decisions).map(([row_index, action]) => ({ row_index: Number(row_index), action })),
      }
      const res = await fetch('/api/equipment/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || 'Commit failed')
      }
      const data = await res.json()
      Modal.success({
        title: 'Import completed',
        content: (
          <div>
            <p>Created: {data.created}</p>
            <p>Updated: {data.updated}</p>
            <p>Skipped: {data.skipped}</p>
            <p>Errors: {data.errors}</p>
            <p>Audit ID: <code>{data.audit_id}</code></p>
          </div>
        ),
      })
      // reset and close
      resetAll()
      onClose?.()
    } catch (e) {
      setError(typeof e?.message === 'string' ? e.message : 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }

  const conflictColumns = [
    { title: 'Row', dataIndex: 'row_index', key: 'row' },
    { title: 'PCR', dataIndex: 'pcr_number', key: 'pcr' },
    {
      title: 'Existing', key: 'existing',
      render: (_, rec) => (
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Name">{rec.existingPreview?.name_of_the_equipment}</Descriptions.Item>
          <Descriptions.Item label="IDFN">{rec.existingPreview?.idfn_no}</Descriptions.Item>
          <Descriptions.Item label="Freq (m)">{rec.existingPreview?.calibration_freq_months ?? ''}</Descriptions.Item>
          <Descriptions.Item label="Last">{rec.existingPreview?.date_of_last_calibration ?? ''}</Descriptions.Item>
          <Descriptions.Item label="Due">{rec.existingPreview?.calibration_due ?? ''}</Descriptions.Item>
        </Descriptions>
      )
    },
    {
      title: 'Incoming', key: 'incoming',
      render: (_, rec) => (
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Name">{rec.incomingPreview?.name_of_the_equipment}</Descriptions.Item>
          <Descriptions.Item label="IDFN">{rec.incomingPreview?.idfn_no}</Descriptions.Item>
          <Descriptions.Item label="Freq (m)">{rec.incomingPreview?.calibration_freq_months ?? ''}</Descriptions.Item>
          <Descriptions.Item label="Last">{rec.incomingPreview?.date_of_last_calibration ?? ''}</Descriptions.Item>
          <Descriptions.Item label="Due">{rec.incomingPreview?.calibration_due ?? ''}</Descriptions.Item>
        </Descriptions>
      )
    },
    {
      title: 'Decision', key: 'decision',
      render: (_, rec) => (
        <Select
          style={{ width: 140 }}
          placeholder="Choose"
          value={decisions[rec.row_index]}
          onChange={(v) => setRowDecision(rec.row_index, v)}
          options={[
            { value: 'discard', label: 'Discard' },
            { value: 'override', label: 'Override' },
          ]}
        />
      )
    },
  ]

  return (
    <Modal
      open={open}
      title="Upload Equipment (Excel/CSV)"
      onCancel={() => { resetAll(); onClose?.() }}
      width={1000}
      footer={null}
      destroyOnClose
    >
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<FileTextOutlined />} href="/api/equipment/import/template.csv" target="_blank">Template CSV</Button>
        <Button icon={<FileExcelOutlined />} href="/api/equipment/import/template.xlsx" target="_blank">Template Excel</Button>
      </Space>

      <Upload beforeUpload={beforeUpload} maxCount={1} accept=".csv,.xlsx" showUploadList>
        <Button icon={<UploadOutlined />}>Choose File</Button>
      </Upload>

      <Space style={{ marginTop: 12 }}>
        <Button type="primary" icon={<CloudUploadOutlined />} loading={uploading} disabled={!file} onClick={doValidate}>
          Validate
        </Button>
        <Typography.Text type="secondary">Allowed: .csv, .xlsx. Dates must be YYYY-MM-DD. The sample row will be auto-skipped.</Typography.Text>
      </Space>

      {error && (
        <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} />
      )}

      {validResp && (
        <div style={{ marginTop: 16 }}>
          <Space wrap>
            <Tag color="blue">Total: {validResp.total_rows}</Tag>
            <Tag color="green" icon={<CheckCircleOutlined />}>Valid: {validResp.valid_rows}</Tag>
            <Tag color="red" icon={<ExclamationCircleOutlined />}>Invalid: {validResp.invalid_rows}</Tag>
            <Tag color="orange">Conflicts: {validResp.conflicts_count}</Tag>
          </Space>

          <Tabs style={{ marginTop: 12 }}
            items={[
              {
                key: 'conflicts',
                label: `Conflicts (${validResp.conflicts_count})`,
                children: (
                  <div>
                    <Space style={{ marginBottom: 8 }}>
                      <Select
                        style={{ width: 200 }}
                        placeholder="Bulk action"
                        value={bulkAction || undefined}
                        onChange={applyBulk}
                        options={[
                          { value: 'discard', label: 'Discard all conflicts' },
                          { value: 'override', label: 'Override all conflicts' },
                        ]}
                      />
                      <Typography.Text type="secondary">Per-row decisions override the bulk selection.</Typography.Text>
                    </Space>
                    <Table
                      rowKey={(r) => `${r.row_index}-${r.pcr_number}`}
                      columns={conflictColumns}
                      dataSource={conflicts}
                      pagination={{ pageSize: 5 }}
                    />
                  </div>
                )
              },
              {
                key: 'errors',
                label: `Errors (${rowErrors.length})`,
                children: (
                  <Table
                    rowKey={(r) => `${r.row_index}`}
                    columns={[{ title: 'Row', dataIndex: 'row_index' }, { title: 'Message', dataIndex: 'message' }]}
                    dataSource={rowErrors}
                    pagination={{ pageSize: 6 }}
                  />
                )
              },
            ]}
          />

          <Space style={{ marginTop: 8 }}>
            <Button type="primary" onClick={doCommit} loading={committing} disabled={!parsedId}>
              Commit
            </Button>
            <Button onClick={() => { resetAll(); onClose?.() }}>Close</Button>
          </Space>
        </div>
      )}
    </Modal>
  )
}
