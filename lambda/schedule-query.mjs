// 실제 스케줄(portpulse-schedule) 조회 — recommend.mjs(추천 파이프라인)와 API(GET /schedule)가 공유한다.
// GET /schedule → 부산발 커버 항로 전체의 임박 스케줄(항로별 대표 도착항 + 최근접 항차 몇 건, 카드 표시용)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ROUTE_POD_IDS } from "./schedule-collector.mjs";
import { ROUTE_PODS } from "./ocean-services.mjs";
import { ROUTE_LABEL } from "./route-map.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CARDS_PER_ROUTE = 8;

function response(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// routeCode의 ETD가 [fromIso, toIso] 안인 실제 스케줄 → buildBrief()가 쓰는 항차 형태로 매핑.
// ShipDa 커버 항로가 아니거나(KSAI/KWAI) DB에 아직 데이터가 없으면 빈 배열(호출부가 synthetic으로 폴백).
export async function loadRouteSchedule(scheduleTable, routeCode, fromIso, toIso) {
  if (!scheduleTable || !ROUTE_POD_IDS[routeCode]) return [];
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: scheduleTable,
      KeyConditionExpression: "routeCode = :r AND sortKey BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":r": routeCode,
        ":from": `${fromIso}T00:00:00.000Z`,
        ":to": `${toIso}T23:59:59.999Z`,
      },
    }));
    return (r.Items ?? [])
      .map((i) => ({
        routeCode, service: null, operator: i.carrier,
        vessel: i.vessel, voyage: i.voyage, direct: i.direct, transitDays: i.transitDays,
        etd: i.etd, eta: i.eta, priceUSD: i.priceUSD, priceBasis: i.priceBasis,
      }))
      .sort((a, b) => a.etd.localeCompare(b.etd));
  } catch (e) { console.warn(`스케줄 ${routeCode} 조회 실패:`, e.message); return []; }
}

function toCard(routeCode, pod, item) {
  return {
    originName: "Busan", destName: pod.name, destCC: pod.cc,
    vessel: item.vessel, operator: item.operator, etd: item.etd, eta: item.eta,
    direct: item.direct, priceUSD: item.priceUSD,
  };
}

// 프론트 카드용 — ShipDa 실커버 11개 항로 전부, 오늘부터 45일 내 임박 항차 상위 N건씩.
async function buildScheduleOverview(scheduleTable) {
  const todayIso = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const toIso = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
  const routes = [];
  for (const routeCode of Object.keys(ROUTE_POD_IDS)) {
    const pod = ROUTE_PODS[routeCode]?.[0];
    if (!pod) continue;
    const items = await loadRouteSchedule(scheduleTable, routeCode, todayIso, toIso);
    if (items.length === 0) continue; // 이 창(45일)에 임박 항차가 없으면 카드 미표시
    routes.push({
      routeCode, routeLabel: ROUTE_LABEL[routeCode] ?? routeCode,
      originName: "Busan", destName: pod.name, destCC: pod.cc,
      sailings: items.slice(0, CARDS_PER_ROUTE).map((s) => toCard(routeCode, pod, s)),
    });
  }
  return routes;
}

export async function handler() {
  const scheduleTable = process.env.SCHEDULE_TABLE_NAME;
  const routes = await buildScheduleOverview(scheduleTable);
  return response(200, { asOf: new Date().toISOString(), routes });
}
