import React, { useEffect, useMemo, useState } from 'react';
import { fetchJson, formatNumber, toPercent } from '../utils/api';

export default function MarketTicker() {
  const [market, setMarket] = useState(null);

  useEffect(() => {
    fetchJson('/market-data').then(setMarket).catch(() => undefined);
  }, []);

  const items = useMemo(
    () => {
      if (!market) return [['시황 데이터 로딩 중', 'var(--text-secondary)']];
      const kcci = market.kcci?.composite;
      const exchange = market.exchange_rate;
      const routeLabels = { us_west: '미주서안', us_east: '미주동안', europe: '유럽', sea: '동남아' };
      const routeItems = (market.kcci?.routes || [])
        .filter((route) => routeLabels[route.route])
        .map((route) => [`KCCI ${routeLabels[route.route]} ${formatNumber(route.index_value)}`, tone(route.change_rate), toPercent(route.change_rate)]);
      return [
        [`Updated ${kcci?.recorded_date || exchange?.recorded_date || '-'}`, 'var(--text-secondary)'],
        kcci ? [`KCCI ${formatNumber(kcci.index_value)}`, tone(kcci.change_rate), toPercent(kcci.change_rate)] : null,
        market.scfi ? [`SCFI ${formatNumber(market.scfi.index_value)}`, tone(market.scfi.change_rate), toPercent(market.scfi.change_rate)] : null,
        exchange ? [`환율 (USD/KRW) ${formatNumber(exchange.index_value)}`, tone(exchange.change_rate, true), toPercent(exchange.change_rate)] : null,
        ...routeItems,
      ].filter(Boolean);
    },
    [market],
  );

  return (
    <>
      <style>
        {`
          @keyframes tickerScroll {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
        `}
      </style>
      <div className="panel" style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '48px',
        borderRadius: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: 'none',
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        zIndex: 30,
        whiteSpace: 'nowrap'
      }}>
        <div style={{
          display: 'flex',
          animation: 'tickerScroll 30s linear infinite',
          paddingLeft: '100%'
        }}>
          {[...items, ...items].map(([label, color, change], index) => (
            <div key={index} style={{ display: 'inline-flex', alignItems: 'center', padding: '0 24px', fontSize: '13px', fontWeight: '500' }}>
              <span style={{ color: 'var(--text-primary)' }}>{label}</span>
              {change && <span style={{ color, marginLeft: '8px', fontWeight: '600' }}>{change}</span>}
              <span style={{ color: 'var(--border-color)', margin: '0 24px' }}>|</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function tone(value, inverse = false) {
  const isPositive = Number(value) >= 0;
  const isBad = inverse ? isPositive : !isPositive;
  return isBad ? 'var(--danger-color)' : 'var(--success-color)';
}
