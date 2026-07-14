import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { Shield, TrendingUp, DollarSign, CalendarDays, Bell } from 'lucide-react';
import { fetchJson, formatNumber } from '../utils/api';

const levelColors = {
  HIGH: 'var(--danger-color)',
  CRITICAL: 'var(--danger-color)',
  MEDIUM: 'var(--warning-color)',
  LOW: 'var(--success-color)',
};

export default function AnalysisPage() {
  const { shipmentId } = useParams();
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        if (!shipmentId) {
          const result = await fetchJson('/shipments');
          const latest = result.shipments?.at(-1);
          if (!latest) throw new Error('먼저 선적 건을 등록해주세요.');
          navigate(`/analysis/${latest.id}`, { replace: true });
          return;
        }

        const result = await fetchJson(`/risk-analysis/${shipmentId}`);
        if (active) setAnalysis(result);
      } catch (error) {
        if (active) setLoadError(error.message || '리스크 분석을 불러오지 못했습니다.');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, [shipmentId, navigate]);

  if (loading) return <PageState title="등록된 선적 건을 분석하고 있습니다..." />;
  if (loadError) return <PageState title={loadError} error />;

  const shipment = analysis?.shipment || {};
  const budgetImpact = analysis?.budget_impact || {};
  const causes = analysis?.causes || [];
  const recommendations = analysis?.recommendations || [];
  const riskLevel = analysis?.risk_level || 'MEDIUM';
  const riskColor = levelColors[riskLevel] || 'var(--warning-color)';

  return (
    <div className="animate-fade-in" style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto', paddingBottom: '100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '28px', marginBottom: '8px' }}>리스크 분석 결과</h1>
          <p style={{ color: 'var(--text-secondary)' }}>등록한 선적 조건과 최신 시장 데이터 기준 종합 판단입니다.</p>
        </div>
        <NavLink to={`/scenario/${shipmentId}`} className="btn btn-outline">
          시나리오 비교하기
        </NavLink>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: '24px', marginBottom: '24px' }}>
        <div className="panel" style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <Shield size={64} color={riskColor} style={{ marginBottom: '16px' }} />
          <span style={{ fontSize: '16px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: '600' }}>종합 리스크 등급</span>
          <strong style={{ fontSize: '48px', color: riskColor, lineHeight: '1', marginBottom: '16px' }}>{riskLevel}</strong>
          <div style={{ background: 'var(--glass-bg)', padding: '12px 24px', borderRadius: '100px', fontSize: '15px', border: '1px solid var(--border-color)', marginBottom: '24px' }}>
            점수: <strong style={{ color: 'var(--primary-color)' }}>{analysis?.risk_score ?? '-'} / 100</strong>
          </div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', maxWidth: '520px' }}>{analysis?.summary}</p>
        </div>

        <div className="panel" style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <h2 style={{ fontSize: '18px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>입력 조건 요약</h2>
          <Info label="항로" value={`${shipment.origin || '-'} → ${shipment.destination || '-'}`} />
          <Info label="희망 부킹일" value={shipment.booking_date || '-'} />
          <Info label="선적 예정일" value={shipment.shipping_date || '-'} />
          <Info label="물량 및 조건" value={`${shipment.volume || '-'} ${shipment.unit || ''} / ${shipment.incoterms || '-'}`} />
          <Info label="기준 예산" value={shipment.budget_per_unit ? `$${formatNumber(shipment.budget_per_unit)} / ${shipment.unit}` : '-'} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: '24px' }}>
        <div className="panel" style={{ padding: '32px' }}>
          <h2 style={{ fontSize: '20px', marginBottom: '24px' }}>주요 리스크 원인</h2>
          {causes.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {causes.map((cause, index) => (
                <Cause key={`${cause.title}-${index}`} icon={causeIcon(index)} title={cause.title} text={cause.description} color={levelColors[cause.severity] || 'var(--primary-color)'} />
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-muted)' }}>현재 확인된 추가 리스크 원인이 없습니다.</p>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="panel" style={{ padding: '24px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <h2 style={{ fontSize: '16px', color: 'var(--danger-color)', marginBottom: '12px' }}>예산 영향</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '16px' }}>{budgetImpact.explanation || '예산 영향 데이터가 없습니다.'}</p>
            <strong style={{ fontSize: '18px' }}>예상 초과 부담: ${formatNumber(budgetImpact.estimated_excess_amount || 0)}</strong>
          </div>
          <div className="panel" style={{ padding: '24px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
            <h2 style={{ fontSize: '16px', color: 'var(--success-color)', marginBottom: '12px' }}>추천 행동</h2>
            <ul style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6', paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recommendations.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'right' }}>분석 근거: {(analysis?.data_sources || []).join(', ') || '-'}</p>
        </div>
      </div>
    </div>
  );
}

function PageState({ title, error = false }) {
  return (
    <div className="panel" style={{ margin: '80px auto', maxWidth: '720px', padding: '64px', textAlign: 'center', color: error ? 'var(--danger-color)' : 'var(--text-secondary)' }}>
      {title}
    </div>
  );
}

function Info({ label, value }) {
  return <div><span style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>{label}</span><strong>{value}</strong></div>;
}

function Cause({ icon, title, text, color }) {
  return (
    <div style={{ display: 'flex', gap: '16px' }}>
      <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: `${color}15`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
      <div><strong style={{ display: 'block', marginBottom: '6px' }}>{title}</strong><p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>{text}</p></div>
    </div>
  );
}

function causeIcon(index) {
  const icons = [<TrendingUp key="trend" />, <DollarSign key="dollar" />, <CalendarDays key="calendar" />, <Bell key="bell" />];
  return icons[index % icons.length];
}
