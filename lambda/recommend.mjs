// AI 선적 추천 Lambda — 회사 엑셀 + KCCI 시계열 + 실제 스케줄 + 환율·금리·뉴스를 종합해
// "지금 이 배로 보내라 / 지금은 미뤄라"를 근거와 함께 서술로 추천한다.
//
// 파이프라인:
//   ① 데이터 로드(S3 회사엑셀 · DynamoDB KCCI/FX/뉴스 — 없으면 번들 스냅샷 폴백)
//   ② recommend-engine.buildBrief() 로 모든 숫자 확정(순수 계산)
//   ③ Bedrock Agent에 브리프를 넘겨 설득형 추천 '서사'를 생성(Agent가 KB 참조 + 도구 호출)
//   ④ JSON 스키마 검증 + 폴백
//   ⑤ DynamoDB(portpulse-recommendations)에 이력 저장 후 응답
//
// GET /recommendations            → 현재 선적 추천(회사 데이터 기준)
// GET /recommendations/{id}        → 특정 선적(데모는 현재건과 동일 id)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { buildBrief } from "./recommend-engine.mjs";
import { parseCompanyFromS3 } from "./company-input.mjs";
import { CURRENT_SHIPMENT_KEY } from "./company-upload.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const agentClient = new BedrockAgentRuntimeClient({});
const s3 = new S3Client({});

const AGENT_ID = process.env.BEDROCK_AGENT_ID ?? "";
const AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID ?? "";
const MARKET_TABLE = process.env.MARKET_TABLE_NAME;
const NEWS_TABLE = process.env.NEWS_TABLE_NAME;
const RECO_TABLE = process.env.RECO_TABLE_NAME;
const COMPANY_BUCKET = process.env.COMPANY_BUCKET;
const COMPANY_KEY = process.env.COMPANY_KEY ?? "current/company-input.xlsx";

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const bundled = (f) => JSON.parse(readFileSync(here(f), "utf8"));

const json = (code, body) => ({ statusCode: code, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const todayKst = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

// ── 데이터 로드 ─────────────────────────────────────────────

async function loadCurrentOverride() {
  if (!COMPANY_BUCKET) return null;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: COMPANY_BUCKET, Key: CURRENT_SHIPMENT_KEY }));
    return JSON.parse(await res.Body.transformToString());
  } catch { return null; }
}

async function loadCompany() {
  const fallback = bundled("./sample-company.json");
  let base = fallback;
  let currentSource = "bundled";
  if (COMPANY_BUCKET) {
    try {
      const parsed = await parseCompanyFromS3(COMPANY_BUCKET, COMPANY_KEY);
      base = { policy: parsed.policy ?? fallback.policy, current: parsed.current ?? fallback.current, history: parsed.history?.length ? parsed.history : fallback.history };
      currentSource = parsed.current ? "excel" : "bundled";
    } catch (e) { console.warn("S3 회사데이터(엑셀) 로드 실패, 번들 폴백:", e.message); }
  }
  const override = await loadCurrentOverride();
  if (override) { base = { ...base, current: override }; currentSource = "ui_form"; }
  return { ...base, currentSource };
}

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
  if (Object.keys(series).length < routes.length) return { series: fallback.series, compositeNow: fallback.compositeNow, source: "bundled" };
  return { series, compositeNow: series.KCCI?.at(-1)?.value ?? fallback.compositeNow, source: "dynamodb" };
}

async function loadMacro() {
  const snap = bundled("./macro-snapshot.json");
  return { USD: snap.USD, baseRate: snap.baseRate };
}

// ── Agent 호출로 추천 서사 생성 ─────────────────────────────

