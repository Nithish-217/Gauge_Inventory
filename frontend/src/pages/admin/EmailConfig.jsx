import React, { useEffect, useMemo, useState } from 'react'

export default function EmailConfig() {
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('')
  const [limit, setLimit] = useState(100)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // API base is controlled by the backend .env and dev proxy; use relative URLs only
  const [lastTriedUrl, setLastTriedUrl] = useState('')
  const [schedTime, setSchedTime] = useState('')
  const [schedTz, setSchedTz] = useState('')
  const [schedMsg, setSchedMsg] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [offsetDays, setOffsetDays] = useState('')
  const [offsetMsg, setOffsetMsg] = useState('')

  const apiBase = ''

  const load = async (signal) => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      if (limit) qs.set('limit', String(limit))
      if (fromDate) qs.set('from_date', fromDate)
      if (toDate) qs.set('to_date', toDate)
      const url = `/admin/email-logs?${qs.toString()}`

      async function fetchJson(u) {
        const res = await fetch(u, { signal, headers: { 'Accept': 'application/json' } })
        const ct = (res.headers.get('content-type') || '').toLowerCase()
        if (!res.ok) {
          const bodyText = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`)
        }
        if (!ct.includes('application/json')) {
          const text = await res.text()
          throw new Error(`Non-JSON response (content-type: ${ct || 'unknown'}): ${text.slice(0, 200)}`)
        }
        return res.json()
      }

      setLastTriedUrl(url)
      const data = await fetchJson(url)
      setLogs(Array.isArray(data) ? data : [])
    } catch (e) {
      if (e.name !== 'AbortError') setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const ctrl = new AbortController()
    load(ctrl.signal)
    const id = setInterval(() => load(ctrl.signal), 15000)
    return () => { ctrl.abort(); clearInterval(id) }
  }, [status, limit, fromDate, toDate, apiBase])

  const getSchedule = async () => {
    setSchedMsg('')
    try {
      const res = await fetch(`/admin/due-reminder/time`, { headers: { 'Accept':'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSchedTime(data?.time || '')
      setSchedTz(data?.timezone || '')
    } catch (e) {
      setSchedMsg(String(e.message || e))
    }
  }

  const setSchedule = async () => {
    setSchedMsg('')
    try {
      const res = await fetch(`/admin/due-reminder/time`, {
        method: 'PUT',
        headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify({ time: schedTime })
      })
      const data = await res.json().catch(()=>({}))
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
      setSchedMsg(`Updated to ${data.time} (${data.timezone})`)
    } catch (e) {
      setSchedMsg(String(e.message || e))
    }
  }

  const runNow = async () => {
    setSchedMsg('')
    try {
      const res = await fetch(`/admin/due-reminder/run`, { method: 'POST' })
      const data = await res.json().catch(()=>({}))
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
      setSchedMsg('Triggered run successfully')
    } catch (e) {
      setSchedMsg(String(e.message || e))
    }
  }

  // Offset controls (days before due)
  const getOffset = async () => {
    setOffsetMsg('')
    try {
      const res = await fetch(`/admin/due-reminder/offset`, { headers: { 'Accept':'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setOffsetDays((data?.days ?? 0).toString())
    } catch (e) {
      setOffsetMsg(String(e.message || e))
    }
  }
  const setOffset = async () => {
    setOffsetMsg('')
    try {
      const daysNum = Math.max(0, parseInt(offsetDays || '0') || 0)
      const res = await fetch(`/admin/due-reminder/offset`, {
        method: 'PUT',
        headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify({ days: daysNum })
      })
      const data = await res.json().catch(()=>({}))
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
      setOffsetDays(String(data.days))
      setOffsetMsg(`Offset set to ${data.days} day(s) before due`)
    } catch (e) {
      setOffsetMsg(String(e.message || e))
    }
  }

  // Load current offset and schedule time once on mount
  useEffect(() => {
    getOffset();
    getSchedule();
  }, [])

  const rows = useMemo(() => logs.map((r) => ({
    id: r.id,
    sent_at: r.sent_at,
    to_email: r.to_email,
    subject: r.subject,
    status: r.status,
    error: r.error,
  })), [logs])

  // Build a single list with inline separators like Gmail
  const flatList = useMemo(() => {
    const now = new Date()
    const todayStr = now.toISOString().slice(0,10)
    const y = new Date(now); y.setDate(now.getDate()-1)
    const yStr = y.toISOString().slice(0,10)
    const buckets = { today: [], yesterday: [], earlier: [] }
    for (const r of rows) {
      const d = new Date(r.sent_at)
      const ds = isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10)
      if (ds === todayStr) buckets.today.push(r)
      else if (ds === yStr) buckets.yesterday.push(r)
      else buckets.earlier.push(r)
    }
    const out = []
    const order = [
      { key: 'today', label: 'Today' },
      { key: 'yesterday', label: 'Yesterday' },
      { key: 'earlier', label: 'Earlier' },
    ]
    for (const sec of order) {
      const list = buckets[sec.key]
      if (list.length) {
        out.push({ __sep: true, label: sec.label })
        for (const r of list) out.push(r)
      }
    }
    return out
  }, [rows])

  return (
    <div style={{display:'flex', flexDirection:'column', minHeight:'calc(100vh - 140px)', width:'100%', maxWidth:'none'}}>
      <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:12,flexWrap:'wrap'}}>
        <h2 style={{margin:0,fontSize:18,fontWeight:700}}>Email Config / Logs</h2>
        <div style={{display:'flex',alignItems:'center',gap:8,background:'#fff',padding:'6px 8px',borderRadius:8,boxShadow:'0 1px 2px rgba(0,0,0,0.06)'}}>
          <label>From</label>
          <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} />
          <label>To</label>
          <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} />
        </div>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,background:'#fff',padding:'6px 8px',borderRadius:8,boxShadow:'0 1px 2px rgba(0,0,0,0.06)'}}>
          <label>Limit</label>
          <input type="number" min={1} max={500} value={limit} onChange={e=>setLimit(Math.max(1, Math.min(500, parseInt(e.target.value||'0')||100)))} />
          <label>Status</label>
          <select value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
          <button type="button" onClick={()=>load()}>Refresh</button>
        </div>
      </div>
      {lastTriedUrl ? (
        <div style={{fontSize:12,opacity:0.7,marginBottom:8}}>Last tried: <span style={{fontFamily:'monospace'}}>{lastTriedUrl}</span></div>
      ) : null}
      <div className="card" style={{marginBottom:12,padding:12, width:'100%', maxWidth:'none'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div style={{fontWeight:600}}>Schedule Time</div>
          <input style={{width:110}} placeholder="HH:MM" value={schedTime} onChange={e=>setSchedTime(e.target.value)} />
          <button type="button" onClick={setSchedule}>Update</button>
          <button type="button" onClick={runNow}>Run Now</button>
          {schedTz ? <span style={{opacity:0.7}}>TZ: {schedTz}</span> : null}
          {schedMsg ? <span style={{marginLeft:8,color:'#1677ff'}}>{schedMsg}</span> : null}
        </div>
      </div>
      <div className="card" style={{marginBottom:12,padding:12, width:'100%', maxWidth:'none'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div style={{fontWeight:600}}>Days Before Due</div>
          <input type="number" min={0} style={{width:110}} placeholder="0" value={offsetDays} onChange={e=>setOffsetDays(e.target.value)} />
          <button type="button" onClick={setOffset}>Update</button>
          {offsetMsg ? <span style={{marginLeft:8,color:'#1677ff'}}>{offsetMsg}</span> : null}
        </div>
      </div>
      {error ? (
        <div className="alert error">{error}</div>
      ) : null}

      <div className="card" style={{flex:1, display:'flex', flexDirection:'column', minHeight:400, width:'100%', maxWidth:'none'}}>
        {loading && rows.length===0 ? (
          <div style={{padding:12}}>Loading...</div>
        ) : flatList.length === 0 ? (
          <div style={{padding:12}}>No email logs</div>
        ) : (
          <div style={{display:'flex', flexDirection:'column', flex:1, overflowY:'auto', width:'100%'}}>
            {/* Header row */}
            <div style={{display:'flex', gap:12, padding:'10px 12px', background:'#fafafa', borderBottom:'1px solid #eee', position:'sticky', top:0, zIndex:1}}>
              <div style={{width:110, fontWeight:600}}>Date</div>
              <div style={{width:90, fontWeight:600}}>Time</div>
              <div style={{flex:1, minWidth:0, fontWeight:600}}>Sent To</div>
              <div style={{width:96, fontWeight:600, textAlign:'right'}}>Status</div>
            </div>
            {flatList.map((item, idx) => {
              if (item.__sep) {
                return (
                  <div key={`sep-${idx}`} style={{
                    padding:'6px 12px',
                    background:'#fafafa',
                    fontWeight:600,
                    position:'sticky', top:44, zIndex:1,
                    borderTop: '1px solid #eee',
                    borderBottom: '1px solid #eee'
                  }}>{item.label}</div>
                )
              }
              const status = (item.status || '').toLowerCase()
              const isFailed = status === 'failed'
              const dateStr = item.date_str || (item.sent_at ? new Date(item.sent_at).toISOString().slice(0,10) : '')
              const timeStr = item.time_str || (item.sent_at ? new Date(item.sent_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '')
              const toEmail = Array.isArray(item.to) ? item.to.join(', ') : (item.to_email || '')
              const fullMsg = (item.message || item.body || '').toString()
              const preview = (fullMsg || '').replace(/\s+/g,' ').slice(0, 180) + (fullMsg && fullMsg.length>180 ? '…' : '')
              return (
                <div key={item.id} style={{
                  display:'flex', gap:12,
                  padding:'10px 12px', cursor:'default',
                  borderBottom:'1px solid #f2f2f2', width:'100%'
                }} className="mail-row">
                  <div style={{width:110, whiteSpace:'nowrap'}}>{dateStr}</div>
                  <div style={{width:90, whiteSpace:'nowrap', opacity:0.8}}>{timeStr}</div>
                  <div style={{flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:4}}>
                    <div style={{display:'flex', alignItems:'center', gap:12}}>
                      <div style={{flex:1, minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={toEmail}>{toEmail}</div>
                      <div style={{width:96, textAlign:'right'}}>
                        <span style={{
                          display:'inline-block', padding:'2px 8px', borderRadius:999,
                          background: isFailed ? '#fff1f0' : '#f6ffed',
                          color: isFailed ? '#cf1322' : '#389e0d',
                          border: `1px solid ${isFailed ? '#ffa39e' : '#b7eb8f'}`,
                          fontSize:12
                        }}>{status || 'unknown'}</span>
                      </div>
                    </div>
                    {/* Subtle inline preview spanning Sent To .. Status */}
                    {preview ? (
                      <div style={{
                        color:'#667085',
                        fontSize:12,
                        lineHeight:1.4,
                        whiteSpace:'nowrap',
                        overflow:'hidden',
                        textOverflow:'ellipsis'
                      }}>{preview}</div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {/* Offset controls feedback */}
      {offsetMsg ? <div style={{marginTop:8, color:'#1677ff'}}>{offsetMsg}</div> : null}
    </div>
  )
}
