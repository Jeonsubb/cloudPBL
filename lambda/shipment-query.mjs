// 선적 의사결정 조회 API.
// GET /shipments                    → 샘플 포트폴리오 결정카드(실시간 KCCI/환율 반영) + 포트폴리오 요약
// GET /shipments/{id}/advisor       → Bedrock 적극 추천형 AI 어드바이저(결정카드 근거 기반, 숫자 창작 금지)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { buildDecisionCard, quoteChargeTotal, quoteComparableTotal } from "./decision.mjs";
import { SHIPMENTS, QUOTES } from "./sample-portfolio.mjs";
import { KCCI_SERIES } from "./kcci-series.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-opus-4-5-20251101-v1:0";

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

function cardsFor(asOf, marketByRoute) {
  return SHIPMENTS.map((sh) => {
    const quotes = QUOTES.filter((q) => q.shipmentId === sh.id);
    const card = buildDecisionCard(sh, quotes, marketByRoute, asOf);
    return { shipment: sh, quotes, card };
  });
}

function portfolioSummary(entries) {
  const cards = entries.map((e) => e.card);
  const budgetExposure = entries.reduce((sum, e) => {
    const q = e.quotes.find((x) => x.id === e.card.quoteId);
    if (!q || (e.card.budgetVariancePct ?? 0) <= 0) return sum;
    return sum + Math.max(0, q.total - e.shipment.targetBudget);
  }, 0);
  return {
    total: cards.length,
    urgent: cards.filter((c) => c.priority === "URGENT").length,
    actionDue: cards.filter((c) => c.priority === "URGENT" || c.priority === "ACTION").length,
    directComparable: cards.filter((c) => c.comparability === "DIRECT").length,
    dataReview: cards.filter((c) => c.comparability !== "DIRECT").length,
    budgetExposureUsd: Math.round(budgetExposure),
  };
}

function advisorPrompt(entry, usdKrw) {
  const { shipment: sh, quotes, card } = entry;
  const quoteLines = quotes.map((q) =>
    `- ${q.id} ${q.forwarder}: 총 ${q.total.toLocaleString("en-US")} ${q.currency} (해상비 비교분 ${quoteComparableTotal(q).toLocaleString("en-US")}), 유효기간 ${q.validUntil}, ETD ${q.plannedEtd}→ETA ${q.plannedEta}, ${q.direct ? "직항" : `환적 ${q.transshipments}회`}`
  ).join("\n") || "(등록된 견적 없음)";

  const krwLine = usdKrw ? `참고 환율: 1 USD = ${usdKrw.value.toLocaleString("en-US")}원 (${usdKrw.date})` : "";
  const marketLine = card.market
    ? `동일 항로 KCCI(${card.market.name}): ${card.market.value.toLocaleString("en-US")} (전주 ${card.market.weeklyChangePct >= 0 ? "+" : ""}${card.market.weeklyChangePct.toFixed(2)}%, ${card.market.observedAt})`
    : "동일 항로 KCCI 비교값 없음";

  return `당신은 한국 수출기업의 국제물류 담당자를 돕는 시니어 물류 어드바이저입니다.
아래는 규칙엔진이 이미 계산한 '선적 결정 카드'와 근거 데이터입니다.
규칙엔진의 행동/숫자는 확정 사실이므로 바꾸지 말고, 그 위에 실무자가 바로 쓸 수 있는 조언을 적극적으로 제시하세요.

[선적]
${sh.id} ${sh.originLabel}→${sh.destinationLabel} / ${sh.equipment}×${sh.containerCount} ${sh.cargoProfile} ${sh.loadType}
품목: ${sh.description} / 인코텀즈 ${sh.incoterm} / 부킹통제 ${sh.bookingController}
목표예산 ${sh.targetBudget.toLocaleString("en-US")} ${sh.currency} (${sh.costScope}) / Cargo Ready ${sh.cargoReadyDate} / 납기 ${sh.requiredDeliveryDate}

[견적]
${quoteLines}

[규칙엔진 결정 — 확정]
행동: ${card.actionLabel}(${card.action}) / 우선순위 ${card.priority} / 신뢰도 ${card.confidence} / 마감 ${card.deadline}
예산편차: ${card.budgetVariancePct === null ? "N/A" : card.budgetVariancePct.toFixed(1) + "%"} / KCCI편차: ${card.kcciVariancePct === null ? "N/A(비교불가)" : card.kcciVariancePct.toFixed(1) + "%"}
납기버퍼: ${card.deliveryBufferDays ?? "N/A"}일 / 견적유효: ${card.quoteValidityDays ?? "N/A"}일 / 비교가능성: ${card.comparability}
근거: ${card.reasons.join(" ")}
주의신호: ${card.counterSignals.join(" ") || "없음"}
${marketLine}
${krwLine}

[작성 지침]
- 마크다운 기호 없이 순수 텍스트. 📌로 시작하는 2~3개 짧은 단락.
- 규칙엔진이 정한 행동을 먼저 한 문장으로 확인한 뒤, "왜 그런지"를 데이터로 풀어 설명.
- 실무자가 오늘 당장 할 구체적 행동(누구에게 무엇을 언제까지)을 제안. 재견적이면 어떤 항목을 얼마나 낮춰달라 요청할지까지.
- 위 데이터에 없는 수치(미래 운임, 정확한 ETA 등)는 지어내지 말 것. 불확실하면 불확실하다고 쓸 것.
- 마지막 줄에 "※ AI 참고 의견이며 최종 판단은 담당자 확인이 필요합니다." 한 줄 추가.`;
}

async function callBedrock(prompt) {
  const r = await bedrock.send(new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 1400, temperature: 0.5 },
  }));
  return r.output?.message?.content?.[0]?.text ?? "";
}

export async function handler(event) {
  const tableName = process.env.MARKET_TABLE_NAME;
  const asOf = todayKst();
  const path = event.rawPath || event.requestContext?.http?.path || "";
  const shipmentId = event.pathParameters?.shipmentId;

  const marketByRoute = await buildMarketByRoute(tableName);

  // 어드바이저: /shipments/{id}/advisor
  if (shipmentId && path.includes("/advisor")) {
    const quotes = QUOTES.filter((q) => q.shipmentId === shipmentId);
    const shipment = SHIPMENTS.find((s) => s.id === shipmentId);
    if (!shipment) return response(404, { error: `unknown shipment: ${shipmentId}` });
    const card = buildDecisionCard(shipment, quotes, marketByRoute, asOf);
    const usdKrw = await getUsdKrw(tableName);
    const advice = await callBedrock(advisorPrompt({ shipment, quotes, card }, usdKrw));
    return response(200, { shipmentId, action: card.action, advice, evaluatedAt: asOf });
  }

  // 목록
  const entries = cardsFor(asOf, marketByRoute);
  return response(200, {
    asOf,
    summary: portfolioSummary(entries),
    shipments: entries.map(({ shipment, quotes, card }) => ({
      id: shipment.id,
      route: `${shipment.originLabel}→${shipment.destinationLabel}`,
      equipment: `${shipment.equipment}×${shipment.containerCount}`,
      description: shipment.description,
      targetBudget: shipment.targetBudget,
      currency: shipment.currency,
      selectedQuoteTotal: card.quoteId ? quoteChargeTotal(quotes.find((q) => q.id === card.quoteId)) : null,
      card,
    })),
  });
}
