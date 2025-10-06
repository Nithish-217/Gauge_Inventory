import React from 'react'
import { NavLink, Outlet } from 'react-router-dom'

export default function AdminDashboard() {
  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="cmti-logo" aria-hidden="true">CMTI</div>
          <div className="sidebar-title">Admin</div>
        </div>

        <nav className="menu">
          <NavLink to="gauge-inventory" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Gauge Inventory</NavLink>
          <NavLink to="calibration-planner" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Calibration Planner</NavLink>
          <NavLink to="gauge-tracker" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Gauge Tracker</NavLink>
          <NavLink to="report-manager" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Report Manager</NavLink>
          <NavLink to="label-manager" className={({isActive}) => `menu-item${isActive ? ' active' : ''}`}>Label Manager</NavLink>
        </nav>
      </aside>

      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  )
}
