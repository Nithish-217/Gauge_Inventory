import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Input, InputNumber, Space, message, Modal, Pagination, AutoComplete, Tag } from 'antd'
import { loadJsPDF, makeHeaderFooter, buildAutoTablePageHook, formatNow } from '../utils/pdfExport.js'
import { ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined, ShoppingCartOutlined } from '@ant-design/icons'

const { TextArea } = Input

export default function EquipmentTable({ mode = 'admin' }) {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState('name_of_the_equipment')
  const [sortDir, setSortDir] = useState('asc')
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
    pcr_number: '',
    ranges: ''
  })
  const [requestedBy, setRequestedBy] = useState(() => {
    try { return localStorage.getItem('username') || 'operator' } catch { return 'operator' }
  })
  const [qty, setQty] = useState({}) // { [gauge_id]: number }
  const [requesting, setRequesting] = useState({}) // { [gauge_id]: boolean }
  const [requestedMap, setRequestedMap] = useState({}) // { [gauge_id]: boolean }
  const [fieldErrors, setFieldErrors] = useState({}) // { [name]: message }
  const [purposeModalOpen, setPurposeModalOpen] = useState(false)
  const [purposeModalGauge, setPurposeModalGauge] = useState(null)
  const [purposeValue, setPurposeValue] = useState('')
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
    pcr_number: '',
    ranges: ''
  })
  const limit = pageSize
  const bcRef = useRef(null)
  const [suggestions, setSuggestions] = useState([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [locationFilter, setLocationFilter] = useState('')
  const [locOptions, setLocOptions] = useState([])
  const [locLoading, setLocLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [holderMap, setHolderMap] = useState({}) // { [gauge_id]: string (holder name) }
  const qDebounceRef = useRef(null)
  

  useEffect(() => {
    try {
      bcRef.current = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('equipment-events') : null
    } catch { bcRef.current = null }
    return () => { try { bcRef.current && bcRef.current.close() } catch {} }
  }, [])

  // Build a map of current holders from Gauge Tracker (accepted and not returned; fall back to requested_by when pending)
  useEffect(() => {
    let cancelled = false
    const loadHolders = async () => {
      try {
        const map = {}
        let offset = 0
        const pageLimit = 500
        for (let i = 0; i < 50; i++) {
          const params = new URLSearchParams({ limit: String(pageLimit), offset: String(offset) })
          params.set('sort_by', 'requested_at')
          params.set('sort_dir', 'desc')
          const res = await fetch(`/gauge-tracker?${params.toString()}`)
          if (!res.ok) break
          const data = await res.json().catch(()=>[])
          const rows = Array.isArray(data) ? data : []
          for (const r of rows) {
            const gid = Number(r.gauge_id)
            if (!gid) continue
            const status = String(r.status||'').toLowerCase()
            const open = !r.returned_at && (status === 'accepted' || status === 'requested')
            if (open) {
              // Always prefer the operator who requested as the holder name
              const who = (r.requested_by || r.accepted_by || '')
              if (who) map[gid] = who
            }
          }
          if (rows.length < pageLimit) break
          offset += pageLimit
        }
        if (!cancelled) setHolderMap(map)
      } catch {
        if (!cancelled) setHolderMap({})
      }
    }
    loadHolders()
    return () => { cancelled = true }
  }, [])

  // Typeahead suggestions
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

  // Location suggestions (separate location filter)
  const fetchLocationSuggest = async (text) => {
    const s = (text || '').trim()
    if (!s) { setLocOptions([]); return }
    setLocLoading(true)
    try {
      const res = await fetch(`/equipment/location-suggest?q=${encodeURIComponent(s)}&limit=20`)
      const data = await res.json().catch(()=>[])
      const opts = Array.isArray(data) ? data.map((v) => ({ value: v, label: v })) : []
      setLocOptions(opts)
    } catch { setLocOptions([]) } finally { setLocLoading(false) }
  }

  

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
      const curPage = typeof opts.page === 'number' ? opts.page : (currentPage - 1)
      const params = new URLSearchParams({ limit: String(limit), offset: String(curPage * limit) })
      if (q.trim()) params.set('q', q.trim())
      if (sortBy) params.set('sort_by', sortBy)
      if (sortDir) params.set('sort_dir', sortDir)
      const loc = (typeof opts.location === 'string') ? opts.location : locationFilter
      if ((loc || '').trim()) params.set('location', String(loc).trim())
      
      const res = await fetch(`/equipment?${params.toString()}`)
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Failed to load equipment')
      }
      const data = await res.json()
      const arr = Array.isArray(data.items) ? data.items : []
      setTotalItems(data.total || 0)
      setItems(arr.map(r => ({ ...r, key: r.gauge_id })))
    } catch (err) {
      setError(typeof err?.message === 'string' ? err.message : 'Failed to load equipment')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData({ page: currentPage - 1 }) }, [currentPage, pageSize, sortBy, sortDir])

  // Debounced server search on q changes
  useEffect(() => {
    if (qDebounceRef.current) clearTimeout(qDebounceRef.current)
    qDebounceRef.current = setTimeout(() => {
      setCurrentPage(1)
      fetchData({ page: 0, reset: true })
    }, 300)
    return () => { if (qDebounceRef.current) clearTimeout(qDebounceRef.current) }
  }, [q])

  // If location filter is cleared, reset results immediately
  useEffect(() => {
    if ((locationFilter || '').trim() === '') {
      setCurrentPage(1)
      fetchData({ page: 0, reset: true })
    }
  }, [locationFilter])

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
    e.preventDefault(); setCurrentPage(1); fetchData({ page: 0, reset: true })
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
      const parseRanges = (text) => {
        try {
          const raw = String(text || '')
          const parts = raw.split(/\n|,/g).map(s=>s.trim()).filter(Boolean)
          // de-duplicate preserving order
          const seen = new Set()
          const out = []
          for (const p of parts) { if (!seen.has(p)) { seen.add(p); out.push(p) } }
          return out
        } catch { return [] }
      }
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
        ranges: parseRanges(form.ranges)
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
      const created = await res.json()
      // refresh and navigate to expected alphabetical position
      setAdding(false)
      setForm({
        name_of_the_equipment: '', location: '', receipt_date: '', make_model: '', idfn_no: '',
        overall_measurement_uncertainty: '', calibration_freq_months: '', date_of_last_calibration: '', calibration_due: '', pcr_number: '', ranges: ''
      })
      try {
        const qs = new URLSearchParams()
        qs.set('name', created.name_of_the_equipment || '')
        if (created.gauge_id != null) qs.set('gauge_id', String(created.gauge_id))
        if (q.trim()) qs.set('q', q.trim())
        const posRes = await fetch(`/equipment/position-by-name?${qs.toString()}`)
        const pos = await posRes.json().catch(()=>({ index: 0 }))
        const idx = Number(pos.index) || 0
        const page = Math.floor(idx / pageSize) + 1
        setCurrentPage(page)
        fetchData({ page: page - 1 })
      } catch {
        setCurrentPage(1)
        fetchData({ page: 0 })
      }
      setAddSuccess('Tool saved successfully.')
      message.success('Tool added successfully')
      setTimeout(()=>setAddSuccess(''), 2500)
      try { bcRef.current && bcRef.current.postMessage({ type: 'equipment:changed' }) } catch {}
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
      try { bcRef.current && bcRef.current.postMessage({ type: 'equipment:changed' }) } catch {}
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
      pcr_number: row.pcr_number ?? '',
      ranges: Array.isArray(row.ranges) && row.ranges.length ? row.ranges.join(', ') : ''
    })
    setEditing(true)
  }

  const onUpdate = async (e) => {
    e.preventDefault()
    if (!editRow) return
    setEditErr('')
    try {
      setEditLoading(true)
      const parseRanges = (text) => {
        try {
          const raw = String(text || '')
          const parts = raw.split(/\n|,/g).map(s=>s.trim()).filter(Boolean)
          const seen = new Set(); const out = []
          for (const p of parts) { if (!seen.has(p)) { seen.add(p); out.push(p) } }
          return out
        } catch { return [] }
      }
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
        ranges: parseRanges(editForm.ranges)
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
      // Update local row immediately
      setItems(prev => prev.map(r => r.gauge_id === updated.gauge_id ? { ...r, ...updated, key: updated.gauge_id } : r))
      setEditing(false)
      // Broadcast change for other pages
      try { bcRef.current && bcRef.current.postMessage({ type: 'equipment:changed' }) } catch {}
      // Refresh and, if name changed, navigate to correct alphabetical page
      try {
        const qs = new URLSearchParams()
        qs.set('name', updated.name_of_the_equipment || '')
        if (updated.gauge_id != null) qs.set('gauge_id', String(updated.gauge_id))
        if ((q || '').trim()) qs.set('q', q.trim())
        const posRes = await fetch(`/equipment/position-by-name?${qs.toString()}`)
        const pos = await posRes.json().catch(()=>({ index: 0 }))
        const idx = Number(pos.index) || 0
        const page = Math.floor(idx / pageSize) + 1
        setCurrentPage(page)
        await fetchData({ page: page - 1 })
      } catch {
        await fetchData({ page: currentPage - 1 })
      }
    } catch (err) {
      setEditErr(typeof err?.message === 'string' ? err.message : 'Failed to update tool')
    } finally {
      setEditLoading(false)
    }
  }

  const onRequest = (row) => {
    const gid = Number(row?.gauge_id)
    if (!gid) { setError('Row not found.'); return }
    // Block if already requesting or requested
    if (requesting[gid] || requestedMap[gid]) return
    // Open purpose modal first
    setPurposeModalGauge(row)
    setPurposeValue('')
    setPurposeModalOpen(true)
  }

  const submitRequest = async () => {
    const row = purposeModalGauge
    const gid = Number(row?.gauge_id)
    if (!gid) { setError('Row not found.'); return }
    // Block if already requesting or requested
    if (requesting[gid] || requestedMap[gid]) return
    
    setPurposeModalOpen(false)
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
        purpose: (purposeValue || '').trim() || null,
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
      setPurposeValue('')
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
      { 
        title: 'Sl. No.', 
        key: 'slno', 
        width: 100, 
        align: 'center',
        render: (_,_row,index)=> ((currentPage - 1) * pageSize) + index + 1,
      },
      { 
        title: 'Equipment', 
        dataIndex: 'name_of_the_equipment', 
        key: 'name_of_the_equipment', 
        ellipsis: true, 
        width: 200,
        sorter: true,
        defaultSortOrder: 'ascend'
      },
      { 
        title: 'Location', 
        dataIndex: 'location', 
        key: 'location', 
        ellipsis: true, 
        width: 120, 
        align: 'center',
        sorter: (a,b)=>String(a.location||'').localeCompare(String(b.location||'')) 
      },
      { 
        title: 'Make/Model', 
        dataIndex: 'make_model', 
        key: 'make_model', 
        ellipsis: true, 
        width: 150, 
        sorter: (a,b)=>String(a.make_model||'').localeCompare(String(b.make_model||'')) 
      },
      {
        title: 'Range',
        dataIndex: 'ranges',
        key: 'ranges',
        width: 200,
        ellipsis: true,
        render: (v) => {
          const arr = Array.isArray(v) ? v : []
          if (!arr.length) return <span style={{ color:'#999' }}>—</span>
          return <span title={arr.join(', ')}>{arr.join(', ')}</span>
        }
      },
      { 
        title: 'IDFN', 
        dataIndex: 'idfn_no', 
        key: 'idfn_no', 
        width: 120, 
        align: 'center',
        ellipsis: true, 
        sorter: (a,b)=>String(a.idfn_no||'').localeCompare(String(b.idfn_no||'')),
        render: (text) => text ? <span className="idfn-tag">{text}</span> : ''
      },
      { 
        title: 'PCR Number', 
        dataIndex: 'pcr_number', 
        key: 'pcr_number', 
        width: 120, 
        align: 'center',
        sorter:(a,b)=>Number(a.pcr_number||0)-Number(b.pcr_number||0) 
      },
      { 
        title: 'Last Cal.', 
        dataIndex: 'date_of_last_calibration', 
        key: 'date_of_last_calibration', 
        width: 120, 
        align: 'center',
        sorter:(a,b)=>new Date(a.date_of_last_calibration||0)-new Date(b.date_of_last_calibration||0), 
        render:(v)=> v ? new Date(v).toLocaleDateString() : '' 
      },
      { 
        title: 'Due', 
        dataIndex: 'calibration_due', 
        key: 'calibration_due', 
        width: 120, 
        align: 'center',
        sorter:(a,b)=>new Date(a.calibration_due||0)-new Date(b.calibration_due||0), 
        render:(v)=> v ? new Date(v).toLocaleDateString() : '' 
      },
    ]
    const actionCol = mode === 'admin'
      ? {
          title: 'Actions', 
          key: 'actions', 
          fixed: 'right', 
          align: 'center',
          width: 150,
          render: (_, row) => (
            <Space size="small">
              <Button 
                type="text" 
                icon={<EditOutlined />} 
                onClick={() => openEdit(row)}
                title="Edit"
                style={{ color: '#1890ff' }}
              />
              <Button 
                type="text" 
                danger 
                icon={<DeleteOutlined />} 
                onClick={() => onDelete(row.gauge_id)}
                title="Delete"
              />
            </Space>
          )
        }
      : {
          title: 'Request', 
          key: 'request', 
          fixed: 'right', 
          align: 'center',
          width: 100,
          render: (_, row) => {
            const gid = Number(row.gauge_id)
            const isReq = !!requestedMap[gid]
            const isLoading = !!requesting[gid]
            const holder = holderMap[gid]
            const disabled = !!holder || isReq || isLoading
            const label = holder ? `Assigned to ${holder}` : (isReq ? 'Requested' : (isLoading ? 'Requesting...' : 'Request'))
            return (
              <Button
                type="primary"
                size="small"
                icon={<ShoppingCartOutlined />}
                onClick={() => onRequest(row)}
                disabled={disabled}
                title={label}
                style={{
                  whiteSpace: holder ? 'normal' : 'nowrap',
                  lineHeight: 1.2,
                  textAlign: 'left',
                  padding: '2px 8px',
                  width: '100%',
                  maxWidth: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start'
                }}
              >
                {label}
              </Button>
            )
          }
        }
    return [...base, actionCol]
  }, [mode, requesting, requestedMap, holderMap, currentPage, pageSize])

  const handlePageChange = (page, size) => {
    setCurrentPage(page)
    if (size !== pageSize) {
      setPageSize(size)
    }
  }

  const exportInventoryPDF = async () => {
    try {
      setExporting(true)
      const jsPDF = await loadJsPDF()
      const all = []
      let offset = 0
      const pageLimit = 500
      for (let i = 0; i < 200; i++) {
        const params = new URLSearchParams({ limit: String(pageLimit), offset: String(offset) })
        if (q.trim()) params.set('q', q.trim())
        if (sortBy) params.set('sort_by', sortBy)
        if (sortDir) params.set('sort_dir', sortDir)
        if ((locationFilter || '').trim()) params.set('location', String(locationFilter).trim())
        const res = await fetch(`/equipment?${params.toString()}`)
        if (!res.ok) break
        const data = await res.json().catch(()=>({ items:[], total:0 }))
        const arr = Array.isArray(data.items) ? data.items : []
        all.push(...arr)
        if (arr.length < pageLimit) break
        offset += pageLimit
      }
      if (all.length === 0) { message.info('No records to export'); return }
      const doc = new jsPDF({ orientation: 'landscape' })
      const head = [[
        'Sl. No.', 'Description', 'Make/Model', 'Range', 'Location', 'IDFN', 'Last Cal.', 'Next Due', 'PCR'
      ]]
      const body = all.map((r, idx) => [
        String(idx + 1),
        String(r.name_of_the_equipment ?? ''),
        String(r.make_model ?? ''),
        (Array.isArray(r.ranges) && r.ranges.length ? r.ranges.join(', ') : ''),
        String(r.location ?? ''),
        String(r.idfn_no ?? ''),
        r.date_of_last_calibration ? new Date(r.date_of_last_calibration).toLocaleDateString() : '',
        r.calibration_due ? new Date(r.calibration_due).toLocaleDateString() : '',
        String(r.pcr_number ?? '')
      ])
      doc.autoTable({ 
        head, 
        body, 
        styles: { fontSize: 8 },
        margin: { top: 24, bottom: 14, left: 14, right: 14 },
        // Reserve top/bottom margins and draw header/footer per page without overlapping rows
        didDrawPage: buildAutoTablePageHook(doc, 'Gauge Inventory'),
      })
      const fname = `gauge-inventory_${formatNow()}.pdf`
      doc.save(fname)
    } catch (e) {
      message.error('Failed to generate PDF')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="equipment-table-container">
      <div className="table-header">
        <h2>Equipment Used for Calibration</h2>
        <div></div>
      </div>

      {/* Operator view: auto-uses logged-in username; no manual input */}

      <Modal 
        open={mode === 'admin' && adding} 
        title="Add Tool" 
        onCancel={()=>setAdding(false)} 
        footer={null} 
        destroyOnClose
        className="professional-modal"
        width={800}
      >
        <form onSubmit={onAdd}>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label required">Equipment Name</label>
              {fieldErrors.name_of_the_equipment && <div className="form-error">{fieldErrors.name_of_the_equipment}</div>}
              <input 
                className={`form-input ${fieldErrors.name_of_the_equipment ? 'error' : ''}`}
                name="name_of_the_equipment" 
                value={form.name_of_the_equipment} 
                onChange={onFormChange}
                placeholder="Enter equipment name"
              />
            </div>
            <div className="form-field">
              <label className="form-label required">IDFN</label>
              {fieldErrors.idfn_no && <div className="form-error">{fieldErrors.idfn_no}</div>}
              <input 
                className={`form-input ${fieldErrors.idfn_no ? 'error' : ''}`}
                name="idfn_no" 
                value={form.idfn_no} 
                onChange={onFormChange}
                placeholder="Enter IDFN number"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Location</label>
              {fieldErrors.location && <div className="form-error">{fieldErrors.location}</div>}
              <input 
                className={`form-input ${fieldErrors.location ? 'error' : ''}`}
                name="location" 
                value={form.location} 
                onChange={onFormChange}
                placeholder="Enter location"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Make/Model</label>
              {fieldErrors.make_model && <div className="form-error">{fieldErrors.make_model}</div>}
              <input 
                className={`form-input ${fieldErrors.make_model ? 'error' : ''}`}
                name="make_model" 
                value={form.make_model} 
                onChange={onFormChange}
                placeholder="Enter make and model"
              />
            </div>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Ranges (comma or newline separated)</label>
              <TextArea
                className="form-input"
                name="ranges"
                value={form.ranges}
                onChange={onFormChange}
                placeholder="e.g., 0–100 PSI, 0–10 bar"
                rows={2}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Overall Measurement Uncertainty</label>
              {fieldErrors.overall_measurement_uncertainty && <div className="form-error">{fieldErrors.overall_measurement_uncertainty}</div>}
              <input 
                className={`form-input ${fieldErrors.overall_measurement_uncertainty ? 'error' : ''}`}
                name="overall_measurement_uncertainty" 
                value={form.overall_measurement_uncertainty} 
                onChange={onFormChange}
                placeholder="Enter measurement uncertainty"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Receipt Date</label>
              {fieldErrors.receipt_date && <div className="form-error">{fieldErrors.receipt_date}</div>}
              <input 
                className={`form-input ${fieldErrors.receipt_date ? 'error' : ''}`}
                type="date" 
                name="receipt_date" 
                value={form.receipt_date} 
                onChange={onFormChange}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Calibration Frequency (months)</label>
              {fieldErrors.calibration_freq_months && <div className="form-error">{fieldErrors.calibration_freq_months}</div>}
              <input 
                className={`form-input ${fieldErrors.calibration_freq_months ? 'error' : ''}`}
                type="number" 
                min="0" 
                step="1" 
                name="calibration_freq_months" 
                value={form.calibration_freq_months} 
                onChange={onFormChange}
                placeholder="Enter frequency in months"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Last Calibrated On</label>
              {fieldErrors.date_of_last_calibration && <div className="form-error">{fieldErrors.date_of_last_calibration}</div>}
              <input 
                className={`form-input ${fieldErrors.date_of_last_calibration ? 'error' : ''}`}
                type="date" 
                name="date_of_last_calibration" 
                value={form.date_of_last_calibration} 
                onChange={onFormChange}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Calibration Due</label>
              {fieldErrors.calibration_due && <div className="form-error">{fieldErrors.calibration_due}</div>}
              <input 
                className={`form-input ${fieldErrors.calibration_due ? 'error' : ''}`}
                type="date" 
                name="calibration_due" 
                value={form.calibration_due} 
                onChange={onFormChange}
              />
            </div>
            <div className="form-field">
              <label className="form-label">PCR Number</label>
              {fieldErrors.pcr_number && <div className="form-error">{fieldErrors.pcr_number}</div>}
              <input 
                className={`form-input ${fieldErrors.pcr_number ? 'error' : ''}`}
                type="number" 
                inputMode="numeric" 
                pattern="[0-9]*" 
                name="pcr_number" 
                value={form.pcr_number} 
                onChange={onFormChange}
                placeholder="Enter PCR number"
              />
            </div>
          </div>
          {addErr && <div className="form-error" style={{marginTop: 16, fontSize: 14}}>{addErr}</div>}
          {addSuccess && <div className="form-success" style={{marginTop: 16, fontSize: 14}}>{addSuccess}</div>}
          <div className="form-actions">
            <button 
              type="button" 
              className="form-button form-button-cancel" 
              onClick={()=>setAdding(false)}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className={`form-button form-button-primary ${addLoading ? 'loading' : ''}`}
              disabled={addLoading}
            >
              {addLoading ? 'Saving...' : 'Save Tool'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal 
        open={mode === 'admin' && editing} 
        title={`Edit Tool #${editRow?.gauge_id ?? ''}`} 
        onCancel={()=>setEditing(false)} 
        footer={null} 
        destroyOnClose
        className="professional-modal"
        width={800}
      >
        <form onSubmit={onUpdate}>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label required">Equipment Name</label>
              <input 
                className="form-input"
                name="name_of_the_equipment" 
                value={editForm.name_of_the_equipment} 
                onChange={onEditFormChange}
                placeholder="Enter equipment name"
              />
            </div>
            <div className="form-field">
              <label className="form-label required">IDFN</label>
              <input 
                className="form-input"
                name="idfn_no" 
                value={editForm.idfn_no} 
                onChange={onEditFormChange}
                placeholder="Enter IDFN number"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Location</label>
              <input 
                className="form-input"
                name="location" 
                value={editForm.location} 
                onChange={onEditFormChange}
                placeholder="Enter location"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Make/Model</label>
              <input 
                className="form-input"
                name="make_model" 
                value={editForm.make_model} 
                onChange={onEditFormChange}
                placeholder="Enter make and model"
              />
            </div>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Ranges (comma or newline separated)</label>
              <TextArea
                className="form-input"
                name="ranges"
                value={editForm.ranges}
                onChange={onEditFormChange}
                placeholder="e.g., 0–100 PSI, 0–10 bar"
                rows={2}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Receipt Date</label>
              <input 
                className="form-input"
                type="date" 
                name="receipt_date" 
                value={editForm.receipt_date} 
                onChange={onEditFormChange}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Overall Measurement Uncertainty</label>
              <input 
                className="form-input"
                name="overall_measurement_uncertainty" 
                value={editForm.overall_measurement_uncertainty} 
                onChange={onEditFormChange}
                placeholder="Enter measurement uncertainty"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Calibration Frequency (months)</label>
              <input 
                className="form-input"
                type="number" 
                min="0" 
                step="1" 
                name="calibration_freq_months" 
                value={editForm.calibration_freq_months} 
                onChange={onEditFormChange}
                placeholder="Enter frequency in months"
              />
            </div>
            <div className="form-field">
              <label className="form-label">Last Calibrated On</label>
              <input 
                className="form-input"
                type="date" 
                name="date_of_last_calibration" 
                value={editForm.date_of_last_calibration} 
                onChange={onEditFormChange}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Calibration Due</label>
              <input 
                className="form-input"
                type="date" 
                name="calibration_due" 
                value={editForm.calibration_due} 
                onChange={onEditFormChange}
              />
            </div>
            <div className="form-field">
              <label className="form-label">PCR Number</label>
              <input 
                className="form-input"
                type="number" 
                inputMode="numeric" 
                pattern="[0-9]*" 
                name="pcr_number" 
                value={editForm.pcr_number} 
                onChange={onEditFormChange}
                placeholder="Enter PCR number"
              />
            </div>
          </div>
          {editErr && <div className="form-error" style={{marginTop: 16, fontSize: 14}}>{editErr}</div>}
          <div className="form-actions">
            <button 
              type="button" 
              className="form-button form-button-cancel" 
              onClick={()=>setEditing(false)}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className={`form-button form-button-primary ${editLoading ? 'loading' : ''}`}
              disabled={editLoading}
            >
              {editLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        title={`Request Gauge - ${purposeModalGauge?.name_of_the_equipment || ''}`}
        open={purposeModalOpen}
        onCancel={() => {
          setPurposeModalOpen(false)
          setPurposeModalGauge(null)
          setPurposeValue('')
        }}
        footer={[
          <Button
            key="submit"
            type="primary"
            onClick={submitRequest}
          >
            Submit Request
          </Button>
        ]}
        destroyOnClose
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 14, fontWeight: 500 }}>Purpose</label>
            <p style={{ fontSize: 12, color: '#666', marginTop: 4, marginBottom: 8 }}>
              Please mention the purpose for requesting this gauge
            </p>
          </div>
          <TextArea
            value={purposeValue}
            onChange={(e) => setPurposeValue(e.target.value)}
            placeholder="E.g., For calibration of temperature sensors..."
            rows={4}
            maxLength={500}
            showCount
          />
        </div>
      </Modal>

      {error && <div className="error" style={{marginBottom: 8}}>{error}</div>}

      <div className="table-wrapper">
        <div className="table-controls">
          <div className="search-section">
            <AutoComplete
              options={suggestions}
              value={q}
              onChange={(val)=> setQ(val)}
              onSearch={fetchSuggest}
              onSelect={(val)=> { setQ(val); setCurrentPage(1); fetchData({ page: 0, reset: true }) }}
              style={{ minWidth: 360 }}
            >
              <Input.Search
                allowClear
                loading={suggestLoading}
                placeholder="Search by name or IDFN"
                onChange={(e)=> setQ(e.target.value)}
                onSearch={() => { setCurrentPage(1); fetchData({ page: 0, reset: true }) }}
                enterButton
              />
            </AutoComplete>
          </div>
          <div className="filter-section" style={{ marginLeft: 12 }}>
            <AutoComplete
              options={locOptions}
              value={locationFilter}
              onChange={(val)=> setLocationFilter(val)}
              onSearch={fetchLocationSuggest}
              onSelect={(val)=> { setLocationFilter(val); setCurrentPage(1); fetchData({ page: 0, reset: true, location: val }) }}
              style={{ minWidth: 220 }}
            >
              <Input
                allowClear
                placeholder="Filter by location"
                onChange={(e)=> {
                  const v = e.target.value
                  setLocationFilter(v)
                  if ((v || '').trim() === '') {
                    setCurrentPage(1)
                    fetchData({ page: 0, reset: true, location: '' })
                  }
                }}
                onPressEnter={()=> { setCurrentPage(1); fetchData({ page: 0, reset: true }) }}
                suffix={locLoading ? <span style={{fontSize:12,color:'#999'}}>...</span> : null}
              />
            </AutoComplete>
          </div>
          <div className="action-buttons">
            <Button icon={<ReloadOutlined />} onClick={() => { setCurrentPage(1); fetchData({ page: 0, reset: true }) }}>
              Refresh
            </Button>
            {mode === 'admin' && (
              <Button type="primary" icon={<PlusOutlined />} onClick={()=>setAdding(v=>!v)}>
                {adding ? 'Close' : 'Add Tool'}
              </Button>
            )}
            <Button type="primary" onClick={exportInventoryPDF} loading={exporting} disabled={exporting}>
              {exporting ? 'Generating...' : 'Download PDF'}
            </Button>
          </div>
        </div>

        <div className="table-container">
          <Table
            columns={columns}
            dataSource={items}
            loading={loading}
            pagination={false}
            scroll={{ x: 1000 }}
            bordered
            size="middle"
            className="ant-table-striped professional-table"
            locale={{ emptyText: 'No equipment found' }}
            rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-light' : 'table-row-dark')}
            onChange={(_, __, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter
              const field = s && s.field ? s.field : null
              const order = s && s.order ? (s.order === 'descend' ? 'desc' : 'asc') : null
              setSortBy(field)
              setSortDir(order)
              setCurrentPage(1)
              fetchData({ page: 0 })
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
    </div>
  )
}
