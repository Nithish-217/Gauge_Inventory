import React, { useEffect, useMemo, useState } from 'react'
import { Table, Button, Input, Select, Space, Modal, Form, Input as AntInput, message } from 'antd'
import { DeleteOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'

export default function CreateUser() {
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'operator' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [pwdModal, setPwdModal] = useState({ open: false, user: null })
  const [pwdForm] = Form.useForm()
  const [showCreate, setShowCreate] = useState(false)

  const onChange = (e) => {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
  }

  const fetchUsers = async () => {
    setUsersLoading(true)
    try {
      const res = await fetch('/users')
      if (!res.ok) throw new Error(await res.text() || 'Failed to load users')
      const data = await res.json()
      setUsers((Array.isArray(data) ? data : []).map(u => ({ ...u, key: u.id })))
    } catch (err) {
      message.error(typeof err?.message === 'string' ? err.message : 'Failed to load users')
    } finally {
      setUsersLoading(false)
    }
  }

  useEffect(() => { fetchUsers() }, [])

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
      message.success('User created')
      fetchUsers()
      setShowCreate(false)
    } catch (err) {
      setError(typeof err?.message === 'string' ? err.message : 'Failed to create user')
      message.error(typeof err?.message === 'string' ? err.message : 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  const onDelete = async (userId) => {
    Modal.confirm({
      title: 'Delete user?',
      content: 'This action cannot be undone.',
      okType: 'danger',
      onOk: async () => {
        try {
          const res = await fetch(`/users/${userId}`, { method: 'DELETE' })
          if (!res.ok && res.status !== 204) throw new Error(await res.text() || 'Failed to delete')
          message.success('User deleted')
          fetchUsers()
        } catch (e) {
          message.error(typeof e?.message === 'string' ? e.message : 'Failed to delete')
        }
      }
    })
  }

  const openChangePassword = (user) => {
    setPwdModal({ open: true, user })
    pwdForm.resetFields()
  }

  const submitPasswordChange = async () => {
    try {
      const vals = await pwdForm.validateFields()
      const res = await fetch(`/users/${pwdModal.user.id}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: vals.new_password })
      })
      if (!res.ok) throw new Error(await res.text() || 'Failed to change password')
      message.success('Password changed')
      setPwdModal({ open: false, user: null })
    } catch (e) {
      if (e?.errorFields) return; // form validation error
      message.error(typeof e?.message === 'string' ? e.message : 'Failed to change password')
    }
  }

  const columns = useMemo(() => [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: 'Username', dataIndex: 'username', key: 'username' },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Role', dataIndex: 'role', key: 'role', width: 120, render: (r)=> r?.toUpperCase() },
    { title: 'Created', dataIndex: 'created_at', key: 'created_at', width: 200, render: (v)=> v ? new Date(v).toLocaleString() : '' },
    { title: 'Actions', key: 'actions', width: 220, align: 'right', render: (_, row) => (
      <Space>
        <Button icon={<KeyOutlined />} onClick={()=>openChangePassword(row)}>Change Password</Button>
        <Button danger icon={<DeleteOutlined />} onClick={()=>onDelete(row.id)}>Delete</Button>
      </Space>
    )}
  ], [])

  return (
    <div>
      <h2>Users</h2>

      {!showCreate && (
        <div style={{marginBottom:16}}>
          <Button type="primary" icon={<PlusOutlined />} onClick={()=>setShowCreate(true)}>Create a new user</Button>
        </div>
      )}

      {showCreate && (
        <form onSubmit={onSubmit} style={{maxWidth: 680, border:'1px solid rgba(0,0,0,0.08)', padding:16, borderRadius:12, marginBottom:16, background:'var(--card)'}}>
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:12}}>
            <div className="field"><label className="label" htmlFor="username">Username</label><Input id="username" name="username" value={form.username} onChange={onChange} placeholder="Username" /></div>
            <div className="field"><label className="label" htmlFor="email">Email</label><Input id="email" name="email" type="email" value={form.email} onChange={onChange} placeholder="Email" /></div>
            <div className="field"><label className="label" htmlFor="password">Password</label><Input.Password id="password" name="password" value={form.password} onChange={onChange} placeholder="Password" /></div>
            <div className="field"><label className="label" htmlFor="role">Role</label>
              <Select id="role" value={form.role} onChange={(v)=>setForm(f=>({...f, role:v}))} options={[{value:'admin', label:'Admin'},{value:'operator', label:'Operator'}]} />
            </div>
          </div>
          <div className="error" role="alert" aria-live="polite">{error}</div>
          {success && <div style={{color:'#86efac',fontSize:'13px',minHeight:'18px'}}>{success}</div>}
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:12}}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={loading}>{loading ? 'Creating...' : 'Submit'}</Button>
              <Button icon={<ReloadOutlined />} onClick={fetchUsers}>Refresh</Button>
            </Space>
          </div>
        </form>
      )}

      <div style={{border:'1px solid rgba(0,0,0,0.06)', borderRadius:12}}>
        <Table columns={columns} dataSource={users} loading={usersLoading} pagination={false} />
      </div>

      <Modal
        title={pwdModal.user ? `Change Password: ${pwdModal.user.username}` : 'Change Password'}
        open={pwdModal.open}
        onCancel={()=>setPwdModal({ open:false, user:null })}
        onOk={submitPasswordChange}
        okText="Update Password"
      >
        <Form layout="vertical" form={pwdForm}>
          <Form.Item label="New Password" name="new_password" rules={[{required:true, message:'Enter a password'},{min:6, message:'At least 6 characters'}]}>
            <AntInput.Password placeholder="Enter new password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
