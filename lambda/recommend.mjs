// AI 선적 추천 Lambda — 회사 엑셀 + KCCI 시계열 + 실제 스케줄 + 환율·금리·뉴스를 종합해
// "지금 이 배로 보내라 / 지금은 미뤄라"를 근거와 함께 서술로 추천한다.
//
// 파이프라인:
//   ① 데이터 로드(S3 회사엑셀 · DynamoDB KCCI/FX/뉴스 — 없으면 번들 스냅샷 폴백)
//   ② recommend-engine.buildBrief() 로 모든 숫자 확정(순수 계산)
//   ③ Bedrock(Claude)에 브리프+뉴스를 넘겨 설득형 추천 '서사'를 JSON으로 생성(숫자 창작 금지)
//   ④ JSON 스키마 검증 + 1회 자가수정 재시도
//   ⑤ DynamoDB(portpulse-recommendations)에 이력 저장 후 응답
//
// GET /recommendations            → 현재 선적 추천(회사 데이터 기준)
// GET /recommendations/{id}        → 특정 선적(데모는 현재건과 동일 id)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { buildBrief, scheduleWindow, summarizePortfolio } from "./recommend-engine.mjs";
import { resolveRoute } from "./route-map.mjs";
import { loadRouteSchedule } from "./schedule-query.mjs";
import { parseCompanyFromS3 } from "./company-input.mjs";
import { companyIdFromEvent, companyExcelKey, currentShipmentKey, recoPartitionKey, DEFAULT_COMPANY_ID } from "./tenant.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});
const s3 = new S3Client({});
const lambdaClient = new LambdaClient({});
const SELF_FUNCTION_NAME = process.env.SELF_FUNCTION_NAME; // 비동기 자기호출용(30초 한도 회피)
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-opus-4-5-20251101-v1:0";
const MARKET_TABLE = process.env.MARKET_TABLE_NAME;
const NEWS_TABLE = process.env.NEWS_TABLE_NAME;
const RECO_TABLE = process.env.RECO_TABLE_NAME;
const SCHEDULE_TABLE = process.env.SCHEDULE_TABLE_NAME;
const COMPANY_BUCKET = process.env.COMPANY_BUCKET;

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const bundled = (f) => JSON.parse(readFileSync(here(f), "utf8"));

const json = (code, body) => ({ statusCode: code, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const todayKst = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

// ── 데이터 로드 ─────────────────────────────────────────────
// policy·history는 엑셀에서만 온다. current(이번 선적)는 UI 폼 제출본이 있으면 그걸 우선하고,
// 없으면 엑셀의 2_Current_Shipment 시트, 그마저 없으면 번들 샘플로 폴백한다.
async function loadCurrentOverride(companyId) {
  if (!COMPANY_BUCKET) return null;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: COMPANY_BUCKET, Key: currentShipmentKey(companyId) }));
    return JSON.parse(await res.Body.transformToString());
  } catch { return null; }
}

// 회사 데이터 로드(companyId별) — 에이전트 도구(agent-tools.mjs)도 같은 우선순위(UI폼>엑셀>번들)를 써야 해서 export.
export async function loadCompany(companyId = DEFAULT_COMPANY_ID) {
  const fallback = bundled("./sample-company.json");
  let base = fallback;
  let currentSource = "bundled";
  if (COMPANY_BUCKET) {
    try {
      const parsed = await parseCompanyFromS3(COMPANY_BUCKET, companyExcelKey(companyId));
      base = { policy: parsed.policy ?? fallback.policy, current: parsed.current ?? fallback.current, history: parsed.history?.length ? parsed.history : fallback.history };
      currentSource = parsed.current ? "excel" : "bundled";
    } catch (e) { console.warn("S3 회사데이터(엑셀) 로드 실패, 번들 폴백:", e.message); }
  }
  const override = await loadCurrentOverride(companyId);
  if (override) { base = { ...base, current: override }; currentSource = "ui_form"; }
  return { ...base, currentSource };
}

