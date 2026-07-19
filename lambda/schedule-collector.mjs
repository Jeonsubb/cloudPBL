// 실제 선박 스케줄 수집 Lambda.
// ShipDa(www.ship-da.com) 스케줄 조회 화면이 쓰는 공개 API(vesselSchedule/quote/list)를 로그인 없이 호출해
// 부산발 KCCI 11개 항로(남아공/서아공 2개는 ShipDa 자체 커버리지가 없어 제외 — 2026-07 확인)의
// 실제 선사/선박명/항차/ETD/ETA/환적여부를 가져온다.
// 운임(cost)은 비로그인 요청에서 항상 null이라(로그인해도 자사 계약운임일 뿐 시장가가 아님),
// KCCI 지수 앵커+지터 공식(schedule-gen.syntheticPrice, 기존 합성 스케줄과 동일 공식)으로 계산해 붙인다.
// → "스케줄은 실제, 운임은 합성"이라는 프로젝트 설계를 실제 스케줄에도 그대로 적용.
//
// EventBridge가 매주 월요일 KCCI 수집 직후 {}(전체 항로) 또는 {"routes":["KCI","KSEI"]}로 호출.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { syntheticPrice } from "./schedule-gen.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BATCH_SIZE = 25;
const PER_PAGE = 100;
const POL_ID = 1; // 부산항(KRPUS) 고정 — 전 항로 출발지

const SHIPDA_BASE = "https://api-prod.ship-da.com/vesselSchedule/quote/list";
const SHIPDA_WEB = "https://www.ship-da.com/forwarding/schedule";
const SHIPDA_HEADERS = {
  Origin: "https://www.ship-da.com",
  Referer: "https://www.ship-da.com/forwarding/schedule",
  "User-Agent": "Mozilla/5.0 (compatible; PortPulseCollector/1.0)",
};

// KCCI 항로코드 → ShipDa 목적항 podId. 대표 도착항은 ocean-services.ROUTE_PODS(기존 5개)와 정합시키고
// 나머지 6개 항로는 이번 조사에서 새로 확인한 대표 도착항.
export const ROUTE_POD_IDS = {
  KCI: { podId: 43, podName: "Shanghai" },
  KSEI: { podId: 489, podName: "Singapore" },
  KAUI: { podId: 1566, podName: "Sydney" },
  KJI: { podId: 350, podName: "Tokyo" },
  KMDI: { podId: 1639, podName: "Barcelona" },
  KLWI: { podId: 965, podName: "Manzanillo" },
  KLEI: { podId: 915, podName: "Santos" },
  KNEI: { podId: 1613, podName: "Hamburg" },
  KUWI: { podId: 822, podName: "Long Beach" },
  KUEI: { podId: 792, podName: "New York" },
  KMEI: { podId: 1934, podName: "Jebel Ali" },
};

// 항로별 현재 KCCI 수준에서의 40ft 대표 운임(합성 기준가). 5개 항로는 ocean-services.SERVICES 기존값 평균,
// 나머지 6개는 항로 거리·시장 특성 기반 추정치(Freightos류 스냅샷 부재 — 상대적 크기만 근거 있음).
export const ROUTE_ANCHOR_USD = {
  KCI: 280, KJI: 450, KSEI: 950,
  KMEI: 2200, KAUI: 2600,
  KLWI: 3400, KLEI: 4200, KMDI: 4800, KNEI: 5150,
  KUWI: 7100, KUEI: 9150,
};

// 선사 티어별 가격 배수 — 실제 업계는 같은 항로·같은 주라도 선사 간 10~20% 정도 차이가 나는 게 정상
// (지역/역내 특화 선사는 비용경쟁력으로 저가 포지셔닝, 글로벌 대형선사는 기준가 근접~약간 프리미엄).
// 조사 근거: 같은 항로 선사간 스프레드 10~20%가 일반적이라는 업계 자료(2026-07 확인).
const CARRIER_TIER_MULTIPLIER = {
  // 한국계 역내 특화 선사 — 비용경쟁력 포지셔닝(저가)
  KMTC: 0.87, SINOKOR: 0.85, "HEUNG-A": 0.86, NAMSUNG: 0.88, "SM LINE": 0.87,
  PAN: 0.85, INTERASIA: 0.86, KOTA: 0.88,
  // 초대형 글로벌 선사(규모의 경제로 공격적 가격) — 약간 저가~기준가
  MSC: 0.94, CMA: 0.96, "CMA CGM": 0.96,
  // 한국/일본 대형 선사 — 기준가(anchorUsd 자체가 이 수준 기반)
  HMM: 1.0, ONE: 1.0,
  // 그 외 글로벌 대형 선사 — 기준가~약간 프리미엄(서비스 안정성)
  MAERSK: 1.08, ZIM: 1.05, COSCO: 1.0, EVERGREEN: 1.02, "YANG MING": 1.0, "HAPAG-LLOYD": 1.06,
};
function carrierMultiplier(carrierName) {
  const key = String(carrierName ?? "").trim().toUpperCase();
  return CARRIER_TIER_MULTIPLIER[key] ?? 1.0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function batchWrite(tableName, items) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    let requests = items.slice(i, i + BATCH_SIZE).map((item) => ({ PutRequest: { Item: item } }));
    for (let attempt = 0; requests.length > 0 && attempt < 3; attempt += 1) {
      const result = await ddb.send(new BatchWriteCommand({ RequestItems: { [tableName]: requests } }));
      requests = result.UnprocessedItems?.[tableName] ?? [];
      if (requests.length > 0) await sleep(200 * (attempt + 1));
    }
    if (requests.length > 0) throw new Error(`DynamoDB unprocessed items: ${requests.length}`);
  }
}

