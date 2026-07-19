// 회사 데이터 입력 — 두 경로를 지원한다.
//   ① 엑셀 업로드: 정책(policy)·과거실적(history)·(선택)현재선적을 담은 xlsx를 통째로 올린다.
//   ② 현재 선적 수동 입력: UI 폼으로 "이번에 보낼 화물 1건"만 직접 제출한다(엑셀 없이도 가능).
// 현재 선적은 ②가 있으면 ②를 우선한다 — recommend.mjs의 loadCompany()가 병합 순서를 결정한다.
//
// GET  /company/upload-url     → 엑셀 업로드용 presigned PUT URL(5분 유효)
// GET  /company/status         → 지금 업로드된 엑셀/현재선적 존재 여부·시각
// GET  /shipments/current      → 현재 선적 프리필(폼 편집용) — UI제출본 있으면 그것, 없으면 엑셀 파싱본
// POST /shipments/current      → 현재 선적을 JSON으로 직접 저장(엑셀 불필요)
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { parseCompanyFromS3 } from "./company-input.mjs";
import { companyIdFromEvent, companyExcelKey, currentShipmentKey } from "./tenant.mjs";

const s3 = new S3Client({});
const BUCKET = process.env.COMPANY_BUCKET;

// 하위호환: recommend.mjs 등이 이 이름으로 import — 이제 companyId를 받는 함수다.
export const CURRENT_SHIPMENT_KEY = currentShipmentKey;

const json = (code, body) => ({ statusCode: code, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function headSafe(key) {
  try {
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { key, lastModified: h.LastModified?.toISOString?.() ?? null, sizeBytes: h.ContentLength };
  } catch { return null; }
}

async function getExcelUploadUrl(companyId) {
  if (!BUCKET) return json(500, { error: "COMPANY_BUCKET 미설정" });
  const key = companyExcelKey(companyId);
  const cmd = new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = await getSignedUrl(s3, cmd, { expiresIn: 300 });
  return json(200, { url, key, expiresIn: 300 });
}

async function getCompanyStatus(companyId) {
  if (!BUCKET) return json(200, { excel: null, currentShipment: null });
  const [excel, current] = await Promise.all([
    headSafe(companyExcelKey(companyId)),
    headSafe(currentShipmentKey(companyId)),
  ]);
  return json(200, { excel, currentShipment: current });
}

// UI 폼 필드 — "견적/추천에 필요한 화물 정보"만 받는다. 주문번호·선적ID·고객사명 같은
// 사내 참조번호는 견적을 받는 데 필요한 정보가 아니라서 폼에 없다(엑셀 3시트 스키마와는 이 점이 다름).
// shipmentId는 내부적으로 자동 채번한다 — 현재 선적은 항상 1건(싱글턴 파일)이라 값 자체는 표시용일 뿐.
const REQUIRED_FIELDS = ["pol", "pod", "cargoReadyDate", "requiredDeliveryDate", "equipment", "containerCount", "budgetAmount"];
const NUMERIC_FIELDS = ["containerCount", "grossWeightKg", "volumeCbm", "budgetAmount"];

function autoShipmentId() {
  const t = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `CUR-${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}`;
}

function normalizeShipment(body) {
  const out = { ...body };
  for (const k of NUMERIC_FIELDS) if (out[k] != null && out[k] !== "") out[k] = Number(out[k]);
  out.shipmentId ||= autoShipmentId();
  out.loadType ??= "FCL";
  out.cargoType ??= "DRY";
  out.expectedCostScope ??= "PORT_TO_PORT";
  out.budgetCurrency ??= "USD";
  out.freightPayer ??= "EXPORTER";
  return out;
}

async function putCurrentShipment(event, companyId) {
  if (!BUCKET) return json(500, { error: "COMPANY_BUCKET 미설정" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "잘못된 JSON 본문" }); }
  const record = normalizeShipment(body);
  const missing = REQUIRED_FIELDS.filter((k) => record[k] == null || record[k] === "");
  if (missing.length) return json(422, { error: `필수 항목 누락: ${missing.join(", ")}` });
  if (record.requiredDeliveryDate <= record.cargoReadyDate) {
    return json(422, { error: "납기일(requiredDeliveryDate)이 화물준비일(cargoReadyDate)보다 뒤여야 합니다." });
  }
  record.source = "UI_FORM";
  record.savedAt = new Date().toISOString();
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: currentShipmentKey(companyId),
      Body: JSON.stringify(record, null, 2), ContentType: "application/json",
    }));
  } catch (e) {
    console.error("현재 선적 저장 실패:", e.message);
    return json(500, { error: `저장 실패: ${e.message}` });
  }
  return json(200, { saved: true, current: record });
}

async function getCurrentShipment(companyId) {
  if (!BUCKET) return json(200, { current: null, source: null });
  // 1순위: UI 폼으로 저장된 값
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: currentShipmentKey(companyId) }));
    const text = await res.Body.transformToString();
    return json(200, { current: JSON.parse(text), source: "UI_FORM" });
  } catch { /* 없으면 엑셀에서 시도 */ }
  // 2순위: 엑셀의 2_Current_Shipment 시트
  try {
    const { current } = await parseCompanyFromS3(BUCKET, companyExcelKey(companyId));
    return json(200, { current: current ? { ...current, source: "EXCEL" } : null, source: current ? "EXCEL" : null });
  } catch {
    return json(200, { current: null, source: null });
  }
}

export async function handler(event) {
  const path = event.rawPath || event.requestContext?.http?.path || "";
  const method = event.requestContext?.http?.method || "GET";
  const companyId = companyIdFromEvent(event);
  try {
    if (path === "/company/upload-url") return await getExcelUploadUrl(companyId);
    if (path === "/company/status") return await getCompanyStatus(companyId);
    if (path === "/shipments/current" && method === "POST") return await putCurrentShipment(event, companyId);
    if (path === "/shipments/current" && method === "GET") return await getCurrentShipment(companyId);
    return json(404, { error: "not found" });
  } catch (e) {
    console.error("company-upload 처리 실패:", e);
    return json(500, { error: e.message });
  }
}
