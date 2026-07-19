// FRED(세인트루이스 연방준비은행) 그래프 CSV 내보내기 — API 키 불필요, 일별(영업일) 데이터.
// ECOS의 국제상품가격(902Y003)은 월별뿐이라 원유는 이쪽을 쓴다.
const FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";

/**
 * @param fredSeriesId FRED 시리즈 id (예: DCOILWTICO, DCOILBRENTEU)
 * @returns [{date, value}] 오름차순. 휴장일은 값이 비어 있어 제외한다.
 */
export async function fetchFredSeries(fredSeriesId, fromDate, toDate) {
  const cosd = fromDate.toISOString().slice(0, 10);
  const coed = toDate.toISOString().slice(0, 10);
  const url = `${FRED_BASE}?id=${fredSeriesId}&cosd=${cosd}&coed=${coed}`;
  // FRED 앞단 WAF가 Node/undici 기본 UA(및 브라우저 위장 UA+TLS 조합)는 걸러낸다(2026-07-19 확인) —
  // curl 스타일 UA는 통과된다.
  const res = await fetch(url, {
    headers: { "User-Agent": "curl/8.7.1" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`FRED HTTP ${res.status} (${fredSeriesId})`);
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1); // 헤더(observation_date,<id>) 제외
  return lines
    .map((line) => {
      const [date, raw] = line.split(",");
      return { date, value: raw?.trim() ? Number(raw) : NaN }; // 휴장일은 빈 문자열 — Number("")===0이 되어버리는 것 방지
    })
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}
