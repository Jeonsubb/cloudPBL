// KCCI 컨테이너 운임 종합지수 + 항로별 세부지수의 "주간 시계열"을 생성한다.
// 운영에서는 이 값들이 DynamoDB(portpulse-market-timeseries)에 실수집돼 있지만,
// 로컬 데모/추천엔진 검증을 위해 실제 관측 앵커에 맞춘 합성 시계열을 만들어 data/에 저장한다.
//
// 근거 앵커(실측/공개):
//  - KCCI 출시 2022-11-07 = 1000pt(기준)
//  - 2026-07-13 종합 = 4318pt (대시보드 실측)
//  - 전년 대비 +88.97% → 2025-07 ≈ 2285pt
//  - 2024년 홍해 리스크 급등, 이후 조정 구간 반영
// 항로별 세부지수는 종합을 항로 스케일(현재 관측 수준 비율)로 투영 + 항로별 독립 노이즈.
//
// 결정적(seeded) 생성이라 재실행해도 값이 동일하다.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
mkdirSync(dataDir, { recursive: true });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEEK = 7 * 86_400_000;
const d = (s) => new Date(`${s}T00:00:00Z`).getTime();
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// 종합지수 앵커 (date, value)
const ANCHORS = [
  ["2022-11-07", 1000],
  ["2023-06-05", 860],
  ["2024-01-01", 1150],
  ["2024-06-24", 2600],
  ["2024-11-25", 1850],
  ["2025-07-14", 2285],
  ["2026-01-05", 3450],
  ["2026-07-13", 4318],
].map(([s, v]) => [d(s), v]);

// 앵커 사이 선형보간
function anchorValue(t) {
  if (t <= ANCHORS[0][0]) return ANCHORS[0][1];
  if (t >= ANCHORS.at(-1)[0]) return ANCHORS.at(-1)[1];
  for (let i = 1; i < ANCHORS.length; i++) {
    if (t <= ANCHORS[i][0]) {
      const [t0, v0] = ANCHORS[i - 1], [t1, v1] = ANCHORS[i];
      return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
    }
  }
  return ANCHORS.at(-1)[1];
}

const START = d("2023-01-02"); // 데모 백필 시작(월요일)
const END = d("2026-07-13");
const COMPOSITE_NOW = 4318;

// 종합: 앵커 보간 + 완만한 주간 노이즈(AR(1) 느낌으로 누적) → 마지막 주는 실측값으로 고정
function genComposite() {
  const rnd = mulberry32(20221107);
  const pts = [];
  let drift = 0;
  for (let t = START; t <= END + 1; t += WEEK) {
    const base = anchorValue(Math.min(t, END));
    drift = drift * 0.6 + (rnd() - 0.5) * 0.05; // ±2.5% 완만
    const v = base * (1 + drift);
    pts.push({ date: iso(t), value: Math.round(v) });
  }
  pts.at(-1).value = COMPOSITE_NOW; // 현재값 고정
  return pts;
}

// 항로별 현재 수준(관측 기반 추정, pt) → 종합 대비 스케일
const ROUTES = {
  KUWI: { now: 5200, seed: 1001, label: "미주서안" },
  KUEI: { now: 6100, seed: 1002, label: "미주동안" },
  KNEI: { now: 4900, seed: 1003, label: "북유럽" },
  KMDI: { now: 5400, seed: 1004, label: "지중해" },
  KSEI: { now: 2050, seed: 1005, label: "동남아" },
  KCI: { now: 1350, seed: 1006, label: "중국" },
  KJI: { now: 1250, seed: 1007, label: "일본" },
};

function genRoute(composite, cfg) {
  const rnd = mulberry32(cfg.seed);
  const k = cfg.now / COMPOSITE_NOW;
  let n = 0;
  const pts = composite.map((c) => {
    n = n * 0.5 + (rnd() - 0.5) * 0.06; // 항로 독립 노이즈 ±3%
    return { date: c.date, value: Math.round(c.value * k * (1 + n)) };
  });
  pts.at(-1).value = cfg.now; // 현재값 고정
  return pts;
}

const composite = genComposite();
const out = {
  _comment:
    "KCCI 종합/항로별 주간 시계열(합성). 실제 관측 앵커(2022-11-07=1000, 2026-07-13 종합=4318, yoy +88.97%)에 맞춰 결정적으로 생성. 운영에선 DynamoDB portpulse-market-timeseries에서 실수집값을 읽는다. 추천엔진/스케줄 운임합성의 시장 기준선.",
  base: "2022-11-07 = 1000pt",
  observedAt: "2026-07-13",
  compositeNow: COMPOSITE_NOW,
  series: { KCCI: composite },
  routeMeta: {},
};
for (const [code, cfg] of Object.entries(ROUTES)) {
  out.series[code] = genRoute(composite, cfg);
  out.routeMeta[code] = { label: cfg.label, now: cfg.now };
}

writeFileSync(`${dataDir}/kcci-history.json`, JSON.stringify(out));
console.log(`kcci-history.json 생성: 종합 ${composite.length}주 (${composite[0].date} → ${composite.at(-1).date})`);
console.log("현재 종합:", COMPOSITE_NOW, "| 1년전:", composite.find((p) => p.date >= "2025-07-07")?.value);
for (const [code, cfg] of Object.entries(ROUTES)) {
  const s = out.series[code];
  const yoy = ((s.at(-1).value / s.find((p) => p.date >= "2025-07-07").value - 1) * 100).toFixed(1);
  console.log(`  ${code} ${cfg.label}: 현재 ${s.at(-1).value}pt, yoy ${yoy}%`);
}
