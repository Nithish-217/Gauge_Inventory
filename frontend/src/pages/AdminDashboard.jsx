import React, { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { HomeOutlined, UserOutlined, TeamOutlined, AppstoreOutlined, CalendarOutlined, AimOutlined, FileTextOutlined, TagOutlined, MailOutlined } from '@ant-design/icons'

export default function AdminDashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [displayRole, setDisplayRole] = useState(() => {
    try { return localStorage.getItem('role') || 'admin' } catch { return 'admin' }
  })
  const [displayUsername, setDisplayUsername] = useState(() => {
    try { return localStorage.getItem('username') || 'user' } catch { return 'user' }
  })
  const onLogout = () => {
    try {
      localStorage.removeItem('role')
      localStorage.removeItem('username')
      localStorage.removeItem('userId')
    } catch {}
    navigate('/')
  }
  useEffect(() => {
    let abort = false
    const userId = (() => { try { return localStorage.getItem('userId') || '' } catch { return '' } })()
    if (!userId) return
    ;(async () => {
      try {
        const res = await fetch(`/users/${userId}`)
        if (!res.ok) return
        const user = await res.json()
        if (abort) return
        const username = (user?.username ?? '').toString().trim()
        const role = (user?.role ?? '').toString().toLowerCase()
        if (username) {
          setDisplayUsername(username)
          try { localStorage.setItem('username', username) } catch {}
        }
        if (role) {
          setDisplayRole(role)
          try { localStorage.setItem('role', role) } catch {}
        }
      } catch {}
    })()
    return () => { abort = true }
  }, [])
  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="cmti-logo" aria-label="CMTI logo"></div>
        </div>

        <nav className="menu">
          <NavLink to="create-user" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>
            <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
              <TeamOutlined />
              <span>User Management</span>
            </span>
          </NavLink>
          <NavLink
            to="gauge-inventory"
            className={({isActive}) => {
              const onAdminHome = location.pathname === '/admin'
              return `menu-item${(isActive || onAdminHome) ? ' active' : ''}`
            }}
          >
            <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
              <AppstoreOutlined />
              <span>Gauge Inventory</span>
            </span>
          </NavLink>
          <NavLink to="calibration-planner" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>
            <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
              <CalendarOutlined />
              <span>Calibration Planner</span>
            </span>
          </NavLink>
          <NavLink to="gauge-tracker" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>
            <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
              <AimOutlined />
              <span>Gauge Tracker</span>
            </span>
          </NavLink>
          <NavLink to="report-manager" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>
            <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
              <FileTextOutlined />
              <span>Report Manager</span>
            </span>
          </NavLink>
          <NavLink to="label-manager" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>
            <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
              <TagOutlined />
              <span>Label Manager</span>
            </span>
          </NavLink>
          <NavLink to="email-config" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>
            <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
              <MailOutlined />
              <span>Email Config</span>
            </span>
          </NavLink>
        </nav>
      </aside>

      <main className="admin-content">
        <div className="topbar">
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <button className="icon-btn" type="button" title="Home" onClick={()=>navigate('/admin')} aria-label="Admin Home">
              <HomeOutlined />
            </button>
            <div className="topbar-title">CMTI Gauge Management System</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div className="user-info-section">
              <div className="user-info-icon">
                <UserOutlined />
              </div>
              <div className="user-info-text">
                <span className="user-role">{(displayRole || 'admin').toUpperCase()}</span>
                <span className="user-separator"> · </span>
                <span className="user-name">{displayUsername || 'user'}</span>
              </div>
            </div>
            <button className="logout-btn" type="button" onClick={onLogout}>LOGOUT</button>
          </div>
        </div>
        <div style={{paddingTop:16}}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
