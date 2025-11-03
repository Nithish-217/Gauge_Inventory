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
  const [requestedGaugeIds, setRequestedGaugeIds] = React.useState(new Set()) // Set of gauge_ids that have been requested
  
  // Calculate KPIs for the selected month
  const kpis = React.useMemo(() => {
    const today = dayjs()
    const selectedMonth = value.month()
    const selectedYear = value.year()
    
    let total = 0, completed = 0, due = 0, missed = 0
    
    items.forEach(item => {
      // Count items with calibration due in the selected month
      if (item.calibration_due) {
        const dueDate = dayjs(item.calibration_due)
        if (dueDate.month() === selectedMonth && dueDate.year() === selectedYear) {
          due++
          if (dueDate.isBefore(today, 'day')) missed++
        }
      }
      
      // Count items with last calibration in the selected month
      if (item.date_of_last_calibration) {
        const lastCalDate = dayjs(item.date_of_last_calibration)
        if (lastCalDate.month() === selectedMonth && lastCalDate.year() === selectedYear) {
          completed++
        }
      }
      
      // Total items that have any calibration activity in the selected month
      if ((item.date_of_last_calibration && 
           dayjs(item.date_of_last_calibration).month() === selectedMonth && 
           dayjs(item.date_of_last_calibration).year() === selectedYear) ||
          (item.calibration_due && 
           dayjs(item.calibration_due).month() === selectedMonth && 
           dayjs(item.calibration_due).year() === selectedYear)) {
        total++
      }
    })
    
    return { total, completed, due, missed }
  }, [items, value])

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
      const eq = `[${r.gauge_id ?? '-'}] ${eqName}`
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
      const gaugeIds = new Set(allRequests.map(r => r.gauge_id).filter(id => id != null))
      setRequestedGaugeIds(gaugeIds)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch requested gauges:', e)
    }
  }

  React.useEffect(() => { 
    fetchAll()
    fetchRequestedGauges()
  }, [])

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
            const hasBeenRequested = ev.gauge_id && requestedGaugeIds.has(ev.gauge_id)
            return (
              <List.Item style={{padding:'6px 0'}}
                actions={isDue && ev.gauge_id && hasBeenRequested ? [
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
