// KOBC(한국해양진흥공사) KCCI 컨테이너선 운임지수 — 종합지수 + 13개 세부항로.
// 매주 월요일 14시 발표(주간 지표) — ECOS 일별 지표와 갱신 주기가 다름.
// 항로명·가중치는 공식 기술서(KCCI_Standards.pdf) 기준(2026-07-14 확인).
// featured: false인 항목도 DynamoDB에는 수집·저장되지만 market-series.mjs(API/대시보드 목록)에는 노출하지 않는다
// — 항로 13개를 다 카드로 띄우면 수출기업 대시보드가 지나치게 산만해지기 때문.
const ROUTES = [
  { id: "KCCI", label: "KOBC 컨테이너선 운임 종합지수", weight: null, featured: true },
  { id: "KUWI", label: "북미서안 (Korea US West Index)", weight: "15%" },
  { id: "KUEI", label: "북미동안 (Korea US East Index)", weight: "10%" },
  { id: "KNEI", label: "북유럽 (Korea North Europe Index)", weight: "10%" },
  { id: "KMDI", label: "지중해 (Korea Mediterranean Index)", weight: "5%" },
  { id: "KMEI", label: "중동 (Korea Middle East Index)", weight: "5%" },
  { id: "KAUI", label: "오세아니아 (Korea Australia Index)", weight: "5%" },
  { id: "KLEI", label: "중남미동안 (Korea Latin East Index)", weight: "5%" },
  { id: "KLWI", label: "중남미서안 (Korea Latin West Index)", weight: "5%" },
  { id: "KSAI", label: "남아프리카 (Korea South Africa Index)", weight: "2.5%" },
  { id: "KWAI", label: "서아프리카 (Korea West Africa Index)", weight: "2.5%" },
  { id: "KCI", label: "중국 (Korea China Index)", weight: "15%" },
  { id: "KJI", label: "일본 (Korea Japan Index)", weight: "10%" },
  { id: "KSEI", label: "동남아 (Korea Southeast Asia Index)", weight: "10%" },
];

export const KCCI_SERIES = ROUTES.map((r) => ({
  ...r,
  unit: "pt",
  prefix: "KCCI",
  source: r.id === "KCCI" ? "KOBC KCCI" : `KOBC KCCI/${r.id}`,
  historyStart: "2022-11-07",
  featured: r.featured ?? false,
}));
