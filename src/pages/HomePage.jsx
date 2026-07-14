import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Plus, TrendingUp, DollarSign, ExternalLink } from 'lucide-react';
import { fetchJson, formatNumber, toPercent } from '../utils/api';

const fallbackMarket = {
  updatedAt: '2026-07-13',
  risk: 'LOW',
  kcciComposite: { label: 'KCCI 종합 지수', value: '4,318', change: '-0.28%', tone: 'good' },
  scfi: { label: 'SCFI 상하이 컨테이너 지수', value: '3,184.82', change: '-4.27%', tone: 'good' },
  exchange: { label: '원/달러 환율', value: '1,507.1원', change: '+0.19%', tone: 'bad' },
};

export default function HomePage() {
  const navigate = useNavigate();
  const [market, setMarket] = useState(fallbackMarket);
  const [shipments, setShipments] = useState([]);
  const [news, setNews] = useState([]);

  useEffect(() => {
    Promise.allSettled([fetchJson('/market-data'), fetchJson('/shipments'), fetchJson('/news?limit=3')]).then(([marketResult, shipmentsResult, newsResult]) => {
      if (marketResult.status === 'fulfilled') {
        const data = marketResult.value;
        setMarket({
          ...fallbackMarket,
          updatedAt: data.kcci?.composite?.recorded_date || data.exchange_rate?.recorded_date || fallbackMarket.updatedAt,
          kcciComposite: {
            ...fallbackMarket.kcciComposite,
            value: formatNumber(data.kcci?.composite?.value || data.kcci?.composite?.index_value) || fallbackMarket.kcciComposite.value,
            change: toPercent(data.kcci?.composite?.change_rate) || fallbackMarket.kcciComposite.change,
          },
          scfi: {
            ...fallbackMarket.scfi,
            value: formatNumber(data.scfi?.value || data.scfi?.index_value) || fallbackMarket.scfi.value,
            change: toPercent(data.scfi?.change_rate) || fallbackMarket.scfi.change,
          },
          exchange: {
            ...fallbackMarket.exchange,
            value: data.exchange_rate?.index_value ? `${formatNumber(data.exchange_rate.index_value)}원` : fallbackMarket.exchange.value,
            change: toPercent(data.exchange_rate?.change_rate) || fallbackMarket.exchange.change,
          },
        });
      }
      if (shipmentsResult.status === 'fulfilled') {
        const rows = shipmentsResult.value.shipments;
        if (Array.isArray(rows)) setShipments(rows);
      }
      if (newsResult.status === 'fulfilled' && Array.isArray(newsResult.value.news)) {
        setNews(newsResult.value.news.slice(0, 3));
      }
    });
  }, []);

  const overallRisk = shipments.some((item) => item.risk_level === 'HIGH' || item.risk_level === 'CRITICAL')
    ? 'HIGH'
    : shipments.some((item) => item.risk_level === 'MEDIUM') ? 'MEDIUM' : 'LOW';
  const overallRiskColor = overallRisk === 'HIGH' ? 'var(--danger-color)' : overallRisk === 'MEDIUM' ? 'var(--warning-color)' : 'var(--success-color)';

  return (
    <div className="animate-fade-in" style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto', paddingBottom: '100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '28px', marginBottom: '8px' }}>오늘의 해운 리스크: <span style={{ color: overallRiskColor }}>{overallRisk}</span></h1>
          <p style={{ color: 'var(--text-secondary)' }}>{market.updatedAt} 기준 종합 시황 브리핑</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/register')}>
          <Plus size={18} /> 새 선적 건 등록하기
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px', marginBottom: '40px' }}>
        <MetricCard icon={<TrendingUp size={24} />} item={market.kcciComposite} accent="var(--primary-color)" bg="rgba(79, 70, 229, 0.1)" />
        <MetricCard icon={<TrendingUp size={24} />} item={market.scfi} accent="var(--primary-color)" bg="rgba(79, 70, 229, 0.1)" />
        <MetricCard icon={<DollarSign size={24} />} item={market.exchange} accent="var(--warning-color)" bg="rgba(245, 158, 11, 0.1)" />
      </div>

      <h3 style={{ fontSize: '20px', marginBottom: '16px' }}>내 선적 건 모니터링</h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '40px' }}>
        {shipments.length === 0 && <div className="panel" style={{ padding: '32px', color: 'var(--text-muted)', textAlign: 'center' }}>등록된 선적 건이 없습니다.</div>}
        {shipments.map((shipment) => {
          const isHigh = shipment.risk_level === 'HIGH' || shipment.risk_level === 'CRITICAL';
          const statusColor = isHigh ? 'var(--danger-color)' : 'var(--warning-color)';
          return (
            <div key={shipment.id} className="panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', transition: 'transform 0.2s' }} onClick={() => navigate(`/analysis/${shipment.id}`)} onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <span style={{ padding: '6px 12px', background: 'var(--glass-bg)', border: '1px solid var(--border-color)', borderRadius: '100px', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '500' }}>
                    {shipment.shipping_date || '2026-08-18'} 선적 예정
                  </span>
                  <span style={{ padding: '6px 12px', background: `${statusColor}20`, color: statusColor, borderRadius: '100px', fontSize: '12px', fontWeight: 'bold' }}>
                    리스크 {shipment.risk_level || 'MEDIUM'}
                  </span>
                </div>
                <h4 style={{ fontSize: '18px', fontWeight: '600' }}>{shipment.origin || '부산'} → {shipment.destination || '미주서안'} <span style={{ color: 'var(--text-muted)', fontSize: '14px', marginLeft: '12px', fontWeight: '500' }}>{shipment.volume || 4} {shipment.unit || 'FEU'} · {shipment.incoterms || 'CIF'}</span></h4>
              </div>
              <div className="btn btn-outline" style={{ borderRadius: '50%', padding: '12px' }}>
                <ArrowRight size={20} />
              </div>
            </div>
          );
        })}
      </div>

      <h3 style={{ fontSize: '20px', marginBottom: '16px' }}>주요 해운 뉴스 리스크</h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {news.length === 0 && <div className="panel" style={{ padding: '32px', color: 'var(--text-muted)', textAlign: 'center' }}>수집된 해운 뉴스가 없습니다.</div>}
        {news.map((item) => (
          <a key={item.id || item.title} href={item.source_url || undefined} target={item.source_url ? '_blank' : undefined} rel="noreferrer" className="panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', transition: 'transform 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'translateX(6px)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'translateX(0)'}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <span style={{ padding: '4px 12px', background: 'rgba(79, 70, 229, 0.1)', color: 'var(--primary-color)', borderRadius: '6px', fontSize: '12px', fontWeight: '600' }}>
                  {item.category || '기타'}
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{item.published_date || '-'}</span>
              </div>
              <h4 style={{ fontSize: '16px', fontWeight: '600' }}>{item.title}</h4>
            </div>
            <div style={{ color: 'var(--text-muted)' }}>
              <ExternalLink size={20} />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ item, icon, accent, bg }) {
  const isBad = item.tone === 'bad';
  return (
    <div className="panel" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div style={{ padding: '12px', background: bg, borderRadius: '12px', color: accent }}>
          {icon}
        </div>
        <span style={{ color: isBad ? 'var(--danger-color)' : 'var(--success-color)', fontSize: '15px', fontWeight: 'bold' }}>{item.change}</span>
      </div>
      <h4 style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '8px' }}>{item.label}</h4>
      <p style={{ fontSize: '28px', fontWeight: '700' }}>{item.value}</p>
    </div>
  );
}