// DynamoDB에서 KCCI 주간 시계열을 시도 → 부족하면 번들 생성이력 폴백
async function loadKcci() {
  const fallback = bundled("./kcci-history.json");
  if (!MARKET_TABLE) return { series: fallback.series, compositeNow: fallback.compositeNow, source: "bundled" };
  const routes = Object.keys(fallback.series);
  const series = {};
  try {
    await Promise.all(routes.map(async (code) => {
      const r = await ddb.send(new QueryCommand({
        TableName: MARKET_TABLE,
        KeyConditionExpression: "series = :s",
        ExpressionAttributeValues: { ":s": `KCCI#${code}` },
      }));
      const pts = (r.Items ?? []).map((i) => ({ date: i.date, value: Number(i.value) })).sort((a, b) => a.date.localeCompare(b.date));
      if (pts.length >= 20) series[code] = pts;
    }));
  } catch (e) { console.warn("DynamoDB KCCI 로드 실패:", e.message); }
  // 하나라도 부족하면 전체 번들 사용(정합 유지)
  if (Object.keys(series).length < routes.length) return { series: fallback.series, compositeNow: fallback.compositeNow, source: "bundled" };
  return { series, compositeNow: series.KCCI?.at(-1)?.value ?? fallback.compositeNow, source: "dynamodb" };
}

async function loadMacro() {
  const snap = bundled("./macro-snapshot.json");
  return { USD: snap.USD, baseRate: snap.baseRate };
}

async function loadNewsHeadlines(limit = 6) {
  if (!NEWS_TABLE) return [];
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: NEWS_TABLE,
      KeyConditionExpression: "#d = :d",
      ExpressionAttributeNames: { "#d": "date" },
      ExpressionAttributeValues: { ":d": todayKst() },
      Limit: 40,
    }));
    return (r.Items ?? [])
      .filter((i) => !i.duplicate && (i.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit)
      .map((i) => ({ title: i.title, source: i.source }));
  } catch (e) { console.warn("뉴스 로드 실패:", e.message); return []; }
}

// ── Bedrock 프롬프트 ────────────────────────────────────────
const SYSTEM_PROMPT = `당신은 한국 수출기업의 국제물류를 자문하는 15년차 해상운임 전략가다.
화주가 "지금 이 화물을 어떻게 보내야 하나"를 물으면, 시황·자사 이력·실제 선박 스케줄을 종합해
결단력 있고 구체적인 추천을 한국어로 제시한다.

원칙:
- 근거로 인용하는 모든 수치는 입력 브리프에 있는 값만 사용한다. 없는 숫자(미래 운임, 정확 ETA 등)는 절대 지어내지 않는다.
- 뻔한 양비론 금지. 데이터가 한쪽을 가리키면 분명하게 그쪽을 추천하고, 왜인지 숫자로 설득한다.
- "과거 대비 지금 수준이 어떤지", "회사 예산·과거 실거래 대비 어떤지", "왜 이 스케줄인지", "어느 포워더인지"까지 짚는다.
- 서술은 실무자가 그대로 상신 보고서에 붙일 수 있을 만큼 구체적이되, 과장·공포마케팅은 피한다.
- 반드시 지정된 JSON 스키마 하나만 출력한다. 코드펜스·설명문 없이 순수 JSON.`;

