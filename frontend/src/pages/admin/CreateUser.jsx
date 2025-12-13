import React, { useEffect, useMemo, useState } from 'react'
import { Table, Button, Input, Select, Space, Modal, Form, Input as AntInput, message, Pagination } from 'antd'
import { DeleteOutlined, KeyOutlined, PlusOutlined, ReloadOutlined, EditOutlined, UserOutlined, LockOutlined } from '@ant-design/icons'

export default function CreateUser() {
  const [form, setForm] = useState({ username: '', email: '', password: '', role: undefined, employee_id: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [pwdModal, setPwdModal] = useState({ open: false, user: null })
  const [pwdForm] = Form.useForm()
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [editForm, setEditForm] = useState({ username: '', email: '', role: 'operator', employee_id: '' })
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState('')
  const [q, setQ] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [pageSize, setPageSize] = useState(10)

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
      const userList = (Array.isArray(data) ? data : []).map(u => ({ ...u, key: u.id }))
      setUsers(userList)
      setTotalItems(userList.length)
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
      setError('Username, Email, Password, and Role are required.')
      return
    }
    try {
      setLoading(true)
      const payload = {
        ...form,
        employee_id: form.employee_id?.trim() || null
      }
      const res = await fetch('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Failed to create user')
      }
      const data = await res.json()
      setSuccess(`User created with id ${data.id}`)
      setForm({ username: '', email: '', password: '', role: undefined, employee_id: '' })
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

  const openEdit = (user) => {
    setEditingUser(user)
    setEditForm({
      username: user.username || '',
      email: user.email || '',
      role: user.role || 'operator',
      employee_id: user.employee_id || ''
    })
    setEditError('')
    setShowEdit(true)
  }

  const onEditChange = (e) => {
    const { name, value } = e.target
    setEditForm((f) => ({ ...f, [name]: value }))
  }

  const onSubmitEdit = async (e) => {
    e.preventDefault()
    setEditError('')
    if (!editForm.username || !editForm.email || !editForm.role) {
      setEditError('Username, Email, and Role are required.')
      return
    }
    try {
      setEditLoading(true)
      const payload = {
        username: editForm.username.trim(),
        email: editForm.email.trim(),
        role: editForm.role,
        employee_id: editForm.employee_id?.trim() || null
      }
      const res = await fetch(`/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Failed to update user')
      }
      message.success('User updated successfully')
      fetchUsers()
      setShowEdit(false)
      setEditingUser(null)
      setEditForm({ username: '', email: '', role: 'operator', employee_id: '' })
    } catch (err) {
      setEditError(typeof err?.message === 'string' ? err.message : 'Failed to update user')
      message.error(typeof err?.message === 'string' ? err.message : 'Failed to update user')
    } finally {
      setEditLoading(false)
    }
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
    { 
      title: 'ID', 
      dataIndex: 'id', 
      key: 'id', 
      width: 80, 
      align: 'center',
      sorter: (a,b) => a.id - b.id
    },
    { 
      title: 'Username', 
      dataIndex: 'username', 
      key: 'username', 
      ellipsis: true,
      width: 150,
      sorter: (a,b) => String(a.username||'').localeCompare(String(b.username||''))
    },
    { 
      title: 'Employee ID', 
      dataIndex: 'employee_id', 
      key: 'employee_id', 
      ellipsis: true,
      width: 140,
      align: 'center',
      render: (text) => text ? <span>{text}</span> : <span style={{ color: '#999' }}>—</span>,
      sorter: (a,b) => String(a.employee_id||'').localeCompare(String(b.employee_id||''))
    },
    { 
      title: 'Email', 
      dataIndex: 'email', 
      key: 'email', 
      ellipsis: true,
      width: 200,
      sorter: (a,b) => String(a.email||'').localeCompare(String(b.email||''))
    },
    { 
      title: 'Role', 
      dataIndex: 'role', 
      key: 'role', 
      width: 120, 
      align: 'center',
      render: (r)=> {
        const role = r?.toUpperCase()
        const color = role === 'ADMIN' ? 'red' : 'blue'
        return <span style={{ 
          padding: '4px 8px', 
          borderRadius: '4px', 
          backgroundColor: color === 'red' ? '#ffebee' : '#e3f2fd',
          color: color === 'red' ? '#c62828' : '#1565c0',
          fontWeight: '600',
          fontSize: '12px'
        }}>{role}</span>
      }
    },
    { 
      title: 'Created', 
      dataIndex: 'created_at', 
      key: 'created_at', 
      width: 180, 
      align: 'center',
      render: (v)=> v ? new Date(v).toLocaleString() : '' 
    },
    { 
      title: 'Actions', 
      key: 'actions', 
      width: 200, 
      align: 'center',
      render: (_, row) => (
        <Space size="small">
          <Button 
            type="text" 
            icon={<EditOutlined />} 
            onClick={()=>openEdit(row)}
            title="Edit User"
            style={{ color: '#52c41a' }}
          />
          <Button 
            type="text" 
            icon={<LockOutlined />} 
            onClick={()=>openChangePassword(row)}
            title="Change Password"
            style={{ color: '#1890ff' }}
          />
          <Button 
            type="text" 
            danger 
            icon={<DeleteOutlined />} 
            onClick={()=>onDelete(row.id)}
            title="Delete User"
          />
        </Space>
      )
    }
  ], [])

  const filteredUsers = useMemo(() => {
    const term = (q || '').toLowerCase().trim()
    if (!term) return users
    return users.filter(u =>
      String(u.username||'').toLowerCase().includes(term) ||
      String(u.email||'').toLowerCase().includes(term) ||
      String(u.role||'').toLowerCase().includes(term)
    )
  }, [users, q])

  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    const end = start + pageSize
    return filteredUsers.slice(start, end)
  }, [filteredUsers, currentPage, pageSize])

  const handlePageChange = (page, size) => {
    setCurrentPage(page)
    setPageSize(size)
  }

  return (
    <div className="equipment-table-container">
      <div className="table-header">
        <h2>User Management</h2>
      </div>

      <div className="table-wrapper">
        <div className="table-controls">
          <div className="search-section">
            <Input.Search
              allowClear
              placeholder="Search by username, email, or role"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              onSearch={()=>{ setCurrentPage(1) }}
              style={{width: 320}}
            />
          </div>
          <div className="action-buttons">
            <Button icon={<ReloadOutlined />} onClick={fetchUsers}>Refresh</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={()=>{ setForm({ username:'', email:'', password:'', role: undefined, employee_id:'' }); setError(''); setSuccess(''); setShowCreate(true) }}>Create User</Button>
          </div>
        </div>

      <Modal
        title="Create a new user"
        open={showCreate}
        onCancel={()=>setShowCreate(false)}
        footer={null}
        destroyOnClose
        className="professional-modal"
        width={600}
      >
        <form onSubmit={onSubmit} autoComplete="off">
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label required">Username</label>
              <input
                className="form-input"
                id="username"
                name="username"
                autoComplete="off"
                value={form.username}
                onChange={onChange}
                placeholder="Enter username"
              />
            </div>
            <div className="form-field">
              <label className="form-label required">Email</label>
              <input
                className="form-input"
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={onChange}
                placeholder="Enter email address"
              />
            </div>
            <div className="form-field">
              <label className="form-label required">Password</label>
              <AntInput.Password
                className="form-input"
                id="password"
                name="password"
                autoComplete="new-password"
                value={form.password}
                onChange={onChange}
                placeholder="Enter password"
                visibilityToggle
              />
            </div>
            <div className="form-field">
              <label className="form-label required">Role</label>
              <Select 
                id="role" 
                value={form.role}
                placeholder="Select role"
                allowClear
                onChange={(v)=>setForm(f=>({...f, role:v}))} 
                options={[{value:'admin', label:'Admin'},{value:'operator', label:'Operator'}]}
                style={{ width: '100%' }}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Employee ID</label>
              <input
                className="form-input"
                id="employee_id"
                name="employee_id"
                value={form.employee_id}
                onChange={onChange}
                placeholder="Enter employee ID (optional)"
              />
            </div>
          </div>
          {error && <div className="form-error" style={{marginTop: 16, fontSize: 14}}>{error}</div>}
          {success && <div className="form-success" style={{marginTop: 16, fontSize: 14}}>{success}</div>}
          <div className="form-actions">
            <button
              type="button"
              className="form-button form-button-cancel"
              onClick={()=>setShowCreate(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`form-button form-button-primary ${loading ? 'loading' : ''}`}
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

        <div className="table-container">
          <Table
            columns={columns}
            dataSource={paginatedUsers}
            loading={usersLoading}
            pagination={false}
            bordered
            size="middle"
            className="ant-table-striped professional-table"
            rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-light' : 'table-row-dark')}
            scroll={{ x: 1000 }}
          />
        </div>

        <div className="pagination-container">
          <Pagination
            current={currentPage}
            total={filteredUsers.length}
            pageSize={pageSize}
            showSizeChanger
            showQuickJumper
            showTotal={(total, range) => `${range[0]}-${range[1]} of ${total} users`}
            onChange={handlePageChange}
            onShowSizeChange={handlePageChange}
            pageSizeOptions={['10', '20', '50', '100']}
          />
        </div>
      </div>

      <Modal
        title={`Edit User - ${editingUser?.username || ''}`}
        open={showEdit}
        onCancel={() => {
          setShowEdit(false)
          setEditingUser(null)
          setEditForm({ username: '', email: '', role: 'operator', employee_id: '' })
          setEditError('')
        }}
        footer={null}
        destroyOnClose
        className="professional-modal"
        width={600}
      >
        <form onSubmit={onSubmitEdit}>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label required">Username</label>
              <input
                className="form-input"
                id="edit_username"
                name="username"
                value={editForm.username}
                onChange={onEditChange}
                placeholder="Enter username"
              />
            </div>
            <div className="form-field">
              <label className="form-label required">Email</label>
              <input
                className="form-input"
                id="edit_email"
                name="email"
                type="email"
                value={editForm.email}
                onChange={onEditChange}
                placeholder="Enter email address"
              />
            </div>
            <div className="form-field">
              <label className="form-label required">Role</label>
              <Select 
                id="edit_role" 
                value={editForm.role} 
                onChange={(v)=>setEditForm(f=>({...f, role:v}))} 
                options={[{value:'admin', label:'Admin'},{value:'operator', label:'Operator'}]}
                style={{ width: '100%' }}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Employee ID</label>
              <input
                className="form-input"
                id="edit_employee_id"
                name="employee_id"
                value={editForm.employee_id}
                onChange={onEditChange}
                placeholder="Enter employee ID (optional)"
              />
            </div>
          </div>
          {editError && <div className="form-error" style={{marginTop: 16, fontSize: 14}}>{editError}</div>}
          <div className="form-actions">
            <button
              type="button"
              className="form-button form-button-cancel"
              onClick={() => {
                setShowEdit(false)
                setEditingUser(null)
                setEditForm({ username: '', email: '', role: 'operator', employee_id: '' })
                setEditError('')
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`form-button form-button-primary ${editLoading ? 'loading' : ''}`}
              disabled={editLoading}
            >
              {editLoading ? 'Updating...' : 'Update User'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        title={pwdModal.user ? `Change Password: ${pwdModal.user.username}` : 'Change Password'}
        open={pwdModal.open}
        onCancel={()=>setPwdModal({ open:false, user:null })}
        onOk={submitPasswordChange}
        okText="Update Password"
        className="professional-modal"
        width={500}
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
