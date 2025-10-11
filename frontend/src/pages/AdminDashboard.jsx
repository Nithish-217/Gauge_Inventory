import React, { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { HomeOutlined, UserOutlined } from '@ant-design/icons'

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
          <NavLink to="create-user" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Create User</NavLink>
          <NavLink
            to="gauge-inventory"
            className={({isActive}) => {
              const onAdminHome = location.pathname === '/admin'
              return `menu-item${(isActive || onAdminHome) ? ' active' : ''}`
            }}
          >
            Gauge Inventory
          </NavLink>
          <NavLink to="calibration-planner" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Calibration Planner</NavLink>
          <NavLink to="gauge-tracker" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Gauge Tracker</NavLink>
          <NavLink to="report-manager" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Report Manager</NavLink>
          <NavLink to="label-manager" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Label Manager</NavLink>
        </nav>
      </aside>

      <main className="admin-content">
        <div className="topbar">
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <button className="icon-btn" type="button" title="Home" onClick={()=>navigate('/admin')} aria-label="Admin Home">
              <HomeOutlined />
            </button>
            <div className="topbar-title">CMTI Tool Management System</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{display:'flex',alignItems:'center',gap:6,color:'#555'}}>
              <UserOutlined />
              <span style={{fontSize:13}}>
                {(displayRole || 'admin').toUpperCase()} · {(displayUsername || 'user')}
              </span>
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
