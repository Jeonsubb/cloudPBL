// 실제 서비스 루프(ocean-services.mjs)를 주간 케이던스로 굴려 과거·미래 항차를 생성한다.
// 선박명은 실제 관측 풀을 순환 배정, ETD/ETA/소요일/직항여부/서비스코드는 실제 서비스 정의값.
//
// 운임(priceUSD)은 합성이지만 "근거 있는" 매커니즘이다:
//   priceUSD = anchorUsd × (해당 ETD 주간 KCCI지수 / 현재 KCCI지수) × 항차별 지터(±6%, 결정적)
// → 과거 지수가 낮았을 때 항차는 그만큼 싸고, 지금처럼 지수가 고점이면 비싸다.
//   "지금이 과거 대비 얼마나 비싼가"가 데이터에서 자연스럽게 나오도록 설계.
// 항차별 지터는 (선박명+항차번호) 해시로 시드해 재실행해도 값이 고정된다.

import { servicesForRoute } from "./ocean-services.mjs";

const DAY = 86_400_000;
const d = (s) => new Date(`${s}T00:00:00Z`).getTime();
const iso = (t) => new Date(t).toISOString().slice(0, 10);

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// 항차 시드 → ±pct 결정적 지터
function jitter(seed, pct) {
  const r = ((hashStr(seed) % 10000) / 10000); // 0..1
  return 1 + (r - 0.5) * 2 * pct;
}

// 주간 시계열에서 특정 날짜의 지수(해당일 이하 최신 관측)
function indexAt(series, targetIso) {
  let v = series[0]?.value ?? 1000;
  for (const p of series) { if (p.date <= targetIso) v = p.value; else break; }
  return v;
}

function vesselCode(vessel) {
  const words = vessel.split(/\s+/);
  const letters = (words[0].slice(0, 1) + (words[1] ?? words[0]).slice(0, 3)).toUpperCase();
  return letters.padEnd(4, "X").slice(0, 4);
}

const DIR_BY_ROUTE = { KUWI: "E", KUEI: "E", KNEI: "W", KSEI: "W", KCI: "W" };

/**
 * @param routeCode  KCCI 항로코드
 * @param opts.fromIso / opts.toIso  생성 구간(ETD 기준)
 * @param opts.routeSeries  해당 항로 주간 KCCI [{date,value}] (오름차순). 없으면 anchorUsd 고정.
 * @returns 항차 배열(ETD 오름차순)
 */
export function generateSailings(routeCode, { fromIso, toIso, routeSeries } = {}) {
  const services = servicesForRoute(routeCode);
  if (services.length === 0) return [];
  const from = d(fromIso), to = d(toIso);
  const indexNow = routeSeries?.at(-1)?.value ?? null;
  const dir = DIR_BY_ROUTE[routeCode] ?? "E";
  const out = [];

  for (const svc of services) {
    // 서비스별 위상 오프셋(요일 분산) — 결정적
    const phase = (hashStr(svc.service) % svc.cadenceDays) * DAY;
    // from 이전 첫 출항점을 케이던스에 맞춰 정렬
    let t = from - ((from - phase) % (svc.cadenceDays * DAY));
    let week = Math.floor((t - d("2023-01-02")) / (svc.cadenceDays * DAY));
    for (; t <= to; t += svc.cadenceDays * DAY, week++) {
      if (t < from) continue;
      const etd = iso(t);
      const eta = iso(t + svc.transitDays * DAY);
      const vessel = svc.vessels[((week % svc.vessels.length) + svc.vessels.length) % svc.vessels.length];
      const seq = String(100 + (week % 900)).padStart(4, "0");
      const voyage = `${vesselCode(vessel)}${seq}${dir}`;

      const idxAtEtd = routeSeries ? indexAt(routeSeries, etd) : indexNow;
      const marketRatio = indexNow ? idxAtEtd / indexNow : 1;
      const jit = jitter(`${vessel}|${voyage}`, 0.06);
      const priceUSD = Math.round((svc.anchorUsd * marketRatio * jit) / 10) * 10;

      out.push({
        routeCode, service: svc.service, operator: svc.operator,
        vessel, voyage, direct: svc.direct, transitDays: svc.transitDays,
        etd, eta,
        priceUSD,
        priceBasis: {
          anchorUsd: svc.anchorUsd,
          kcciAtEtd: idxAtEtd,
          kcciNow: indexNow,
          marketRatio: Number(marketRatio.toFixed(3)),
          jitterPct: Number(((jit - 1) * 100).toFixed(1)),
        },
      });
    }
  }
  out.sort((a, b) => a.etd.localeCompare(b.etd));
  return out;
}
