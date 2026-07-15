// 조회 API Lambda (API Gateway HTTP API 뒤에 배치).
// GET /series             → 지표 목록(메타데이터만, DB 조회 없음)
// GET /series/{id}?days=N → 해당 지표의 최근 N일 시계열
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SERIES } from "./market-series.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// 기준금리(1999~)·환율(1980~) 전체 이력 백필을 지원하기 위한 상한.
const MAX_DAYS = 20000;

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  const tableName = process.env.TABLE_NAME;
  const seriesId = event.pathParameters?.seriesId;

  if (!seriesId) {
    return response(
      200,
      SERIES.map(({ id, label, unit, source, category }) => ({ id, label, unit, source, category })),
    );
  }

  const meta = SERIES.find((s) => s.id === seriesId);
  if (!meta) return response(404, { error: `unknown series: ${seriesId}` });

  const days = Math.min(Number(event.queryStringParameters?.days ?? 90) || 90, MAX_DAYS);
  const fromDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  // 장기 이력(기준금리 1999~, 환율 1980~)은 1MB Query 응답 한도를 넘을 수 있어 페이지네이션한다.
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "series = :s AND #d >= :from",
        ExpressionAttributeNames: { "#d": "date" },
        ExpressionAttributeValues: { ":s": `${meta.prefix}#${seriesId}`, ":from": fromDate },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    items.push(...(result.Items ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  const points = items
    .map((item) => ({ date: item.date, value: item.value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return response(200, {
    id: meta.id,
    label: meta.label,
    unit: meta.unit,
    source: meta.source,
    points,
  });
}
