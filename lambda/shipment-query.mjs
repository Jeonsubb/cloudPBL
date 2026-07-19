// 선적 의사결정 조회 API.
// GET /shipments                    → 샘플 포트폴리오 원본 데이터(선적·견적·시장가) — Agent가 판단
// GET /shipments/{id}/advisor       → Bedrock Agent 어드바이저(Agent가 데이터를 보고 직접 의사결정)
// Agent 극대화 구조: 규칙엔진 제거, Agent가 선적·견적·시장 데이터를 직접 분석해 행동을 결정한다.
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { SHIPMENTS, QUOTES } from "./sample-portfolio.mjs";
import { KCCI_SERIES } from "./kcci-series.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const agentRuntime = new BedrockAgentRuntimeClient({});
const AGENT_ID = process.env.AGENT_ID;
const AGENT_ALIAS_ID = process.env.AGENT_ALIAS_ID;

function response(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function latestTwo(tableName, seriesKey) {
  const r = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "series = :s",
    ExpressionAttributeValues: { ":s": seriesKey },
    ScanIndexForward: false, Limit: 2,
  }));
  const [latest, prev] = r.Items ?? [];
  return latest ? { latest, prev } : null;
}

// 실시간 KCCI 13개 항로 → { routeCode: {name, value, weeklyChangePct, observedAt} }
async function buildMarketByRoute(tableName) {
  const map = {};
  for (const s of KCCI_SERIES.filter((x) => x.id !== "KCCI")) {
    const two = await latestTwo(tableName, `KCCI#${s.id}`);
    if (!two) continue;
    const value = two.latest.value;
    const weeklyChangePct = two.prev?.value ? ((value - two.prev.value) / two.prev.value) * 100 : 0;
    map[s.id] = { name: s.label.replace(/\s*\(.*\)/, ""), value, weeklyChangePct, observedAt: two.latest.date };
  }
  return map;
}

async function getUsdKrw(tableName) {
  const two = await latestTwo(tableName, "ECOS#FX_USD_KRW");
  return two ? { value: two.latest.value, date: two.latest.date } : null;
}

// 포트폴리오 원본 데이터 — Agent가 직접 판단할 수 있도록 선적·견적·시장가를 그대로 반환
function buildPortfolioData(asOf, marketByRoute) {
  return SHIPMENTS.map((sh) => {
    const quotes = QUOTES.filter((q) => q.shipmentId === sh.id);
    const market = sh.routeCode ? marketByRoute[sh.routeCode] : null;
    const quotesWithComparable = quotes.map((q) => {
      const comparableCharges = q.charges.filter((c) => c.kcciComparable);
      const comparableTotal = comparableCharges.reduce((s, c) => s + c.amount * c.quantity, 0);
      const comparablePerFeu = sh.containerCount > 0 ? Math.round(comparableTotal / sh.containerCount) : comparableTotal;
      return {
        id: q.id, forwarder: q.forwarder, total: q.total, currency: q.currency,
        comparablePerFeu, validUntil: q.validUntil,
        plannedEtd: q.plannedEtd, plannedEta: q.plannedEta,
        direct: q.direct, transshipments: q.transshipments,
      };
    });
    const daysToDelivery = Math.ceil((new Date(`${sh.requiredDeliveryDate}T00:00:00+09:00`) - new Date(`${asOf}T00:00:00+09:00`)) / 86_400_000);
    return {
      shipment: sh, quotes: quotesWithComparable,
      market, daysToDelivery,
    };
  });
}

