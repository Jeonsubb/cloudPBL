// 회사 입력 엑셀(PortPulse_Company_Input_Template.xlsx) 파서.
// 시트 3종을 구조화된 객체로 변환한다:
//   1_Company_Policy      → policy   (회사 판단 기준: 통화·납기버퍼·예산경고·환적선호)
//   2_Current_Shipment    → current  (지금 판단할 선적 1건)
//   3_Historical_Shipments→ history[](완료된 과거 실적 — 자사 프리미엄/포워더 성적 산출용)
//
// 각 시트는 [제목행, 설명행, 헤더행, 데이터...] 구조라 헤더를 3번째 행(range:2)으로 잡는다.
// 엑셀 시리얼 날짜(예: 46216)는 ISO(YYYY-MM-DD)로 변환한다.
import * as XLSX from "xlsx";

const EXCEL_EPOCH = Date.UTC(1899, 11, 30); // 1899-12-30
const DAY = 86_400_000;

function serialToIso(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    // 이미 날짜 문자열이면 그대로(YYYY-MM-DD 앞 10자리)
    const m = v.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : v;
  }
  if (typeof v === "number") return new Date(EXCEL_EPOCH + v * DAY).toISOString().slice(0, 10);
  return null;
}

// 시트마다 제목·설명 행 수가 달라(병합/빈 행 포함) 헤더 위치가 유동적이라,
// 알려진 헤더 키(marker)가 들어있는 행을 찾아 그 행을 헤더로 삼는다.
function sheetRows(wb, name, markers) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const headerIdx = grid.findIndex((row) =>
    Array.isArray(row) && row.some((c) => typeof c === "string" && markers.includes(c.trim())),
  );
  if (headerIdx < 0) return [];
  const headers = grid[headerIdx].map((c) => (c == null ? "" : String(c).trim()));
  const rows = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!Array.isArray(cells) || cells.every((c) => c == null || c === "")) continue;
    const obj = {};
    headers.forEach((h, j) => { if (h) obj[h] = cells[j] ?? null; });
    rows.push(obj);
  }
  return rows;
}

// 날짜성 컬럼들을 ISO로 정규화
const DATE_COLS = new Set([
  "lastReviewedDate", "cargoReadyDate", "requiredDeliveryDate",
  "plannedEtd", "actualDeparture", "plannedEta", "actualArrival",
]);
function normalizeDates(row) {
  const out = { ...row };
  for (const k of Object.keys(out)) if (DATE_COLS.has(k)) out[k] = serialToIso(out[k]);
  return out;
}

export function parseCompanyWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const policyRows = sheetRows(wb, "1_Company_Policy", ["companyName"]).map(normalizeDates);
  const currentRows = sheetRows(wb, "2_Current_Shipment", ["shipmentId"]).map(normalizeDates);
  const historyRows = sheetRows(wb, "3_Historical_Shipments", ["historicalShipmentId"]).map(normalizeDates);

  const policy = policyRows[0] ?? null;
  const current = currentRows[0] ?? null;
  const history = historyRows.filter((r) => r.historicalShipmentId);

  return { policy, current, history };
}

// 로컬 파일에서 파싱(개발/CLI용)
export async function parseCompanyFile(path) {
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(path);
  return parseCompanyWorkbook(buf);
}

// S3에서 파싱(운영용) — 최신 업로드 객체를 읽는다.
export async function parseCompanyFromS3(bucket, key) {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({});
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buf = Buffer.from(await res.Body.transformToByteArray());
  return parseCompanyWorkbook(buf);
}