function userPrompt(brief, news) {
  const newsBlock = news.length
    ? news.map((n) => `- ${n.title} (${n.source})`).join("\n")
    : "(오늘 수집된 관련 헤드라인 없음)";
  return `## 판단할 선적 브리프(모든 숫자는 확정값이다)
\`\`\`json
${JSON.stringify(brief, null, 2)}
\`\`\`

## 오늘의 해운 시황 헤드라인(정성 참고용, 수치 인용 금지)
${newsBlock}

## 출력 스키마 — 아래 JSON 하나만, 순수 JSON으로 출력
{
  "verdict": "12자 내외의 결단형 헤드라인 (예: '지금 예약하세요, 미룰 장이 아닙니다')",
  "stance": "BOOK_NOW | BOOK_SOON | CONSIDER_WAIT | DEADLINE_RISK 중 하나",
  "confidence": "HIGH | MEDIUM | LOW",
  "recommendedSailing": { "vessel": "", "operator": "", "service": "", "etd": "", "eta": "", "priceUSDPerFeu": 0, "why": "이 항차를 고른 한 문장 이유" },
  "narrative": "3~5문단, 마크다운 기호 없는 순수 한국어 서술. (1) 지금 시장이 과거 대비 어느 수준인지 백분위·yoy로 (2) 회사 예산과 자사 과거 실거래·시장연동 공정가 대비 이 운임이 합리적인지 (3) 왜 이 스케줄이고 왜 지금인지(납기·버퍼·탑승가능 항차 수) (4) 어느 포워더로, 무엇을 협상할지. 문단은 개행 두 번으로 구분.",
  "keyNumbers": [ { "label": "짧은 라벨", "value": "값(단위 포함)", "note": "한 줄 설명" } ],
  "actions": [ "오늘 당장 할 구체 행동(누구에게 무엇을)" ],
  "risks": [ "이 추천의 반대 시나리오/주의점" ],
  "watchTriggers": [ "이런 조건이 되면 판단을 뒤집어야 한다" ],
  "nextReviewDate": "YYYY-MM-DD"
}
keyNumbers는 3~5개, actions/risks/watchTriggers는 각 2~4개. narrative가 이 추천의 핵심이니 가장 공들여 쓴다.`;
}

async function converseJson(system, user) {
  const r = await bedrock.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: user }] }],
    inferenceConfig: { maxTokens: 2600, temperature: 0.6 },
  }));
  return r.output?.message?.content?.[0]?.text ?? "";
}

function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

const REQUIRED = ["verdict", "stance", "confidence", "recommendedSailing", "narrative", "keyNumbers", "actions"];
function validate(obj) {
  const missing = REQUIRED.filter((k) => obj[k] == null);
  if (missing.length) throw new Error(`필드 누락: ${missing.join(", ")}`);
  if (!Array.isArray(obj.keyNumbers) || obj.keyNumbers.length === 0) throw new Error("keyNumbers 비어있음");
  if (typeof obj.narrative !== "string" || obj.narrative.length < 80) throw new Error("narrative 너무 짧음");
  return obj;
}

async function generateRecommendation(brief, news) {
  const user = userPrompt(brief, news);
  let raw = await converseJson(SYSTEM_PROMPT, user);
  try {
    return validate(extractJson(raw));
  } catch (err) {
    // 1회 자가수정 재시도
    const repair = `${user}\n\n## 직전 출력이 스키마를 어겼다: ${err.message}\n스키마를 정확히 지켜 순수 JSON 하나만 다시 출력하라.`;
    raw = await converseJson(SYSTEM_PROMPT, repair);
    return validate(extractJson(raw));
  }
}

// ── 포트폴리오(다건) 추천 ────────────────────────────────────
const PORTFOLIO_SYSTEM_PROMPT = `당신은 한국 수출기업의 국제물류를 총괄하는 15년차 해상운임 전략가다.
회사가 앞으로 보내야 하는 '여러 건의 선적(포트폴리오)'을 받아, 실제 선박 스케줄·합성 시장운임·납기·자사 이력·시황을 종합해
"어느 건을 지금 예약하고 어느 건은 미루며, 각각 어떤 배로 얼마에 보낼지"를 우선순위와 함께 결단력 있게 제시한다.

원칙:
- 인용하는 모든 수치는 입력 포트폴리오 데이터에 있는 값만 쓴다. 없는 숫자는 지어내지 않는다.
- 각 선적의 stance/priority/추천항차는 입력의 cheapestFeasible·lean·feasibleCount·vsBudgetPct·납기를 근거로 정한다.
- 납기위험(feasibleCount 0 또는 lean DEADLINE_RISK)은 최우선으로 다룬다.
- 포트폴리오 전체 관점(총 실현비용·예산초과노출·지금 예약해야 할 건수)에서 실무자가 상신할 수 있는 요약을 준다.
- 반드시 지정된 JSON 스키마 하나만, 코드펜스·설명문 없이 순수 JSON으로 출력한다.`;

