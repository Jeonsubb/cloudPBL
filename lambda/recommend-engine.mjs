// 추천 엔진(순수 계산부) — 회사 데이터 + 시장 시계열 + 실제 스케줄을 하나의 "브리프"로 합친다.
// 여기서 모든 숫자를 확정한다. Bedrock은 이 브리프를 받아 '서사(추천문)'만 쓴다(숫자 창작 금지).
// 브리프는 Bedrock 없이도 프론트가 렌더 가능한 자족적 객체이기도 하다.

import { resolveRoute } from "./route-map.mjs";
import { generateSailings } from "./schedule-gen.mjs";
import { marketStats, fxStats } from "./market-stats.mjs";
import { companyStats, budgetContext } from "./company-stats.mjs";

const DAY = 86_400_000;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);
const addDays = (iso, n) => new Date(new Date(iso).getTime() + n * DAY).toISOString().slice(0, 10);

// 스케줄 조회 구간(ETD 기준) — 화물준비 1주 전 ~ 납기 이후 3주까지.
// buildBrief 내부와, 호출부(recommend.mjs)가 실제 스케줄 DB를 미리 쿼리할 때 동일 기준을 쓰도록 export.
export function scheduleWindow(current) {
  return { from: addDays(current.cargoReadyDate, -7), to: addDays(current.requiredDeliveryDate, 21) };
}

/**
 * @param input.policy   회사 정책 행
 * @param input.current  현재 선적 행
 * @param input.history  과거 실적 배열
 * @param input.kcci     { series: { [routeCode]: [{date,value}], KCCI: [...] }, compositeNow }
 * @param input.fx       { USD: [{date,value}], ... }  (선택)
 * @param input.baseRate [{date,value}] 기준금리 (선택)
 * @param input.schedule 실제 스케줄(사전 조회, ETD 오름차순) — 없으면(null/undefined) synthetic 생성으로 폴백
 * @param input.asOf     기준일 ISO(KST)
 */
export function buildBrief(input) {
  const { policy, current, history, kcci, fx, baseRate, schedule, asOf } = input;
  const route = resolveRoute(current.pol, current.pod);
  const routeSeries = route.routeCode ? kcci.series[route.routeCode] : null;
  const currentIndex = routeSeries?.at(-1)?.value ?? null;

  const buffer = Number(policy?.minDeliveryBufferDays ?? 5);
  const maxTs = Number(policy?.preferredMaxTransshipments ?? 1);
  const feu = Number(current.containerCount || 1);
  const budgetPerFeu = current.budgetAmount ? Math.round(current.budgetAmount / feu) : null;

  // ── 시장 통계
  const market = routeSeries ? marketStats(routeSeries) : null;
  const composite = kcci.series.KCCI ? marketStats(kcci.series.KCCI) : null;
  const fxUsd = fx?.USD ? fxStats(fx.USD) : null;
  const rate = baseRate?.at(-1) ?? null;

  // ── 스케줄: 실제 스케줄(schedule)이 있으면 그대로 쓰고, 없으면(미커버 항로 등) synthetic 생성으로 폴백
  const { from: windowFrom, to: windowTo } = scheduleWindow(current);
  const sailingsAll = schedule?.length
    ? schedule
    : route.routeCode
      ? generateSailings(route.routeCode, { fromIso: windowFrom, toIso: windowTo, routeSeries })
      : [];

  // 화물 준비일 이후 출항 가능한 것만(그 전엔 못 실음)
  const boardable = sailingsAll.filter((s) => s.etd >= current.cargoReadyDate);
  const deadlineLatestEta = addDays(current.requiredDeliveryDate, -buffer);

  const candidates = boardable.map((s) => {
    const deliveryBuffer = daysBetween(s.eta, current.requiredDeliveryDate);
    const meetsRequired = s.eta <= current.requiredDeliveryDate;   // 하드 납기(반드시)
    const meetsBuffer = s.eta <= deadlineLatestEta;                 // 선호 버퍼까지 충족
    const withinTs = (s.direct ? 0 : 1) <= maxTs;
    const perFeu = s.priceUSD;
    return {
      ...s,
      totalUSD: perFeu * feu,
      deliveryBufferDays: deliveryBuffer,
      meetsRequired, meetsBuffer,
      bufferShortfallDays: meetsRequired && !meetsBuffer ? buffer - deliveryBuffer : 0,
      withinTsPref: withinTs,
      feasible: meetsRequired && withinTs,     // 하드 납기 + 환적선호 충족 = 실현가능
      comfortable: meetsBuffer && withinTs,    // 버퍼까지 여유
      vsBudgetPct: budgetPerFeu ? Number(((perFeu / budgetPerFeu - 1) * 100).toFixed(1)) : null,
    };
  });

  const feasible = candidates.filter((c) => c.feasible);
  const comfortable = candidates.filter((c) => c.comfortable);
  const cheapestFeasible = [...feasible].sort((a, b) => a.priceUSD - b.priceUSD)[0] ?? null;
  const earliestFeasible = [...feasible].sort((a, b) => a.etd.localeCompare(b.etd))[0] ?? null;
  const spotPerFeuNow = candidates[0]?.priceUSD ?? currentIndex; // 근시일 대표가

  // ── 자사 통계 + 예산 맥락
  const companySt = companyStats(history, routeSeries, currentIndex);
  const budgetCtx = budgetContext(current, companySt, spotPerFeuNow);

  // ── 타이밍 판독(부드러운 휴리스틱 — Bedrock 서사의 출발점, 강제 아님)
  const timing = readTiming({ market, feasible, candidates, deadlineLatestEta, current, buffer });

  return {
    asOf,
    company: policy?.companyName ?? "회사",
    shipment: {
      id: current.shipmentId, orderRef: current.orderRef, customer: current.customerName,
      lane: `${route.polLabel?.name ?? current.pol}→${route.podLabel?.name ?? current.pod}`,
      routeCode: route.routeCode, routeLabel: route.routeLabel,
      equipment: current.equipment, containers: feu, cargoType: current.cargoType,
      commodity: current.commodityDescription,
      cargoReadyDate: current.cargoReadyDate, requiredDeliveryDate: current.requiredDeliveryDate,
      incoterms: current.incoterms, freightPayer: current.freightPayer,
      budgetTotal: current.budgetAmount, budgetPerFeu, budgetCurrency: current.budgetCurrency,
      deadlineLatestEta, minDeliveryBufferDays: buffer, maxTransshipments: maxTs,
    },
    market: market ? { ...market, routeLabel: route.routeLabel, indexNow: currentIndex } : null,
    composite: composite ? { now: composite.now, pctile52: composite.pctile52, yoyPct: composite.yoyPct, regime: composite.regime, momentum: composite.momentum } : null,
    fx: fxUsd, baseRate: rate,
    company_stats: companySt,
    budget: budgetCtx,
    schedule: {
      window: { from: windowFrom, to: windowTo },
      totalGenerated: sailingsAll.length,
      boardable: boardable.length,
      feasibleCount: feasible.length,
      comfortableCount: comfortable.length,
      candidates: candidates.slice(0, 14),
      cheapestFeasible, earliestFeasible,
    },
    timing,
  };
}

