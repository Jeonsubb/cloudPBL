// KCCI 주간 수집 Lambda.
// EventBridge가 매주 월요일 15시 KST에 {"weeks": N}으로 호출하면 최근 N주를 KOBC에서 받아 DynamoDB에 upsert한다.
// 백필은 수동 invoke로 {"weeks": 250} 같은 큰 값을 넘기면 된다(KCCI 출시일 2022-11-07 기준 충분).
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { fetchKcciAll } from "./kcci.mjs";
import { KCCI_SERIES } from "./kcci-series.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BATCH_SIZE = 25;

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

export async function handler(event = {}) {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) throw new Error("TABLE_NAME env is required");
  const weeks = Number(event.weeks ?? process.env.DEFAULT_WEEKS ?? 8);
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - weeks * 7 * 86_400_000);
  const fetchedAt = new Date().toISOString();

  const bySeries = await fetchKcciAll(fromDate, toDate);
  const summary = [];
  for (const series of KCCI_SERIES) {
    const points = bySeries[series.id] ?? [];
    await batchWrite(
      tableName,
      points.map((p) => ({
        series: `${series.prefix}#${series.id}`,
        date: p.date,
        value: p.value,
        unit: series.unit,
        label: series.label,
        source: series.source,
        fetchedAt,
      })),
    );
    summary.push({ series: series.id, written: points.length, latest: points.at(-1) ?? null });
  }
  console.log(JSON.stringify({ weeks, summary }));
  return { ok: true, weeks, summary };
}
