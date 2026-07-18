// 실제 선사 서비스 루프 정의 — hmm21.com 공개 Point-to-Point 스케줄 조회(2026-07-16 관측)에서
// 부산발 각 항로의 실제 서비스코드·운항선사·선박명·소요일수를 수집해 정리한 것.
// schedule-gen.mjs가 이 정의를 주간 케이던스로 굴려 과거·미래 항차를 생성한다(선박명은 실제 풀을 순환).
// 운임(priceUSD)은 여기서 만들지 않는다 — schedule-gen이 KCCI 지수 수준에 연동해 합성한다.
//
// routeCode는 KCCI 세부항로(kcci-series.mjs)와 정합.
//   KUWI 미주서안 / KUEI 미주동안 / KNEI 북유럽 / KSEI 동남아 / KCI 중국
//
// 필드:
//   service        서비스 루프 코드(실측)
//   operator       운항 선사(실측)
//   direct         직항 여부(실측)
//   transitDays    도어X, 항구간 표정 소요일(실측 관측치의 대표값)
//   cadenceDays    출항 간격(대부분 주 1항차 = 7)
//   anchorUsd      "현재 KCCI 수준"에서의 40ft 대표 운임(합성 기준가) — Freightos 스냅샷/항로 특성 기반
//   vessels        실제 관측된 선박명 풀(주간 순환 배정)

export const SERVICES = [
  // ── 북유럽(부산→함부르크/로테르담) ─────────────────────────────
  {
    routeCode: "KNEI", service: "FE4", operator: "ONE", direct: true,
    transitDays: 40, cadenceDays: 7, anchorUsd: 5400,
    vessels: ["ONE TRIBUTE", "ONE TRIUMPH", "ONE INTEGRITY", "ONE TRUST", "ONE FUTURE"],
  },
  {
    routeCode: "KNEI", service: "FE3", operator: "HMM", direct: false,
    transitDays: 68, cadenceDays: 7, anchorUsd: 4900,
    vessels: ["HMM HAMBURG", "HMM STOCKHOLM", "HMM OSLO", "HMM LE HAVRE", "HMM SOUTHAMPTON", "HMM ROTTERDAM"],
  },

  // ── 미주서안(부산→롱비치) ──────────────────────────────────────
  {
    routeCode: "KUWI", service: "CPX", operator: "SML", direct: true,
    transitDays: 11, cadenceDays: 7, anchorUsd: 6800,
    vessels: ["SM BUSAN", "SM KWANGYANG", "SM YANTIAN", "SM NINGBO", "SM LONG BEACH"],
  },
  {
    routeCode: "KUWI", service: "MP2", operator: "HMM", direct: true,
    transitDays: 13, cadenceDays: 7, anchorUsd: 7400,
    vessels: ["HMM DAON", "HMM PEARL", "ONE FORTUNE", "ONE FORWARD", "ONE FREEDOM", "ONE FOREVER", "YM WORTHINESS", "ZEAL LUMOS"],
  },

  // ── 미주동안(부산→뉴욕) ────────────────────────────────────────
  {
    routeCode: "KUEI", service: "EC1", operator: "ONE", direct: true,
    transitDays: 25, cadenceDays: 7, anchorUsd: 9500,
    vessels: ["HYUNDAI MARS", "HYUNDAI SATURN", "YM TRANQUILITY", "ONE HENRY HUDSON", "ONE HANOI"],
  },
  {
    routeCode: "KUEI", service: "EC2", operator: "HMM", direct: true,
    transitDays: 37, cadenceDays: 7, anchorUsd: 8800,
    vessels: ["ONE COLUMBA", "HMM AMETHYST", "HMM VICTORY", "YM WORTH", "ONE MEISHAN", "ONE CRANE"],
  },

  // ── 동남아(부산→싱가포르) ──────────────────────────────────────
  {
    routeCode: "KSEI", service: "FIM", operator: "HMM", direct: true,
    transitDays: 15, cadenceDays: 7, anchorUsd: 950,
    vessels: ["SEASPAN BRILLIANCE", "HMM OCEAN", "HMM MASTER", "HMM GARAM"],
  },

  // ── 중국(부산→상하이) ──────────────────────────────────────────
  {
    routeCode: "KCI", service: "FIL", operator: "HMM", direct: true,
    transitDays: 3, cadenceDays: 7, anchorUsd: 280,
    vessels: ["HMM JUNIPER", "HMM PREMIUM", "HYUNDAI HONGKONG"],
  },
  {
    routeCode: "KCI", service: "PS6", operator: "HMM", direct: true,
    transitDays: 8, cadenceDays: 7, anchorUsd: 310,
    vessels: ["HMM RUBY", "HMM TURQUOISE", "HMM TOPAZ"],
  },
  {
    routeCode: "KCI", service: "VTX", operator: "PAN", direct: true,
    transitDays: 2, cadenceDays: 4, anchorUsd: 255,
    vessels: ["POS LAEMCHABANG", "SM JAKARTA", "STARSHIP PEGASUS"],
  },
];

// 항로별 대표 도착항(스케줄 카드 표시용) — ShipDa 실제 커버리지 조사(2026-07)에서 확인한 대표 POD.
export const ROUTE_PODS = {
  KNEI: [{ code: "DEHAM", name: "Hamburg", cc: "DE" }, { code: "NLRTM", name: "Rotterdam", cc: "NL" }],
  KUWI: [{ code: "USLGB", name: "Long Beach", cc: "US" }],
  KUEI: [{ code: "USNYC", name: "New York", cc: "US" }],
  KSEI: [{ code: "SGSIN", name: "Singapore", cc: "SG" }],
  KCI: [{ code: "CNSHA", name: "Shanghai", cc: "CN" }],
  KJI: [{ code: "JPTYO", name: "Tokyo", cc: "JP" }],
  KMDI: [{ code: "ESBCN", name: "Barcelona", cc: "ES" }],
  KMEI: [{ code: "AEJEA", name: "Jebel Ali", cc: "AE" }],
  KAUI: [{ code: "AUSYD", name: "Sydney", cc: "AU" }],
  KLEI: [{ code: "BRSSZ", name: "Santos", cc: "BR" }],
  KLWI: [{ code: "MXZLO", name: "Manzanillo", cc: "MX" }],
};

export function servicesForRoute(routeCode) {
  return SERVICES.filter((s) => s.routeCode === routeCode);
}
