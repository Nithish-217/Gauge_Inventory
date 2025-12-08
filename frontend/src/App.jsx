import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, Typography, Alert, Divider } from 'antd'
import { UserOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons'
import './App.css'

export default function App() {
  // Ensure light theme is set on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light')
    localStorage.setItem('theme', 'light')
  }, [])

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
      // Add a timeout so the UI doesn't keep loading forever if the server is down
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 12000)
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: String(password).trim() }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))
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
      if (err?.name === 'AbortError') {
        setError('Unable to reach server. Please ensure the backend is running and try again.')
      } else {
        setError(typeof err?.message === 'string' ? err.message : 'Login failed')
      }
    } finally {
      setLoading(false)
    }
  }

  

  return (
    <div className="container">
      <div className="card">
        <div className="login-header">
          <div className="login-text-content">
            <h1 className="login-title">Gauge Management System</h1>
            <Typography.Paragraph className="login-subtitle">
              Sign in to access the dashboard
            </Typography.Paragraph>
          </div>
        </div>

        <div id="root-inner">
          <Form 
            layout="vertical" 
            onSubmitCapture={handleSubmit} 
            noValidate
            className="login-form"
          >
            <Form.Item 
              name="username" 
              rules={[{ required: true, message: 'Please input your username!' }]}
            >
              <Input 
                prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="Username"
                size="large"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Please input your password!' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
                type="password"
                placeholder="Password"
                size="large"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Form.Item>

            {error && (
              <Alert 
                type="error" 
                message={error} 
                showIcon 
                style={{ marginBottom: 16, textAlign: 'left' }}
              />
            )}
            {message && (
              <Alert 
                type="success" 
                message={message} 
                showIcon 
                style={{ marginBottom: 16, textAlign: 'left' }}
              />
            )}

            <Form.Item style={{ marginBottom: 0 }}>
              <Button 
                type="primary" 
                htmlType="submit" 
                loading={loading}
                icon={!loading && <LoginOutlined />}
                size="large"
              >
                {loading ? 'Logging in...' : 'Sign In'}
              </Button>
            </Form.Item>
          </Form>
        </div>

        <div className="footer">
          <p>© {year} CMTI. All rights reserved.</p>
          <p style={{ fontSize: '0.8em', opacity: 0.7, marginTop: '4px' }}>
            Gauge Calibration Management System v1.0
          </p>
        </div>
      </div>
    </div>
  )
}

