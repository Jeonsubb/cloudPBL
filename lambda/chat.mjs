// 플로팅 챗봇 API. POST /chat { message, history? } → Bedrock Agent 응답.
// Bedrock Agent(InvokeAgent)를 통해 응답을 생성한다.
// Agent가 Action Group(DynamoDB 조회), Knowledge Base(해운 도메인), 웹검색을 알아서 판단해 사용.
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const agentClient = new BedrockAgentRuntimeClient({});
const s3 = new S3Client({});
const AGENT_ID = process.env.BEDROCK_AGENT_ID ?? "";
const AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID ?? "";
const KB_BUCKET = process.env.KB_BUCKET ?? "";
const MAX_HISTORY_TURNS = 10;

function response(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function makeSessionId(event) {
  // 동일 사용자의 대화 연속성을 위해 세션 ID 유지. 없으면 랜덤 생성.
  const raw = event.headers?.["x-session-id"] || crypto.randomUUID();
  // Agent 세션 ID 규칙: 영숫자 + ._:- (2~100자)
  return raw.replace(/[^0-9a-zA-Z._:-]/g, "-").slice(0, 100) || crypto.randomUUID();
}

function metadataValue(metadata, key) {
  const value = metadata?.[key];
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return String(value.stringValue ?? value.numberValue ?? value.booleanValue ?? "");
}

function parseS3Uri(uri) {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri || "");
  return match ? { bucket: match[1], key: decodeURIComponent(match[2]) } : null;
}

function citationFromReference(reference) {
  const metadata = reference.metadata ?? {};
  const uri = reference.location?.s3Location?.uri ?? "";
  const s3Location = parseS3Uri(uri);
  const fallbackName = s3Location?.key.split("/").pop() ?? "출처 문서";
  const pageValue = metadataValue(metadata, "x-amz-bedrock-kb-document-page-number");
  const page = pageValue && Number.isFinite(Number(pageValue)) ? Number(pageValue) : null;

  return {
    title: metadataValue(metadata, "title") || fallbackName,
    organization: metadataValue(metadata, "organization"),
    page,
    excerpt: String(reference.content?.text ?? "").slice(0, 500),
    sourcePageUrl: metadataValue(metadata, "source_page_url"),
    s3Location,
  };
}

async function finalizeCitations(rawCitations) {
  const unique = new Map();
  for (const citation of rawCitations) {
    for (const reference of citation.retrievedReferences ?? []) {
      const item = citationFromReference(reference);
      const key = `${item.s3Location?.bucket ?? ""}/${item.s3Location?.key ?? item.title}#${item.page ?? ""}`;
      if (!unique.has(key)) unique.set(key, item);
    }
  }

  return Promise.all([...unique.values()].map(async (item, index) => {
    let url = item.sourcePageUrl || "";
    if (item.s3Location && item.s3Location.bucket === KB_BUCKET) {
      url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: item.s3Location.bucket, Key: item.s3Location.key }),
        { expiresIn: 900 },
      );
      if (item.page) url += `#page=${item.page}`;
    }

    return {
      id: `source-${index + 1}`,
      title: item.title,
      organization: item.organization,
      page: item.page,
      excerpt: item.excerpt,
      url,
    };
  }));
}

async function invokeAgent(message, history, sessionId) {
  const input = {
    agentId: AGENT_ID,
    agentAliasId: AGENT_ALIAS_ID,
    sessionId,
    inputText: message,
    enableTrace: false,
  };

  // 새 세션이면서 이전 대화 이력이 있으면 conversationHistory로 전달
  if (history.length > 0) {
    input.sessionState = {
      conversationHistory: {
        messages: history.map((h) => ({
          role: h.role === "assistant" ? "assistant" : "user",
          content: [{ text: String(h.text || "").slice(0, 2000) }],
        })),
      },
    };
  }

  const command = new InvokeAgentCommand(input);
  const result = await agentClient.send(command);

  // Agent 응답은 스트림으로 온다 — chunk를 모아 완성 텍스트로 반환
  const chunks = [];
  const rawCitations = [];
  for await (const event of result.completion || []) {
    if (event.chunk?.bytes) {
      chunks.push(new TextDecoder().decode(event.chunk.bytes));
    }
    rawCitations.push(...(event.chunk?.attribution?.citations ?? []));
  }

  const reply = chunks.join("").trim();
  if (!reply) throw new Error("Agent가 빈 응답을 반환했습니다.");
  const citations = await finalizeCitations(rawCitations);
  return { reply, citations, sessionId: result.sessionId || sessionId };
}

export async function handler(event) {
  const body = JSON.parse(event.body || "{}");
  const message = String(body.message || "").slice(0, 2000);
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];

  if (!message.trim()) return response(400, { error: "message is required" });

  if (!AGENT_ID || !AGENT_ALIAS_ID) {
    console.error("BEDROCK_AGENT_ID 또는 BEDROCK_AGENT_ALIAS_ID 환경변수 미설정");
    return response(500, { error: "Agent 설정이 완료되지 않았습니다." });
  }

  const sessionId = makeSessionId(event);

  try {
    const { reply, citations, sessionId: finalSessionId } = await invokeAgent(message, history, sessionId);
    return response(200, { reply, citations, sessionId: finalSessionId });
  } catch (err) {
    console.error("Agent invoke error:", err);
    // 폴백: Agent 호출 실패 시 안내 메시지
    return response(200, {
      reply: "죄송합니다. 일시적으로 AI 응답을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.\n\n해운 운임, 부킹 타이밍, 리스크 요인에 대해 질문해주세요.",
      error: err.message,
    });
  }
}
