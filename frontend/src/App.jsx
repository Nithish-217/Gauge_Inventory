import React, { useState } from 'react'

export default function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const year = new Date().getFullYear()

  async function handleSubmit(e) {
    e.preventDefault()
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
        body: JSON.stringify({ username, password })
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Login failed')
      }
      const data = await res.json()
      if (data && data.success) {
        setMessage('Login successful. Welcome, ' + (data.user?.username || 'user') + '!')
      } else {
        throw new Error(data?.message || 'Invalid credentials')
      }
    } catch (err) {
      setError(typeof err?.message === 'string' ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  function handleForgot(e) {
    e.preventDefault()
    alert('Forgot password flow coming soon.')
  }

  return (
    <div className="container">
      <div className="card">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true"></div>
          <h1>CMTI</h1>
        </div>

        <div id="root-inner">
          <form onSubmit={handleSubmit} noValidate>
            <p className="subtle">Sign in to continue</p>

            <div className="field">
              <label htmlFor="username" className="label">Username</label>
              <input
                id="username"
                type="text"
                className="input"
                placeholder="Enter your username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="password" className="label">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="error" role="alert" aria-live="polite">{error}</div>
            {message && <div style={{color:'#86efac',fontSize:'13px',minHeight:'18px'}}>{message}</div>}

            <div className="actions">
              <button type="submit" className="btn" disabled={loading}>{loading ? 'Logging in...' : 'Login'}</button>
              <a href="#" className="link" onClick={handleForgot}>Forgot password?</a>
            </div>
          </form>
        </div>

        <p className="footer">© <span>{year}</span> CMTI. All rights reserved.</p>
      </div>
    </div>
  )
}
