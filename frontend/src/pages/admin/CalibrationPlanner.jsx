import React from 'react'
import { Calendar, Badge, Button, Space, Spin, Tooltip, Modal, List, Tag, Select, Segmented } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function CalibrationPlanner() {
  const [loading, setLoading] = React.useState(false)
  const [items, setItems] = React.useState([])
  const [eventMap, setEventMap] = React.useState({}) // { 'YYYY-MM-DD': Array<{type,label,eq}> }
  const [detailModal, setDetailModal] = React.useState({ open: false, date: '', events: [] })
  const [value, setValue] = React.useState(dayjs())
  const [mode, setMode] = React.useState('month') // 'month' | 'year'

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
        push(r.date_of_last_calibration, { type: 'success', label: `Last: ${eq}`, eq })
      }
      if (r.calibration_due) {
        push(r.calibration_due, { type: 'processing', label: `Due: ${eq}`, eq })
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

  React.useEffect(() => { fetchAll() }, [])

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
            ? (isOverdue ? 'rgba(220,38,38,0.12)' : 'rgba(59,130,246,0.12)')
            : 'rgba(16,185,129,0.12)'
          const border = isDue
            ? (isOverdue ? '1px solid rgba(220,38,38,0.35)' : '1px solid rgba(59,130,246,0.3)')
            : '1px solid rgba(16,185,129,0.3)'
          const color = isDue
            ? (isOverdue ? '#dc2626' : '#2563eb')
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
          <Tag color="blue">Due: {due}</Tag>
          <Tag color="red">Missed: {missed}</Tag>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center', marginBottom: 12}}>
        <h2 style={{margin:0}}>Calibration Planner</h2>
        <Space>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <Badge status="success" text={<span style={{fontSize:12}}>Last calibration</span>} />
            <Badge status="processing" text={<span style={{fontSize:12}}>Calibration due</span>} />
            <Badge status="error" text={<span style={{fontSize:12}}>Missed (overdue)</span>} />
          </div>
          <Button onClick={fetchAll}>Refresh</Button>
        </Space>
      </div>
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
            return (
              <List.Item style={{padding:'6px 0'}}>
                <List.Item.Meta
                  avatar={<span style={{display:'inline-block', width:10, height:10, borderRadius:3, background: isDue ? '#2563eb' : '#059669'}} />}
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