// 해당 항로의 KCCI 주간 시계열(오름차순) — 합성 운임의 "현재/ETD시점 지수" 계산에 필요. 없으면 앵커 고정가.
async function loadRouteSeries(marketTable, routeCode) {
  if (!marketTable) return null;
  try {
    const r = await ddb.send(new QueryCommand({
      TableName: marketTable,
      KeyConditionExpression: "series = :s",
      ExpressionAttributeValues: { ":s": `KCCI#${routeCode}` },
    }));
    const pts = (r.Items ?? []).map((i) => ({ date: i.date, value: Number(i.value) })).sort((a, b) => a.date.localeCompare(b.date));
    return pts.length >= 4 ? pts : null;
  } catch (e) { console.warn(`KCCI ${routeCode} 로드 실패:`, e.message); return null; }
}

async function fetchPage(podId, etdIso, page) {
  const url = `${SHIPDA_BASE}?freightType=FCL&polId=${POL_ID}&podId=${podId}&etd=${encodeURIComponent(etdIso)}&page=${page}&perPage=${PER_PAGE}&sort=etd&order=ASC`;
  const res = await fetch(url, { headers: SHIPDA_HEADERS });
  if (!res.ok) throw new Error(`ShipDa ${res.status} podId=${podId} page=${page}`);
  return res.json();
}

// podId의 전체 스케줄을 페이지네이션으로 수집(perPage=100 기준 항로당 1~3페이지 수준)
async function fetchAllSailings(podId, etdIso) {
  const first = await fetchPage(podId, etdIso, 0);
  const list = [...(first.list ?? [])];
  const carrierById = new Map((first.meta?.carrier ?? []).map((c) => [c.id, c.name]));
  const total = first.total ?? list.length;
  for (let page = 1; page * PER_PAGE < total; page += 1) {
    await sleep(150); // 공개 API 예의상 페이지 사이 소폭 지연
    const next = await fetchPage(podId, etdIso, page);
    list.push(...(next.list ?? []));
  }
  return { list, carrierById, total };
}

function toScheduleItem({ routeCode, podName, sailing: s, carrierById, anchorUsd, routeSeries, collectedAt }) {
  const etdIso = s.fullETD.slice(0, 10);
  const carrier = carrierById.get(s.linerId) ?? `Carrier#${s.linerId}`;
  // 항로 기준가 × 선사 티어 배수(±13~15%p 수준) — 같은 주 안에서도 선사별로 값이 갈리게 한다.
  const tieredAnchor = anchorUsd * carrierMultiplier(carrier);
  const { priceUSD, priceBasis } = syntheticPrice({
    anchorUsd: tieredAnchor, routeSeries, etdIso, seed: String(s.id), jitterPct: 0.1,
  });
  const scheduleQuery = new URLSearchParams({
    freightType: "FCL", polId: String(POL_ID), podId: String(ROUTE_POD_IDS[routeCode].podId),
    etd: `${etdIso}T00:00:00.000Z`, scheduleId: String(s.id),
  });
  return {
    routeCode,
    sortKey: `${s.fullETD}#${s.id}`,
    shipdaId: s.id,
    sourceUrl: `${SHIPDA_WEB}?${scheduleQuery}`,
    carrier,
    vessel: s.shipName,
    voyage: s.voyagerNo,
    pol: s.pol, pod: s.pod, podName,
    etd: etdIso, eta: s.fullETA.slice(0, 10),
    etdFull: s.fullETD, etaFull: s.fullETA,
    transitDays: s.transitTimeInDays,
    direct: !s.ts,
    transship: s.ts ? { ship1: s.tsShipName1, voyage1: s.tsVoyagerNo1, ship2: s.tsShipName2, voyage2: s.tsVoyagerNo2 } : null,
    docCloseTime: s.docCloseTime, cargoCloseTime: s.cargoCloseTime,
    priceUSD, priceBasis,
    source: "shipda", collectedAt,
  };
}

export async function handler(event = {}) {
  const tableName = process.env.SCHEDULE_TABLE_NAME;
  const marketTable = process.env.MARKET_TABLE_NAME;
  if (!tableName) throw new Error("SCHEDULE_TABLE_NAME env is required");

  const routes = event.routes?.length ? event.routes : Object.keys(ROUTE_POD_IDS);
  const nowIso = new Date().toISOString();
  const summary = [];

  for (const routeCode of routes) {
    const cfg = ROUTE_POD_IDS[routeCode];
    const anchorUsd = ROUTE_ANCHOR_USD[routeCode];
    if (!cfg || anchorUsd == null) { summary.push({ routeCode, error: "알 수 없는 항로(ShipDa 커버리지 없음)" }); continue; }
    try {
      const [routeSeries, { list, carrierById, total }] = await Promise.all([
        loadRouteSeries(marketTable, routeCode),
        fetchAllSailings(cfg.podId, nowIso),
      ]);
      const items = list.map((s) => toScheduleItem({
        routeCode, podName: cfg.podName, sailing: s, carrierById, anchorUsd, routeSeries, collectedAt: nowIso,
      }));
      await batchWrite(tableName, items);
      summary.push({ routeCode, podId: cfg.podId, total, written: items.length, kcciSource: routeSeries ? "dynamodb" : "anchor고정" });
    } catch (e) {
      console.error(`${routeCode} 수집 실패:`, e);
      summary.push({ routeCode, error: e.message });
    }
  }

  console.log(JSON.stringify({ summary }));
  return { ok: true, summary };
}