async function generateRecommendation(brief) {
  const briefJson = JSON.stringify(brief, null, 2);

  const prompt = `당신은 한국 수출기업의 국제물류를 자문하는 15년차 해상운임 전략가입니다.
아래 선적 브리프(모든 숫자는 확정값)를 읽고, 설득형 추천을 JSON으로 생성하세요.

GetHighImpactNews 도구로 최근 해운 뉴스를 조회해서 참고하세요.

## 선적 브리프
\`\`\`json
${briefJson}
\`\`\`

## 작성 원칙
- 근거로 인용하는 모든 수치는 위 브리프에 있는 값만 사용. 없는 숫자는 절대 지어내지 않음.
- 뻔한 양비론 금지. 데이터가 한쪽을 가리키면 분명하게 그쪽을 추천하고 숫자로 설득.
- "과거 대비 지금 수준", "회사 예산·과거 실거래 대비", "왜 이 스케줄인지", "어느 포워더인지"까지 짚기.
- 서술은 실무자가 상신 보고서에 붙일 수 있을 만큼 구체적이되 과장·공포마케팅은 피함.

## 출력 스키마 — 순수 JSON 하나만 출력(코드펜스 없이)
{
  "verdict": "12자 내외의 결단형 헤드라인",
  "stance": "BOOK_NOW | BOOK_SOON | CONSIDER_WAIT | DEADLINE_RISK 중 하나",
  "confidence": "HIGH | MEDIUM | LOW",
  "recommendedSailing": { "vessel": "", "operator": "", "service": "", "etd": "", "eta": "", "priceUSDPerFeu": 0, "why": "이 항차를 고른 한 문장 이유" },
  "narrative": "3~5문단 순수 한국어 서술. (1) 시장 수준 백분위·yoy (2) 예산 대비 합리성 (3) 스케줄 선택 이유 (4) 포워더·협상 제안. 문단은 개행 두 번 구분.",
  "keyNumbers": [ { "label": "라벨", "value": "값(단위)", "note": "설명" } ],
  "actions": [ "오늘 할 구체 행동" ],
  "risks": [ "반대 시나리오/주의점" ],
  "watchTriggers": [ "판단 뒤집을 조건" ],
  "nextReviewDate": "YYYY-MM-DD"
}
keyNumbers 3~5개, actions/risks/watchTriggers 각 2~4개.`;

  const sessionId = `reco-${brief.shipment?.id || "default"}-${Date.now()}`;

  const command = new InvokeAgentCommand({
    agentId: AGENT_ID,
    agentAliasId: AGENT_ALIAS_ID,
    sessionId,
    inputText: prompt,
    enableTrace: false,
  });

  const result = await agentClient.send(command);

  const chunks = [];
  for await (const event of result.completion || []) {
    if (event.chunk?.bytes) {
      chunks.push(new TextDecoder().decode(event.chunk.bytes));
    }
  }

  const raw = chunks.join("").trim();
  if (!raw) throw new Error("Agent가 빈 추천을 반환했습니다.");

  return parseAndValidate(raw);
}

function parseAndValidate(raw) {
  let t = raw;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);

  const obj = JSON.parse(t);
  const REQUIRED = ["verdict", "stance", "confidence", "recommendedSailing", "narrative", "keyNumbers", "actions"];
  const missing = REQUIRED.filter((k) => obj[k] == null);
  if (missing.length) throw new Error(`필드 누락: ${missing.join(", ")}`);
  if (!Array.isArray(obj.keyNumbers) || obj.keyNumbers.length === 0) throw new Error("keyNumbers 비어있음");
  if (typeof obj.narrative !== "string" || obj.narrative.length < 80) throw new Error("narrative 너무 짧음");
  return obj;
}

// ── 저장 & 공용 함수 ────────────────────────────────────────

export async function storeRecommendation(brief, reco) {
  if (!RECO_TABLE) return;
  try {
    await ddb.send(new PutCommand({
      TableName: RECO_TABLE,
      Item: {
        shipmentId: brief.shipment.id,
        evaluatedAt: `${brief.asOf}T${new Date().toISOString().slice(11, 19)}Z`,
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

// 브리프 계산 + Agent 추천 생성(+저장). handler와 스케줄 모니터가 공유.
export async function computeRecommendation({ store = true } = {}) {
  if (!AGENT_ID || !AGENT_ALIAS_ID) {
    throw new Error("BEDROCK_AGENT_ID / BEDROCK_AGENT_ALIAS_ID 환경변수 미설정");
  }

  const asOf = todayKst();
  const [company, kcci, macro] = await Promise.all([loadCompany(), loadKcci(), loadMacro()]);
  if (!company?.current) throw new Error("현재 선적 데이터가 없습니다(엑셀 2_Current_Shipment 또는 현재 선적 폼 입력 필요).");

  const brief = buildBrief({
    policy: company.policy, current: company.current, history: company.history,
    kcci: { series: kcci.series, compositeNow: kcci.compositeNow },
    fx: { USD: macro.USD }, baseRate: macro.baseRate, asOf,
  });
  brief.dataSources = { kcci: kcci.source, company: COMPANY_BUCKET ? "s3" : "bundled", currentShipmentSource: company.currentSource };

  const recommendation = await generateRecommendation(brief);
  if (store) await storeRecommendation(brief, recommendation);
  return { asOf, brief, recommendation };
}

// 직전 저장된 추천의 stance(재평가 시 변화 감지용)
export async function lastStoredStance(shipmentId) {
  if (!RECO_TABLE) return null;
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: RECO_TABLE,
      KeyConditionExpression: "shipmentId = :s",
      ExpressionAttributeValues: { ":s": shipmentId },
      ScanIndexForward: false, Limit: 1,
    }));
    return r.Items?.[0]?.stance ?? null;
  } catch (e) { console.warn("직전 stance 조회 실패:", e.message); return null; }
}

export async function handler(event) {
  try {
    const result = await computeRecommendation({ store: true });
    return json(200, result);
  } catch (e) {
    console.error("추천 생성 실패:", e);
    return json(e.message.includes("선적 데이터") ? 422 : 500, { error: e.message });
  }
}
