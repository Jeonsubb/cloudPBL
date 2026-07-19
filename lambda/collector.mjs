// 일별 시장 시계열 수집 Lambda.
// EventBridge 스케줄이 {"days": N}으로 호출하면 최근 N일을 ECOS에서 받아 DynamoDB에 upsert한다.
// 백필은 수동 invoke로 {"days": 365} 같은 큰 값을 넘기면 된다(sample 키는 창 분할로 느려지므로 실키 권장).
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { fetchSeries } from "./ecos.mjs";
import { fetchFredSeries } from "./fred.mjs";
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
  const fetchedAt = new Date().toISOString();

  const summary = [];
  for (const series of SERIES) {
    try {
      // 월간 등 저빈도 시리즈는 일별 수집주기(예: 14일)로는 새 값이 나온 달을 놓칠 수 있어
      // 시리즈별 최소 창(minWindowDays)을 보장한다.
      const seriesDays = Math.max(days, series.minWindowDays ?? 0);
      const fromDate = new Date(toDate.getTime() - seriesDays * 86_400_000);
      const points = series.source === "fred"
        ? await fetchFredSeries(series.fredSeriesId, fromDate, toDate)
        : await fetchSeries(apiKey, series, fromDate, toDate);
      await batchWrite(
        tableName,
        points.map((p) => ({
          series: `${series.prefix}#${series.id}`,
          date: p.date,
          value: p.value,
          unit: series.unit,
          label: series.label,
          source: series.source === "fred" ? `FRED ${series.fredSeriesId}` : `${series.statCode}/${series.itemCode}`,
          fetchedAt,
        })),
      );
      summary.push({ series: series.id, written: points.length, latest: points.at(-1) ?? null });
    } catch (e) {
      // 한 시리즈(예: ECOS rate limit)가 실패해도 나머지 시리즈는 계속 수집한다.
      console.error(`시리즈 ${series.id} 수집 실패:`, e.message);
      summary.push({ series: series.id, error: e.message });
    }
  }
  console.log(JSON.stringify({ days, apiKey: apiKey === "sample" ? "sample" : "real", summary }));
  return { ok: true, days, summary };
}
