// Bedrock Agent 액션그룹 실행기 — 에이전트의 "손발" Lambda 1개.
// 에이전트가 도구를 호출하면 이 핸들러로 들어오고, function 이름으로 분기해
// DynamoDB(시장·뉴스·추천이력)/S3(회사 데이터)를 읽거나 웹 검색을 수행해 JSON 텍스트로 돌려준다.
// 숫자는 전부 DB/외부 소스 원본 — 에이전트(LLM)는 이 값을 인용만 하고 창작하지 않는 것이 계약이다.
//
// 액션그룹 구성(infra/lib/portpulse-agent.mjs의 functionSchema와 1:1 대응):
//   market-data  get_market_snapshot / get_market_series
//   news-data    get_top_news
//   company-data get_shipment_decisions / get_current_shipment / get_latest_recommendation
//   web-search   web_search (Tavily — Secrets Manager portpulse/web-search 미설정 시 안내만 반환)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { SERIES as ECOS_SERIES } from "./series.mjs";
import { KCCI_SERIES } from "./kcci-series.mjs";
import { buildDecisionCard } from "./decision.mjs";
import { SHIPMENTS, QUOTES } from "./sample-portfolio.mjs";
import { loadCompany } from "./recommend.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secretsClient = new SecretsManagerClient({});

const MARKET_TABLE = process.env.MARKET_TABLE_NAME;
const NEWS_TABLE = process.env.NEWS_TABLE_NAME;
const RECO_TABLE = process.env.RECO_TABLE_NAME;

// 도구가 조회할 수 있는 전체 시계열 — 대시보드 노출용(market-series.mjs, featured만)과 달리
// KCCI 13개 항로 전부를 포함한다. 에이전트는 "미주서안 항로 최근 흐름" 같은 세부 질문도 받기 때문.
const TOOL_SERIES = [
  ...ECOS_SERIES.map(({ id, label, unit, prefix }) => ({ id, label, unit, prefix })),
  ...KCCI_SERIES.map(({ id, label, unit, prefix }) => ({ id, label, unit, prefix })),
];

const todayKst = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

async function latestTwo(seriesKey) {
  const r = await ddb.send(new QueryCommand({
    TableName: MARKET_TABLE,
    KeyConditionExpression: "series = :s",
    ExpressionAttributeValues: { ":s": seriesKey },
    ScanIndexForward: false, Limit: 2,
  }));
  const [latest, prev] = r.Items ?? [];
  return latest ? { latest, prev } : null;
}

function withChange(meta, two) {
  const { latest, prev } = two;
  const diff = prev ? latest.value - prev.value : 0;
  const pct = prev?.value ? (diff / prev.value) * 100 : 0;
  return {
    id: meta.id, label: meta.label, value: latest.value, unit: meta.unit,
    date: latest.date, changeFromPrev: Number(diff.toFixed(2)), changePct: Number(pct.toFixed(2)),
  };
}

// ── market-data ─────────────────────────────────────────────

// 오늘의 시장 스냅샷: 환율 4종 + 기준금리 + KCCI 종합 + 주간 급등락 항로(±3% 이상).
async function getMarketSnapshot() {
  const fx = [];
  let baseRate = null;
  for (const s of ECOS_SERIES) {
    const two = await latestTwo(`${s.prefix}#${s.id}`);
    if (!two) continue;
    const snap = withChange(s, two);
    if (s.id === "BOK_BASE_RATE") baseRate = snap;
    else fx.push(snap);
  }
  const kcciAll = [];
  for (const s of KCCI_SERIES) {
    const two = await latestTwo(`KCCI#${s.id}`);
    if (two) kcciAll.push(withChange(s, two));
  }
  const composite = kcciAll.find((k) => k.id === "KCCI") ?? null;
  const notableRoutes = kcciAll
    .filter((k) => k.id !== "KCCI" && Math.abs(k.changePct) >= 3)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  return { asOf: todayKst(), fx, baseRate, kcciComposite: composite, notableRoutes };
}

