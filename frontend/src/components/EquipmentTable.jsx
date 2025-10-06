import React, { useEffect, useMemo, useState } from 'react'

export default function EquipmentTable({ mode = 'admin' }) {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [requestedBy, setRequestedBy] = useState('')
  const [qty, setQty] = useState({}) // { [gauge_id]: number }
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

  const fetchData = async () => {
    setError(''); setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) })
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/equipment?${params.toString()}`)
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Failed to load equipment')
      }
      const data = await res.json()
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      setError(typeof err?.message === 'string' ? err.message : 'Failed to load equipment')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [page])

  const onSearch = (e) => {
    e.preventDefault(); setPage(0); fetchData()
  }

  const onFormChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({...f, [name]: value}))
  }

  const onAdd = async (e) => {
    e.preventDefault()
    setAddErr('')
    if (!form.name_of_the_equipment.trim() || !form.idfn_no.trim()) {
      setAddErr('Equipment name and IDFN are required.')
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
    } catch (err) {
      setAddErr(typeof err?.message === 'string' ? err.message : 'Failed to add tool')
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

  const onRequest = async (gauge_id) => {
    const quantity = Number(qty[gauge_id] || 1)
    if (!quantity || quantity < 1) {
      setError('Please enter a valid quantity (>=1).')
      return
    }
    try {
      const res = await fetch('/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gauge_id, quantity, requested_by: requestedBy || null })
      })
      if (!res.ok) {
        const txt = await res.text(); throw new Error(txt || 'Failed to request tool')
      }
      // optional: show toast/success
      setQty(prev => ({ ...prev, [gauge_id]: '' }))
    } catch (err) {
      setError(typeof err?.message === 'string' ? err.message : 'Failed to request tool')
    }
  }

  const cols = useMemo(() => [
    { key: 'gauge_id', label: 'Gauge ID' },
    { key: 'name_of_the_equipment', label: 'Equipment' },
    { key: 'location', label: 'Location' },
    { key: 'make_model', label: 'Make/Model' },
    { key: 'idfn_no', label: 'IDFN' },
    { key: 'date_of_last_calibration', label: 'Last Cal.' },
    { key: 'calibration_due', label: 'Due' },
  ], [])

  return (
    <div>
      <h2>Equipment Used for Calibration</h2>

      <div className="actions" style={{marginBottom: 12, gap: 8}}>
        <form onSubmit={onSearch} className="actions" style={{flex:1, gap:8}}>
          <input className="input" placeholder="Search by name, IDFN or location" value={q} onChange={(e)=>setQ(e.target.value)} />
          <button className="btn" type="submit" disabled={loading}>Search</button>
        </form>
        {mode === 'admin' ? (
          <button className="btn" type="button" onClick={()=>setAdding(v=>!v)}>{adding ? 'Close' : 'Add Tool'}</button>
        ) : (
          <div className="field" style={{minWidth:240}}>
            <label className="label">Requested By (optional)</label>
            <input className="input" placeholder="Your name / ID" value={requestedBy} onChange={(e)=>setRequestedBy(e.target.value)} />
          </div>
        )}
      </div>

      {mode === 'admin' && adding && (
        <form onSubmit={onAdd} style={{border:'1px solid rgba(0,0,0,0.08)', padding:16, borderRadius:12, marginBottom:12, background:'var(--card)'}}>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:12}}>
            <div className="field"><label className="label">Equipment Name*</label><input className="input" name="name_of_the_equipment" value={form.name_of_the_equipment} onChange={onFormChange} /></div>
            <div className="field"><label className="label">IDFN*</label><input className="input" name="idfn_no" value={form.idfn_no} onChange={onFormChange} /></div>
            <div className="field"><label className="label">Location</label><input className="input" name="location" value={form.location} onChange={onFormChange} /></div>
            <div className="field"><label className="label">Make/Model</label><input className="input" name="make_model" value={form.make_model} onChange={onFormChange} /></div>
            <div className="field"><label className="label">Receipt Date</label><input className="input" type="date" name="receipt_date" value={form.receipt_date} onChange={onFormChange} /></div>
            <div className="field"><label className="label">Overall Measurement Uncertainty</label><input className="input" name="overall_measurement_uncertainty" value={form.overall_measurement_uncertainty} onChange={onFormChange} /></div>
            <div className="field"><label className="label">Calibration Freq (months)</label><input className="input" name="calibration_freq_months" value={form.calibration_freq_months} onChange={onFormChange} /></div>
            <div className="field"><label className="label">Date of Last Calibration</label><input className="input" type="date" name="date_of_last_calibration" value={form.date_of_last_calibration} onChange={onFormChange} /></div>
            <div className="field"><label className="label">Calibration Due</label><input className="input" type="date" name="calibration_due" value={form.calibration_due} onChange={onFormChange} /></div>
            <div className="field"><label className="label">PCR Number</label><input className="input" name="pcr_number" value={form.pcr_number} onChange={onFormChange} /></div>
          </div>
          {addErr && <div className="error" style={{marginTop:8}}>{addErr}</div>}
          <div className="actions" style={{marginTop:12}}>
            <button className="btn" type="submit" disabled={addLoading}>{addLoading ? 'Saving...' : 'Save Tool'}</button>
          </div>
        </form>
      )}

      {error && <div className="error" style={{marginBottom: 8}}>{error}</div>}

      <div style={{overflowX:'auto', border:"1px solid rgba(0,0,0,0.06)", borderRadius:12}}>
        <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.key} style={{textAlign:'left', padding:'12px', background:'var(--card)', color:'var(--text)', position:'sticky', top:0}}>{c.label}</th>
              ))}
              <th style={{textAlign:'right', padding:'12px', background:'var(--card)', position:'sticky', top:0}}>{mode === 'admin' ? 'Actions' : 'Request'}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length + 1} style={{padding:16}}>Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={cols.length + 1} style={{padding:16}}>No equipment found.</td></tr>
            ) : (
              items.map((row) => (
                <tr key={row.gauge_id}>
                  {cols.map(c => (
                    <td key={c.key} style={{padding:'10px 12px', borderTop:'1px solid rgba(0,0,0,0.06)'}}>
                      {row[c.key] ?? ''}
                    </td>
                  ))}
                  <td style={{padding:'10px 12px', borderTop:'1px solid rgba(0,0,0,0.06)', textAlign:'right'}}>
                    {mode === 'admin' ? (
                      <button className="btn" style={{background:'#ef4444'}} type="button" onClick={()=>onDelete(row.gauge_id)}>Delete</button>
                    ) : (
                      <div style={{display:'inline-flex', gap:8, alignItems:'center'}}>
                        <input className="input" style={{width:90}} type="number" min="1" placeholder="Qty" value={qty[row.gauge_id] ?? ''} onChange={(e)=>setQty(p=>({...p, [row.gauge_id]: e.target.value}))} />
                        <button className="btn" type="button" onClick={()=>onRequest(row.gauge_id)}>Request</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="actions" style={{marginTop: 12}}>
        <button className="btn" type="button" disabled={loading || page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Prev</button>
        <button className="btn" type="button" disabled={loading || items.length < limit} onClick={()=>setPage(p=>p+1)}>Next</button>
      </div>
    </div>
  )
}
