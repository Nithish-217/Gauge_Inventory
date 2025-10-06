import React from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

export default function OperatorDashboard() {
  const navigate = useNavigate()
  const onLogout = () => {
    try { localStorage.removeItem('role') } catch {}
    navigate('/')
  }
  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="cmti-logo" aria-hidden="true">CMTI</div>
          <div className="sidebar-title">Operator</div>
        </div>

        <nav className="menu">
          <NavLink end to="" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Home</NavLink>
          <NavLink to="gauge-inventory" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Gauge Inventory</NavLink>
          <NavLink to="calibration-report" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Calibration Report</NavLink>
        </nav>
      </aside>

      <main className="admin-content">
        <div className="topbar">
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <button className="icon-btn" type="button" title="Home" onClick={()=>navigate('/operator')} aria-label="Operator Home">
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
