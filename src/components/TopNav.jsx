import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Bell, Moon, Sun, Activity } from 'lucide-react';

export default function TopNav({ theme, onToggleTheme }) {
  const location = useLocation();
  const links = [
    { path: '/register', label: '선적 건 등록' },
    { path: '/analysis', label: '리스크 분석' },
    { path: '/scenario', label: '시나리오 비교' },
  ];

  return (
    <header className="panel" style={{ borderRadius: 0, borderTop: 'none', borderLeft: 'none', borderRight: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: '72px', position: 'sticky', top: 0, zIndex: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '48px' }}>
        
        <NavLink to="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary-color)' }}>
          <Activity size={28} strokeWidth={2.5} />
          <span style={{ fontWeight: '800', fontSize: '20px', letterSpacing: '-0.5px' }}>PortPulse</span>
        </NavLink>
        
        <nav style={{ display: 'flex', gap: '24px' }}>
          {links.map(item => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <NavLink key={item.path} to={item.path} style={{
                color: isActive ? 'var(--primary-color)' : 'var(--text-secondary)',
                fontWeight: isActive ? '600' : '500',
                fontSize: '15px',
                position: 'relative',
                padding: '24px 0'
              }}>
                {item.label}
                {isActive && (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', background: 'var(--primary-color)', borderRadius: '3px 3px 0 0' }} />
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <NavLink to="/alerts" className="btn btn-outline" style={{ padding: '10px', borderRadius: '50%', position: 'relative' }}>
          <Bell size={20} />
          <span style={{ position: 'absolute', top: '10px', right: '10px', width: '8px', height: '8px', background: 'var(--danger-color)', borderRadius: '50%', border: '2px solid var(--bg-panel)' }}></span>
        </NavLink>
        
        <button onClick={onToggleTheme} className="btn btn-outline" style={{ padding: '10px', borderRadius: '50%' }}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>
    </header>
  );
}
