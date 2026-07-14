import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { fetchJson } from '../utils/api';

const levelColors = {
  HIGH: 'var(--danger-color)',
  MEDIUM: 'var(--warning-color)',
  LOW: 'var(--success-color)',
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    fetchJson('/alerts?limit=50')
      .then((result) => setAlerts(result.alerts || []))
      .catch((error) => setLoadError(error.message || '알림을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="animate-fade-in" style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', paddingBottom: '100px' }}>
      <h1 style={{ fontSize: '28px', marginBottom: '8px' }}>알림 내역</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>시황 브리핑 및 등록된 선적 건의 리스크 경보를 확인하세요.</p>

      {loading && <EmptyState title="알림을 불러오고 있습니다..." />}
      {!loading && loadError && <EmptyState title={loadError} error />}
      {!loading && !loadError && alerts.length === 0 && <EmptyState title="아직 알림이 없습니다." description="선적 건 경보나 일일 브리핑이 생성되면 여기에 표시됩니다." />}

      {!loading && !loadError && alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {alerts.map((alert) => {
            const color = levelColors[alert.risk_level] || 'var(--primary-color)';
            return (
              <article key={alert.id} className="panel" style={{ padding: '24px', borderLeft: `4px solid ${color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '12px' }}>
                  <strong>{alert.title || '부킹 리스크 알림'}</strong>
                  <span style={{ color, fontSize: '12px', fontWeight: 700 }}>{alert.risk_level || alert.alert_type}</span>
                </div>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{alert.message}</p>
                <div style={{ marginTop: '14px', color: 'var(--text-muted)', fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <span>{alert.origin && alert.destination ? `${alert.origin} → ${alert.destination}` : alert.alert_type}</span>
                  <span>{formatDate(alert.sent_at || alert.created_at)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, description, error = false }) {
  return (
    <div className="panel" style={{ padding: '80px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', color: error ? 'var(--danger-color)' : 'var(--text-muted)' }}>
      <Bell size={48} style={{ marginBottom: '24px', opacity: 0.5 }} />
      <strong style={{ fontSize: '18px', marginBottom: '8px', color: error ? 'var(--danger-color)' : 'var(--text-primary)' }}>{title}</strong>
      {description && <p style={{ fontSize: '15px' }}>{description}</p>}
    </div>
  );
}

function formatDate(value) {
  if (!value) return '-';
  const parsed = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('ko-KR');
}
