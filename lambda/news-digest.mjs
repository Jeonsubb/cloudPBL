// 일일 시황 브리핑 Lambda.
// 오늘 뉴스 후보 + 시장 지표(환율·기준금리·KCCI 종합/13개 항로)를 모아
// Bedrock(Claude)이 (1)중복 제거+중요 뉴스 3~5개 선별 (2)해운 중심 시황 분석을 JSON으로 생성 →
// 링크는 코드가 원본 그대로 붙여 텔레그램 메시지를 조립한다.
// 텔레그램 시크릿이 아직 없으면(portpulse/telegram-bot 미설정) 전송만 건너뛰고 조립된 텍스트는 그대로 반환한다.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { SERIES as ECOS_SERIES } from "./series.mjs";
import { KCCI_SERIES } from "./kcci-series.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});
const secretsClient = new SecretsManagerClient({});

// 2026-07-14 aws bedrock list-inference-profiles로 확인된 크로스리전 추론 프로필 ID.
// Claude 계열은 온디맨드 foundation-model ID로 직접 호출이 안 되고 이 형태의 프로필 ID가 필요함.
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-opus-4-5-20251101-v1:0";
// 키워드 점수로 1차 추린 후보 수(Bedrock이 이 안에서 중복 제거 후 3~5개 선별).
const NEWS_CANDIDATE_N = 25;
// 항로 급등락으로 볼 최소 주간 변동폭(%).
const ROUTE_MOVE_THRESHOLD = 3;

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDate(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

// 아침 브리핑 시점엔 당일 뉴스가 아직 없을 수 있어, 최근 며칠(기본 2일)을 롤링으로 모은다.
async function fetchNewsCandidates(tableName, date, limit, lookbackDays = 2) {
  const dates = Array.from({ length: lookbackDays }, (_, i) => shiftDate(date, -i));
  const perDate = await Promise.all(
    dates.map((d) =>
      ddb.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "#d = :d",
          ExpressionAttributeNames: { "#d": "date" },
          ExpressionAttributeValues: { ":d": d },
        }),
      ),
    ),
  );
  return perDate
    .flatMap((r) => r.Items ?? [])
    .filter((it) => (it.score ?? 0) > 0)
    .sort((a, b) => b.score - a.score || b.pubDate.localeCompare(a.pubDate))
    .slice(0, limit)
    .map(({ title, source, pubDate, link }) => ({ title, source, pubDate, link }));
}

// 시리즈 하나의 최신값과 직전값(일별=전일, 주별=전주)을 읽어 변동을 계산.
async function fetchLatestTwo(tableName, series) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "series = :s",
      ExpressionAttributeValues: { ":s": `${series.prefix}#${series.id}` },
      ScanIndexForward: false,
      Limit: 2,
    }),
  );
  const [latest, prev] = result.Items ?? [];
  if (!latest) return null;
  const diff = prev ? latest.value - prev.value : 0;
  const pct = prev?.value ? (diff / prev.value) * 100 : 0;
  return { id: series.id, label: series.label, value: latest.value, unit: series.unit, date: latest.date, diff, pct };
}

async function fetchMarket(tableName) {
  const fxList = [];
  for (const s of ECOS_SERIES.filter((s) => s.category === "fx")) {
    const snap = await fetchLatestTwo(tableName, s);
    if (snap) fxList.push(snap);
  }
  const rate = await fetchLatestTwo(tableName, ECOS_SERIES.find((s) => s.id === "BOK_BASE_RATE"));

  const kcciAll = [];
  for (const s of KCCI_SERIES) {
    const snap = await fetchLatestTwo(tableName, s);
    if (snap) kcciAll.push(snap);
  }
  const composite = kcciAll.find((s) => s.id === "KCCI");
  const routes = kcciAll.filter((s) => s.id !== "KCCI");
  const notableRoutes = routes
    .filter((r) => Math.abs(r.pct) >= ROUTE_MOVE_THRESHOLD)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  return { fxList, rate, composite, notableRoutes };
}

