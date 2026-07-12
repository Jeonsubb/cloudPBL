import { mockFreightIndices, mockNews, type FreightIndex, type NewsItem } from "./portpulse";

export type ProviderMode = "LIVE" | "SAMPLE" | "BUNDLED_DEMO" | "LICENSE_REQUIRED";

export type TimePoint = {
  date: string;
  value: number;
};

export type MacroSeries = {
  id: "USD_KRW" | "BOK_BASE_RATE" | "KTB_3Y";
  label: string;
  shortLabel: string;
  unit: "KRW" | "%";
  frequency: "D" | "M";
  latest: number;
  previous: number | null;
  change: number | null;
  observedAt: string;
  points: TimePoint[];
  source: "한국은행 ECOS";
  sourceUrl: string;
  mode: Exclude<ProviderMode, "LICENSE_REQUIRED">;
  note: string;
};

export type DashboardNewsItem = NewsItem & {
  aggregator: string;
  isToday: boolean;
};

export type GlobalFreightIntegration = {
  id: "FBX_GLOBAL" | "SCFI";
  name: string;
  market: string;
  cadence: string;
  value: number | null;
  unit: "PT" | "USD/40FT";
  observedAt: string | null;
  verifiedAt: string | null;
  status: "PUBLIC_ATTRIBUTED" | "LICENSE_REQUIRED";
  statusLabel: string;
  description: string;
  source: string;
  sourceUrl: string;
  attributionUrl: string;
  termsUrl: string;
  licenseBasis: string;
  aiUsePolicy: "DENY_UNTIL_REVIEW";
};

export type SourceStatus = {
  id: "ECOS" | "KCCI" | "NEWS" | "FBX" | "SCFI";
  label: string;
  status: "NORMAL" | "LIMITED" | "STALE" | "FALLBACK" | "ACTION_REQUIRED";
  statusLabel: string;
  observedAt: string | null;
  fetchedAt: string;
  detail: string;
  sourceUrl: string;
};

export type DashboardPayload = {
  schemaVersion: "portpulse.dashboard.v1";
  fetchedAt: string;
  mode: "LIVE" | "MIXED" | "FALLBACK";
  macro: {
    usdKrw: MacroSeries;
    baseRate: MacroSeries;
    bond3y: MacroSeries;
  };
  freight: {
    kcci: FreightIndex[];
    kcciMode: "LIVE" | "BUNDLED_DEMO";
    global: GlobalFreightIntegration[];
  };
  news: DashboardNewsItem[];
  newsMode: "FRESH" | "STALE" | "FALLBACK";
  sources: SourceStatus[];
  notices: string[];
};

const ECOS_URL = "https://ecos.bok.or.kr/";

function macroFallback(
  id: MacroSeries["id"],
  label: string,
  shortLabel: string,
  unit: MacroSeries["unit"],
  frequency: MacroSeries["frequency"],
  points: TimePoint[],
  note: string,
): MacroSeries {
  const latestPoint = points.at(-1)!;
  const previousPoint = points.at(-2);
  const change = previousPoint ? latestPoint.value - previousPoint.value : null;
  return {
    id,
    label,
    shortLabel,
    unit,
    frequency,
    latest: latestPoint.value,
    previous: previousPoint?.value ?? null,
    change,
    observedAt: latestPoint.date,
    points,
    source: "한국은행 ECOS",
    sourceUrl: ECOS_URL,
    mode: "BUNDLED_DEMO",
    note,
  };
}

