// 플로팅 챗봇 API. POST /chat { message, sessionId? } → Bedrock Agent 응답 + sessionId.
// (Bedrock Agent 재구성) 이전엔 매 요청마다 시장·뉴스·포트폴리오 전체를 이 Lambda가 조립해
// Converse에 욱여넣었지만, 이제 에이전트가 질문을 보고 필요한 도구(agent-tools.mjs)만 골라 호출한다
// — 안 쓰는 데이터 조회가 사라지고, 웹 검색 등 새 도구는 에이전트 쪽에만 붙이면 된다.
// 대화 이력도 프론트가 매 요청 들고 오는 대신 에이전트 세션(sessionId, 유휴 30분)이 서버측에 보관한다.
import { randomUUID } from "node:crypto";
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";

const agentRuntime = new BedrockAgentRuntimeClient({});
const AGENT_ID = process.env.AGENT_ID;
const AGENT_ALIAS_ID = process.env.AGENT_ALIAS_ID;

function response(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export async function handler(event) {
  if (!AGENT_ID || !AGENT_ALIAS_ID) return response(500, { error: "AGENT_ID/AGENT_ALIAS_ID env is required" });

  const body = JSON.parse(event.body || "{}");
  const message = String(body.message || "").slice(0, 2000);
  if (!message.trim()) return response(400, { error: "message is required" });

  // 세션 id는 프론트가 보관했다가 재전송(같은 대화 이어가기). 없거나 형식이 이상하면 새 대화 시작.
  const sessionId = /^[a-zA-Z0-9._:-]{2,100}$/.test(String(body.sessionId ?? "")) ? body.sessionId : randomUUID();

  const result = await agentRuntime.send(new InvokeAgentCommand({
    agentId: AGENT_ID,
    agentAliasId: AGENT_ALIAS_ID,
    sessionId,
    inputText: message,
  }));

  // 응답은 이벤트 스트림 — 텍스트 청크만 모은다.
  let reply = "";
  for await (const ev of result.completion) {
    if (ev.chunk?.bytes) reply += new TextDecoder().decode(ev.chunk.bytes);
  }

  return response(200, { reply, sessionId });
}
