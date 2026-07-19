// Bedrock Agent Action Group Lambda.
// Agent가 사용자 질문에 답하기 위해 필요한 데이터를 DynamoDB에서 조회하는 도구 모음.
// Bedrock Agent 프로토콜: event에 function/parameters가 오고, 고정된 JSON 형식으로 응답한다.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SERIES as ECOS_SERIES } from "./series.mjs";
import { KCCI_SERIES } from "./kcci-series.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const MARKET_TABLE = process.env.MARKET_TABLE_NAME;
const NEWS_TABLE = process.env.NEWS_TABLE_NAME;
const RECO_TABLE = process.env.RECO_TABLE_NAME;

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDate(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

// ── 도구 구현 ──────────────────────────────────────────────────

async function getMarketSnapshot(params) {
  const route = params.route || "KCCI";
  // KCCI 종합 + 요청 항로
  const composite = await latestTwo(`KCCI#KCCI`);
  const routeData = route !== "KCCI" ? await latestTwo(`KCCI#${route}`) : null;

  // 주요 환율·금리
  const usdKrw = await latestTwo("ECOS#FX_USD_KRW");
  const baseRate = await latestTwo("ECOS#BOK_BASE_RATE");

  // 주간 급등락 항로 (|pct| >= 3%)
  const notable = [];
  for (const s of KCCI_SERIES.filter((x) => x.id !== "KCCI")) {
    const two = await latestTwo(`KCCI#${s.id}`);
    if (!two || !two.prev) continue;
    const pct = ((two.latest.value - two.prev.value) / two.prev.value) * 100;
    if (Math.abs(pct) >= 3) notable.push({ route: s.id, label: s.label.replace(/\s*\(.*\)/, ""), value: two.latest.value, weeklyChangePct: +pct.toFixed(2), date: two.latest.date });
  }
  notable.sort((a, b) => Math.abs(b.weeklyChangePct) - Math.abs(a.weeklyChangePct));

  return {
    kcci: composite ? { value: composite.latest.value, date: composite.latest.date, weeklyChangePct: composite.pct } : null,
    requestedRoute: routeData ? { route, value: routeData.latest.value, date: routeData.latest.date, weeklyChangePct: routeData.pct } : null,
    usdKrw: usdKrw ? { value: usdKrw.latest.value, date: usdKrw.latest.date, dailyChangePct: usdKrw.pct } : null,
    baseRate: baseRate ? { value: baseRate.latest.value, date: baseRate.latest.date } : null,
    notableRoutes: notable.slice(0, 5),
  };
}

async function getHighImpactNews(params) {
  const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 10);
  const date = todayKst();
  // 오늘 + 어제까지 최대 2일 롤링
  const dates = [date, shiftDate(date, -1)];
  const allItems = [];

  for (const d of dates) {
    const r = await ddb.send(new QueryCommand({
      TableName: NEWS_TABLE,
      KeyConditionExpression: "#d = :d",
      ExpressionAttributeNames: { "#d": "date" },
      ExpressionAttributeValues: { ":d": d },
    }));
    allItems.push(...(r.Items ?? []));
  }

  const filtered = allItems
    .filter((it) => (it.score ?? 0) > 0 && !it.duplicate)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.pubDate.localeCompare(a.pubDate))
    .slice(0, limit)
    .map(({ title, source, pubDate, link, score }) => ({ title, source, pubDate, link, score }));

  return { date, count: filtered.length, news: filtered };
}

async function getShipmentRisk(params) {
  const shipmentId = params.shipmentId;
  if (!shipmentId) return { error: "shipmentId 파라미터가 필요합니다." };
  if (!RECO_TABLE) return { error: "추천 테이블이 설정되지 않았습니다." };

  // 최근 추천 이력 조회
  const r = await ddb.send(new QueryCommand({
    TableName: RECO_TABLE,
    KeyConditionExpression: "shipmentId = :s",
    ExpressionAttributeValues: { ":s": shipmentId },
    ScanIndexForward: false,
    Limit: 3,
  }));

  const items = (r.Items ?? []).map((it) => ({
    shipmentId: it.shipmentId,
    evaluatedAt: it.evaluatedAt,
    stance: it.stance,
    verdict: it.verdict,
    confidence: it.confidence,
    vessel: it.recommendedVessel,
    marketPctile52: it.marketPctile52,
  }));

  return { shipmentId, recommendations: items };
}