// 부드러운 타이밍 판독: 시장국면 × 납기압박 × 자리 가용성
function readTiming({ market, feasible, candidates, deadlineLatestEta, current, buffer }) {
  const signals = [];
  let lean = "BOOK_SOON"; // 기본
  if (!market) return { lean: "INSUFFICIENT", signals: ["시장 지수 없음 — 스케줄만으로 판단"] };

  const elevated = market.pctile52 >= 80;
  const depressed = market.pctile52 <= 25;
  const rising = market.momentum === "RISING";
  const falling = market.momentum === "FALLING";

  if (elevated) signals.push(`운임이 최근 1년 상위 ${100 - market.pctile52}% 수준(백분위 ${market.pctile52})으로 역사적 고점권`);
  if (depressed) signals.push(`운임이 최근 1년 하위 ${market.pctile52}% 수준으로 저점권 — 실어두기 유리`);
  if (rising) signals.push(`12주 추세 +${market.slope12WkPctPerWk}%/주로 상승 중 — 미루면 더 비싸질 위험`);
  if (falling) signals.push(`12주 추세 ${market.slope12WkPctPerWk}%/주로 하락 중 — 서두르지 않으면 이득 여지`);

  // 납기 압박: 하드 납기를 만족하는 항차 수 / 버퍼까지 여유로운 항차 수
  const comfortable = candidates.filter((c) => c.comfortable);
  const latestFeasibleEtd = feasible.length ? feasible.map((f) => f.etd).sort().at(-1) : null;
  const feasibleFewness = feasible.length <= 2;
  const noComfort = comfortable.length === 0 && feasible.length > 0;
  if (feasibleFewness) signals.push(`하드 납기를 지키는 항차가 ${feasible.length}개뿐 — 선택지가 좁아 미루기 어려움`);
  if (noComfort) {
    const tight = feasible.map((f) => f.bufferShortfallDays).sort((a, b) => a - b)[0];
    signals.push(`납기는 지키되 선호 버퍼(${buffer}일)를 만족하는 항차는 없음 — 최선도 버퍼 ${tight}일 부족`);
  }

  // 판단
  if (feasible.length === 0) lean = "DEADLINE_RISK";
  else if (feasibleFewness || rising || noComfort) lean = "BOOK_NOW";
  else if (depressed && !rising) lean = "BOOK_NOW";
  else if (elevated && falling && !feasibleFewness) lean = "CONSIDER_WAIT";
  else lean = "BOOK_SOON";

  return { lean, elevated, depressed, rising, falling, feasibleFewness, noComfort, latestFeasibleEtd, signals };
}
