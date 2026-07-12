import {
  createDashboardFallback,
  createFbxIntegration,
  createGlobalFreightIntegrations,
  createScfiIntegration,
  type DashboardNewsItem,
  type DashboardPayload,
  type MacroSeries,
  type ProviderMode,
} from "./dashboard-contract";
import { type FreightIndex, type NewsItem } from "./portpulse";

const ECOS_BASE_URL = "https://ecos.bok.or.kr/api/StatisticSearch";
const ECOS_PORTAL_URL = "https://ecos.bok.or.kr/api/";
const KCCI_URL = "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000";
const MOF_RSS_URL = "https://www.mof.go.kr/doc/ko/rssFeed.do?bbsSeq=10";
const CUSTOMS_RSS_URL = "https://www.customs.go.kr/kcs/selectBoardRss.do?bbsId=1362&mi=2891";

type EcosRow = {
  TIME: string;
  DATA_VALUE: string;
};

type EcosResponse = {
  StatisticSearch?: {
    list_total_count: number;
    row?: EcosRow[];
  };
  RESULT?: {
    CODE: string;
    MESSAGE: string;
  };
};

type EcosDefinition = {
  id: MacroSeries["id"];
  label: string;
  shortLabel: string;
  unit: MacroSeries["unit"];
  statCode: string;
  itemCode: string;
  note: string;
};

const ECOS_SERIES: EcosDefinition[] = [
  { id: "USD_KRW", label: "원/미국달러 매매기준율", shortLabel: "USD/KRW", unit: "KRW", statCode: "731Y001", itemCode: "0000001", note: "영업일 기준 매매기준율" },
  { id: "BOK_BASE_RATE", label: "한국은행 기준금리", shortLabel: "기준금리", unit: "%", statCode: "722Y001", itemCode: "0101000", note: "정책금리를 일별 계단형 시계열로 제공" },
  { id: "KTB_3Y", label: "국고채 3년 시장금리", shortLabel: "국고채 3년", unit: "%", statCode: "817Y002", itemCode: "010200000", note: "영업일 기준 시장금리" },
];

const KCCI_NAMES: Record<string, string> = {
  KCCI: "종합지수",
  KUWI: "미서안",
  KUEI: "미동안",
  KNEI: "유럽",
  KMDI: "지중해",
  KMEI: "중동",
  KAUI: "호주",
  KLEI: "중남미동안",
  KLWI: "중남미서안",
  KSAI: "남아프리카",
  KWAI: "서아프리카",
  KCI: "중국",
  KJI: "일본",
  KSEI: "동남아",
};

function dateInSeoul(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function compactDate(date: Date) {
  return dateInSeoul(date).replaceAll("-", "");
}

function subtractDays(date: Date, days: number) {
  return new Date(date.getTime() - days * 86_400_000);
}

function normalizeEcosDate(value: string) {
  if (value.length === 8) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (value.length === 6) return `${value.slice(0, 4)}-${value.slice(4, 6)}`;
  return value;
}

function seriesFromRows(definition: EcosDefinition, rows: EcosRow[], mode: Exclude<ProviderMode, "LICENSE_REQUIRED">): MacroSeries {
  const points = rows
    .map((row) => ({ date: normalizeEcosDate(row.TIME), value: Number(row.DATA_VALUE) }))
    .filter((point) => Number.isFinite(point.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = points.at(-1);
  const previous = points.at(-2);
  if (!latest) throw new Error(`ECOS ${definition.id} returned no observations`);
  return {
    id: definition.id,
    label: definition.label,
    shortLabel: definition.shortLabel,
    unit: definition.unit,
    frequency: "D",
    latest: latest.value,
    previous: previous?.value ?? null,
    change: previous ? latest.value - previous.value : null,
    observedAt: latest.date,
    points,
    source: "한국은행 ECOS",
    sourceUrl: ECOS_PORTAL_URL,
    mode,
    note: mode === "SAMPLE" ? `${definition.note} · 공개 sample 키 최근 10건 이내` : definition.note,
  };
}

async function fetchEcosSeries(definition: EcosDefinition, now: Date, apiKey: string | undefined): Promise<MacroSeries> {
  const usingSample = !apiKey;
  const key = apiKey || "sample";
  const from = compactDate(subtractDays(now, usingSample ? 35 : 95));
  const to = compactDate(now);
  const endRow = usingSample ? 10 : 100;
  const request = async (startRow: number, lastRow: number) => {
    const url = `${ECOS_BASE_URL}/${encodeURIComponent(key)}/json/kr/${startRow}/${lastRow}/${definition.statCode}/D/${from}/${to}/${definition.itemCode}`;
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "PortPulse-MVP/1.0" },
      signal: AbortSignal.timeout(6_500),
    });
    if (!response.ok) throw new Error(`ECOS ${response.status}`);
    return response.json() as Promise<EcosResponse>;
  };
  let payload = await request(1, endRow);
  if (payload.RESULT) throw new Error(`${payload.RESULT.CODE}: ${payload.RESULT.MESSAGE}`);
  const total = payload.StatisticSearch?.list_total_count ?? 0;
  if (usingSample && total > 10) {
    payload = await request(total - 9, total);
    if (payload.RESULT) throw new Error(`${payload.RESULT.CODE}: ${payload.RESULT.MESSAGE}`);
  }
  const rows = payload.StatisticSearch?.row;
  if (!rows?.length) throw new Error(`ECOS ${definition.id} response is empty`);
  return seriesFromRows(definition, rows, usingSample ? "SAMPLE" : "LIVE");
}