function portfolioPrompt(portfolio, news) {
  const newsBlock = news.length ? news.map((n) => `- ${n.title} (${n.source})`).join("\n") : "(오늘 수집된 관련 헤드라인 없음)";
  return `## 회사 선적 포트폴리오(모든 수치는 확정값 — cheapestFeasible=실제 스케줄 중 납기·환적 충족 최저가 항차)
\`\`\`json
${JSON.stringify(portfolio, null, 2)}
\`\`\`

## 오늘의 해운 시황 헤드라인(정성 참고용, 수치 인용 금지)
${newsBlock}

## 출력 스키마 — 아래 JSON 하나만, 순수 JSON으로
{
  "verdict": "포트폴리오 전체 한 줄 결단 헤드라인(예: '5건 중 2건은 오늘 예약, 3건은 관망')",
  "summaryNarrative": "2~3문단, 마크다운 없는 순수 한국어. 이번 기간 선적들을 전체적으로 어떻게 운영할지 — 총 실현비용·예산 대비·지금 움직일 건수·시장국면을 종합해 서술. 문단은 개행 두 번으로 구분.",
  "portfolioKeyNumbers": [ { "label": "짧은 라벨", "value": "값(단위 포함)", "note": "한 줄 설명" } ],
  "shipments": [
    { "id": "SHP-...(입력 id 그대로)", "stance": "BOOK_NOW | BOOK_SOON | CONSIDER_WAIT | DEADLINE_RISK", "priority": 1, "headline": "10자 내외 결단", "why": "이 판단의 근거 1~2문장(스케줄·운임·납기 수치 인용)", "recommendedSailing": { "vessel": "", "operator": "", "etd": "", "eta": "", "priceUSDPerFeu": 0 }, "action": "오늘 할 구체 행동" }
  ],
  "actions": [ "포트폴리오 차원에서 오늘 당장 할 일 2~4개" ]
}
- shipments 배열은 입력의 모든 선적을 priority 오름차순(1이 최우선)으로 포함한다. id는 입력 id를 그대로 쓴다.
- recommendedSailing은 각 선적의 cheapestFeasible 값을 사용하되, 없으면(납기 충족 항차 없음) 빈 값으로 두고 stance는 DEADLINE_RISK.
- portfolioKeyNumbers는 3~5개, actions는 2~4개. summaryNarrative가 핵심이니 가장 공들여 쓴다.`;
}

function validatePortfolio(obj) {
  const missing = ["verdict", "summaryNarrative", "shipments", "portfolioKeyNumbers"].filter((k) => obj[k] == null);
  if (missing.length) throw new Error(`필드 누락: ${missing.join(", ")}`);
  if (!Array.isArray(obj.shipments) || obj.shipments.length === 0) throw new Error("shipments 비어있음");
  if (typeof obj.summaryNarrative !== "string" || obj.summaryNarrative.length < 60) throw new Error("summaryNarrative 너무 짧음");
  return obj;
}

async function generatePortfolioRecommendation(portfolio, news) {
  const user = portfolioPrompt(portfolio, news);
  let raw = await converseJson(PORTFOLIO_SYSTEM_PROMPT, user);
  try {
    return validatePortfolio(extractJson(raw));
  } catch (err) {
    const repair = `${user}\n\n## 직전 출력이 스키마를 어겼다: ${err.message}\n스키마를 정확히 지켜 순수 JSON 하나만 다시 출력하라.`;
    raw = await converseJson(PORTFOLIO_SYSTEM_PROMPT, repair);
    return validatePortfolio(extractJson(raw));
  }
}

