// 한국은행 ECOS StatisticSearch 클라이언트.
// "1/N" 행 범위는 요청한 기간 전체 결과 중 처음 N건만 반환한다(끝이 아니라 앞쪽이 잘림).
// 그래서 sample/real 키 모두 응답 건수가 maxRows를 넘지 않도록 날짜 창을 나눠서 수집한다.
// - sample 키: 호출당 10건 제한 → 9일 창(ERROR-301 회피).
// - real 키: 호출당 1000건 제한 → 영업일만 있는 일별 데이터 기준 900일(달력일) 창이면 항상 안전.
const ECOS_BASE = "https://ecos.bok.or.kr/api/StatisticSearch";
const SAMPLE_WINDOW_DAYS = 9;
const SAMPLE_MAX_ROWS = 10;
const REAL_WINDOW_DAYS = 900;
const REAL_MAX_ROWS = 1000;

// cycle이 "M"(월간)이면 ECOS가 요청 날짜를 YYYYMM 6자리로 요구한다(YYYYMMDD 주면 ERROR-101).
function fmt(date, cycle) {
  const yyyymmdd = date.toISOString().slice(0, 10).replaceAll("-", "");
  return cycle === "M" ? yyyymmdd.slice(0, 6) : yyyymmdd;
}

// 응답 TIME은 일간이면 YYYYMMDD(8자리), 월간이면 YYYYMM(6자리) — 후자는 해당월 1일로 정규화.
function toIsoDate(time) {
  if (time.length === 6) return `${time.slice(0, 4)}-${time.slice(4, 6)}-01`;
  return `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`;
}

async function fetchWindow(apiKey, series, from, to, maxRows) {
  const url = `${ECOS_BASE}/${apiKey}/json/kr/1/${maxRows}/${series.statCode}/${series.cycle}/${from}/${to}/${series.itemCode}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`ECOS HTTP ${response.status} (${series.id})`);
  const body = await response.json();
  if (body.RESULT) {
    // 데이터 없음(INFO-200)은 빈 결과로 취급, 그 외는 오류
    if (body.RESULT.CODE === "INFO-200") return [];
    throw new Error(`ECOS ${body.RESULT.CODE}: ${body.RESULT.MESSAGE} (${series.id})`);
  }
  return (body.StatisticSearch?.row ?? []).map((row) => ({
    date: toIsoDate(row.TIME),
    value: Number(row.DATA_VALUE),
  }));
}

/**
 * 지정 기간의 일별 시계열을 [{date, value}] 오름차순으로 반환한다.
 * @param {string} apiKey ECOS 인증키. "sample"이면 자동으로 창 분할 수집.
 * @param {{id:string,statCode:string,itemCode:string,cycle:string}} series
 * @param {Date} fromDate
 * @param {Date} toDate
 */
export async function fetchSeries(apiKey, series, fromDate, toDate) {
  const isSample = apiKey === "sample";
  const windowDays = isSample ? SAMPLE_WINDOW_DAYS : REAL_WINDOW_DAYS;
  const maxRows = isSample ? SAMPLE_MAX_ROWS : REAL_MAX_ROWS;

  const points = [];
  let cursor = new Date(fromDate);
  while (cursor <= toDate) {
    const windowEnd = new Date(
      Math.min(cursor.getTime() + (windowDays - 1) * 86_400_000, toDate.getTime()),
    );
    points.push(...(await fetchWindow(apiKey, series, fmt(cursor, series.cycle), fmt(windowEnd, series.cycle), maxRows)));
    cursor = new Date(windowEnd.getTime() + 86_400_000);
  }
  const byDate = new Map(points.filter((p) => Number.isFinite(p.value)).map((p) => [p.date, p]));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
