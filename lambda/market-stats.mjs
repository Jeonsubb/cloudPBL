// 시장 통계 엔진 — KCCI 항로 지수 시계열에서 "지금이 과거 대비 어느 수준인가"를 숫자로 뽑는다.
// 백분위/표준점수/추세/최근 변동 — 추천 서사(Bedrock)가 인용할 정량 근거. 숫자는 여기서만 확정.
// 순수 함수. 입력 series는 오름차순 주간 [{date, value}].

const pct = (a, b) => (b ? (a / b - 1) * 100 : 0);

function percentileOf(value, arr) {
  if (arr.length === 0) return null;
  const below = arr.filter((v) => v <= value).length;
  return (below / arr.length) * 100;
}

function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function std(a) { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); }

// 최근 n주 선형회귀 기울기(주당 pt) → %/주로 환산
function slopePerWeek(points) {
  const n = points.length;
  if (n < 2) return 0;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.value);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den ? num / den : 0;
  return my ? (slope / my) * 100 : 0;
}

/** @param series 오름차순 주간 [{date,value}] (특정 항로) */
export function marketStats(series) {
  if (!series || series.length < 4) return null;
  const values = series.map((p) => p.value);
  const now = values.at(-1);
  const wow = values.length >= 2 ? pct(now, values.at(-2)) : 0;
  const m1 = values.length >= 5 ? pct(now, values.at(-5)) : null;   // ~4주
  const m3 = values.length >= 13 ? pct(now, values.at(-13)) : null; // ~12주
  const yoy = values.length >= 53 ? pct(now, values.at(-53)) : null;

  const last52 = values.slice(-52);
  const all = values;
  const p52 = percentileOf(now, last52);
  const pAll = percentileOf(now, all);
  const z52 = std(last52) ? (now - mean(last52)) / std(last52) : 0;
  const min52 = Math.min(...last52), max52 = Math.max(...last52);
  const slope12 = slopePerWeek(series.slice(-12));

  // 국면 라벨(백분위 + 추세 조합) — 서사 근거용
  let regime = "NORMAL";
  if (p52 >= 85) regime = "ELEVATED";
  else if (p52 >= 65) regime = "FIRM";
  else if (p52 <= 20) regime = "DEPRESSED";
  else if (p52 <= 40) regime = "SOFT";
  const momentum = slope12 > 1.2 ? "RISING" : slope12 < -1.2 ? "FALLING" : "FLAT";

  return {
    now, wowPct: r1(wow), m1Pct: m1 == null ? null : r1(m1), m3Pct: m3 == null ? null : r1(m3),
    yoyPct: yoy == null ? null : r1(yoy),
    pctile52: p52 == null ? null : Math.round(p52),
    pctileAll: pAll == null ? null : Math.round(pAll),
    z52: r2(z52), min52, max52,
    fromMin52Pct: r1(pct(now, min52)), fromMax52Pct: r1(pct(now, max52)),
    slope12WkPctPerWk: r2(slope12),
    regime, momentum,
  };
}

// FX/금리 스냅샷 통계
export function fxStats(points) {
  if (!points || points.length < 2) return null;
  const now = points.at(-1);
  const ago = (n) => points[Math.max(0, points.length - 1 - n)];
  return {
    value: now.value, date: now.date,
    d1Pct: r2(pct(now.value, ago(1).value)),
    m1Pct: r2(pct(now.value, ago(22).value)),   // ~영업일 22일
    yoyPct: points.length >= 252 ? r2(pct(now.value, ago(252).value)) : null,
  };
}

const r1 = (v) => Number(v.toFixed(1));
const r2 = (v) => Number(v.toFixed(2));
