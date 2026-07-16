// 자사 실적 통계 엔진 — 과거 선적 이력(history[])으로 이 회사만의 비용 구조를 뽑는다.
//  · 자사 운임 vs 시장(KCCI) 관계 → "너희는 KCCI pt당 얼마 내고 다녔다" → 오늘 지수로 공정가 투영
//  · 포워더 성적표(지연·견적초과·정시율)
//  · 자사 지불 추세 / 현재 예산이 자사 이력·시장 대비 어디쯤인지
// 순수 함수. history 원소는 company-input.mjs 파싱 결과 스키마.

const DAY = 86_400_000;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// 특정 날짜의 항로 지수(해당일 이하 최신 주간값)
function indexAt(series, targetIso) {
  if (!series?.length) return null;
  let v = series[0].value;
  for (const p of series) { if (p.date <= targetIso) v = p.value; else break; }
  return v;
}

/**
 * @param history   과거 실적 배열
 * @param routeSeries 해당 항로 KCCI 주간 시계열(오름차순)
 * @param currentIndex 현재 항로 지수
 */
export function companyStats(history, routeSeries, currentIndex) {
  const valid = (history ?? []).filter((h) => h.actualPaidAmount && h.containerCount);
  if (valid.length === 0) return { sampleSize: 0 };

  // 1) 자사 운임 vs KCCI 관계: perFEU 지불액 / 출항시점 지수 = "pt당 단가"
  const ratios = [];
  const perFeuList = [];
  for (const h of valid) {
    const perFeu = h.actualPaidAmount / h.containerCount;
    perFeuList.push({ date: h.actualDeparture || h.plannedEtd, perFeu });
    const idx = indexAt(routeSeries, h.actualDeparture || h.plannedEtd);
    if (idx) ratios.push(perFeu / idx);
  }
  const avgRatio = mean(ratios);                       // USD per KCCI pt(참고 지표)

  // 2) 자사 지불 추세(가장 오래된→최신 perFEU)
  const sorted = [...perFeuList].sort((a, b) => (a.date > b.date ? 1 : -1));
  const firstPerFeu = Math.round(sorted[0].perFeu);
  const lastPerFeu = Math.round(sorted.at(-1).perFeu);
  const lastDate = sorted.at(-1).date;
  const paidTrendPct = firstPerFeu ? Number(((lastPerFeu / firstPerFeu - 1) * 100).toFixed(1)) : null;

  // 시장연동 공정가: "가장 최근 실거래가 × (현재지수/그때지수)" — like-for-like로 오늘 환산.
  // pt당 단가 곱(avgRatio×현재지수)보다 노이즈가 적고 직관적이라 이걸 헤드라인 공정가로 쓴다.
  const idxAtLast = indexAt(routeSeries, lastDate);
  const marketAdjustedFairPerFeu =
    idxAtLast && currentIndex ? Math.round(lastPerFeu * (currentIndex / idxAtLast)) : null;
  const indexChangeSinceLastPct =
    idxAtLast && currentIndex ? Number(((currentIndex / idxAtLast - 1) * 100).toFixed(1)) : null;
  const projectedFairPerFeu = marketAdjustedFairPerFeu; // 헤드라인 공정가

  // 3) 포워더 성적표
  const byFwd = {};
  for (const h of valid) {
    const f = h.forwarder || "미상";
    (byFwd[f] ??= []).push(h);
  }
  const forwarders = Object.entries(byFwd).map(([name, rows]) => {
    const delays = rows.filter((r) => r.actualArrival && r.plannedEta).map((r) => daysBetween(r.plannedEta, r.actualArrival));
    const overruns = rows.filter((r) => r.quotedAmount).map((r) => (r.actualPaidAmount / r.quotedAmount - 1) * 100);
    const onTime = delays.filter((d) => d <= 1).length;
    return {
      forwarder: name, shipments: rows.length,
      carriers: [...new Set(rows.map((r) => r.carrier).filter(Boolean))],
      avgDelayDays: delays.length ? Number(mean(delays).toFixed(1)) : null,
      avgQuoteOverrunPct: overruns.length ? Number(mean(overruns).toFixed(1)) : null,
      onTimeRate: delays.length ? Math.round((onTime / delays.length) * 100) : null,
      avgTransship: Number(mean(rows.map((r) => r.transshipments ?? 0)).toFixed(1)),
    };
  }).sort((a, b) => b.shipments - a.shipments);

  return {
    sampleSize: valid.length,
    lane: `${valid[0].pol}→${valid[0].pod}`,
    equipment: valid[0].equipment,
    usdPerKcciPt: avgRatio ? Number(avgRatio.toFixed(2)) : null,
    projectedFairPerFeu,                                 // 시장연동 공정가/FEU(헤드라인)
    marketAdjustedFairPerFeu, indexChangeSinceLastPct, lastShipmentDate: lastDate,
    historicalPerFeu: { first: firstPerFeu, last: lastPerFeu, trendPct: paidTrendPct },
    forwarders,
  };
}

// 현재 선적 예산이 자사 이력·시장 대비 어디쯤인지
export function budgetContext(current, companySt, spotPerFeuNow) {
  if (!current?.budgetAmount || !current?.containerCount) return null;
  const budgetPerFeu = Math.round(current.budgetAmount / current.containerCount);
  const proj = companySt?.projectedFairPerFeu ?? null;
  const hist = companySt?.historicalPerFeu?.last ?? null;
  return {
    budgetTotal: current.budgetAmount,
    budgetPerFeu,
    vsProjectedPct: proj ? Number(((budgetPerFeu / proj - 1) * 100).toFixed(1)) : null,
    vsLastPaidPct: hist ? Number(((budgetPerFeu / hist - 1) * 100).toFixed(1)) : null,
    vsSpotNowPct: spotPerFeuNow ? Number(((budgetPerFeu / spotPerFeuNow - 1) * 100).toFixed(1)) : null,
  };
}