// 특정 시계열 최근 N일. 장기 조회도 에이전트 컨텍스트에 안전하도록 최대 200포인트로 균등 샘플링.
async function getMarketSeries({ seriesId, days }) {
  const meta = TOOL_SERIES.find((s) => s.id === seriesId);
  if (!meta) {
    return { error: `unknown seriesId: ${seriesId}`, availableSeries: TOOL_SERIES.map((s) => `${s.id}(${s.label})`) };
  }
  const n = Math.min(Math.max(Number(days) || 90, 7), 3650);
  const fromDate = new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const items = [];
  let exclusiveStartKey;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: MARKET_TABLE,
      KeyConditionExpression: "series = :s AND #d >= :from",
      ExpressionAttributeNames: { "#d": "date" },
      ExpressionAttributeValues: { ":s": `${meta.prefix}#${seriesId}`, ":from": fromDate },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(r.Items ?? []));
    exclusiveStartKey = r.LastEvaluatedKey;
  } while (exclusiveStartKey);

  let points = items
    .map((i) => ({ date: i.date, value: i.value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const total = points.length;
  if (total > 200) {
    const step = (total - 1) / 199;
    points = Array.from({ length: 200 }, (_, i) => points[Math.round(i * step)]);
  }
  return { id: meta.id, label: meta.label, unit: meta.unit, days: n, totalPoints: total, sampled: total > 200, points };
}

// ── news-data ───────────────────────────────────────────────

async function getTopNews({ date, limit }) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? "")) ? date : todayKst();
  const n = Math.min(Math.max(Number(limit) || 5, 1), 20);
  const r = await ddb.send(new QueryCommand({
    TableName: NEWS_TABLE,
    KeyConditionExpression: "#d = :d",
    ExpressionAttributeNames: { "#d": "date" },
    ExpressionAttributeValues: { ":d": d },
  }));
  const items = (r.Items ?? [])
    .filter((it) => (it.score ?? 0) > 0 && !it.duplicate)
    .sort((a, b) => b.score - a.score || b.pubDate.localeCompare(a.pubDate))
    .slice(0, n)
    .map(({ title, source, pubDate, link }) => ({ title, source, pubDate, link }));
  return { date: d, count: items.length, items };
}

// ── company-data ────────────────────────────────────────────

// 샘플 포트폴리오 6건의 결정카드 — 규칙엔진(decision.mjs)이 확정한 행동/숫자.
async function getShipmentDecisions() {
  const marketByRoute = {};
  for (const s of KCCI_SERIES.filter((x) => x.id !== "KCCI")) {
    const two = await latestTwo(`KCCI#${s.id}`);
    if (!two) continue;
    const pct = two.prev?.value ? ((two.latest.value - two.prev.value) / two.prev.value) * 100 : 0;
    marketByRoute[s.id] = { name: s.label.replace(/\s*\(.*\)/, ""), value: two.latest.value, weeklyChangePct: pct, observedAt: two.latest.date };
  }
  const asOf = todayKst();
  const shipments = SHIPMENTS.map((sh) => {
    const quotes = QUOTES.filter((q) => q.shipmentId === sh.id);
    const card = buildDecisionCard(sh, quotes, marketByRoute, asOf);
    return {
      id: sh.id, route: `${sh.originLabel}→${sh.destinationLabel}`,
      equipment: `${sh.equipment}×${sh.containerCount}`, targetBudget: `${sh.targetBudget} ${sh.currency}`,
      action: card.actionLabel, priority: card.priority, deadline: card.deadline,
      budgetVariancePct: card.budgetVariancePct, kcciVariancePct: card.kcciVariancePct,
      reasons: card.reasons,
    };
  });
  return { asOf, note: "가상 샘플 포트폴리오(데모). 행동/숫자는 규칙엔진 확정값 — 바꾸지 말고 인용할 것.", shipments };
}

// 회사의 "이번 선적"(UI 폼 제출본 > 업로드 엑셀 > 번들 샘플 순).
async function getCurrentShipment() {
  const company = await loadCompany();
  if (!company?.current) return { error: "현재 선적 데이터 없음(엑셀 업로드 또는 현재 선적 폼 입력 필요)" };
  return { source: company.currentSource, current: company.current, policy: company.policy ?? null };
}

