import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Input, InputNumber, Space, message, Modal } from 'antd'
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons'

export default function EquipmentTable({ mode = 'admin' }) {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const scrollRef = useRef(null)
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState('')
  const [addSuccess, setAddSuccess] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [editErr, setEditErr] = useState('')
  const [editRow, setEditRow] = useState(null)
  const [editForm, setEditForm] = useState({
    name_of_the_equipment: '',
    location: '',
    receipt_date: '',
    make_model: '',
    idfn_no: '',
    overall_measurement_uncertainty: '',
    calibration_freq_months: '',
    date_of_last_calibration: '',
    calibration_due: '',
    pcr_number: ''
  })
  const [requestedBy, setRequestedBy] = useState(() => {
    try { return localStorage.getItem('username') || 'operator' } catch { return 'operator' }
  })
  const [qty, setQty] = useState({}) // { [gauge_id]: number }
  const [requesting, setRequesting] = useState({}) // { [gauge_id]: boolean }
  const [requestedMap, setRequestedMap] = useState({}) // { [gauge_id]: boolean }
  const [fieldErrors, setFieldErrors] = useState({}) // { [name]: message }
  const [form, setForm] = useState({
    name_of_the_equipment: '',
    location: '',
    receipt_date: '',
    make_model: '',
    idfn_no: '',
    overall_measurement_uncertainty: '',
    calibration_freq_months: '',
    date_of_last_calibration: '',
    calibration_due: '',
    pcr_number: ''
  })
  const limit = 25

  // Helper: add months to a YYYY-MM-DD string and return YYYY-MM-DD
  function addMonthsISO(dateStr, months) {
    try {
      if (!dateStr || !months) return ''
      const [y, m, d] = String(dateStr).split('-').map(Number)
      if (!y || !m || !d) return ''
      const dt = new Date(Date.UTC(y, m - 1, d))
      const targetMonth = dt.getUTCMonth() + Number(months)
      // Set to 1st, adjust month, then clamp day for month length
      const temp = new Date(Date.UTC(dt.getUTCFullYear(), targetMonth, 1))
      const lastDay = new Date(Date.UTC(temp.getUTCFullYear(), temp.getUTCMonth() + 1, 0)).getUTCDate()
      const day = Math.min(d, lastDay)
      const out = new Date(Date.UTC(temp.getUTCFullYear(), temp.getUTCMonth(), day))
      const yy = out.getUTCFullYear()
      const mm = String(out.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(out.getUTCDate()).padStart(2, '0')
      return `${yy}-${mm}-${dd}`
    } catch { return '' }
  }

  const onEditFormChange = (e) => {
    const { name, value } = e.target
    setEditForm(prev => {
      const next = { ...prev, [name]: value }
      if ((name === 'date_of_last_calibration' || name === 'calibration_freq_months')) {
        const last = name === 'date_of_last_calibration' ? value : next.date_of_last_calibration
        const freq = name === 'calibration_freq_months' ? value : next.calibration_freq_months
        const months = String(freq || '').trim()
        if (last && /^\d{4}-\d{2}-\d{2}$/.test(String(last)) && /^\d+$/.test(months)) {
          next.calibration_due = addMonthsISO(last, Number(months)) || next.calibration_due
        }
      }
      return next
    })
  }

  const fetchData = async (opts = {}) => {
    setError(''); setLoading(true)
    try {
      const curPage = typeof opts.page === 'number' ? opts.page : page
      const params = new URLSearchParams({ limit: String(limit), offset: String(curPage * limit) })
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/equipment?${params.toString()}`)
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Failed to load equipment')
      }
      const data = await res.json()
      const arr = Array.isArray(data.items) ? data.items : []
      setHasMore(arr.length === limit)
      if (curPage === 0 || opts.reset) {
        setItems(arr.map(r => ({ ...r, key: r.gauge_id })))
      } else {
        setItems(prev => [...prev, ...arr.map(r => ({ ...r, key: r.gauge_id }))])
      }
    } catch (err) {
      setError(typeof err?.message === 'string' ? err.message : 'Failed to load equipment')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData({ page }) }, [page])

  // Initialize requestedMap for the logged-in operator to block duplicate requests across reloads
  useEffect(() => {
    let cancelled = false
    const initRequested = async () => {
      try {
        const rb = (requestedBy || '').trim()
        if (!rb) return
        const res = await fetch(`/gauge-tracker?requested_by=${encodeURIComponent(rb)}`)
        if (!res.ok) return
        const data = await res.json()
        const arr = Array.isArray(data) ? data : []
        const map = {}
        for (const r of arr) {
          const status = String(r.status||'').toLowerCase()
          const open = (status === 'requested' || status === 'accepted') && !r.returned_at
          if (open && r.gauge_id) map[Number(r.gauge_id)] = true
        }
        if (!cancelled) setRequestedMap(map)
      } catch {}
    }
    initRequested()
    return () => { cancelled = true }
  }, [requestedBy])

  const onSearch = (e) => {
    e.preventDefault(); setPage(0); setHasMore(true); fetchData({ page: 0, reset: true })
  }

  const validateField = (name, value) => {
    let msg = ''
    switch (name) {
      case 'name_of_the_equipment':
        if (!String(value).trim()) msg = 'Required (text)'
        break
      case 'idfn_no':
        if (!String(value).trim()) msg = 'Required (text)'
        break
      case 'calibration_freq_months':
        if (value === '' || value === null || typeof value === 'undefined') msg = ''
        else if (!/^\d+$/.test(String(value))) msg = 'Must be a whole number'
        break
      case 'pcr_number':
        if (value === '' || value === null || typeof value === 'undefined') msg = ''
        else if (!/^\d+$/.test(String(value))) msg = 'Digits only'
        else if (String(value).length > 18) msg = 'Too long (max 18 digits)'
        break
      case 'receipt_date':
      case 'date_of_last_calibration':
      case 'calibration_due':
        if (!value) msg = ''
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) msg = 'Use date picker (YYYY-MM-DD)'
        break
      default:
        msg = ''
    }
    setFieldErrors(prev => ({ ...prev, [name]: msg }))
    return msg
  }

  const onFormChange = (e) => {
    const { name, value } = e.target
    setForm(prev => {
      const next = { ...prev, [name]: value }
      // Auto-calc calibration_due when last calibration date and frequency are present
      if ((name === 'date_of_last_calibration' || name === 'calibration_freq_months')) {
        const last = name === 'date_of_last_calibration' ? value : next.date_of_last_calibration
        const freq = name === 'calibration_freq_months' ? value : next.calibration_freq_months
        const months = String(freq || '').trim()
        if (last && /^\d{4}-\d{2}-\d{2}$/.test(String(last)) && /^\d+$/.test(months)) {
          next.calibration_due = addMonthsISO(last, Number(months)) || next.calibration_due
        }
      }
      return next
    })
    validateField(name, value)
  }

  const onAdd = async (e) => {
    e.preventDefault()
    setAddErr('')
    setAddSuccess('')
    // Validate all fields and block submit if invalid
    const errors = {}
    Object.keys(form).forEach((k) => {
      const m = validateField(k, form[k] ?? '')
      if (m) errors[k] = m
    })
    if (!form.name_of_the_equipment.trim()) errors['name_of_the_equipment'] = 'Required (text)'
    if (!form.idfn_no.trim()) errors['idfn_no'] = 'Required (text)'
    if (Object.keys(errors).length) {
      setFieldErrors(prev => ({ ...prev, ...errors }))
      setAddErr('Please fix the highlighted fields. Datatype hints are shown above each field.')
      return
    }
    try {
      setAddLoading(true)
      const payload = {
        ...form,
        calibration_freq_months: form.calibration_freq_months ? Number(form.calibration_freq_months) : null,
        pcr_number: form.pcr_number ? Number(form.pcr_number) : null,
        receipt_date: form.receipt_date || null,
        date_of_last_calibration: form.date_of_last_calibration || null,
        calibration_due: form.calibration_due || null,
        location: form.location || null,
        make_model: form.make_model || null,
        overall_measurement_uncertainty: form.overall_measurement_uncertainty || null,
      }
      const res = await fetch('/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Failed to add tool')
      }
      await res.json()
      // refresh
      setAdding(false)
      setForm({
        name_of_the_equipment: '', location: '', receipt_date: '', make_model: '', idfn_no: '',
        overall_measurement_uncertainty: '', calibration_freq_months: '', date_of_last_calibration: '', calibration_due: '', pcr_number: ''
      })
      setPage(0)
      fetchData()
      setAddSuccess('Tool saved successfully.')
      message.success('Tool added successfully')
      setTimeout(()=>setAddSuccess(''), 2500)
    } catch (err) {
      setAddErr(typeof err?.message === 'string' ? err.message : 'Failed to add tool')
      message.error(typeof err?.message === 'string' ? err.message : 'Failed to add tool')
    } finally {
      setAddLoading(false)
    }
  }

  const onDelete = async (gauge_id) => {
    if (!confirm('Delete this tool?')) return
    try {
      const res = await fetch(`/equipment/${gauge_id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const txt = await res.text(); throw new Error(txt || 'Failed to delete')
      }
      fetchData()
    } catch (err) {
      setError(typeof err?.message === 'string' ? err.message : 'Failed to delete')
    }
  }

  const openEdit = (row) => {
    if (!row) return
    setEditErr('')
    setEditRow(row)
    const toISO = (v) => {
      try {
        if (!v) return ''
        const d = new Date(v)
        if (isNaN(d.getTime())) return String(v)
        const yy = d.getFullYear()
        const mm = String(d.getMonth()+1).padStart(2,'0')
        const dd = String(d.getDate()).padStart(2,'0')
        return `${yy}-${mm}-${dd}`
      } catch { return '' }
    }
    setEditForm({
      name_of_the_equipment: row.name_of_the_equipment || '',
      location: row.location || '',
      receipt_date: toISO(row.receipt_date || ''),
      make_model: row.make_model || '',
      idfn_no: row.idfn_no || '',
      overall_measurement_uncertainty: row.overall_measurement_uncertainty || '',
      calibration_freq_months: row.calibration_freq_months ?? '',
      date_of_last_calibration: toISO(row.date_of_last_calibration || ''),
      calibration_due: toISO(row.calibration_due || ''),
      pcr_number: row.pcr_number ?? ''
    })
    setEditing(true)
  }

  const onUpdate = async (e) => {
    e.preventDefault()
    if (!editRow) return
    setEditErr('')
    try {
      setEditLoading(true)
      const payload = {
        ...editForm,
        calibration_freq_months: editForm.calibration_freq_months === '' ? null : Number(editForm.calibration_freq_months),
        pcr_number: editForm.pcr_number === '' ? null : Number(editForm.pcr_number),
        receipt_date: editForm.receipt_date || null,
        date_of_last_calibration: editForm.date_of_last_calibration || null,
        calibration_due: editForm.calibration_due || null,
        location: editForm.location || null,
        make_model: editForm.make_model || null,
        overall_measurement_uncertainty: editForm.overall_measurement_uncertainty || null,
      }
      const res = await fetch(`/equipment/${editRow.gauge_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Failed to update tool')
      }
      const updated = await res.json()
      setItems(prev => prev.map(r => r.gauge_id === updated.gauge_id ? { ...r, ...updated, key: updated.gauge_id } : r))
      setEditing(false)
    } catch (err) {
      setEditErr(typeof err?.message === 'string' ? err.message : 'Failed to update tool')
    } finally {
      setEditLoading(false)
    }
  }

  const onRequest = async (row) => {
    const gid = Number(row?.gauge_id)
    if (!gid) { setError('Row not found.'); return }
    // Block if already requesting or requested
    if (requesting[gid] || requestedMap[gid]) return
    try {
      setRequesting(prev => ({ ...prev, [gid]: true }))
      const payload = {
        gauge_id: gid,
        name_of_the_equipment: row.name_of_the_equipment,
        idfn_no: row.idfn_no,
        location: row.location || null,
        make_model: row.make_model || null,
        quantity: 1,
        requested_by: requestedBy || null,
      }
      // Try new Gauge Tracker endpoint first
      const res = await fetch('/gauge-tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        // Fallback to legacy /requests endpoint
        const fallback = await fetch('/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gauge_id: gid, quantity: 1, requested_by: requestedBy || null })
        })
        if (!fallback.ok) {
          const raw = await fallback.text()
          try {
            const err = JSON.parse(raw)
            const msg = err?.detail || err?.message || raw || 'Failed to save request'
            throw new Error(msg)
          } catch {
            const msg = raw || 'Failed to save request'
            throw new Error(msg)
          }
        }
        setRequestedMap(prev => ({ ...prev, [gid]: true }))
        message.success('Request submitted')
        return
      }
      setRequestedMap(prev => ({ ...prev, [gid]: true }))
      message.success('Request saved to Gauge Tracker')
    } catch (err) {
      const msg = typeof err?.message === 'string' ? err.message : 'Failed to save request'
      setError(msg)
      try { message.error(msg) } catch {}
    } finally {
      setRequesting(prev => ({ ...prev, [gid]: false }))
    }
  }

  const columns = useMemo(() => {
    const base = [
      { title: 'Sl. No.', dataIndex: 'gauge_id', key: 'gauge_id', width: 110, sorter: (a,b)=>a.gauge_id-b.gauge_id },
      { title: 'Equipment', dataIndex: 'name_of_the_equipment', key: 'name_of_the_equipment', ellipsis: true, sorter: (a,b)=>String(a.name_of_the_equipment||'').localeCompare(String(b.name_of_the_equipment||'')) },
      { title: 'Location', dataIndex: 'location', key: 'location', ellipsis: true, width: 140, sorter: (a,b)=>String(a.location||'').localeCompare(String(b.location||'')) },
      { title: 'Make/Model', dataIndex: 'make_model', key: 'make_model', ellipsis: true, width: 160, sorter: (a,b)=>String(a.make_model||'').localeCompare(String(b.make_model||'')) },
      { title: 'IDFN', dataIndex: 'idfn_no', key: 'idfn_no', width: 140, ellipsis: true, sorter: (a,b)=>String(a.idfn_no||'').localeCompare(String(b.idfn_no||'')) },
      { title: 'PCR Number', dataIndex: 'pcr_number', key: 'pcr_number', width: 160, sorter:(a,b)=>Number(a.pcr_number||0)-Number(b.pcr_number||0) },
      { title: 'Last Cal.', dataIndex: 'date_of_last_calibration', key: 'date_of_last_calibration', width: 140, sorter:(a,b)=>new Date(a.date_of_last_calibration||0)-new Date(b.date_of_last_calibration||0), render:(v)=> v ? new Date(v).toLocaleDateString() : '' },
      { title: 'Due', dataIndex: 'calibration_due', key: 'calibration_due', width: 140, sorter:(a,b)=>new Date(a.calibration_due||0)-new Date(b.calibration_due||0), render:(v)=> v ? new Date(v).toLocaleDateString() : '' },
    ]
    const actionCol = mode === 'admin'
      ? {
          title: 'Actions', key: 'actions', fixed: 'right', align: 'right',
          render: (_, row) => (
            <Space>
              <Button onClick={() => openEdit(row)}>Edit</Button>
              <Button danger onClick={() => onDelete(row.gauge_id)}>Delete</Button>
            </Space>
          )
        }
      : {
          title: 'Request', key: 'request', fixed: 'right', align: 'right',
          render: (_, row) => {
            const gid = Number(row.gauge_id)
            const isReq = !!requestedMap[gid]
            const isLoading = !!requesting[gid]
            const disabled = !!row.is_unavailable || isReq || isLoading
            const label = row.is_unavailable ? 'Unavailable' : (isReq ? 'Requested' : (isLoading ? 'Requesting...' : 'Request'))
            return (
              <Space>
                <Button
                  type="primary"
                  onClick={() => onRequest(row)}
                  disabled={disabled}
                >{label}</Button>
              </Space>
            )
          }
        }
    return [...base, actionCol]
  }, [mode, requesting, requestedMap])

  const onScroll = (e) => {
    const el = e.currentTarget
    if (loading || !hasMore) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
    if (nearBottom) setPage(p => p + 1)
  }

  return (
    <div>
      <h2>Equipment Used for Calibration</h2>

      {/* Operator view: auto-uses logged-in username; no manual input */}

      <Modal open={mode === 'admin' && adding} title="Add Tool" onCancel={()=>setAdding(false)} footer={null} destroyOnClose>
        <form onSubmit={onAdd}>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:12}}>
            <div className="field">
              <label className="label">Equipment Name* (text)</label>
              {fieldErrors.name_of_the_equipment && <div className="error">{fieldErrors.name_of_the_equipment}</div>}
              <input className="input" name="name_of_the_equipment" value={form.name_of_the_equipment} onChange={onFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">IDFN* (text)</label>
              {fieldErrors.idfn_no && <div className="error">{fieldErrors.idfn_no}</div>}
              <input className="input" name="idfn_no" value={form.idfn_no} onChange={onFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Location (text)</label>
              {fieldErrors.location && <div className="error">{fieldErrors.location}</div>}
              <input className="input" name="location" value={form.location} onChange={onFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Make/Model (text)</label>
              {fieldErrors.make_model && <div className="error">{fieldErrors.make_model}</div>}
              <input className="input" name="make_model" value={form.make_model} onChange={onFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Receipt Date (date YYYY-MM-DD)</label>
              {fieldErrors.receipt_date && <div className="error">{fieldErrors.receipt_date}</div>}
              <input className="input" type="date" name="receipt_date" value={form.receipt_date} onChange={onFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Overall Measurement Uncertainty (text)</label>
              {fieldErrors.overall_measurement_uncertainty && <div className="error">{fieldErrors.overall_measurement_uncertainty}</div>}
              <input className="input" name="overall_measurement_uncertainty" value={form.overall_measurement_uncertainty} onChange={onFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Calibration Freq (months) (number)</label>
              {fieldErrors.calibration_freq_months && <div className="error">{fieldErrors.calibration_freq_months}</div>}
              <input className="input" type="number" min="0" step="1" name="calibration_freq_months" value={form.calibration_freq_months} onChange={onFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Last Calibrated on</label>
              {fieldErrors.date_of_last_calibration && <div className="error">{fieldErrors.date_of_last_calibration}</div>}
              <input className="input" type="date" name="date_of_last_calibration" value={form.date_of_last_calibration} onChange={onFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Calibration Due (date YYYY-MM-DD)</label>
              {fieldErrors.calibration_due && <div className="error">{fieldErrors.calibration_due}</div>}
              <input className="input" type="date" name="calibration_due" value={form.calibration_due} onChange={onFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">PCR Number (digits only)</label>
              {fieldErrors.pcr_number && <div className="error">{fieldErrors.pcr_number}</div>}
              <input className="input" type="number" inputMode="numeric" pattern="[0-9]*" name="pcr_number" value={form.pcr_number} onChange={onFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
          </div>
          {addErr && <div className="error" style={{marginTop:8}}>{addErr}</div>}
          {addSuccess && <div style={{marginTop:8, color:'#22c55e', fontSize:13}}>{addSuccess}</div>}
          <div className="actions" style={{marginTop:12, display:'flex', justifyContent:'flex-end', gap:8}}>
            <Button onClick={()=>setAdding(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={addLoading}>{addLoading ? 'Saving...' : 'Save Tool'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={mode === 'admin' && editing} title={`Edit Tool [${editRow?.gauge_id ?? ''}]`} onCancel={()=>setEditing(false)} footer={null} destroyOnClose>
        <form onSubmit={onUpdate}>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:12}}>
            <div className="field">
              <label className="label">Equipment Name* (text)</label>
              <input className="input" name="name_of_the_equipment" value={editForm.name_of_the_equipment} onChange={onEditFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">IDFN* (text)</label>
              <input className="input" name="idfn_no" value={editForm.idfn_no} onChange={onEditFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Location (text)</label>
              <input className="input" name="location" value={editForm.location} onChange={onEditFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Make/Model (text)</label>
              <input className="input" name="make_model" value={editForm.make_model} onChange={onEditFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Receipt Date (date YYYY-MM-DD)</label>
              <input className="input" type="date" name="receipt_date" value={editForm.receipt_date} onChange={onEditFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Overall Measurement Uncertainty (text)</label>
              <input className="input" name="overall_measurement_uncertainty" value={editForm.overall_measurement_uncertainty} onChange={onEditFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Calibration Freq (months) (number)</label>
              <input className="input" type="number" min="0" step="1" name="calibration_freq_months" value={editForm.calibration_freq_months} onChange={onEditFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Last Calibrated on</label>
              <input className="input" type="date" name="date_of_last_calibration" value={editForm.date_of_last_calibration} onChange={onEditFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">Calibration Due (date YYYY-MM-DD)</label>
              <input className="input" type="date" name="calibration_due" value={editForm.calibration_due} onChange={onEditFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
            <div className="field">
              <label className="label">PCR Number (digits only)</label>
              <input className="input" type="number" inputMode="numeric" pattern="[0-9]*" name="pcr_number" value={editForm.pcr_number} onChange={onEditFormChange} style={{ background: '#ffffff', border:'1px solid #000' }} />
            </div>
          </div>
          {editErr && <div className="error" style={{marginTop:8}}>{editErr}</div>}
          <div className="actions" style={{marginTop:12, display:'flex', justifyContent:'flex-end', gap:8}}>
            <Button onClick={()=>setEditing(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={editLoading}>{editLoading ? 'Saving...' : 'Save Changes'}</Button>
          </div>
        </form>
      </Modal>

      {error && <div className="error" style={{marginBottom: 8}}>{error}</div>}

      <div style={{overflow: 'auto', height: 'calc(100vh - 260px)', border:"1px solid rgba(0,0,0,0.06)", borderRadius:12}} onScroll={onScroll} ref={scrollRef}>
        <Table
          columns={columns}
          dataSource={items}
          loading={loading}
          pagination={false}
          scroll={{ x: 1000 }}
          bordered
          size="middle"
          sticky
          className="ant-table-striped"
          locale={{ emptyText: 'No equipment found' }}
          rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-light' : 'table-row-dark')}
          title={() => (
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <Space>
                <Input.Search
                  allowClear
                  placeholder="Search by name, IDFN or location"
                  value={q}
                  onChange={(e)=>setQ(e.target.value)}
                  onSearch={() => { setPage(0); setHasMore(true); fetchData({ page: 0, reset: true }) }}
                  enterButton
                  style={{minWidth:320}}
                />
              </Space>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={() => { setPage(0); setHasMore(true); fetchData({ page: 0, reset: true }) }}>Refresh</Button>
                {mode === 'admin' && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={()=>setAdding(v=>!v)}>
                    {adding ? 'Close' : 'Add Tool'}
                  </Button>
                )}
              </Space>
            </div>
          )}
        />
        <div style={{ textAlign: 'center', padding: 8, color: '#888' }}>
          {loading ? 'Loading…' : (hasMore ? 'Scroll to load more' : 'End of list')}
        </div>
      </div>

      {/* Removed Prev/Next; infinite scroll handles paging */}
    </div>
  )
}
