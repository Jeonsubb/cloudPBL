// 일별 시장 시계열 수집 Lambda.
// EventBridge 스케줄이 {"days": N}으로 호출하면 최근 N일을 ECOS에서 받아 DynamoDB에 upsert한다.
// 백필은 수동 invoke로 {"days": 365} 같은 큰 값을 넘기면 된다(sample 키는 창 분할로 느려지므로 실키 권장).
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { fetchSeries } from "./ecos.mjs";
import { SERIES } from "./series.mjs";

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
  const apiKey = process.env.ECOS_API_KEY || "sample";
  const days = Number(event.days ?? process.env.DEFAULT_DAYS ?? 14);
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - days * 86_400_000);
  const fetchedAt = new Date().toISOString();

  const summary = [];
  for (const series of SERIES) {
    const points = await fetchSeries(apiKey, series, fromDate, toDate);
    await batchWrite(
      tableName,
      points.map((p) => ({
        series: `${series.prefix}#${series.id}`,
        date: p.date,
        value: p.value,
        unit: series.unit,
        label: series.label,
        source: `${series.statCode}/${series.itemCode}`,
        fetchedAt,
      })),
    );
    summary.push({ series: series.id, written: points.length, latest: points.at(-1) ?? null });
  }
  console.log(JSON.stringify({ days, apiKey: apiKey === "sample" ? "sample" : "real", summary }));
  return { ok: true, days, summary };
}
