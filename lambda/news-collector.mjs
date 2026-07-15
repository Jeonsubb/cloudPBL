// 해운 전문지 RSS 수집 Lambda.
// EventBridge가 3시간마다 호출 — 각 피드가 4~6일치를 담고 있어 폴링을 놓쳐도 안전한 여유가 있다.
// 공식 API가 없는 일반 RSS라 XML도 정규식으로 직접 파싱한다(구조가 단순하고 고정적이라 별도 XML 파서 불필요).
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { NEWS_SOURCES } from "./news-sources.mjs";
import { scoreTitle } from "./news-score.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BATCH_SIZE = 25;

const ENTITIES = { "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&quot;|&apos;|&lt;|&gt;|&amp;/g, (m) => ENTITIES[m]);
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
  return match ? decodeEntities(match[1].trim()) : "";
}

function parseRss(xml) {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return blocks.map((block) => ({
    title: extractTag(block, "title"),
    link: extractTag(block, "link"),
    pubDate: extractTag(block, "pubDate"),
  }));
}

function articleId(link) {
  const idxno = link.match(/idxno=(\d+)/);
  return idxno ? idxno[1] : Buffer.from(link).toString("base64url").slice(0, 40);
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

export async function handler() {
  const tableName = process.env.NEWS_TABLE_NAME;
  if (!tableName) throw new Error("NEWS_TABLE_NAME env is required");
  const fetchedAt = new Date().toISOString();

  const summary = [];
  for (const src of NEWS_SOURCES) {
    try {
      const response = await fetch(src.url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();

      const items = parseRss(xml)
        .filter((it) => it.title && it.link && it.pubDate)
        .map((it) => ({
          date: it.pubDate.slice(0, 10),
          articleId: `${src.id}#${articleId(it.link)}`,
          title: it.title,
          link: it.link,
          source: src.label,
          pubDate: it.pubDate,
          score: scoreTitle(it.title),
          fetchedAt,
        }));

      await batchWrite(tableName, items);
      summary.push({ source: src.id, written: items.length });
    } catch (err) {
      summary.push({ source: src.id, error: err.message });
    }
  }
  console.log(JSON.stringify({ summary }));
  return { ok: true, summary };
}
