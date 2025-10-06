import React from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

export default function AdminDashboard() {
  const navigate = useNavigate()
  const onLogout = () => {
    try {
      localStorage.removeItem('role')
    } catch {}
    navigate('/')
  }
  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="cmti-logo" aria-hidden="true">CMTI</div>
          <div className="sidebar-title">Admin</div>
        </div>

        <nav className="menu">
          <NavLink to="create-user" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Create User</NavLink>
          <NavLink to="gauge-inventory" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Gauge Inventory</NavLink>
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
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12l9-9 9 9"/><path d="M9 21V9h6v12"/></svg>
            </button>
            <div className="topbar-title">CMTI Tool Management System</div>
          </div>
          <button className="logout-btn" type="button" onClick={onLogout}>LOGOUT</button>
        </div>
        <div style={{paddingTop:16}}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
