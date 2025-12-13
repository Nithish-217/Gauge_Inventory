import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import 'antd/dist/reset.css'
import { ConfigProvider, theme } from 'antd'
import Layout from './layouts/Layout.jsx'
import App from './App.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import OperatorDashboard from './pages/OperatorDashboard.jsx'
import OperatorGaugeInventory from './pages/operator/GaugeInventory.jsx'
import OperatorGaugeTracker from './pages/operator/GaugeTracker.jsx'
import ToolRequest from './pages/operator/ToolRequest.jsx'
import CalibrationReport from './pages/operator/CalibrationReport.jsx'
import GaugeInventory from './pages/admin/GaugeInventory.jsx'
import CalibrationPlanner from './pages/admin/CalibrationPlanner.jsx'
import GaugeTracker from './pages/admin/GaugeTracker.jsx'
import ReportManager from './pages/admin/ReportManager.jsx'
import EmailConfig from './pages/admin/EmailConfig.jsx'
import LabelManager from './pages/admin/LabelManager.jsx'
import CreateUser from './pages/admin/CreateUser.jsx'
import AdminHome from './pages/admin/Home.jsx'

// Default API base for backend requests from admin pages
try {
  if (typeof window !== 'undefined') {
    // Only set if not already provided elsewhere
    window.__API_BASE__ = window.__API_BASE__ || 'http://localhost:5657'
  }
} catch {}

const root = createRoot(document.getElementById('root'))
root.render(
  <React.StrictMode>
    <ConfigProvider 
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
        },
      }}
    >
      <BrowserRouter>
        <Routes future={{ v7_relativeSplatPath: true }}>
          <Route path="/" element={<Layout />}> 
            <Route index element={<App />} />
            <Route path="admin" element={<AdminDashboard />} >
              <Route index element={<Navigate to="gauge-inventory" replace />} />
              <Route path="create-user" element={<CreateUser />} />
              <Route path="gauge-inventory" element={<GaugeInventory />} />
              <Route path="calibration-planner" element={<CalibrationPlanner />} />
              <Route path="gauge-tracker" element={<GaugeTracker />} />
              <Route path="report-manager" element={<ReportManager />} />
              <Route path="label-manager" element={<LabelManager />} />
              <Route path="email-config" element={<EmailConfig />} />
            </Route>
            <Route path="operator" element={<OperatorDashboard />} >
              <Route index element={<Navigate to="gauge-inventory" replace />} />
              <Route path="gauge-inventory" element={<OperatorGaugeInventory />} />
              <Route path="gauge-tracker" element={<OperatorGaugeTracker />} />
              <Route path="tool-request" element={<ToolRequest />} />
              <Route path="calibration-report" element={<CalibrationReport />} />
            </Route>
            <Route path="dev" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
)