const PORTFOLIO_PK = (companyId) => `${companyId}#PORTFOLIO`;

async function storePortfolio(companyId, asOf, portfolio, reco) {
  if (!RECO_TABLE) return;
  try {
    await ddb.send(new PutCommand({
      TableName: RECO_TABLE,
      Item: {
        shipmentId: PORTFOLIO_PK(companyId),
        evaluatedAt: `${asOf}T${new Date().toISOString().slice(11, 19)}Z`,
        companyId, asOf, portfolio, reco,
      },
    }));
  } catch (e) { console.warn("포트폴리오 저장 실패:", e.message); }
}

async function loadLatestPortfolio(companyId) {
  if (!RECO_TABLE) return null;
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: RECO_TABLE,
      KeyConditionExpression: "shipmentId = :s",
      ExpressionAttributeValues: { ":s": PORTFOLIO_PK(companyId) },
      ScanIndexForward: false, Limit: 1,
    }));
    return r.Items?.[0] ?? null;
  } catch (e) { console.warn("포트폴리오 조회 실패:", e.message); return null; }
}

// 무거운 계산(스케줄 매칭 + Bedrock) — 비동기 자기호출로 실행돼 30초 한도를 넘기지 않는다.
export async function computePortfolioRecommendation({ companyId = DEFAULT_COMPANY_ID } = {}) {
  const asOf = todayKst();
  const [company, kcci, macro, news] = await Promise.all([loadCompany(companyId), loadKcci(), loadMacro(), loadNewsHeadlines()]);

  // 포트폴리오 = 현재 선적 + 예정 선적(중복 id 제거)
  const shipments = [];
  const seen = new Set();
  for (const s of [company.current, ...(company.planned ?? [])]) {
    if (s?.shipmentId && !seen.has(s.shipmentId)) { seen.add(s.shipmentId); shipments.push(s); }
  }
  if (shipments.length === 0) throw new Error("선적 데이터가 없습니다(현재 선적 또는 예정 선적 입력 필요).");

  const kcciInput = { series: kcci.series, compositeNow: kcci.compositeNow };
  const briefs = [];
  for (const shp of shipments) {
    const route = resolveRoute(shp.pol, shp.pod);
    const { from, to } = scheduleWindow(shp);
    const schedule = route.routeCode ? await loadRouteSchedule(SCHEDULE_TABLE, route.routeCode, from, to) : null;
    briefs.push(buildBrief({
      policy: company.policy, current: shp, history: company.history,
      kcci: kcciInput, fx: { USD: macro.USD }, baseRate: macro.baseRate, schedule, asOf,
    }));
  }

  const portfolio = summarizePortfolio(briefs);
  portfolio.dataSources = {
    kcci: kcci.source, company: COMPANY_BUCKET ? "s3" : "bundled",
    currentShipmentSource: company.currentSource, news: news.length,
  };
  const recommendation = await generatePortfolioRecommendation(portfolio, news);
  await storePortfolio(companyId, asOf, portfolio, recommendation);
  return { asOf, portfolio, recommendation };
}

export async function storeRecommendation(companyId, brief, reco) {
  if (!RECO_TABLE) return;
  try {
    await ddb.send(new PutCommand({
      TableName: RECO_TABLE,
      Item: {
        shipmentId: recoPartitionKey(companyId, brief.shipment.id), // {companyId}#{shipmentId} — 회사간 격리
        evaluatedAt: `${brief.asOf}T${new Date().toISOString().slice(11, 19)}Z`,
        companyId,
        stance: reco.stance, verdict: reco.verdict, confidence: reco.confidence,
        recommendedVessel: reco.recommendedSailing?.vessel ?? null,
        marketPctile52: brief.market?.pctile52 ?? null,
        budgetPerFeu: brief.shipment.budgetPerFeu ?? null,
        reco, briefDigest: {
          lane: brief.shipment.lane, routeCode: brief.shipment.routeCode,
          indexNow: brief.market?.indexNow, feasibleCount: brief.schedule.feasibleCount,
        },
      },
    }));
  } catch (e) { console.warn("추천 저장 실패:", e.message); }
}