async function fetchEcosMacro(now: Date) {
  const apiKey = process.env.ECOS_API_KEY?.trim() || undefined;
  const [usdKrw, baseRate, bond3y] = await Promise.all(ECOS_SERIES.map((definition) => fetchEcosSeries(definition, now, apiKey)));
  return { usdKrw, baseRate, bond3y, usingSample: !apiKey };
}

function decodeEntities(value: string) {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name] ?? match)
    .trim();
}

function stripHtml(value: string) {
  return decodeEntities(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function parseNumber(value: string) {
  if (!/[0-9]/.test(value)) return Number.NaN;
  return Number(value.replaceAll(",", "").replace(/[^0-9.-]/g, ""));
}

async function fetchKcciSnapshot(): Promise<FreightIndex[]> {
  const response = await fetch(KCCI_URL, {
    headers: { accept: "text/html", "user-agent": "PortPulse-MVP/1.0" },
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw new Error(`KCCI ${response.status}`);
  const html = await response.text();
  return parseKcciHtml(html);
}

export function parseKcciHtml(html: string): FreightIndex[] {
  const currentDate = html.match(/Current Index<br>[\s\S]*?(\d{4}-\d{2}-\d{2})/i)?.[1];
  if (!currentDate) throw new Error("KCCI observation date was not found");
  const codes = new Set(Object.keys(KCCI_NAMES));
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const items: FreightIndex[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1]));
    const codeIndex = cells.findIndex((cell) => codes.has(cell));
    if (codeIndex < 0 || cells.length < codeIndex + 6) continue;
    const code = cells[codeIndex];
    const value = parseNumber(cells[codeIndex + 3]);
    const changeMatch = cells[codeIndex + 5].match(/\((-?\d+(?:\.\d+)?)%\)/);
    if (!changeMatch || !Number.isFinite(value)) continue;
    const weeklyChangePct = Number(changeMatch[1]);
    items.push({
      code,
      name: KCCI_NAMES[code],
      value,
      unit: code === "KCCI" ? "PT" : "USD/FEU",
      weeklyChangePct,
      observedAt: currentDate,
      publishedAt: currentDate,
      source: "KOBC KCCI",
      sourceUrl: KCCI_URL,
      provenance: "MARKET_OBSERVED",
    });
  }
  const parsedCodes = new Set(items.map((item) => item.code));
  if (items.length !== Object.keys(KCCI_NAMES).length || parsedCodes.size !== Object.keys(KCCI_NAMES).length || Object.keys(KCCI_NAMES).some((code) => !parsedCodes.has(code))) {
    throw new Error("KCCI table was incomplete or duplicated");
  }
  return items;
}

function extractTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function classifyNews(title: string): NewsItem["category"] {
  if (/환율|원\/달러|달러|금리/.test(title)) return "환율";
  if (/운임|SCFI|KCCI|물류비|할증료/.test(title)) return "운임";
  if (/항만|부산항|터미널|항구/.test(title)) return "항만";
  if (/수출|관세|통상|무역/.test(title)) return "통상";
  return "물류";
}

function inferRegions(title: string) {
  const regions = [
    [/부산/, "부산"], [/상하이|중국/, "중국"], [/싱가포르|동남아/, "동남아"], [/미국|미주/, "미주"],
    [/유럽|홍해/, "유럽"], [/중동|이란|호르무즈/, "중동"], [/일본/, "일본"],
  ] as const;
  const found = regions.filter(([pattern]) => pattern.test(title)).map(([, name]) => name);
  return found.length ? found : ["글로벌"];
}

function parseOfficialDate(value: string, timeZone: "GMT" | "KST") {
  if (timeZone === "KST" && /^\d{4}-\d{2}-\d{2} /.test(value)) {
    return new Date(`${value.replace(/\.0$/, "").replace(" ", "T")}+09:00`);
  }
  return new Date(value);
}

async function fetchOfficialFeed(url: string, source: string, timeZone: "GMT" | "KST", now: Date): Promise<DashboardNewsItem[]> {
  const response = await fetch(url, {
    headers: { accept: "application/rss+xml, application/xml", "user-agent": "PortPulse-MVP/1.0" },
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw new Error(`${source} RSS ${response.status}`);
  const xml = await response.text();
  const today = dateInSeoul(now);
  return (xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [])
    .map((item, index): DashboardNewsItem | null => {
      const title = extractTag(item, "title");
      const rawUrl = extractTag(item, "link");
      const pubDate = extractTag(item, "pubDate");
      const parsedDate = parseOfficialDate(pubDate, timeZone);
      if (!title || !rawUrl || Number.isNaN(parsedDate.getTime())) return null;
      const articleUrl = rawUrl.replace(/^http:\/\//, "https://");
      const category = classifyNews(title);
      return {
        id: `${source === "해양수산부" ? "MOF" : "CUSTOMS"}-${parsedDate.getTime()}-${index}`,
        title,
        summary: `${source} 공식 보도자료입니다. 제목과 발행시각만 집계하며 세부 내용은 원문에서 확인합니다.`,
        source,
        publishedAt: parsedDate.toISOString(),
        url: articleUrl,
        category,
        regions: inferRegions(title),
        relatedShipmentIds: [],
        provenance: "MARKET_OBSERVED",
        aggregator: "공식기관 RSS",
        isToday: dateInSeoul(parsedDate) === today,
      };
    })
    .filter((item): item is DashboardNewsItem => item !== null);
}

async function fetchLatestNews(now: Date): Promise<DashboardNewsItem[]> {
  const results = await Promise.allSettled([
    fetchOfficialFeed(MOF_RSS_URL, "해양수산부", "GMT", now),
    fetchOfficialFeed(CUSTOMS_RSS_URL, "관세청", "KST", now),
  ]);
  const all = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const relevant = all.filter((item) => /항만|물류|해운|선박|수출|무역안보|고환율|중소기업|공급망|항로|컨테이너|해양안전/.test(item.title));
  const items = relevant.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (items.length < 4) throw new Error("official news feeds returned too few relevant items");
  return items.slice(0, 12);
}

export async function getDashboardPayload(now = new Date()): Promise<DashboardPayload> {
  const fallback = createDashboardFallback(now);
  const fetchedAt = now.toISOString();
  const [macroResult, kcciResult, newsResult] = await Promise.allSettled([
    fetchEcosMacro(now),
    fetchKcciSnapshot(),
    fetchLatestNews(now),
  ]);

  const macro = macroResult.status === "fulfilled" ? macroResult.value : { ...fallback.macro, usingSample: false };
  const kcci = kcciResult.status === "fulfilled" ? kcciResult.value : fallback.freight.kcci;
  const news = newsResult.status === "fulfilled" ? newsResult.value : fallback.news;
  const usingEcosFallback = macroResult.status === "rejected";
  const usingSample = macroResult.status === "fulfilled" && macroResult.value.usingSample;
  const kcciLive = kcciResult.status === "fulfilled";
  const newsLive = newsResult.status === "fulfilled";
  const usdKrw = macro.usdKrw;
  const kcciDate = kcci.find((item) => item.code === "KCCI")?.observedAt ?? null;
  const latestNewsDate = news[0]?.publishedAt ?? null;
  const latestNewsAgeHours = latestNewsDate ? Math.max(0, (now.getTime() - new Date(latestNewsDate).getTime()) / 3_600_000) : Number.POSITIVE_INFINITY;
  const newsFresh = newsLive && latestNewsAgeHours <= 48;
  const notices: string[] = [];
  if (usingSample) notices.push("ECOS 운영 인증키가 없어 공식 sample 키의 최근 10건 이내를 표시합니다. ECOS_API_KEY를 넣으면 90일 시계열로 자동 확장됩니다.");
  if (usingEcosFallback) notices.push("ECOS 연결이 지연되어 코드에 포함된 검증 데모 Snapshot을 표시합니다. 운영 last-good 저장소는 아직 연결하지 않았습니다.");
  if (!kcciLive) notices.push("KCCI 페이지 연결이 지연되어 코드에 포함된 공식값 검증 Snapshot을 표시합니다.");
  if (newsLive) notices.push(`뉴스는 해양수산부·관세청 공식 RSS의 메타데이터만 표시합니다.${newsFresh ? "" : " 최근 48시간 내 새 관련 발행은 없습니다."}`);
  else notices.push("뉴스 집계 연결이 지연되어 공식기관 큐레이션을 표시합니다.");
  notices.push("SCFI는 비상업 여부와 무관하게 공개 재배포 권한 확인이 필요해 숫자 대신 공식 원문과 계약 상태를 제공합니다.");

  return {
    schemaVersion: "portpulse.dashboard.v1",
    fetchedAt,
    mode: usingEcosFallback && !kcciLive && !newsLive ? "FALLBACK" : "MIXED",
    macro: { usdKrw: macro.usdKrw, baseRate: macro.baseRate, bond3y: macro.bond3y },
    freight: { kcci, kcciMode: kcciLive ? "LIVE" : "BUNDLED_DEMO", global: createGlobalFreightIntegrations() },
    news,
    newsMode: newsLive ? newsFresh ? "FRESH" : "STALE" : "FALLBACK",
    sources: [
      {
        id: "ECOS",
        label: "환율·금리",
        status: usingEcosFallback ? "FALLBACK" : usingSample ? "LIMITED" : "NORMAL",
        statusLabel: usingEcosFallback ? "내장 데모" : usingSample ? "개발용 SAMPLE" : "정상",
        observedAt: usdKrw.observedAt,
        fetchedAt,
        detail: usingEcosFallback ? "실시간 수집값 아님" : usingSample ? "운영키 필요 · 최근 10건" : "ECOS 서버 어댑터",
        sourceUrl: ECOS_PORTAL_URL,
      },
      {
        id: "KCCI",
        label: "부산발 운임",
        status: kcciLive ? "NORMAL" : "FALLBACK",
        statusLabel: kcciLive ? "공식 최신" : "공식 스냅샷",
        observedAt: kcciDate,
        fetchedAt,
        detail: "KOBC KCCI · 주간 발표",
        sourceUrl: KCCI_URL,
      },
      {
        id: "NEWS",
        label: "해양물류 뉴스",
        status: newsLive ? newsFresh ? "NORMAL" : "STALE" : "FALLBACK",
        statusLabel: newsLive ? newsFresh ? "공식 RSS · 최신" : "새 발행 없음" : "내장 큐레이션",
        observedAt: latestNewsDate,
        fetchedAt,
        detail: newsLive ? "해수부·관세청 메타데이터" : "실시간 수집값 아님",
        sourceUrl: MOF_RSS_URL,
      },
      {
        id: "FBX",
        label: "글로벌 운임",
        status: "LIMITED",
        statusLabel: "수동 검증",
        observedAt: null,
        fetchedAt: createFbxIntegration().verifiedAt!,
        detail: "7월 13일 수동 확인 · 자동수집 미연동",
        sourceUrl: createFbxIntegration().sourceUrl,
      },
      {
        id: "SCFI",
        label: "상하이 운임",
        status: "ACTION_REQUIRED",
        statusLabel: "배포권 필요",
        observedAt: null,
        fetchedAt,
        detail: "공개 수치 재배포 전 서면 허가 필요",
        sourceUrl: createScfiIntegration().sourceUrl,
      },
    ],
    notices,
  };
}

export const dashboardProviderConstants = {
  ECOS_PORTAL_URL,
  KCCI_URL,
  MOF_RSS_URL,
  CUSTOMS_RSS_URL,
} as const;