export function createDashboardFallback(now = new Date()): DashboardPayload {
  const fetchedAt = now.toISOString();
  const snapshotVerifiedAt = "2026-07-13T05:40:00+09:00";
  const usdKrw = macroFallback("USD_KRW", "원/미국달러 매매기준율", "USD/KRW", "KRW", "D", [
    { date: "2026-07-01", value: 1548.4 },
    { date: "2026-07-02", value: 1554.4 },
    { date: "2026-07-03", value: 1554.1 },
    { date: "2026-07-06", value: 1539.7 },
    { date: "2026-07-07", value: 1531.8 },
    { date: "2026-07-08", value: 1526.6 },
    { date: "2026-07-09", value: 1509.9 },
    { date: "2026-07-10", value: 1504.2 },
  ], "2026-07-13에 공식 응답과 대조한 내장 데모 Snapshot입니다.");
  const baseRate = macroFallback("BOK_BASE_RATE", "한국은행 기준금리", "기준금리", "%", "D", [
    { date: "2026-07-01", value: 2.5 }, { date: "2026-07-02", value: 2.5 }, { date: "2026-07-03", value: 2.5 },
    { date: "2026-07-06", value: 2.5 }, { date: "2026-07-07", value: 2.5 }, { date: "2026-07-08", value: 2.5 },
    { date: "2026-07-09", value: 2.5 }, { date: "2026-07-10", value: 2.5 },
  ], "2026-07-13에 공식 응답과 대조한 내장 데모 Snapshot입니다.");
  const bond3y = macroFallback("KTB_3Y", "국고채 3년 시장금리", "국고채 3년", "%", "D", [
    { date: "2026-07-01", value: 3.791 }, { date: "2026-07-02", value: 3.747 }, { date: "2026-07-03", value: 3.748 },
    { date: "2026-07-06", value: 3.776 }, { date: "2026-07-07", value: 3.78 }, { date: "2026-07-08", value: 3.775 },
    { date: "2026-07-09", value: 3.778 }, { date: "2026-07-10", value: 3.768 },
  ], "2026-07-13에 공식 응답과 대조한 내장 데모 Snapshot입니다.");
  const news = [...mockNews].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 6).map((item) => ({ ...item, aggregator: "공식기관 큐레이션", isToday: false }));
  return {
    schemaVersion: "portpulse.dashboard.v1",
    fetchedAt,
    mode: "FALLBACK",
    macro: { usdKrw, baseRate, bond3y },
    freight: {
      kcci: mockFreightIndices,
      kcciMode: "BUNDLED_DEMO",
      global: createGlobalFreightIntegrations(),
    },
    news,
    newsMode: "FALLBACK",
    sources: [
      { id: "ECOS", label: "환율·금리", status: "FALLBACK", statusLabel: "내장 데모", observedAt: usdKrw.observedAt, fetchedAt: snapshotVerifiedAt, detail: "실시간 수집값이 아닌 검증 Snapshot", sourceUrl: ECOS_URL },
      { id: "KCCI", label: "부산발 운임", status: "FALLBACK", statusLabel: "내장 데모", observedAt: "2026-07-06", fetchedAt: snapshotVerifiedAt, detail: "KOBC 공식값 검증 Snapshot", sourceUrl: mockFreightIndices[0].sourceUrl },
      { id: "NEWS", label: "해양물류 뉴스", status: "FALLBACK", statusLabel: "내장 큐레이션", observedAt: news[0]?.publishedAt ?? null, fetchedAt: snapshotVerifiedAt, detail: "원문 링크만 제공", sourceUrl: "https://www.mof.go.kr/doc/ko/rssFeed.do?bbsSeq=10" },
      { id: "FBX", label: "글로벌 운임", status: "LIMITED", statusLabel: "수동 검증", observedAt: null, fetchedAt: createFbxIntegration().verifiedAt!, detail: "자동수집 미연동 · Freightos 출처표시", sourceUrl: createFbxIntegration().sourceUrl },
      { id: "SCFI", label: "상하이 운임", status: "ACTION_REQUIRED", statusLabel: "배포권 필요", observedAt: null, fetchedAt, detail: "공개 대시보드 수치 재배포 전 서면 허가 필요", sourceUrl: createScfiIntegration().sourceUrl },
    ],
    notices: ["데이터 연결 전에는 코드에 포함된 검증 데모 Snapshot을 표시하며, 운영 저장소의 마지막 성공 데이터가 아닙니다."],
  };
}

export function createScfiIntegration(): GlobalFreightIntegration {
  return {
    id: "SCFI",
    name: "Shanghai Containerized Freight Index",
    market: "상하이발 수출 컨테이너 Spot",
    cadence: "매주 금요일",
    value: null,
    unit: "PT",
    observedAt: null,
    verifiedAt: null,
    status: "LICENSE_REQUIRED",
    statusLabel: "재배포 권한 확인 필요",
    description: "SCFI는 대표 글로벌 지수지만 공식 약관상 열람과 공개 재배포가 다릅니다. MVP에서는 원문 연결과 계약 상태를 표시하고, 허가 후 같은 어댑터에 숫자·이력을 연결합니다.",
    source: "Shanghai Shipping Exchange Institute",
    sourceUrl: "https://en.sse.net.cn/indices/scfinew.jsp",
    attributionUrl: "https://en.sse.net.cn/indices/scfinew.jsp",
    termsUrl: "https://en.sse.net.cn/indices/agreetext.htm",
    licenseBasis: "SSE 서면 재배포 허가 전 Link-only",
    aiUsePolicy: "DENY_UNTIL_REVIEW",
  };
}

export function createFbxIntegration(): GlobalFreightIntegration {
  return {
    id: "FBX_GLOBAL",
    name: "Freightos Baltic Index Global",
    market: "글로벌 12개 주요 컨테이너 항로",
    cadence: "공식 페이지 Current FBX · 수동 확인",
    value: 3979.6,
    unit: "USD/40FT",
    observedAt: null,
    verifiedAt: "2026-07-13T05:40:00+09:00",
    status: "PUBLIC_ATTRIBUTED",
    statusLabel: "수동 검증 Snapshot",
    description: "2026-07-13에 Freightos 공식 페이지의 Current FBX를 수동 확인한 값입니다. 관측일은 페이지에 없어 임의 생성하지 않으며, 자동 수집·역사 데이터·AI 입력은 별도 조건을 확인합니다.",
    source: "Freightos",
    sourceUrl: "https://www.freightos.com/enterprise/terminal/freightos-baltic-index-global-container-pricing-index/",
    attributionUrl: "https://app.terminal.freightos.com/",
    termsUrl: "https://www.freightos.com/freightos-data-terms-conditions/",
    licenseBasis: "Freightos Data Terms § Right of Use 5 · public FBX, full credit + Terminal link",
    aiUsePolicy: "DENY_UNTIL_REVIEW",
  };
}

export function createGlobalFreightIntegrations() {
  return [createFbxIntegration(), createScfiIntegration()];
}