// 브리프 계산 + Bedrock 추천 생성(+저장). handler와 스케줄 모니터가 공유한다.
export async function computeRecommendation({ store = true, companyId = DEFAULT_COMPANY_ID } = {}) {
  const asOf = todayKst();
  const [company, kcci, macro, news] = await Promise.all([loadCompany(companyId), loadKcci(), loadMacro(), loadNewsHeadlines()]);
  if (!company?.current) throw new Error("현재 선적 데이터가 없습니다(엑셀 2_Current_Shipment 또는 현재 선적 폼 입력 필요).");

  const route = resolveRoute(company.current.pol, company.current.pod);
  const { from: windowFrom, to: windowTo } = scheduleWindow(company.current);
  const schedule = route.routeCode ? await loadRouteSchedule(SCHEDULE_TABLE, route.routeCode, windowFrom, windowTo) : null;

  const brief = buildBrief({
    policy: company.policy, current: company.current, history: company.history,
    kcci: { series: kcci.series, compositeNow: kcci.compositeNow },
    fx: { USD: macro.USD }, baseRate: macro.baseRate, schedule, asOf,
  });
  brief.dataSources = {
    kcci: kcci.source, company: COMPANY_BUCKET ? "s3" : "bundled", currentShipmentSource: company.currentSource,
    news: news.length, schedule: schedule?.length ? "shipda" : "synthetic",
  };

  const recommendation = await generateRecommendation(brief, news);
  if (store) await storeRecommendation(companyId, brief, recommendation);
  return { asOf, brief, recommendation };
}

// 직전 저장된 추천의 stance(재평가 시 변화 감지용)
export async function lastStoredStance(companyId, shipmentId) {
  if (!RECO_TABLE) return null;
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: RECO_TABLE,
      KeyConditionExpression: "shipmentId = :s",
      ExpressionAttributeValues: { ":s": recoPartitionKey(companyId, shipmentId) },
      ScanIndexForward: false, Limit: 1,
    }));
    return r.Items?.[0]?.stance ?? null;
  } catch (e) { console.warn("직전 stance 조회 실패:", e.message); return null; }
}

// GET  /recommendations           → 저장된 최신 포트폴리오 추천을 즉시 반환(빠름)
// POST /recommendations/refresh    → 백그라운드 재계산 트리거(202), 프론트는 GET을 폴링
export async function handler(event) {
  // 비동기 자기호출 경로 — 무거운 계산을 30초 한도 밖에서 수행하고 저장.
  if (event?.internalCompute) {
    try { await computePortfolioRecommendation({ companyId: event.companyId }); return { ok: true }; }
    catch (e) { console.error("포트폴리오 계산 실패:", e); return { ok: false, error: e.message }; }
  }

  const companyId = companyIdFromEvent(event);
  const path = event.rawPath || event.requestContext?.http?.path || "";
  const method = event.requestContext?.http?.method || "GET";
  try {
    if (method === "POST" && path.endsWith("/refresh")) {
      if (SELF_FUNCTION_NAME) {
        await lambdaClient.send(new InvokeCommand({
          FunctionName: SELF_FUNCTION_NAME, InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({ internalCompute: true, companyId })),
        }));
      } else {
        computePortfolioRecommendation({ companyId }).catch((e) => console.error("동기 폴백 계산 실패:", e.message));
      }
      return json(202, { status: "computing" });
    }

    // 기본: 저장된 최신 포트폴리오 반환
    const latest = await loadLatestPortfolio(companyId);
    if (!latest) return json(200, { status: "none" });
    return json(200, {
      status: "ready", asOf: latest.asOf, evaluatedAt: latest.evaluatedAt,
      portfolio: latest.portfolio, recommendation: latest.reco,
    });
  } catch (e) {
    console.error("추천 조회 실패:", e);
    return json(500, { error: e.message });
  }
}
