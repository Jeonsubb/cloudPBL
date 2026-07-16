// 뉴스 조회 API Lambda.
// GET /news/top?date=YYYY-MM-DD&limit=N → 해당 날짜(기본 오늘, KST) 점수 상위 N건
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function handler(event) {
  const tableName = process.env.NEWS_TABLE_NAME;
  const date = event.queryStringParameters?.date ?? todayKst();
  const limit = Math.min(Number(event.queryStringParameters?.limit ?? 5) || 5, 100);

  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "#d = :d",
      ExpressionAttributeNames: { "#d": "date" },
      ExpressionAttributeValues: { ":d": date },
    }),
  );

  // 키워드 점수 0(해운 키워드 무매칭)은 잡음으로 제외. duplicate는 news-collector가
  // Bedrock으로 미리 계산해둔 "같은 사안, 다른 신문사" 중복 표시 — 여기선 플래그만 읽는다(재계산 없음).
  const relevant = (result.Items ?? [])
    .filter((it) => (it.score ?? 0) > 0 && !it.duplicate)
    .sort((a, b) => b.score - a.score || b.pubDate.localeCompare(a.pubDate));

  const items = relevant.slice(0, limit).map(({ title, link, source, pubDate, score }) => ({
    title,
    link,
    source,
    pubDate,
    score,
  }));

  return response(200, { date, total: relevant.length, count: items.length, items });
}
