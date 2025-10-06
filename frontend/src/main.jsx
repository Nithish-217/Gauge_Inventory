import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import Layout from './layouts/Layout.jsx'
import App from './App.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import OperatorDashboard from './pages/OperatorDashboard.jsx'
import OperatorHome from './pages/operator/Home.jsx'
import OperatorGaugeInventory from './pages/operator/GaugeInventory.jsx'
import ToolRequest from './pages/operator/ToolRequest.jsx'
import CalibrationReport from './pages/operator/CalibrationReport.jsx'
import GaugeInventory from './pages/admin/GaugeInventory.jsx'
import CalibrationPlanner from './pages/admin/CalibrationPlanner.jsx'
import GaugeTracker from './pages/admin/GaugeTracker.jsx'
import ReportManager from './pages/admin/ReportManager.jsx'
import LabelManager from './pages/admin/LabelManager.jsx'

const root = createRoot(document.getElementById('root'))
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}> 
          <Route index element={<App />} />
          <Route path="admin" element={<AdminDashboard />} >
            <Route index element={<div style={{padding:24}}><h2>Admin Home</h2><p>Select a menu item to continue.</p></div>} />
            <Route path="gauge-inventory" element={<GaugeInventory />} />
            <Route path="calibration-planner" element={<CalibrationPlanner />} />
            <Route path="gauge-tracker" element={<GaugeTracker />} />
            <Route path="report-manager" element={<ReportManager />} />
            <Route path="label-manager" element={<LabelManager />} />
          </Route>
          <Route path="operator" element={<OperatorDashboard />} >
            <Route index element={<OperatorHome />} />
            <Route path="gauge-inventory" element={<OperatorGaugeInventory />} />
            <Route path="tool-request" element={<ToolRequest />} />
            <Route path="calibration-report" element={<CalibrationReport />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
