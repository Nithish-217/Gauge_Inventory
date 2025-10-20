import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, Typography, Alert } from 'antd'

export default function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const year = new Date().getFullYear()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    if (e?.preventDefault) e.preventDefault()
    setError('')
    setMessage('')
    if (!username.trim() || !password) {
      setError('Please enter both username and password.')
      return
    }
    try {
      setLoading(true)
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: String(password).trim() })
      })
      if (!res.ok) {
        // try to parse structured error first
        try {
          const errJson = await res.json()
          const msg = errJson?.detail || errJson?.message || 'Login failed'
          throw new Error(msg)
        } catch {
          const txt = await res.text()
          throw new Error(txt || 'Login failed')
        }
      }
      const data = await res.json()
      if (data && data.success) {
        const role = (data.user?.role ?? data.role ?? (Array.isArray(data.user?.roles) ? data.user.roles[0] : undefined) ?? 'user').toString().toLowerCase()
        setMessage(`Welcome (${role})!`)
        // Persist basic auth view state if needed
        try {
          localStorage.setItem('role', role)
          // Persist user id for fetching profile later
          const userId = (data.user?.id ?? data.id ?? '').toString()
          if (userId) localStorage.setItem('userId', userId)
          // Persist the username as well for header display. Try common fields and fall back to input value.
          const persistedUsername = (
            data.user?.username ??
            data.user?.userName ??
            data.user?.name ??
            data.username ??
            data.userName ??
            data.name ??
            username ??
            ''
          )?.toString()?.trim()
          localStorage.setItem('username', persistedUsername || (username?.toString()?.trim() || ''))
        } catch {}
        // Navigate based on role
        if (role === 'admin') {
          navigate('/admin')
        } else {
          navigate('/operator')
        }
      } else {
        throw new Error(data?.message || 'Invalid credentials')
      }
    } catch (err) {
      setError(typeof err?.message === 'string' ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  

  return (
      <div className="container">
        <div className="card">
          <div className="login-header">
            <div className="login-title-wrapper">
              <div className="login-text-content">
                <h1 className="login-title">Welcome to Gauge Calibration and Management System</h1>
                <Typography.Paragraph className="login-subtitle">Sign in to continue</Typography.Paragraph>
              </div>
            </div>
          </div>

        <div id="root-inner" style={{ textAlign: 'center' }}>
          <Form layout="vertical" onSubmitCapture={handleSubmit} noValidate>

            <Form.Item label="Username" required style={{ textAlign: 'left' }}>
              <Input
                id="username"
                placeholder="Enter your username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{ textAlign: 'left' }}
              />
            </Form.Item>

            <Form.Item label="Password" required style={{ textAlign: 'left' }}>
              <Input.Password
                id="password"
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ textAlign: 'left' }}
              />
            </Form.Item>

            {error && (
              <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />
            )}
            {message && (
              <Alert type="success" message={message} showIcon style={{ marginBottom: 12 }} />
            )}

            <div className="actions" style={{ display:'flex', gap:12, alignItems:'center', justifyContent:'center', marginTop: '24px' }}>
              <Button type="primary" htmlType="submit" loading={loading} style={{ minWidth: 140, height: '44px', fontSize: '16px', fontWeight: '600' }}>
                {loading ? 'Logging in...' : 'Login'}
              </Button>
            </div>
          </Form>
        </div>

          <p className="footer">© <span>{year}</span> CMTI. All rights reserved.</p>
        </div>
      </div>
  )
}

