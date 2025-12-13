import React, { useEffect, useState, useRef } from 'react'
import { Card, Row, Col, Spin, message, Empty, Button } from 'antd'
import { exportElementToPDF, formatNow } from '../../utils/pdfExport'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'

// Light, aesthetic color palette
const LIGHT_COLORS = [
  '#6C9BD1', // Soft blue
  '#A8D5BA', // Mint green
  '#F4A261', // Warm orange
  '#E76F51', // Coral
  '#9B8FB8', // Lavender
  '#4ECDC4', // Turquoise
  '#FFB6C1', // Light pink
  '#FFD93D', // Sunny yellow
]

const CHART_COLORS = {
  returns: '#6C9BD1',      // Soft blue
  rejects: '#E76F51',       // Coral
  accepted: '#A8D5BA',     // Mint green
  requested: '#9B8FB8',    // Lavender
  good: '#A8D5BA',          // Mint green
  bad: '#E76F51',           // Coral
  needsRepair: '#F4A261',   // Warm orange
  custom: '#6C9BD1',        // Soft blue
}

export default function Analytics() {
  const [loading, setLoading] = useState(true)
  const [returnsRejects, setReturnsRejects] = useState(null)
  const [mostUsedTools, setMostUsedTools] = useState([])
  const [operatorAnalytics, setOperatorAnalytics] = useState(null)
  const [error, setError] = useState(null)
  const containerRef = useRef(null)
  const [returnConditionCounts, setReturnConditionCounts] = useState({ good: 0, bad: 0, needsRepair: 0, custom: 0 })

  useEffect(() => {
    fetchAnalytics()
  }, [])

  const fetchWithTimeout = async (url, opts = {}, ms = 15000) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ms)
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal })
      return res
    } finally {
      clearTimeout(timeout)
    }
  }

  const fetchAnalytics = async () => {
    setLoading(true)
    setError(null)
    try {
      const [returnsRejectsRes, mostUsedRes, operatorRes] = await Promise.all([
        fetchWithTimeout('/analytics/returns-rejects'),
        fetchWithTimeout('/analytics/most-used-tools?limit=10'),
        fetchWithTimeout('/analytics/operator-analytics')
      ])

      if (!returnsRejectsRes.ok) {
        const errorText = await returnsRejectsRes.text()
        throw new Error(`Returns/Rejects: ${returnsRejectsRes.status} ${errorText}`)
      }
      if (!mostUsedRes.ok) {
        const errorText = await mostUsedRes.text()
        throw new Error(`Most Used Tools: ${mostUsedRes.status} ${errorText}`)
      }
      if (!operatorRes.ok) {
        const errorText = await operatorRes.text()
        throw new Error(`Operator Analytics: ${operatorRes.status} ${errorText}`)
      }

      const returnsRejectsData = await returnsRejectsRes.json()
      const mostUsedData = await mostUsedRes.json()
      const operatorData = await operatorRes.json()

      setReturnsRejects(returnsRejectsData)
      setMostUsedTools(Array.isArray(mostUsedData) ? mostUsedData : [])
      setOperatorAnalytics(operatorData)

      // Also derive Returns Condition distribution from Gauge Tracker logs (newest first on action taken)
      // We will page through tracker data sorted by returned_at desc (fallback to requested_at)
      try {
        const pageLimit = 500
        let offset = 0
        const counts = { good: 0, bad: 0, needsRepair: 0, custom: 0 }
        for (let i = 0; i < 40; i++) {
          const p = new URLSearchParams({ limit: String(pageLimit), offset: String(offset), sort_by: 'returned_at', sort_dir: 'desc' })
          const res = await fetchWithTimeout(`/gauge-tracker?${p.toString()}`)
          if (!res.ok) break
          const data = await res.json().catch(()=>[])
          const arr = Array.isArray(data) ? data : []
          for (const row of arr) {
            if ((row.status||'').toLowerCase() === 'returned') {
              const label = String(row.return_status || '').toLowerCase()
              if (label === 'good') counts.good++
              else if (label === 'bad') counts.bad++
              else if (label === 'needs repair') counts.needsRepair++
              else if (label) counts.custom++
            }
          }
          if (arr.length < pageLimit) break
          offset += pageLimit
        }
        setReturnConditionCounts(counts)
      } catch {}
    } catch (e) {
      console.error('Analytics fetch error:', e)
      setError(e.message || 'Failed to load analytics')
      message.error(`Failed to load analytics: ${e.message || 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '20px' }}>
        <Card>
          <Empty description={error} />
        </Card>
      </div>
    )
  }

  const summary = returnsRejects?.summary || {}
  const monthlyTrends = returnsRejects?.monthly_trends || []

  // Prepare chart data
  const monthlyChartData = monthlyTrends.map(item => ({
    month: item.month ? new Date(item.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Unknown',
    Returns: item.returns || 0,
    Rejects: item.rejects || 0
  }))

  // Most used tools chart data (top 10)
  const toolsChartData = mostUsedTools.slice(0, 10).map(item => ({
    name: item.name_of_the_equipment || 'Unknown',
    Requests: item.request_count || 0,
    Accepted: item.accepted_count || 0,
    Returned: item.returned_count || 0
  }))

  // Returns condition pie chart data (derived from gauge tracker)
  const returnsConditionData = [
    { name: 'Good', value: Number(returnConditionCounts.good||0) },
    { name: 'Bad', value: Number(returnConditionCounts.bad||0) },
    { name: 'Needs Repair', value: Number(returnConditionCounts.needsRepair||0) },
    { name: 'Custom', value: Number(returnConditionCounts.custom||0) }
  ].filter(item => item.value > 0)

  // Status distribution pie chart
  const statusDistributionData = [
    { name: 'Accepted', value: summary.total_accepted || 0 },
    { name: 'Rejected', value: summary.total_rejects || 0 },
    { name: 'Returned', value: summary.total_returns || 0 },
    { name: 'Requested', value: summary.total_requested || 0 }
  ].filter(item => item.value > 0)

  // Operator activity chart data
  const operatorChartData = operatorAnalytics?.operator_stats?.slice(0, 10).map(item => ({
    name: item.operator || 'Unknown',
    Requests: item.total_requests || 0,
    Accepted: item.accepted_requests || 0,
    Rejected: item.rejected_requests || 0
  })) || []

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display:'flex', alignItems:'center', gap: 12, marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: '#262626', flex: 1 }}>Analytics Dashboard</h3>
        <Button
          type="primary"
          size="small"
          style={{ padding: '0 10px', width: 'auto' }}
          onClick={async ()=>{ try { await exportElementToPDF(containerRef.current, `analytics_${formatNow()}.pdf`, 'Analytics Dashboard') } catch(e) { message.error('Failed to export PDF') } }}
        >
          Download PDF
        </Button>
      </div>
      <div ref={containerRef}>

      {/* KPI Summary */}
      <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
        <Col xs={12} md={6}>
          <Card style={{ borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>Requested</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#262626' }}>{summary.total_requested ?? 0}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card style={{ borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>Accepted</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#262626' }}>{summary.total_accepted ?? 0}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card style={{ borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>Returned</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#262626' }}>{summary.total_returns ?? 0}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card style={{ borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#8c8c8c' }}>Rejected</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#262626' }}>{summary.total_rejects ?? 0}</div>
          </Card>
        </Col>
      </Row>

      {/* Charts Row 1 - Pie Charts */}
      <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
        <Col xs={24} lg={12}>
          <Card 
            title="Status Distribution" 
            style={{ borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
          >
            {statusDistributionData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusDistributionData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={90}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={LIGHT_COLORS[index % LIGHT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      border: '1px solid #e8e8e8',
                      borderRadius: '6px'
                    }} 
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="No data available" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card 
            title="Returns Condition Distribution"
            style={{ borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
          >
            {returnsConditionData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={returnsConditionData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={90}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {returnsConditionData.map((entry, index) => {
                      const colorMap = {
                        'Good': CHART_COLORS.good,
                        'Bad': CHART_COLORS.bad,
                        'Needs Repair': CHART_COLORS.needsRepair,
                        'Custom': CHART_COLORS.custom
                      }
                      return (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={colorMap[entry.name] || LIGHT_COLORS[index % LIGHT_COLORS.length]} 
                        />
                      )
                    })}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      border: '1px solid #e8e8e8',
                      borderRadius: '6px'
                    }} 
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="No data available" />
            )}
          </Card>
        </Col>
      </Row>

      {/* Monthly Trends Chart */}
      {monthlyChartData.length > 0 && (
        <Card 
          title="Monthly Returns and Rejects Trends" 
          style={{ marginBottom: '24px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
        >
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={monthlyChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis 
                dataKey="month" 
                tick={{ fill: '#595959', fontSize: 12 }}
                stroke="#d9d9d9"
              />
              <YAxis 
                tick={{ fill: '#595959', fontSize: 12 }}
                stroke="#d9d9d9"
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e8e8e8',
                  borderRadius: '6px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }} 
              />
              <Legend 
                wrapperStyle={{ paddingTop: '10px' }}
              />
              <Line 
                type="monotone" 
                dataKey="Returns" 
                stroke={CHART_COLORS.returns} 
                strokeWidth={3}
                dot={{ fill: CHART_COLORS.returns, r: 5 }}
                activeDot={{ r: 7 }}
              />
              <Line 
                type="monotone" 
                dataKey="Rejects" 
                stroke={CHART_COLORS.rejects} 
                strokeWidth={3}
                dot={{ fill: CHART_COLORS.rejects, r: 5 }}
                activeDot={{ r: 7 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Most Used Tools Chart */}
      {toolsChartData.length > 0 && (
        <Card 
          title="Most Used Tools (Top 10)" 
          style={{ marginBottom: '24px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
        >
          <ResponsiveContainer width="100%" height={450}>
            <BarChart data={toolsChartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis 
                type="number" 
                tick={{ fill: '#595959', fontSize: 12 }}
                stroke="#d9d9d9"
              />
              <YAxis 
                dataKey="name" 
                type="category" 
                width={180}
                tick={{ fill: '#595959', fontSize: 11 }}
                stroke="#d9d9d9"
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e8e8e8',
                  borderRadius: '6px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }} 
              />
              <Legend 
                wrapperStyle={{ paddingTop: '10px' }}
              />
              <Bar 
                dataKey="Requests" 
                fill={CHART_COLORS.requested}
                radius={[0, 4, 4, 0]}
              />
              <Bar 
                dataKey="Accepted" 
                fill={CHART_COLORS.accepted}
                radius={[0, 4, 4, 0]}
              />
              <Bar 
                dataKey="Returned" 
                fill={CHART_COLORS.returns}
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Operator Activity Chart */}
      {operatorChartData.length > 0 && (
        <Card 
          title="Operator Activity (Top 10)" 
          style={{ marginBottom: '24px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
        >
          <ResponsiveContainer width="100%" height={450}>
            <BarChart data={operatorChartData} margin={{ top: 5, right: 30, left: 20, bottom: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis 
                dataKey="name" 
                angle={-45} 
                textAnchor="end" 
                height={100}
                tick={{ fill: '#595959', fontSize: 11 }}
                stroke="#d9d9d9"
              />
              <YAxis 
                tick={{ fill: '#595959', fontSize: 12 }}
                stroke="#d9d9d9"
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e8e8e8',
                  borderRadius: '6px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }} 
              />
              <Legend 
                wrapperStyle={{ paddingTop: '10px' }}
              />
              <Bar 
                dataKey="Requests" 
                fill={CHART_COLORS.requested}
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                dataKey="Accepted" 
                fill={CHART_COLORS.accepted}
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                dataKey="Rejected" 
                fill={CHART_COLORS.rejects}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
      </div>
    </div>
  )
}