function buildPrompt(news, market) {
  const { fxList, rate, composite, notableRoutes } = market;
  const macroLines = [
    ...fxList.map((f) => `${f.label} ${f.value.toLocaleString("en-US")}원 (전일 ${f.diff >= 0 ? "+" : ""}${f.diff.toFixed(1)}, ${f.pct >= 0 ? "+" : ""}${f.pct.toFixed(2)}%)`),
    rate && `기준금리 ${rate.value}% (전 관측치 대비 ${rate.diff >= 0 ? "+" : ""}${rate.diff.toFixed(2)}%p)`,
  ].filter(Boolean).join("\n");

  const kcciLine = composite
    ? `KCCI 종합지수 ${composite.value.toLocaleString("en-US")}pt (전주 ${composite.diff >= 0 ? "+" : ""}${composite.diff.toFixed(0)}pt, ${composite.pct >= 0 ? "+" : ""}${composite.pct.toFixed(2)}%) [${composite.date} 기준]`
    : "(KCCI 데이터 없음)";
  const routeLines = notableRoutes.length
    ? notableRoutes.map((r) => `- ${r.label}: ${r.value.toLocaleString("en-US")}pt (전주 ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}%)`).join("\n")
    : "(주간 변동폭 3% 이상 항로 없음)";

  const newsLines = news.map((n, i) => `${i + 1}. [${n.source}] ${n.title}`).join("\n");

  return `당신은 한국 수출기업 실무자를 위한 해운·물류 시황 브리핑 분석가입니다.
아래 데이터만 근거로 작성하고, 데이터에 없는 내용은 추측·창작하지 마세요.

# 데이터

[해운 운임 — 이 브리핑의 핵심]
${kcciLine}
주간 급등락 항로:
${routeLines}

[매크로 — 참고용, 간단히]
${macroLines || "(데이터 없음)"}

[오늘 수집된 해운·물류 뉴스 후보 ${news.length}건]
${newsLines || "(수집된 뉴스 없음)"}

# 지시

1. 뉴스 후보 중 같은 사안을 다룬 중복 기사(매체만 다른 것)를 하나로 합치고, 수출기업 실무자에게 정말 중요한 것 3~5개만 고르세요. 홍보성·행사·미담 기사는 제외.
2. 해운 시황을 중심으로 분석하세요. KCCI 종합지수 흐름과 급등락 항로가 무엇을 시사하는지, 뉴스와 엮어 해석을 담으세요.
3. 매크로(환율·금리)는 최대 2줄. 원/달러를 중심으로 방향과 수출 채산성 영향만 짚고, 엔·유로·위안은 특이한 움직임이 있을 때만 한 줄로 언급. 통화별 숫자 나열은 지양.
4. 인사말·맺음말·면책·출처표기·구독안내는 절대 넣지 마세요.

# 출력(반드시 아래 JSON만, 코드블록 없이)

{
  "analysis": "본문. 📍로 시작하는 섹션들(예: 📍 해운 시황, 📍 매크로 영향)로 구성. 마크다운 기호(#, *, -)는 쓰지 말고 항목은 가운뎃점(·)으로. 각 섹션 2~4줄.",
  "topNews": [
    { "index": <후보번호(정수)>, "note": "이 뉴스가 왜 중요한지 한 줄 요약" }
  ]
}`;
}

async function callBedrock(prompt) {
  const response = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 2000, temperature: 0.3 },
    }),
  );
  return response.output?.message?.content?.[0]?.text ?? "";
}

// Bedrock이 코드블록(```json)으로 감싸는 경우까지 고려해 JSON만 추출.
function parseModelJson(text) {
  const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("모델 응답에서 JSON을 찾지 못함");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function buildTelegramMessage(parsed, news, date) {
  const header = `📰 PortPulse 해운 시황 브리핑 · ${date}`;
  const divider = "━━━━━━━━━━━━━━";

  const selected = (parsed.topNews ?? [])
    .map((sel) => ({ ...sel, article: news[sel.index - 1] }))
    .filter((sel) => sel.article);
  const newsBlock = selected.length
    ? "📎 주요 뉴스\n\n" +
      selected
        .map((sel, i) => `${i + 1}. ${sel.note || sel.article.title}\n${sel.article.title} (${sel.article.source})\n${sel.article.link}`)
        .join("\n\n")
    : "";

  return [header, divider, (parsed.analysis ?? "").trim(), newsBlock ? divider : "", newsBlock]
    .filter(Boolean)
    .join("\n\n");
}

async function getTelegramConfig() {
  const secretName = process.env.TELEGRAM_SECRET_NAME;
  if (!secretName) return null;
  try {
    const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretName }));
    const parsed = JSON.parse(result.SecretString ?? "{}");
    return parsed.token && parsed.chatId ? parsed : null;
  } catch {
    return null;
  }
}

async function sendTelegram({ token, chatId }, text) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // disable_web_page_preview: 링크 여러 개가 각각 미리보기 카드로 펼쳐지는 것 방지.
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}: ${await response.text()}`);
}

export async function handler() {
  const newsTableName = process.env.NEWS_TABLE_NAME;
  const marketTableName = process.env.MARKET_TABLE_NAME;
  if (!newsTableName || !marketTableName) throw new Error("NEWS_TABLE_NAME/MARKET_TABLE_NAME env is required");
  const date = todayKst();

  const [news, market] = await Promise.all([
    fetchNewsCandidates(newsTableName, date, NEWS_CANDIDATE_N),
    fetchMarket(marketTableName),
  ]);

  const raw = await callBedrock(buildPrompt(news, market));
  const parsed = parseModelJson(raw);
  const message = buildTelegramMessage(parsed, news, date);

  let telegramSent = false;
  const telegramConfig = await getTelegramConfig();
  if (telegramConfig) {
    await sendTelegram(telegramConfig, message);
    telegramSent = true;
  }

  console.log(JSON.stringify({ date, candidates: news.length, selected: parsed.topNews?.length ?? 0, telegramSent }));
  return { ok: true, date, telegramSent, message };
}
