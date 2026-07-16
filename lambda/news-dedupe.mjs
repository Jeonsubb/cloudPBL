// 뉴스 중복 제거 — Bedrock으로 "같은 사안, 다른 신문사" 기사를 묶어 대표 1건만 남긴다.
// news-collector.mjs가 매 수집 주기(3시간)마다 한 번씩만 호출 — 대시보드 조회(news-query.mjs)는
// 매번 Bedrock을 부르지 않고 이미 계산된 duplicate 플래그만 읽어서 빠르고 저렴하다.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-opus-4-5-20251101-v1:0";
const BATCH_SIZE = 25;

function shiftDate(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

async function fetchCandidates(tableName, dates) {
  const perDate = await Promise.all(
    dates.map((d) =>
      ddb.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "#d = :d",
        ExpressionAttributeNames: { "#d": "date" },
        ExpressionAttributeValues: { ":d": d },
      })),
    ),
  );
  return perDate.flatMap((r) => r.Items ?? []).filter((it) => (it.score ?? 0) > 0);
}

function buildPrompt(items) {
  const lines = items.map((it, i) => `${i}. [${it.source}] ${it.title}`).join("\n");
  return `아래는 해운·물류 뉴스 후보 목록이다. 서로 다른 신문사가 같은 사안(같은 보도자료·같은 사건)을 다루는 중복 기사를 찾아라.
표현이 다르거나 수치가 조금 달라도 같은 사건이면 중복으로 본다. 단순히 주제가 비슷한 것(둘 다 "항만" 언급 등)은 중복이 아니다.

${lines}

JSON 배열만 출력하라(코드블록 없이). 중복 그룹이 있는 것만 포함하고, 중복이 하나도 없으면 빈 배열 []을 출력하라.
각 그룹은 {"primary": 유지할 인덱스, "duplicates": [나머지 인덱스들]} 형태. 원문 정보가 더 상세하거나 최초 보도로 보이는 쪽을 primary로 선택.`;
}

function parseJson(text) {
  const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
}

async function batchWrite(tableName, items) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    let requests = items.slice(i, i + BATCH_SIZE).map((item) => ({ PutRequest: { Item: item } }));
    for (let attempt = 0; requests.length > 0 && attempt < 3; attempt += 1) {
      const result = await ddb.send(new BatchWriteCommand({ RequestItems: { [tableName]: requests } }));
      requests = result.UnprocessedItems?.[tableName] ?? [];
      if (requests.length > 0) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
    if (requests.length > 0) throw new Error(`DynamoDB unprocessed items: ${requests.length}`);
  }
}

/**
 * 최근 lookbackDays치 뉴스 후보를 모아 Bedrock으로 중복 그룹을 찾고,
 * 대표(primary)가 아닌 항목에 duplicate:true를 기록한다.
 */
export async function dedupeRecent(tableName, today, lookbackDays = 2) {
  const dates = Array.from({ length: lookbackDays }, (_, i) => shiftDate(today, -i));
  const items = await fetchCandidates(tableName, dates);
  if (items.length < 2) return { candidates: items.length, groups: 0, marked: 0 };

  const response = await bedrock.send(new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: [{ text: buildPrompt(items) }] }],
    inferenceConfig: { maxTokens: 1500, temperature: 0 },
  }));
  const raw = response.output?.message?.content?.[0]?.text ?? "[]";
  const groups = parseJson(raw);

  const toMark = [];
  for (const g of groups) {
    for (const idx of g.duplicates ?? []) {
      const item = items[idx];
      if (item && idx !== g.primary) toMark.push({ ...item, duplicate: true });
    }
  }
  if (toMark.length > 0) await batchWrite(tableName, toMark);

  return { candidates: items.length, groups: groups.length, marked: toMark.length };
}
