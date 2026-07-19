// 플로팅 챗봇 API. POST /chat { message, sessionId? } → Bedrock Agent 응답 + sessionId.
// (Bedrock Agent 재구성) 이전엔 매 요청마다 시장·뉴스·포트폴리오 전체를 이 Lambda가 조립해
// Converse에 욱여넣었지만, 이제 에이전트가 질문을 보고 필요한 도구(agent-tools.mjs)만 골라 호출한다
// — 안 쓰는 데이터 조회가 사라지고, 웹 검색 등 새 도구는 에이전트 쪽에만 붙이면 된다.
// 대화 이력도 프론트가 매 요청 들고 오는 대신 에이전트 세션(sessionId, 유휴 30분)이 서버측에 보관한다.
import { randomUUID } from "node:crypto";
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { companyIdFromEvent } from "./tenant.mjs";

const agentRuntime = new BedrockAgentRuntimeClient({});
const s3 = new S3Client({});
const AGENT_ID = process.env.AGENT_ID;
const AGENT_ALIAS_ID = process.env.AGENT_ALIAS_ID;
const KB_DOCS_BUCKET = process.env.KB_DOCS_BUCKET;

function metadataValue(metadata, key) {
  const value = metadata?.[key];
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  return String(value.stringValue ?? value.value?.stringValue ?? value.value ?? "");
}

function sourceLocation(reference) {
  const location = reference?.location ?? {};
  return location.s3Location?.uri
    ?? location.webLocation?.url
    ?? location.confluenceLocation?.url
    ?? location.sharePointLocation?.url
    ?? location.salesforceLocation?.url
    ?? location.kendraDocumentLocation?.uri
    ?? "";
}

function titleFromLocation(location) {
  const encodedName = String(location).split("/").pop() || "참고 문서";
  try {
    return decodeURIComponent(encodedName).replace(/\.(pdf|xlsx?|docx?|html?|md|txt)$/i, "");
  } catch {
    return encodedName.replace(/\.(pdf|xlsx?|docx?|html?|md|txt)$/i, "");
  }
}

function citedRange(reply, part) {
  const text = String(part?.text ?? "");
  const hintedStart = Number.isInteger(part?.span?.start) ? part.span.start : 0;
  if (text) {
    const exactAtHint = reply.slice(hintedStart, hintedStart + text.length) === text;
    const start = exactAtHint ? hintedStart : reply.indexOf(text, Math.max(0, hintedStart - 2));
    if (start >= 0) return { start, end: start + text.length };
  }

  const start = Math.max(0, Math.min(reply.length, hintedStart));
  const rawEnd = Number.isInteger(part?.span?.end) ? part.span.end : start;
  // Bedrock의 span.end는 포함 인덱스다. 텍스트가 없는 예외 응답에서도 문장 뒤에 배지가 오도록 +1.
  return { start, end: Math.max(start, Math.min(reply.length, rawEnd + 1)) };
}

// Bedrock InvokeAgent attribution을 프론트가 안전하게 렌더할 수 있는 작은 JSON으로 변환한다.
export function buildCitationPayload(reply, bedrockCitations = []) {
  const sources = [];
  const sourceIds = new Map();
  const citations = [];

  const addSource = (reference) => {
    const metadata = reference?.metadata ?? {};
    const location = sourceLocation(reference);
    const title = metadataValue(metadata, "title") || titleFromLocation(location);
    const url = metadataValue(metadata, "source_page_url") || (/^https?:\/\//.test(location) ? location : "");
    const rawPageNumber = Number(metadataValue(metadata, "x-amz-bedrock-kb-document-page-number"));
    const pageNumber = Number.isInteger(rawPageNumber) && rawPageNumber > 0 ? rawPageNumber : null;
    // 같은 PDF라도 인용 페이지가 다르면 별도 출처로 둬 클릭 시 정확한 페이지로 이동시킨다.
    const key = `${location}|${title}|${url}|${pageNumber ?? ""}`;
    if (sourceIds.has(key)) return sourceIds.get(key);

    const id = sources.length + 1;
    sourceIds.set(key, id);
    const source = {
      id,
      title,
      organization: metadataValue(metadata, "organization"),
      publishedAt: metadataValue(metadata, "published_at"),
      url,
      location,
    };
    if (pageNumber) source.pageNumber = pageNumber;
    sources.push(source);
    return id;
  };

  for (const citation of bedrockCitations) {
    const part = citation?.generatedResponsePart?.textResponsePart;
    const ids = [...new Set((citation?.retrievedReferences ?? []).map(addSource))];
    if (!part || ids.length === 0) continue;
    citations.push({ ...citedRange(reply, part), sourceIds: ids });
  }

  return { citations, sources };
}

function s3ObjectFromLocation(location) {
  try {
    const parsed = new URL(String(location));
    if (parsed.protocol !== "s3:" || !parsed.hostname) return null;
    return { bucket: parsed.hostname, key: decodeURIComponent(parsed.pathname.replace(/^\//, "")) };
  } catch {
    return null;
  }
}

async function attachDirectDocumentUrls(sources) {
  return Promise.all(sources.map(async (source) => {
    const object = s3ObjectFromLocation(source.location);
    if (!object || !KB_DOCS_BUCKET || object.bucket !== KB_DOCS_BUCKET) return source;
    try {
      const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: object.bucket, Key: object.key }), { expiresIn: 3600 });
      const url = source.pageNumber ? `${signedUrl}#page=${source.pageNumber}` : signedUrl;
      return { ...source, sourcePageUrl: source.url, url, directDocument: true };
    } catch (error) {
      console.warn("Failed to sign cited KB document", { key: object.key, message: error?.message });
      return source;
    }
  }));
}

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

  // 로그인한 회사 id를 세션 속성으로 전달 → agent-tools가 이 회사의 선적/추천만 조회한다.
  const companyId = companyIdFromEvent(event);

  const result = await agentRuntime.send(new InvokeAgentCommand({
    agentId: AGENT_ID,
    agentAliasId: AGENT_ALIAS_ID,
    sessionId,
    inputText: message,
    sessionState: { sessionAttributes: { companyId } },
  }));

  // 응답은 이벤트 스트림 — 텍스트 청크만 모은다.
  let reply = "";
  const bedrockCitations = [];
  for await (const ev of result.completion) {
    if (ev.chunk?.bytes) reply += new TextDecoder().decode(ev.chunk.bytes);
    if (ev.chunk?.attribution?.citations) bedrockCitations.push(...ev.chunk.attribution.citations);
  }

  const citationPayload = buildCitationPayload(reply, bedrockCitations);
  citationPayload.sources = await attachDirectDocumentUrls(citationPayload.sources);
  return response(200, { reply, sessionId, ...citationPayload });
}
