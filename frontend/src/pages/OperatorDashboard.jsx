import React from 'react'
import { NavLink, Outlet } from 'react-router-dom'

export default function OperatorDashboard() {
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
          <NavLink to="tool-request" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Tool Request</NavLink>
          <NavLink to="calibration-report" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Calibration Report</NavLink>
        </nav>
      </aside>

      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  )
}