// 최신 AI 선적 추천 이력(recommend.mjs가 DynamoDB에 저장한 것).
async function getLatestRecommendation() {
  if (!RECO_TABLE) return { error: "추천 이력 테이블 미설정" };
  const company = await loadCompany();
  const shipmentId = company?.current?.shipmentId;
  if (!shipmentId) return { error: "현재 선적 데이터가 없어 추천 이력을 찾을 수 없음" };
  const r = await ddb.send(new QueryCommand({
    TableName: RECO_TABLE,
    KeyConditionExpression: "shipmentId = :s",
    ExpressionAttributeValues: { ":s": shipmentId },
    ScanIndexForward: false, Limit: 1,
  }));
  const item = r.Items?.[0];
  if (!item) return { shipmentId, recommendation: null, note: "저장된 추천 이력 없음 — GET /recommendations 최초 호출 전" };
  return {
    shipmentId, evaluatedAt: item.evaluatedAt, stance: item.stance, verdict: item.verdict,
    confidence: item.confidence, recommendedVessel: item.recommendedVessel,
    narrative: item.reco?.narrative ?? null, actions: item.reco?.actions ?? null,
  };
}

// ── web-search ──────────────────────────────────────────────

// Tavily 웹 검색. API 키는 Secrets Manager(portpulse/web-search, {"apiKey":"tvly-..."})에만 둔다.
// 키 미설정이면 실패 대신 "미설정" 안내를 돌려줘 에이전트가 DB 데이터만으로 답하게 유도한다.
let webSearchKeyCache;
async function getWebSearchKey() {
  if (webSearchKeyCache !== undefined) return webSearchKeyCache;
  const secretName = process.env.WEB_SEARCH_SECRET_NAME;
  if (!secretName) return (webSearchKeyCache = null);
  try {
    const r = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));
    webSearchKeyCache = JSON.parse(r.SecretString ?? "{}").apiKey ?? null;
  } catch {
    webSearchKeyCache = null;
  }
  return webSearchKeyCache;
}

async function webSearch({ query, maxResults }) {
  const q = String(query ?? "").trim();
  if (!q) return { error: "query is required" };
  const apiKey = await getWebSearchKey();
  if (!apiKey) {
    return { error: "웹 검색 미설정(Secrets Manager portpulse/web-search에 Tavily apiKey 필요). 내부 DB 도구만으로 답하고, 웹 검색이 필요한 질문이면 미설정 사실을 사용자에게 알릴 것." };
  }
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey, query: q, search_depth: "basic",
      max_results: Math.min(Math.max(Number(maxResults) || 5, 1), 8),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { error: `웹 검색 실패: HTTP ${res.status}` };
  const data = await res.json();
  return {
    query: q,
    results: (data.results ?? []).map(({ title, url, content }) => ({ title, url, snippet: String(content ?? "").slice(0, 400) })),
  };
}

// ── 디스패치 ────────────────────────────────────────────────

const TOOLS = {
  get_market_snapshot: getMarketSnapshot,
  get_market_series: getMarketSeries,
  get_top_news: getTopNews,
  get_shipment_decisions: getShipmentDecisions,
  get_current_shipment: getCurrentShipment,
  get_latest_recommendation: getLatestRecommendation,
  web_search: webSearch,
};

// Bedrock Agent function-details 이벤트 → 같은 포맷의 functionResponse로 응답.
// parameters는 [{name,type,value}] 배열로 오므로 객체로 풀어서 넘긴다.
export async function handler(event) {
  const fn = TOOLS[event.function];
  const params = Object.fromEntries((event.parameters ?? []).map((p) => [p.name, p.value]));

  let body;
  try {
    body = fn ? await fn(params) : { error: `unknown function: ${event.function}` };
  } catch (e) {
    console.error(`도구 실행 실패 [${event.function}]:`, e);
    body = { error: `도구 실행 실패: ${e.message}` };
  }

  return {
    messageVersion: "1.0",
    response: {
      actionGroup: event.actionGroup,
      function: event.function,
      functionResponse: { responseBody: { TEXT: { body: JSON.stringify(body) } } },
    },
  };
}
