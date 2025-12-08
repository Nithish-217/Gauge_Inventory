import React, { useEffect, useMemo, useState } from 'react'

export default function EmailConfig() {
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('')
  const [limit, setLimit] = useState(100)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [apiBaseState, setApiBaseState] = useState(() => {
    try { return window.__API_BASE__ || localStorage.getItem('apiBase') || '' } catch { return '' }
  })
  const [lastTriedUrl, setLastTriedUrl] = useState('')
  const [schedTime, setSchedTime] = useState('')
  const [schedTz, setSchedTz] = useState('')
  const [schedMsg, setSchedMsg] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const apiBase = apiBaseState

  const load = async (signal) => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      if (limit) qs.set('limit', String(limit))
      if (fromDate) qs.set('from_date', fromDate)
      if (toDate) qs.set('to_date', toDate)
      const urlPrimary = `${apiBase ? apiBase.replace(/\/$/, '') : ''}/admin/email-logs?${qs.toString()}`
      const urlFallback = `/admin/email-logs?${qs.toString()}`

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

      let data
      try {
        setLastTriedUrl(urlPrimary)
        data = await fetchJson(urlPrimary)
      } catch (e) {
        // Retry with relative fallback
        setLastTriedUrl(urlFallback)
        data = await fetchJson(urlFallback)
      }
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
      const base = apiBase ? apiBase.replace(/\/$/, '') : ''
      const res = await fetch(`${base}/admin/due-reminder/time`, { headers: { 'Accept':'application/json' } })
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
      const base = apiBase ? apiBase.replace(/\/$/, '') : ''
      const res = await fetch(`${base}/admin/due-reminder/time`, {
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
      const base = apiBase ? apiBase.replace(/\/$/, '') : ''
      const res = await fetch(`${base}/admin/due-reminder/run`, { method: 'POST' })
      const data = await res.json().catch(()=>({}))
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
      setSchedMsg('Triggered run successfully')
    } catch (e) {
      setSchedMsg(String(e.message || e))
    }
  }

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
    <div style={{display:'flex', flexDirection:'column', minHeight:'calc(100vh - 140px)', width:'100%'}}>
      <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:12,flexWrap:'wrap'}}>
        <h2 style={{margin:0,fontSize:18,fontWeight:700}}>Email Config / Logs</h2>
        <div style={{display:'flex',alignItems:'center',gap:8,background:'#fff',padding:'6px 8px',borderRadius:8,boxShadow:'0 1px 2px rgba(0,0,0,0.06)'}}>
          <label>API Base</label>
          <input style={{minWidth:260}} placeholder="http://localhost:5657" value={apiBase} onChange={e=>setApiBaseState(e.target.value)} onBlur={()=>{ try { localStorage.setItem('apiBase', apiBaseState || '') } catch {} }} />
          <button type="button" onClick={()=>{ try { localStorage.setItem('apiBase', apiBaseState || '') } catch {}; load() }}>Apply</button>
        </div>
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
      <div className="card" style={{marginBottom:12,padding:12, width:'100%'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div style={{fontWeight:600}}>Schedule Time</div>
          <input style={{width:110}} placeholder="HH:MM" value={schedTime} onChange={e=>setSchedTime(e.target.value)} />
          <button type="button" onClick={setSchedule}>Update</button>
          <button type="button" onClick={getSchedule}>Get Current</button>
          <button type="button" onClick={runNow}>Run Now</button>
          {schedTz ? <span style={{opacity:0.7}}>TZ: {schedTz}</span> : null}
          {schedMsg ? <span style={{marginLeft:8,color:'#1677ff'}}>{schedMsg}</span> : null}
        </div>
      </div>
      {error ? (
        <div className="alert error">{error}</div>
      ) : null}

      <div className="card" style={{flex:1, display:'flex', flexDirection:'column', minHeight:400, width:'100%'}}>
        {loading && rows.length===0 ? (
          <div style={{padding:12}}>Loading...</div>
        ) : flatList.length === 0 ? (
          <div style={{padding:12}}>No email logs</div>
        ) : (
          <div style={{display:'flex', flexDirection:'column', flex:1, overflowY:'auto', width:'100%'}}>
            {flatList.map((item, idx) => {
              if (item.__sep) {
                return (
                  <div key={`sep-${idx}`} style={{
                    padding:'8px 12px',
                    background:'#fafafa',
                    fontWeight:600,
                    position:'sticky', top:0, zIndex:1,
                    borderTop: idx===0 ? 'none' : '1px solid #eee',
                    borderBottom: '1px solid #eee'
                  }}>{item.label}</div>
                )
              }
              const isFailed = (item.status || '').toLowerCase() === 'failed'
              const timeStr = new Date(item.sent_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
              return (
                <div key={item.id} style={{
                  display:'flex', alignItems:'center', gap:12,
                  padding:'10px 12px', cursor:'default',
                  borderBottom:'1px solid #f2f2f2'
                }} className="mail-row">
                  <div style={{width:8, height:8, borderRadius:8, background: isFailed ? '#ff4d4f' : '#52c41a'}} aria-label={isFailed ? 'Failed' : 'Sent'} title={isFailed ? 'Failed' : 'Sent'} />
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{display:'flex', alignItems:'center', gap:8}}>
                      <div style={{fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={item.to_email}>{item.to_email}</div>
                      <div style={{opacity:0.6, fontSize:12}}>{isFailed ? '• failed' : '• sent'}</div>
                    </div>
                    <div style={{opacity:0.85, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={item.subject}>{item.subject}</div>
                    {item.error ? (
                      <div style={{color:'#cf1322', fontSize:12, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={item.error}>{item.error}</div>
                    ) : null}
                  </div>
                  <div style={{marginLeft:'auto', whiteSpace:'nowrap', opacity:0.7}}>{timeStr}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
