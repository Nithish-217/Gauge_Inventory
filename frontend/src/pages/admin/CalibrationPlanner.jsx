import React from 'react'
import { Calendar, Badge, Button, Space, Spin, Tooltip, Modal, List, Tag, Select, Segmented, message, Row, Col, Card, Statistic } from 'antd'
import { LeftOutlined, RightOutlined, ReloadOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, CalendarOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function CalibrationPlanner() {
  const [loading, setLoading] = React.useState(false)
  const [items, setItems] = React.useState([])
  const [eventMap, setEventMap] = React.useState({}) // { 'YYYY-MM-DD': Array<{type,label,eq}> }
  const [detailModal, setDetailModal] = React.useState({ open: false, date: '', events: [] })
  const [value, setValue] = React.useState(dayjs())
  const [mode, setMode] = React.useState('month') // 'month' | 'year'
  const [heldGaugeIds, setHeldGaugeIds] = React.useState(new Set()) // gauges currently held by operator
  const [heldByMap, setHeldByMap] = React.useState({}) // { gauge_id: operator_username }
  const [userEmailMap, setUserEmailMap] = React.useState({}) // { usernameLower: email }
  
  // Calculate KPIs for the selected period
  const kpis = React.useMemo(() => {
    const today = dayjs()
    const selectedMonth = value.month()
    const selectedYear = value.year()

    let total = 0, completed = 0, due = 0, missed = 0

    if (mode === 'year') {
      items.forEach(item => {
        // Completed calibrations within the selected year
        if (item.date_of_last_calibration) {
          const lastCalDate = dayjs(item.date_of_last_calibration)
          if (lastCalDate.year() === selectedYear) {
            completed++
          }
        }
        // Due within the selected year
        if (item.calibration_due) {
          const dueDate = dayjs(item.calibration_due)
          if (dueDate.year() === selectedYear) {
            due++
            if (dueDate.isBefore(today, 'day')) missed++
          }
        }
        // Total items that have any calibration activity in the selected year
        const hasLastInYear = item.date_of_last_calibration && dayjs(item.date_of_last_calibration).year() === selectedYear
        const hasDueInYear = item.calibration_due && dayjs(item.calibration_due).year() === selectedYear
        if (hasLastInYear || hasDueInYear) total++
      })
    } else {
      // Month mode (default): aggregate for selected month
      items.forEach(item => {
        // Due within the selected month
        if (item.calibration_due) {
          const dueDate = dayjs(item.calibration_due)
          if (dueDate.month() === selectedMonth && dueDate.year() === selectedYear) {
            due++
            if (dueDate.isBefore(today, 'day')) missed++
          }
        }
        // Completed within the selected month
        if (item.date_of_last_calibration) {
          const lastCalDate = dayjs(item.date_of_last_calibration)
          if (lastCalDate.month() === selectedMonth && lastCalDate.year() === selectedYear) {
            completed++
          }
        }
        // Total having any activity in the selected month
        const hasLastInMonth = item.date_of_last_calibration && dayjs(item.date_of_last_calibration).month() === selectedMonth && dayjs(item.date_of_last_calibration).year() === selectedYear
        const hasDueInMonth = item.calibration_due && dayjs(item.calibration_due).month() === selectedMonth && dayjs(item.calibration_due).year() === selectedYear
        if (hasLastInMonth || hasDueInMonth) total++
      })
    }

    return { total, completed, due, missed }
  }, [items, value, mode])

  const limit = 200

  const buildEvents = (arr) => {
    const map = {}
    const push = (d, ev) => {
      if (!d) return
      map[d] = map[d] || []
      map[d].push(ev)
    }
    for (const r of arr) {
      const eqName = r.name_of_the_equipment || `Gauge ${r.gauge_id}`
      const op = heldByMap && r.gauge_id != null ? heldByMap[r.gauge_id] : undefined
      const opSuffix = op ? ` — ${op}` : ''
      const eq = `[${r.idfn_no ?? '-'}] ${eqName}${opSuffix}`
      if (r.date_of_last_calibration) {
        push(r.date_of_last_calibration, { type: 'success', label: `Last: ${eq}`, eq, gauge_id: r.gauge_id })
      }
      if (r.calibration_due) {
        push(r.calibration_due, { type: 'processing', label: `Due: ${eq}`, eq, gauge_id: r.gauge_id })
      }
    }
    return map
  }

  const fetchAll = async () => {
    setLoading(true)
    try {
      const all = []
      let page = 0
      while (true) {
        const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) })
        const res = await fetch(`/equipment?${params.toString()}`)
        if (!res.ok) throw new Error(await res.text() || 'Failed to load equipment')
        const data = await res.json()
        const chunk = Array.isArray(data.items) ? data.items : []
        all.push(...chunk)
        if (chunk.length < limit) break
        page += 1
      }
      setItems(all)
      setEventMap(buildEvents(all))
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Build username -> email lookup (used for PDF export)
  const ensureUserEmails = async () => {
    try {
      if (userEmailMap && Object.keys(userEmailMap).length > 0) return
      const res = await fetch('/users')
      if (!res.ok) return
      const arr = await res.json().catch(()=>[])
      const map = {}
      for (const u of (Array.isArray(arr) ? arr : [])) {
        const uname = (u.username || '').toString().trim().toLowerCase()
        if (uname) map[uname] = u.email || ''
      }
      setUserEmailMap(map)
    } catch {}
  }

  const fetchRequestedGauges = async () => {
    try {
      const allRequests = []
      let page = 0
      const pageLimit = 500 // Max limit allowed by backend
      while (true) {
        const params = new URLSearchParams({ limit: String(pageLimit), offset: String(page * pageLimit) })
        const res = await fetch(`/gauge-tracker?${params.toString()}`)
        if (!res.ok) break
        const data = await res.json()
        const chunk = Array.isArray(data) ? data : []
        allRequests.push(...chunk)
        if (chunk.length < pageLimit) break
        page += 1
      }
      // Only consider currently held gauges: accepted & not returned
      const active = allRequests.filter(r => String(r.status||'').toLowerCase() === 'accepted' && !r.returned_at)
      const ids = new Set(active.map(r => r.gauge_id).filter(id => id != null))
      const by = {}
      for (const r of active) {
        const who = (r.requested_by || r.accepted_by || '').toString()
        if (r.gauge_id != null && who && !by[r.gauge_id]) by[r.gauge_id] = who
      }
      setHeldGaugeIds(ids)
      setHeldByMap(by)
      // Rebuild events to include operator suffixes
      setEventMap(buildEvents(items))
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch requested gauges:', e)
    }
  }

  React.useEffect(() => { 
    fetchAll()
    fetchRequestedGauges()
  }, [])

  // When heldByMap changes, rebuild event labels with operator names
  React.useEffect(() => {
    if (items && items.length) {
      setEventMap(buildEvents(items))
    }
  }, [heldByMap])

  const adminName = React.useMemo(() => {
    try { return localStorage.getItem('username') || 'Admin' } catch { return 'Admin' }
  }, [])

  const sendReminder = async (gaugeId) => {
    try {
      const res = await fetch('/reminders/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gauge_id: gaugeId, admin_name: adminName })
      })
      if (!res.ok) throw new Error((await res.text()) || 'Failed to send reminder')
      const data = await res.json().catch(()=>({success:true,message:'Reminder sent'}))
      message.success(data.message || 'Reminder email sent')
    } catch (e) {
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to send reminder')
    }
  }

  // ---------- PDF generation helpers ----------
  const loadJsPdf = () => new Promise((resolve, reject) => {
    try {
      if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF)
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
      s.async = true
      s.onload = () => { try { resolve(window.jspdf.jsPDF) } catch (e) { reject(e) } }
      s.onerror = reject
      document.head.appendChild(s)
    } catch (e) { reject(e) }
  })

  const withinPeriod = (dateStr) => {
    if (!dateStr) return false
    const d = dayjs(dateStr)
    if (!d.isValid()) return false
    if (mode === 'year') return d.year() === value.year()
    return d.month() === value.month() && d.year() === value.year()
  }

  const formatDate = (dateStr) => {
    try { return dayjs(dateStr).format('YYYY-MM-DD') } catch { return String(dateStr||'') }
  }

  const computeSections = () => {
    const today = dayjs()
    const due = []
    const missed = []
    const calibrated = []
    for (const r of items) {
      const eq = r.name_of_the_equipment || `Gauge ${r.gauge_id}`
      const idfn = r.idfn_no || ''
      const opUserRaw = heldByMap[r.gauge_id] || ''
      const opEmailRaw = opUserRaw ? (userEmailMap[(opUserRaw || '').trim().toLowerCase()] || '') : ''
      const opUser = opUserRaw || '-'
      const opEmail = opEmailRaw || '-'
      if (r.calibration_due && withinPeriod(r.calibration_due)) {
        const dd = dayjs(r.calibration_due)
        const entry = { eq, idfn, opUser, opEmail, date: dd }
        if (dd.isBefore(today, 'day')) missed.push(entry)
        else due.push(entry)
      }
      if (r.date_of_last_calibration && withinPeriod(r.date_of_last_calibration)) {
        calibrated.push({ eq, idfn, opUser, opEmail, date: dayjs(r.date_of_last_calibration) })
      }
    }
    // Sort by nearest date to today first
    const byNearest = (a,b) => Math.abs(a.date.diff(today, 'day')) - Math.abs(b.date.diff(today, 'day'))
    due.sort(byNearest)
    missed.sort(byNearest)
    calibrated.sort(byNearest)
    return {
      due: due.map((x, i) => ({ sl: i+1, ...x, dateText: formatDate(x.date) })),
      missed: missed.map((x, i) => ({ sl: i+1, ...x, dateText: formatDate(x.date) })),
      calibrated: calibrated.map((x, i) => ({ sl: i+1, ...x, dateText: formatDate(x.date) })),
    }
  }

  const drawTable = (doc, title, rows, dateColHeader, startY, titleColor = '#000000') => {
    const margin = 28
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const usable = pageWidth - margin*2
    const cols = [
      { key:'sl', label:'Sl No.', w: 50 },
      { key:'eq', label:'Equipment', w: Math.floor(usable*0.28) },
      { key:'idfn', label:'IDFN', w: 90 },
      { key:'opUser', label:'Operator', w: Math.floor(usable*0.18) },
      { key:'opEmail', label:'Email', w: Math.floor(usable*0.22) },
      { key:'dateText', label:dateColHeader, w: 110 },
    ]
    const total = cols.reduce((s,c)=> s + (typeof c.w==='number'?c.w:0), 0)
    const scale = usable / total
    cols.forEach(c => { c.w = Math.max(60, Math.floor(c.w * scale)) })

    let y = startY
    // Section title (colored)
    doc.setFont('helvetica','bold'); doc.setFontSize(12)
    try { doc.setTextColor(...(typeof titleColor === 'string' ? [] : titleColor)) } catch {}
    if (typeof titleColor === 'string') { doc.setTextColor(titleColor) }
    doc.text(title, margin, y)
    doc.setTextColor(0,0,0)
    y += 10

    // Header row with blue background
    const headerHeight = 18
    let x = margin
    doc.setFillColor(0, 120, 215) //header color
    doc.setTextColor(255,255,255)
    doc.rect(x, y, usable, headerHeight, 'F')
    doc.setFont('helvetica','bold'); doc.setFontSize(10)
    for (const c of cols) {
      doc.text(String(c.label), x + 6, y + 12)
      x += c.w
    }
    y += headerHeight

    // Reset text color for rows
    doc.setTextColor(0,0,0)
    doc.setFont('helvetica','normal'); doc.setFontSize(9)
    const baseLine = 12
    const rowPadV = 6
    const lineH = baseLine + rowPadV // logical per-line advance

    const renderRow = (row, idx) => {
      // alternate row background
      if (idx % 2 === 0) {
        doc.setFillColor(245, 247, 250) // light gray-blue
        doc.rect(margin, y, usable, lineH, 'F')
      }
      let x0 = margin
      // Wrap per-column text and compute tallest cell
      let rowHeight = lineH
      const wrapped = {}
      for (const c of cols) {
        const txt = String(row[c.key] ?? '')
        const lines = doc.splitTextToSize(txt, c.w - 12)
        wrapped[c.key] = lines
        rowHeight = Math.max(rowHeight, Math.max(lineH, lines.length * baseLine + rowPadV*2))
      }
      // Page break handling (ensure header repeats)
      if (y + rowHeight > pageHeight - margin) {
        doc.addPage()
        y = margin
        // repeat header bar
        let hx = margin
        doc.setFillColor(24, 144, 255)
        doc.setTextColor(255,255,255)
        doc.rect(hx, y, usable, headerHeight, 'F')
        doc.setFont('helvetica','bold'); doc.setFontSize(10)
        for (const c of cols) { doc.text(String(c.label), hx + 6, y + 12); hx += c.w }
        y += headerHeight
        doc.setTextColor(0,0,0)
        doc.setFont('helvetica','normal'); doc.setFontSize(9)
      }
      // Draw cell texts
      for (const c of cols) {
        const lines = wrapped[c.key]
        let yy = y + rowPadV
        for (const line of lines) { doc.text(line, x0 + 6, yy + baseLine - 2); yy += baseLine }
        x0 += c.w
      }
      // Row bottom border
      doc.setDrawColor(230,230,230)
      doc.line(margin, y + rowHeight, margin + usable, y + rowHeight)
      y += rowHeight
    }
    rows.forEach((r, i) => renderRow(r, i))
    return y + 12
  }

  const handleDownloadPdf = async () => {
    try {
      await ensureUserEmails()
      const jsPDF = await loadJsPdf()
      const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' })
      const margin = 28
      const title = 'Calibration Planner'
      const sub = mode === 'year' ? `Period: Year ${value.year()}` : `Period: ${value.format('YYYY MMM')}`
      const generated = `Exported: ${dayjs().format('DD/MM/YYYY, h:mm a')}`
      const org = 'Organization: CMTI'
      // Header Title
      doc.setFont('helvetica','bold'); doc.setFontSize(16)
      doc.text(title, margin, 36)
      // Right aligned org
      const pageWidth = doc.internal.pageSize.getWidth()
      const orgWidth = doc.getTextWidth(org)
      doc.setFont('helvetica','normal'); doc.setFontSize(10)
      doc.text(org, pageWidth - margin - orgWidth, 36)
      // Sub lines
      doc.setFont('helvetica','normal'); doc.setFontSize(11)
      doc.text(generated, margin, 54)
      doc.text(sub, margin, 70)

      const { due, missed, calibrated } = computeSections()
      let y = 92
      if (due.length) y = drawTable(doc, 'Due', due, 'Due Date', y, '#faad14')
      if (missed.length) y = drawTable(doc, 'Missed', missed, 'Missed Date', y, '#f5222d')
      if (calibrated.length) y = drawTable(doc, 'Calibrated', calibrated, 'Calibrated Date', y, '#52c41a')
      if (!due.length && !missed.length && !calibrated.length) {
        doc.setFont('helvetica','italic'); doc.text('No data for selected period.', margin, y)
      }
      const fname = mode === 'year' ? `calibration_report_${value.year()}.pdf` : `calibration_report_${value.format('YYYY_MM')}.pdf`
      doc.save(fname)
    } catch (e) {
      message.error('Failed to generate PDF')
      // eslint-disable-next-line no-console
      console.error(e)
    }
  }

  const dateCellRender = (value) => {
    const key = value.format('YYYY-MM-DD')
    const list = eventMap[key] || []
    if (!list.length) return null
    return (
      <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
        {list.slice(0, 3).map((ev, idx) => {
          const isDue = ev.type === 'processing'
          const isOverdue = isDue && dayjs(key).isBefore(dayjs(), 'day')
          const bg = isDue
            ? (isOverdue ? 'rgba(220,38,38,0.12)' : 'rgba(245,158,11,0.12)')
            : 'rgba(16,185,129,0.12)'
          const border = isDue
            ? (isOverdue ? '1px solid rgba(220,38,38,0.35)' : '1px solid rgba(245,158,11,0.3)')
            : '1px solid rgba(16,185,129,0.3)'
          const color = isDue
            ? (isOverdue ? '#dc2626' : '#d97706')
            : '#059669'
          return (
            <Tooltip title={ev.label} key={idx}>
              <div
                onClick={(e)=>{ e.stopPropagation(); setDetailModal({ open: true, date: key, events: list }) }}
                role="button"
                style={{
                  background: bg,
                  border,
                  borderRadius: 6,
                  padding: '2px 6px',
                  fontSize: 12,
                  color,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >{ev.label}</div>
            </Tooltip>
          )
        })}
        {list.length > 3 && (
          <div style={{ fontSize: 11, color: '#999', cursor:'pointer' }} onClick={(e)=>{ e.stopPropagation(); setDetailModal({ open: true, date: key, events: list }) }}>+{list.length - 3} more</div>
        )}
      </div>
    )
  }

  const dateFullCellRender = (d) => {
    // Only show dates of the current panel month in month view
    if (mode === 'month') {
      const sameMonth = d.month() === value.month() && d.year() === value.year()
      if (!sameMonth) return <div />
      return (
        <div className="ant-picker-calendar-date">
          <div className="ant-picker-calendar-date-value">{d.date()}</div>
          <div className="ant-picker-calendar-date-content">{dateCellRender(d)}</div>
        </div>
      )
    }
    // For year view use default rendering
    return undefined
  }

  const monthCellRender = (value) => {
    // year view: show counts for month
    const ym = value.format('YYYY-MM')
    let last = 0, due = 0, missed = 0
    const today = dayjs()
    // Count using items to avoid building additional map
    for (const r of items) {
      if (r.date_of_last_calibration && String(r.date_of_last_calibration).startsWith(ym)) last++
      if (r.calibration_due && String(r.calibration_due).startsWith(ym)) {
        due++
        try {
          if (dayjs(r.calibration_due).isBefore(today, 'day')) missed++
        } catch {}
      }
    }
    if (last === 0 && due === 0 && missed === 0) return null
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <Tag color="green">Last: {last}</Tag>
          <Tag color="gold">Due: {due}</Tag>
          <Tag color="red">Missed: {missed}</Tag>
        </div>
      </div>
    )
  }

  return (
    <div className="equipment-table-container">
      <div className="table-header">
        <h2>Calibration Planner</h2>
        <div style={{display:'flex',alignItems:'center',gap:16, marginTop: 8}}>
          <Badge status="success" text={<span style={{fontSize:12}}>Last calibration</span>} />
          <Badge color="#f59e0b" text={<span style={{fontSize:12}}>Calibration due</span>} />
          <Badge status="error" text={<span style={{fontSize:12}}>Missed (overdue)</span>} />
        </div>
      </div>

      <div className="table-wrapper">
        <div className="table-controls">
          <div className="search-section">
            <span style={{color: 'var(--text-secondary)', fontSize: '14px'}}>
              View calibration schedules and track due dates
            </span>
          </div>
          <div className="action-buttons">
            <Button icon={<ReloadOutlined />} onClick={() => { fetchAll(); fetchRequestedGauges() }}>Refresh</Button>
            <Button type="primary" onClick={handleDownloadPdf}>Download PDF</Button>
          </div>
        </div>

        {/* KPI Cards */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={6}>
            <Card 
              bodyStyle={{ padding: '16px' }}
              style={{ background: 'rgba(24, 144, 255, 0.06)', border: '1px solid rgba(24, 144, 255, 0.15)' }}
            >
              <Statistic 
                title="Total Equipment" 
                value={kpis.total} 
                prefix={<CalendarOutlined style={{ color: '#1890ff' }} />} 
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card 
              bodyStyle={{ padding: '16px' }}
              style={{ background: 'rgba(82, 196, 26, 0.06)', border: '1px solid rgba(82, 196, 26, 0.15)' }}
            >
              <Statistic 
                title="Calibrated" 
                value={kpis.completed}
                suffix={`/ ${kpis.total}`}
                prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />} 
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card 
              bodyStyle={{ padding: '16px' }}
              style={{ background: 'rgba(250, 173, 20, 0.06)', border: '1px solid rgba(250, 173, 20, 0.15)' }}
            >
              <Statistic 
                title="Due for Calibration" 
                value={kpis.due}
                prefix={<ClockCircleOutlined style={{ color: '#faad14' }} />} 
                valueStyle={{ color: '#fa8c16' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card 
              bodyStyle={{ padding: '16px' }}
              style={{ background: 'rgba(245, 34, 45, 0.06)', border: '1px solid rgba(245, 34, 45, 0.15)' }}
            >
              <Statistic 
                title="Missed Calibration" 
                value={kpis.missed}
                prefix={<CloseCircleOutlined style={{ color: '#f5222d' }} />} 
                valueStyle={{ color: '#f5222d' }}
              />
            </Card>
          </Col>
        </Row>

        <div className="table-container">
          <div style={{border:'1px solid rgba(0,0,0,0.08)', borderRadius: 12, background:'var(--card)'}}>
        <Spin spinning={loading}>
          <Calendar
            value={value}
            mode={mode}
            onPanelChange={(v, m)=>{ setValue(v); setMode(m) }}
            onChange={(v)=>setValue(v)}
            fullscreen
            dateCellRender={dateCellRender}
            dateFullCellRender={dateFullCellRender}
            monthCellRender={monthCellRender}
            headerRender={({ value: val, onChange }) => {
              const year = val.year()
              const month = val.month()
              const years = []
              for (let y = year - 5; y <= year + 5; y++) years.push({ label: `${y}`, value: y })
              const months = Array.from({length:12}, (_,i)=>({ label: dayjs().month(i).format('MMM'), value: i }))
              const changeMonth = (m) => { const nv = val.clone().month(m); onChange(nv); setValue(nv) }
              const changeYear = (y) => { const nv = val.clone().year(y); onChange(nv); setValue(nv) }
              const prev = () => { const nv = val.clone().month(month - 1); onChange(nv); setValue(nv) }
              const next = () => { const nv = val.clone().month(month + 1); onChange(nv); setValue(nv) }
              return (
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '8px 12px'}}>
                  <Space>
                    <Button icon={<LeftOutlined />} onClick={prev} />
                    <Button icon={<RightOutlined />} onClick={next} />
                  </Space>
                  <Space>
                    <Segmented
                      size="small"
                      options={[{label:'Month', value:'month'},{label:'Year', value:'year'}]}
                      value={mode}
                      onChange={(m)=>{ setMode(m); const nv = val; onChange(nv) }}
                    />
                    <Select
                      size="small"
                      value={year}
                      options={years}
                      onChange={changeYear}
                      style={{ width: 96 }}
                    />
                    <Select
                      size="small"
                      value={month}
                      options={months}
                      onChange={changeMonth}
                      style={{ width: 96 }}
                    />
                  </Space>
                </div>
              )
            }}
          />
          </Spin>
          </div>
        </div>
      </div>

      <Modal
        title={`Events on ${detailModal.date}`}
        open={detailModal.open}
        onCancel={()=>setDetailModal({ open:false, date:'', events: [] })}
        footer={null}
      >
        <List
          dataSource={detailModal.events}
          renderItem={(ev)=>{
            const isDue = ev.type === 'processing'
            const hasActiveHolder = ev.gauge_id && heldGaugeIds.has(ev.gauge_id)
            return (
              <List.Item style={{padding:'6px 0'}}
                actions={isDue && ev.gauge_id && hasActiveHolder ? [
                  <Button key="remind" type="link" onClick={()=>sendReminder(ev.gauge_id)}>Send Reminder</Button>
                ] : undefined}
              >
                <List.Item.Meta
                  avatar={<span style={{display:'inline-block', width:10, height:10, borderRadius:3, background: isDue ? '#d97706' : '#059669'}} />}
                  title={<span>{ev.eq}</span>}
                  description={<span style={{color:'#666'}}>{ev.label}</span>}
                />
              </List.Item>
            )
          }}
        />
      </Modal>
    </div>
  )
}
