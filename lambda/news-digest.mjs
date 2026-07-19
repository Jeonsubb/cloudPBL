// 일일 시황 브리핑 Lambda.
// Bedrock Agent를 호출해 시황 분석을 생성하고, 텔레그램으로 발송한다.
// Agent가 Action Group(DynamoDB 뉴스+시장 조회) + KB(해운 도메인 지식)를 활용해 브리핑을 작성.
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const agentClient = new BedrockAgentRuntimeClient({});
const secretsClient = new SecretsManagerClient({});

const AGENT_ID = process.env.BEDROCK_AGENT_ID ?? "";
const AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID ?? "";

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ── Agent 호출 ──────────────────────────────────────────────

async function invokeAgentForBriefing(date) {
  const prompt = `오늘은 ${date}입니다. 아침 시황 브리핑을 작성해주세요.

다음 순서로 진행하세요:
1. GetMarketSnapshot 도구로 KCCI 종합지수, 환율, 금리, 급등락 항로를 조회하세요.
2. GetHighImpactNews 도구로 오늘의 해운 뉴스 상위 5건을 조회하세요.
3. 조회한 데이터를 바탕으로 시황 브리핑을 작성하세요.

브리핑 작성 규칙:
- 📍로 시작하는 섹션(해운 시황, 매크로 영향)으로 구성
- 해운 운임(KCCI)을 중심으로 분석. 급등락 항로가 무엇을 시사하는지 뉴스와 엮어 해석
- 매크로(환율·금리)는 최대 2줄. 원/달러 방향과 수출 채산성 영향만 짚기
- 뉴스는 수출기업 실무자에게 중요한 3~5건만 선별
- 인사말·맺음말·면책·출처표기 없이 본론만
- 마크다운 기호(#, *, -)는 쓰지 말고 항목은 가운뎃점(·)으로
- 각 섹션 2~4줄

마지막에 선별한 뉴스 제목과 출처를 번호 목록으로 붙여주세요.`;

  const sessionId = `digest-${date}-${Date.now()}`;

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

  const text = chunks.join("").trim();
  if (!text) throw new Error("Agent가 빈 브리핑을 반환했습니다.");
  return text;
}

// ── 텔레그램 발송 ──────────────────────────────────────────

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
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
}

// ── 핸들러 ──────────────────────────────────────────────────

export async function handler() {
  const date = todayKst();

  if (!AGENT_ID || !AGENT_ALIAS_ID) {
    throw new Error("BEDROCK_AGENT_ID / BEDROCK_AGENT_ALIAS_ID 환경변수 미설정");
  }

  // 1. Agent로 브리핑 생성
  const briefingText = await invokeAgentForBriefing(date);

  // 2. 텔레그램 메시지 조립
  const header = `📰 PortPulse 해운 시황 브리핑 · ${date}`;
  const divider = "━━━━━━━━━━━━━━";
  const message = [header, divider, briefingText].join("\n\n");

  // 3. 텔레그램 발송
  let telegramSent = false;
  const telegramConfig = await getTelegramConfig();
  if (telegramConfig) {
    await sendTelegram(telegramConfig, message);
    telegramSent = true;
  }

  console.log(JSON.stringify({ date, telegramSent, briefingLength: briefingText.length }));
  return { ok: true, date, telegramSent, message };
}
