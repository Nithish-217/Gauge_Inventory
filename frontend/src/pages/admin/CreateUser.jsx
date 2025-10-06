import React, { useState } from 'react'

export default function CreateUser() {
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'operator' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const onChange = (e) => {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    if (!form.username || !form.email || !form.password || !form.role) {
      setError('All fields are required.')
      return
    }
    try {
      setLoading(true)
      const res = await fetch('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Failed to create user')
      }
      const data = await res.json()
      setSuccess(`User created with id ${data.id}`)
      setForm({ username: '', email: '', password: '', role: 'operator' })
    } catch (err) {
      setError(typeof err?.message === 'string' ? err.message : 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h2>Create User</h2>
      <form onSubmit={onSubmit} style={{maxWidth: 520}}>
        <div className="field">
          <label className="label" htmlFor="username">Username</label>
          <input className="input" id="username" name="username" value={form.username} onChange={onChange} placeholder="Username" />
        </div>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" value={form.email} onChange={onChange} placeholder="Email" />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" value={form.password} onChange={onChange} placeholder="Password" />
        </div>
        <div className="field">
          <label className="label" htmlFor="role">Role</label>
          <select className="input" id="role" name="role" value={form.role} onChange={onChange}>
            <option value="admin">Admin</option>
            <option value="operator">Operator</option>
          </select>
        </div>
        <div className="error" role="alert" aria-live="polite">{error}</div>
        {success && <div style={{color:'#86efac',fontSize:'13px',minHeight:'18px'}}>{success}</div>}
        <div className="actions">
          <button className="btn" type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create User'}</button>
        </div>
      </form>
    </div>
  )
}
