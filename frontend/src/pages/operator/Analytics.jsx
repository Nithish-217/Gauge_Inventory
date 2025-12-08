import React from 'react'

export default function Analytics({ summary = {}, monthly = [] }) {
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Analytics</h3>
      <div style={{ fontSize: 14, color: '#555' }}>
        <p>Total returns: {summary.total_returns ?? 0}</p>
        <p>Total rejects: {summary.total_rejects ?? 0}</p>
      </div>
      {Array.isArray(monthly) && monthly.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Recent months</strong>
          <ul>
            {monthly.map((m, idx) => (
              <li key={idx}>
                {String(m.month || '')}: returns {m.returns ?? 0}, rejects {m.rejects ?? 0}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
