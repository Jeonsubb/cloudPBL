import React, { useEffect, useState } from 'react';
import { XCircle, CheckCircle2, Bell, RefreshCw } from 'lucide-react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { fetchJson, formatNumber } from '../utils/api';

export default function ScenarioPage() {
  const { shipmentId } = useParams();
  const navigate = useNavigate();
  const [shipment, setShipment] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const shipmentsResult = await fetchJson('/shipments');
        const rows = shipmentsResult.shipments || [];
        const current = shipmentId ? rows.find((item) => String(item.id) === String(shipmentId)) : rows.at(-1);
        if (!current) throw new Error('시나리오를 비교할 선적 건이 없습니다.');

        if (!shipmentId) {
          navigate(`/scenario/${current.id}`, { replace: true });
          return;
        }

        const definitions = createScenarioDefinitions(current);
        const settled = await Promise.allSettled(
          definitions.map((definition) => analyzeScenarioWithRetry(current.id, definition)),
        );
        const results = settled.map((result, index) => {
          if (result.status === 'fulfilled') return result.value;
          return {
            ...definitions[index],
            risk_level: 'ERROR',
            risk_score: '-',
            summary: result.reason?.message || '시나리오 분석에 실패했습니다.',
            recommendations: [],
            error: true,
          };
        });
        if (active) {
          setShipment(current);
          setCards(results);
        }
      } catch (error) {
        if (active) setLoadError(error.message || '시나리오 분석을 불러오지 못했습니다.');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, [shipmentId, navigate]);

  async function refreshScenario(card) {
    setRefreshing(card.key);
    try {
      const refreshed = await analyzeScenarioWithRetry(shipment.id, card);
      setCards((current) => current.map((item) => item.key === card.key ? refreshed : item));
    } catch (error) {
      setLoadError(error.message || '재분석에 실패했습니다.');
    } finally {
      setRefreshing('');
    }
  }

  if (loading) return <PageState text="4가지 부킹 시나리오를 분석하고 있습니다..." />;
  if (loadError && !shipment) return <PageState text={loadError} error />;
  if (!shipment) return <PageState text="선적 정보로 이동하고 있습니다..." />;

  return (
    <div className="animate-fade-in" style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto', paddingBottom: '100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px', marginBottom: '8px' }}>
        <h1 style={{ fontSize: '28px' }}>시나리오 비교</h1>
        <NavLink className="btn btn-outline" to={`/analysis/${shipmentId}`}>기준 분석으로 돌아가기</NavLink>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>부킹일과 선적일을 바꿘 실제 Lambda 분석 결과를 비교합니다.</p>
      {loadError && <p role="alert" style={{ color: 'var(--danger-color)', marginBottom: '20px' }}>{loadError}</p>}

      <div className="panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '40px' }}>
        <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: '600' }}>기준 조건</span>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {[`${shipment.origin} → ${shipment.destination}`, `${shipment.shipping_date} 선적`, `${shipment.volume} ${shipment.unit}`, shipment.incoterms, `$${formatNumber(shipment.budget_per_unit)}`].map((item) => (
            <span key={item} style={{ padding: '6px 16px', background: 'var(--glass-bg)', border: '1px solid var(--border-color)', borderRadius: '100px', fontSize: '14px', fontWeight: '600' }}>{item}</span>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px' }}>
        {cards.map((card) => {
          const tone = toneForLevel(card.risk_level);
          const isCurrent = card.key === 'current';
          return (
            <div key={card.key} className="panel" style={{ padding: '32px', display: 'flex', flexDirection: 'column', position: 'relative', border: isCurrent ? '2px solid var(--primary-color)' : '1px solid var(--border-color)' }}>
              {isCurrent && <span style={{ position: 'absolute', top: '-12px', left: '24px', background: 'var(--primary-color)', color: 'white', padding: '4px 12px', borderRadius: '100px', fontSize: '12px', fontWeight: 'bold' }}>기준 시나리오</span>}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start', marginBottom: '18px', marginTop: isCurrent ? '12px' : '0' }}>
                <h2 style={{ fontSize: '20px' }}>{card.title}</h2>
                <RiskBadge level={card.risk_level} tone={tone} />
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '14px' }}>부킹 {card.overrides.booking_date} / 선적 {card.overrides.shipping_date}</p>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '18px', flex: 1 }}>{card.summary}</p>
              <strong style={{ color: colorForTone(tone), marginBottom: '16px' }}>{card.risk_score} / 100</strong>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '24px', paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                {(card.recommendations || []).slice(0, 2).map((point) => <li key={point}>{point}</li>)}
              </ul>
              <button disabled={refreshing === card.key} onClick={() => refreshScenario(card)} className={isCurrent ? 'btn btn-primary' : 'btn btn-outline'} style={{ width: '100%' }}>
                <RefreshCw size={16} /> {refreshing === card.key ? '재분석 중...' : '이 조건 재분석'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function createScenarioDefinitions(shipment) {
  const today = new Date();
  const shipping = parseDate(shipment.shipping_date);
  return [
    { key: 'current', title: '현재 등록 조건', overrides: { booking_date: shipment.booking_date || formatDate(today), shipping_date: shipment.shipping_date } },
    { key: 'now', title: '오늘 부킹', overrides: { booking_date: formatDate(today), shipping_date: shipment.shipping_date } },
    { key: 'week', title: '1주 뒤 부킹', overrides: { booking_date: formatDate(addDays(today, 7)), shipping_date: shipment.shipping_date } },
    { key: 'early', title: '선적일 1주 앞당김', overrides: { booking_date: formatDate(today), shipping_date: formatDate(addDays(shipping, -7)) } },
  ];
}

async function analyzeScenario(shipmentId, definition) {
  const result = await fetchJson(`/risk-analysis/${shipmentId}`, { method: 'POST', body: JSON.stringify(definition.overrides) });
  return { ...definition, ...result };
}

async function analyzeScenarioWithRetry(shipmentId, definition) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await analyzeScenario(shipmentId, definition);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

function parseDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toneForLevel(level) {
  if (level === 'HIGH' || level === 'CRITICAL') return 'danger';
  if (level === 'LOW') return 'success';
  return 'warning';
}

function colorForTone(tone) {
  return `var(--${tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'warning'}-color)`;
}

function RiskBadge({ level, tone }) {
  const Icon = tone === 'danger' ? XCircle : tone === 'success' ? CheckCircle2 : Bell;
  const color = colorForTone(tone);
  return <span style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: `${color}15`, color, borderRadius: '100px', fontSize: '12px', fontWeight: 'bold' }}><Icon size={16} />{level}</span>;
}

function PageState({ text, error = false }) {
  return <div className="panel" style={{ margin: '80px auto', maxWidth: '720px', padding: '64px', textAlign: 'center', color: error ? 'var(--danger-color)' : 'var(--text-secondary)' }}>{text}</div>;
}
