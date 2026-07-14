import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { fetchJson } from '../utils/api';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [form, setForm] = useState({
    origin: '부산',
    destination: '미주서안',
    booking_date: '2026-08-01',
    shipping_date: '2026-08-18',
    volume: '4',
    unit: 'FEU',
    incoterms: 'CIF',
    budget: '2800',
    current_quote: '',
    flexibility: '1주 이내 변경 가능',
    category: '일반화물',
  });

  function update(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError('');

    try {
      const result = await fetchJson('/shipments', { method: 'POST', body: JSON.stringify(form) });
      const shipmentId = result.id || result.shipment?.id;
      if (!shipmentId) throw new Error('생성된 선적 번호를 확인할 수 없습니다.');
      navigate(`/analysis/${shipmentId}`);
    } catch (error) {
      setSubmitError(error.message || '선적 건 등록에 실패했습니다.');
      setSubmitting(false);
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '14px 16px',
    background: 'var(--bg-color)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    color: 'var(--text-primary)',
    fontSize: '15px',
    marginTop: '8px',
    transition: 'border-color 0.2s',
  };

  const labelStyle = {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    fontWeight: '600'
  };

  return (
    <div className="animate-fade-in" style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', paddingBottom: '100px' }}>
      <h1 style={{ fontSize: '28px', marginBottom: '8px' }}>새 선적 건 등록</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>부킹 리스크 분석을 위해 선적 조건을 입력해주세요.</p>

      <form className="panel" style={{ padding: '32px' }} onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          <div>
            <label style={labelStyle}>출발지</label>
            <select name="origin" value={form.origin} onChange={update} style={inputStyle}>
              <option value="부산">부산</option>
              <option value="인천">인천</option>
              <option value="광양">광양</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>도착 권역</label>
            <select name="destination" value={form.destination} onChange={update} style={inputStyle}>
              <option value="미주서안">미주서안</option>
              <option value="미주동안">미주동안</option>
              <option value="유럽">유럽</option>
              <option value="동남아">동남아</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>희망 부킹일</label>
            <input type="date" name="booking_date" value={form.booking_date} onChange={update} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>선적 예정일</label>
            <input type="date" name="shipping_date" value={form.shipping_date} onChange={update} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>물량</label>
            <input type="number" name="volume" value={form.volume} onChange={update} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>단위</label>
            <select name="unit" value={form.unit} onChange={update} style={inputStyle}>
              <option value="FEU">FEU</option>
              <option value="TEU">TEU</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Incoterms</label>
            <select name="incoterms" value={form.incoterms} onChange={update} style={inputStyle}>
              <option value="CIF">CIF</option>
              <option value="FOB">FOB</option>
              <option value="CFR">CFR</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>기준 예산단가 (USD)</label>
            <input type="number" name="budget" value={form.budget} onChange={update} style={inputStyle} />
          </div>
          
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>납기 여유</label>
            <select name="flexibility" value={form.flexibility} onChange={update} style={inputStyle}>
              <option value="여유 없음">여유 없음</option>
              <option value="1주 이내 변경 가능">1주 이내 변경 가능</option>
              <option value="2주 이내 변경 가능">2주 이내 변경 가능</option>
            </select>
          </div>
        </div>
        
        {submitError && <p role="alert" style={{ marginTop: '24px', color: 'var(--danger-color)' }}>{submitError}</p>}

        <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ padding: '14px 32px', fontSize: '16px', opacity: submitting ? 0.7 : 1 }}>
            <CalendarDays size={22} />
            {submitting ? '등록 및 분석 준비 중...' : '리스크 분석하기'}
          </button>
        </div>
      </form>
    </div>
  );
}
