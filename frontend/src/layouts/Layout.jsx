import React, { useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { HomeOutlined } from '@ant-design/icons'

export default function Layout() {
  const location = useLocation()
  const isLogin = location.pathname === '/'

  useEffect(() => {
    // Always force light theme
    document.documentElement.setAttribute('data-theme', 'light')
    localStorage.setItem('theme', 'light')
  }, [])

  return (
    <>
      {/* Optional simple top-left nav when NOT on the login page */}
      {!isLogin && (
        <div style={{ position: 'fixed', top: 16, left: 16 }}>
          <Link to="/" className="link" aria-label="Home" title="Home" style={{display:'inline-flex',alignItems:'center',gap:6}}>
            <HomeOutlined />
            <span>Home</span>
          </Link>
        </div>
      )}

      <Outlet />
    </>
  )
}
