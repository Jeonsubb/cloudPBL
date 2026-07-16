// 플로팅 챗봇 API. POST /chat { message, history? } → Bedrock 응답.
// 오늘의 시장 스냅샷(환율/기준금리/KCCI) + 뉴스 상위 + 샘플 선적 포트폴리오를 컨텍스트로 붙여서 답한다.
// 아직 RAG/실제 회사 문서 연동은 없음 — 그건 이후 단계(사용자 안내 문구로 명시).
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { SERIES as ECOS_SERIES } from "./series.mjs";
import { KCCI_SERIES } from "./kcci-series.mjs";
import { buildDecisionCard } from "./decision.mjs";
import { SHIPMENTS, QUOTES } from "./sample-portfolio.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-opus-4-5-20251101-v1:0";
const MAX_HISTORY_TURNS = 12;

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

async function fetchTopNews(newsTableName, date, limit = 5) {
  const r = await ddb.send(new QueryCommand({
    TableName: newsTableName,
    KeyConditionExpression: "#d = :d",
    ExpressionAttributeNames: { "#d": "date" },
    ExpressionAttributeValues: { ":d": date },
  }));
  return (r.Items ?? [])
    .filter((it) => (it.score ?? 0) > 0 && !it.duplicate)
    .sort((a, b) => b.score - a.score || b.pubDate.localeCompare(a.pubDate))
    .slice(0, limit)
    .map((it) => it.title);
}

async function buildMarketContext(marketTableName) {
  const lines = [];
  for (const s of ECOS_SERIES) {
    const two = await latestTwo(marketTableName, `${s.prefix}#${s.id}`);
    if (!two) continue;
    lines.push(`- ${s.label}: ${two.latest.value}${s.unit} (${two.latest.date} 기준)`);
  }
  const kcciAll = [];
  for (const s of KCCI_SERIES) {
    const two = await latestTwo(marketTableName, `KCCI#${s.id}`);
    if (!two) continue;
    const pct = two.prev?.value ? ((two.latest.value - two.prev.value) / two.prev.value) * 100 : 0;
    kcciAll.push({ id: s.id, label: s.label.replace(/\s*\(.*\)/, ""), value: two.latest.value, pct, date: two.latest.date });
  }
  const composite = kcciAll.find((k) => k.id === "KCCI");
  if (composite) lines.push(`- KCCI 종합지수: ${composite.value}pt (전주 ${composite.pct >= 0 ? "+" : ""}${composite.pct.toFixed(2)}%, ${composite.date})`);
  const notable = kcciAll.filter((k) => k.id !== "KCCI" && Math.abs(k.pct) >= 3).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  if (notable.length) lines.push(`- 주간 급등락 항로: ${notable.map((n) => `${n.label} ${n.pct >= 0 ? "+" : ""}${n.pct.toFixed(1)}%`).join(", ")}`);
  return lines.join("\n");
}

function buildPortfolioContext(marketByRoute, asOf) {
  const cards = SHIPMENTS.map((sh) => {
    const quotes = QUOTES.filter((q) => q.shipmentId === sh.id);
    const c = buildDecisionCard(sh, quotes, marketByRoute, asOf);
    return `- ${sh.id} (${sh.originLabel}→${sh.destinationLabel}, ${sh.equipment}×${sh.containerCount}): ${c.actionLabel} / ${c.priority} / 마감 ${c.deadline}`;
  });
  return cards.join("\n");
}

async function buildMarketByRoute(marketTableName) {
  const map = {};
  for (const s of KCCI_SERIES.filter((x) => x.id !== "KCCI")) {
    const two = await latestTwo(marketTableName, `KCCI#${s.id}`);
    if (!two) continue;
    const pct = two.prev?.value ? ((two.latest.value - two.prev.value) / two.prev.value) * 100 : 0;
    map[s.id] = { name: s.label.replace(/\s*\(.*\)/, ""), value: two.latest.value, weeklyChangePct: pct, observedAt: two.latest.date };
  }
  return map;
}

function systemPrompt(marketContext, newsLines, portfolioContext, asOf) {
  return `당신은 PortPulse 대시보드에 내장된 AI 어시스턴트입니다. 한국 수출기업의 해운·물류·환율 담당자를 돕습니다.
오늘(${asOf}) 기준 아래 데이터를 근거로 답하세요. 데이터에 없는 내용은 지어내지 말고 모른다고 답하세요.
아직 특정 회사의 실제 계약서·문서·사내 데이터베이스는 연결돼 있지 않습니다(추후 연동 예정) — 회사 고유 정보를 물으면 이 점을 안내하세요.
마크다운 기호 없이 짧고 실무적인 한국어로 답하세요.

[오늘의 시장 스냅샷]
${marketContext}

[오늘의 해운 뉴스 상위]
${newsLines.map((t, i) => `${i + 1}. ${t}`).join("\n") || "(수집된 뉴스 없음)"}

[샘플 선적 포트폴리오 — 가상 데모 데이터]
${portfolioContext}`;
}

export async function handler(event) {
  const marketTableName = process.env.MARKET_TABLE_NAME;
  const newsTableName = process.env.NEWS_TABLE_NAME;
  const body = JSON.parse(event.body || "{}");
  const message = String(body.message || "").slice(0, 2000);
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];
  if (!message.trim()) return response(400, { error: "message is required" });

  const asOf = todayKst();
  const [marketContext, newsLines, marketByRoute] = await Promise.all([
    buildMarketContext(marketTableName),
    fetchTopNews(newsTableName, asOf),
    buildMarketByRoute(marketTableName),
  ]);
  const portfolioContext = buildPortfolioContext(marketByRoute, asOf);

  const messages = [
    ...history.map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: [{ text: String(h.text || "").slice(0, 2000) }] })),
    { role: "user", content: [{ text: message }] },
  ];

  const result = await bedrock.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: systemPrompt(marketContext, newsLines, portfolioContext, asOf) }],
    messages,
    inferenceConfig: { maxTokens: 800, temperature: 0.4 },
  }));
  const reply = result.output?.message?.content?.[0]?.text ?? "";

  return response(200, { reply });
}