function advisorPrompt(shipment, quotes, marketByRoute, usdKrw) {
  const market = shipment.routeCode ? marketByRoute[shipment.routeCode] : null;
  const quoteLines = quotes.map((q) => {
    const comparableCharges = q.charges.filter((c) => c.kcciComparable);
    const comparableTotal = comparableCharges.reduce((s, c) => s + c.amount * c.quantity, 0);
    const comparablePerFeu = shipment.containerCount > 0 ? Math.round(comparableTotal / shipment.containerCount) : comparableTotal;
    return `- ${q.id} ${q.forwarder}: 총 ${q.total.toLocaleString("en-US")} ${q.currency} (해상비 비교분 FEU당 ${comparablePerFeu.toLocaleString("en-US")}), 유효기간 ${q.validUntil}, ETD ${q.plannedEtd}→ETA ${q.plannedEta}, ${q.direct ? "직항" : `환적 ${q.transshipments}회`}`;
  }).join("\n") || "(등록된 견적 없음)";

  const krwLine = usdKrw ? `참고 환율: 1 USD = ${usdKrw.value.toLocaleString("en-US")}원 (${usdKrw.date})` : "";
  const marketLine = market
    ? `동일 항로 KCCI(${market.name}): FEU당 ${market.value.toLocaleString("en-US")} USD (전주 ${market.weeklyChangePct >= 0 ? "+" : ""}${market.weeklyChangePct.toFixed(2)}%, ${market.observedAt})`
    : "동일 항로 KCCI 비교값 없음";
  const budgetVsQuote = quotes.length > 0
    ? `예산 대비: 최저 견적 ${Math.min(...quotes.map(q => q.total)).toLocaleString("en-US")} vs 목표 ${shipment.targetBudget.toLocaleString("en-US")} ${shipment.currency} (${((Math.min(...quotes.map(q => q.total)) / shipment.targetBudget - 1) * 100).toFixed(1)}%)`
    : "";

  return `아래 선적의 데이터를 분석해서, 지금 어떤 행동을 취해야 하는지 직접 판단하고 조언해주세요.

[선적 정보]
${shipment.id} ${shipment.originLabel}→${shipment.destinationLabel} / ${shipment.equipment}×${shipment.containerCount} ${shipment.cargoProfile} ${shipment.loadType}
품목: ${shipment.description} / 인코텀즈 ${shipment.incoterm} / 부킹통제 ${shipment.bookingController}
목표예산 ${shipment.targetBudget.toLocaleString("en-US")} ${shipment.currency} (${shipment.costScope})
Cargo Ready ${shipment.cargoReadyDate} / 납기 ${shipment.requiredDeliveryDate}

[포워더 견적]
${quoteLines}
${budgetVsQuote}

[시장 데이터]
${marketLine}
${krwLine}

[요청]
- 위 데이터를 종합 분석해서 행동(BOOK_NOW/BOOK_SOON/CONSIDER_WAIT/REQUEST_REQUOTE/DEADLINE_RISK)을 직접 결정하세요.
- 판단 근거를 수치와 함께 명시하세요.
- 실무자가 오늘 당장 할 구체적 행동(누구에게 무엇을 언제까지)을 제안하세요.
- 필요하면 get_top_news나 web_search로 이 항로의 시황 맥락을 보강해도 좋습니다.
- 마크다운 기호 없이 순수 텍스트로 작성하세요.`;
}

// 어드바이저는 일회성 작업이라 세션 재사용 없이 매번 새 sessionId로 부른다.
async function invokeAdvisorAgent(prompt) {
  if (!AGENT_ID || !AGENT_ALIAS_ID) throw new Error("AGENT_ID/AGENT_ALIAS_ID env is required");
  const r = await agentRuntime.send(new InvokeAgentCommand({
    agentId: AGENT_ID,
    agentAliasId: AGENT_ALIAS_ID,
    sessionId: `advisor-${randomUUID()}`,
    inputText: prompt,
  }));
  let text = "";
  for await (const ev of r.completion) {
    if (ev.chunk?.bytes) text += new TextDecoder().decode(ev.chunk.bytes);
  }
  return text;
}

export async function handler(event) {
  const tableName = process.env.MARKET_TABLE_NAME;
  const asOf = todayKst();
  const path = event.rawPath || event.requestContext?.http?.path || "";
  const shipmentId = event.pathParameters?.shipmentId;

  const marketByRoute = await buildMarketByRoute(tableName);

  // 어드바이저: /shipments/{id}/advisor — Agent가 직접 판단
  if (shipmentId && path.includes("/advisor")) {
    const shipment = SHIPMENTS.find((s) => s.id === shipmentId);
    if (!shipment) return response(404, { error: `unknown shipment: ${shipmentId}` });
    const quotes = QUOTES.filter((q) => q.shipmentId === shipmentId);
    const usdKrw = await getUsdKrw(tableName);
    const prompt = advisorPrompt(shipment, quotes, marketByRoute, usdKrw);
    const advice = await invokeAdvisorAgent(prompt);
    return response(200, { shipmentId, advice, evaluatedAt: asOf });
  }

  // 목록: 원본 데이터 반환 (규칙엔진 없이)
  const entries = buildPortfolioData(asOf, marketByRoute);
  return response(200, {
    asOf,
    shipments: entries.map(({ shipment, quotes, market, daysToDelivery }) => ({
      id: shipment.id,
      route: `${shipment.originLabel}→${shipment.destinationLabel}`,
      routeCode: shipment.routeCode,
      equipment: `${shipment.equipment}×${shipment.containerCount}`,
      description: shipment.description,
      incoterm: shipment.incoterm,
      bookingController: shipment.bookingController,
      targetBudget: shipment.targetBudget,
      currency: shipment.currency,
      cargoReadyDate: shipment.cargoReadyDate,
      requiredDeliveryDate: shipment.requiredDeliveryDate,
      daysToDelivery,
      quotes,
      market,
    })),
  });
}