async function getMarketSeries(params) {
  const seriesId = params.seriesId;
  const days = Math.min(Math.max(Number(params.days) || 30, 7), 365);

  // series 목록에서 찾기
  const meta = [...ECOS_SERIES, ...KCCI_SERIES].find((s) => s.id === seriesId);
  if (!meta) return { error: `알 수 없는 시계열: ${seriesId}. 가능한 값: ${KCCI_SERIES.map((s) => s.id).join(", ")}, ${ECOS_SERIES.map((s) => s.id).join(", ")}` };

  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const r = await ddb.send(new QueryCommand({
    TableName: MARKET_TABLE,
    KeyConditionExpression: "series = :s AND #d >= :from",
    ExpressionAttributeNames: { "#d": "date" },
    ExpressionAttributeValues: { ":s": `${meta.prefix}#${seriesId}`, ":from": fromDate },
  }));

  const points = (r.Items ?? [])
    .map((i) => ({ date: i.date, value: i.value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 요약 통계 계산
  const values = points.map((p) => p.value);
  const summary = values.length > 0 ? {
    latest: values.at(-1),
    min: Math.min(...values),
    max: Math.max(...values),
    avg: +(values.reduce((s, v) => s + v, 0) / values.length).toFixed(2),
    count: values.length,
    periodStart: points[0].date,
    periodEnd: points.at(-1).date,
  } : null;

  return { seriesId, label: meta.label, unit: meta.unit, days, summary, points: points.slice(-30) };
}

// ── 유틸리티 ──────────────────────────────────────────────────

async function latestTwo(seriesKey) {
  const r = await ddb.send(new QueryCommand({
    TableName: MARKET_TABLE,
    KeyConditionExpression: "series = :s",
    ExpressionAttributeValues: { ":s": seriesKey },
    ScanIndexForward: false,
    Limit: 2,
  }));
  const [latest, prev] = r.Items ?? [];
  if (!latest) return null;
  const pct = prev?.value ? +((latest.value - prev.value) / prev.value * 100).toFixed(2) : 0;
  return { latest, prev, pct };
}

// ── Bedrock Agent 핸들러 ─────────────────────────────────────

export async function handler(event) {
  const actionGroup = event.actionGroup || "PortPulseTools";
  const functionName = event.function || "";
  const parameters = {};
  for (const p of event.parameters || []) {
    if (p.name) parameters[p.name] = p.value;
  }

  let result;
  try {
    switch (functionName) {
      case "GetMarketSnapshot":
        result = await getMarketSnapshot(parameters);
        break;
      case "GetHighImpactNews":
        result = await getHighImpactNews(parameters);
        break;
      case "GetShipmentRisk":
        result = await getShipmentRisk(parameters);
        break;
      case "GetMarketSeries":
        result = await getMarketSeries(parameters);
        break;
      default:
        result = { error: `알 수 없는 도구: ${functionName}` };
    }
  } catch (err) {
    console.error(`Agent tool error (${functionName}):`, err);
    result = { error: "데이터 조회 중 오류가 발생했습니다." };
  }

  // Bedrock Agent 응답 프로토콜
  return {
    messageVersion: "1.0",
    response: {
      actionGroup,
      function: functionName,
      functionResponse: {
        responseBody: {
          TEXT: { body: JSON.stringify(result, null, 0) },
        },
      },
    },
    sessionAttributes: event.sessionAttributes || {},
    promptSessionAttributes: event.promptSessionAttributes || {},
  };
}
