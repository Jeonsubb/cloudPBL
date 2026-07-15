// KOBC(한국해양진흥공사) KCCI 클라이언트.
// 공식 오픈API가 없다 — data.go.kr 파일데이터도 결국 이 KOBC 페이지로 안내한다.
// 사이트의 "Timeseries & Graphs" 엑셀 다운로드 버튼이 호출하는 폼 엔드포인트를 그대로 사용한다(인증 불필요).
import * as XLSX from "xlsx";

const DOWNLOAD_URL = "https://www.kobc.or.kr/ebz/shippinginfo/timeseries/excel/download.do?mId=0304000000";

function fmt(date) {
  return date.toISOString().slice(0, 10);
}

function toIsoDate(raw) {
  const digits = String(raw).replace(/[^0-9]/g, "");
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/**
 * 지정 기간의 KCCI 종합지수 + 13개 세부항로를 { [컬럼명]: [{date, value}] } 형태로 반환한다.
 * 한 번 요청으로 전체 이력(2022-11 출시~오늘)이 잘리지 않고 온다(2026-07-14 실호출로 확인됨).
 * @param {Date} fromDate
 * @param {Date} toDate
 */
export async function fetchKcciAll(fromDate, toDate) {
  const response = await fetch(DOWNLOAD_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ sDay: fmt(fromDate), eDay: fmt(toDate) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`KOBC HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const headerIdx = rows.findIndex((row) => row.includes("DATE"));
  if (headerIdx === -1) throw new Error("KOBC KCCI 응답에서 헤더 행을 찾지 못함");
  const header = rows[headerIdx];
  const dateCol = header.indexOf("DATE");
  const dataRows = rows.slice(headerIdx + 1).filter((row) => row[dateCol]);
  const columns = header.filter((h) => h && h !== "번호" && h !== "DATE");

  const bySeries = {};
  for (const col of columns) {
    const colIdx = header.indexOf(col);
    bySeries[col] = dataRows
      .map((row) => ({ date: toIsoDate(row[dateCol]), value: Number(row[colIdx]) }))
      .filter((p) => Number.isFinite(p.value))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return bySeries;
}
