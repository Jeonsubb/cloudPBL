// 실제 스케줄(portpulse-schedule) 조회 — recommend.mjs(추천 파이프라인)와 API(GET /schedule)가 공유한다.
// GET /schedule            → 부산발 커버 항로 전체의 미리보기(항로별 균등분산 N건 + 전체 건수)
// GET /schedule/{routeCode} → 해당 항로의 전체 스케줄(사용자가 "전체보기" 눌렀을 때)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ROUTE_POD_IDS } from "./schedule-collector.mjs";
import { ROUTE_PODS } from "./ocean-services.mjs";
import { ROUTE_LABEL } from "./route-map.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CARDS_PER_ROUTE = 10;
const DISPLAY_WINDOW_DAYS = 75; // ShipDa 공개 창(~85~90일)에 맞춤

function displayWindow() {
  const from = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + DISPLAY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

// 상위 N건을 그냥 앞에서 자르면 상하이처럼 항차가 잦은(거의 매일) 항로는 45일 창인데도
// "이번 주 것"만 보이게 된다 — 정렬된 배열에서 균등 간격으로 뽑아 창 전체 기간이 드러나게 한다.
// index 0(가장 임박한 항차)은 항상 포함돼 홈 화면의 "임박순" 로직과 호환된다.
function sampleSpread(items, n) {
  if (items.length <= n) return items;
  const step = (items.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => items[Math.round(i * step)]);
}

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

// 프론트 카드용 미리보기 — ShipDa 실커버 11개 항로 전부, 창(75일) 전체에서 균등분산 N건 + 전체 건수.
async function buildScheduleOverview(scheduleTable) {
  const { from, to } = displayWindow();
  const routes = [];
  for (const routeCode of Object.keys(ROUTE_POD_IDS)) {
    const pod = ROUTE_PODS[routeCode]?.[0];
    if (!pod) continue;
    const items = await loadRouteSchedule(scheduleTable, routeCode, from, to);
    if (items.length === 0) continue; // 이 창에 임박 항차가 없으면 카드 미표시
    routes.push({
      routeCode, routeLabel: ROUTE_LABEL[routeCode] ?? routeCode,
      originName: "Busan", destName: pod.name, destCC: pod.cc,
      total: items.length,
      sailings: sampleSpread(items, CARDS_PER_ROUTE).map((s) => toCard(routeCode, pod, s)),
    });
  }
  return routes;
}

// 사용자가 "전체보기"를 누르면 해당 항로의 창(75일) 내 전체 스케줄을 자르지 않고 반환.
async function buildFullRoute(scheduleTable, routeCode) {
  const pod = ROUTE_PODS[routeCode]?.[0];
  if (!pod || !ROUTE_POD_IDS[routeCode]) return null;
  const { from, to } = displayWindow();
  const items = await loadRouteSchedule(scheduleTable, routeCode, from, to);
  return {
    routeCode, routeLabel: ROUTE_LABEL[routeCode] ?? routeCode,
    originName: "Busan", destName: pod.name, destCC: pod.cc,
    total: items.length,
    sailings: items.map((s) => toCard(routeCode, pod, s)),
  };
}

export async function handler(event) {
  const scheduleTable = process.env.SCHEDULE_TABLE_NAME;
  const routeCode = event.pathParameters?.routeCode?.toUpperCase();
  if (routeCode) {
    const full = await buildFullRoute(scheduleTable, routeCode);
    if (!full) return response(404, { error: `unknown routeCode: ${routeCode}` });
    return response(200, { asOf: new Date().toISOString(), route: full });
  }
  const routes = await buildScheduleOverview(scheduleTable);
  return response(200, { asOf: new Date().toISOString(), routes });
}
