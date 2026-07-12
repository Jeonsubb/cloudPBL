export type ImportIssue = {
  level: "BLOCKING" | "WARNING" | "INFO";
  sheet: string;
  row: number | null;
  field: string | null;
  message: string;
};

export type ImportedSheet = {
  name: string;
  headers: string[];
  records: Record<string, string | number | boolean | Date | null>[];
};

export type ImportResult = {
  fileName: string;
  fileType: "XLSX" | "CSV";
  sheets: ImportedSheet[];
  counts: { shipments: number; quotes: number; charges: number };
  issues: ImportIssue[];
  blocking: number;
  warnings: number;
  canApprove: boolean;
  preview: Record<string, unknown>[];
  security: {
    mode: "LOCAL_BROWSER_PARSE";
    malwareScanPerformed: false;
    notice: string;
  };
};

type Cell = string | number | boolean | Date | null | undefined;

const text = (value: Cell) => value instanceof Date
  ? value.toISOString().slice(0, 10)
  : value === null || value === undefined
    ? ""
    : String(value).trim();

export function sheetFromRows(name: string, rows: Cell[][]): ImportedSheet {
  const [head = [], ...body] = rows;
  const headers = head.map((value, index) => text(value) || `column_${index + 1}`);
  const records = body
    .filter((row) => row.some((value) => text(value) !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
  return { name, headers, records };
}

const requiredShipment = [
  "shipment_ref", "cargo_ready_date", "pol_unlocode", "pod_unlocode", "load_type",
  "cargo_profile", "incoterm_code", "incoterm_named_place", "main_carriage_payer",
  "booking_controller", "target_amount", "target_currency", "cost_scope",
];

function issueMissingHeaders(sheet: ImportedSheet, required: string[], issues: ImportIssue[]) {
  for (const header of required) {
    if (!sheet.headers.includes(header)) {
      issues.push({ level: "BLOCKING", sheet: sheet.name, row: 1, field: header, message: `필수 열 '${header}'이 없습니다.` });
    }
  }
}

function validateShipmentSheet(sheet: ImportedSheet, issues: ImportIssue[]) {
  issueMissingHeaders(sheet, requiredShipment, issues);
  sheet.records.forEach((record, index) => {
    const row = index + 2;
    for (const field of requiredShipment) {
      if (text(record[field] as Cell) === "") {
        issues.push({ level: "BLOCKING", sheet: sheet.name, row, field, message: `${field} 값을 입력하세요.` });
      }
    }
    const load = text(record.load_type as Cell);
    const equipment = text(record.equipment_size_type as Cell);
    const count = Number(record.container_count ?? 0);
    if (load === "FCL" && (!equipment || count <= 0)) {
      issues.push({ level: "BLOCKING", sheet: sheet.name, row, field: "equipment_size_type", message: "FCL은 장비 규격과 컨테이너 수가 필요합니다." });
    }
    const profile = text(record.cargo_profile as Cell);
    if ((equipment === "20GP" || load === "LCL" || profile !== "DRY") && profile) {
      issues.push({ level: "WARNING", sheet: sheet.name, row, field: "cargo_profile", message: `${equipment || load}/${profile}는 KCCI 절대금액 직접 비교 대상이 아닙니다.` });
    }
    if (text(record.booking_controller as Cell) === "BUYER") {
      issues.push({ level: "WARNING", sheet: sheet.name, row, field: "booking_controller", message: "바이어 부킹 거래는 직접 부킹 권고를 생성하지 않습니다." });
    }
    const cargoReady = text(record.cargo_ready_date as Cell);
    const etdEnd = text(record.etd_window_end as Cell);
    if (cargoReady && etdEnd && cargoReady > etdEnd) {
      issues.push({ level: "BLOCKING", sheet: sheet.name, row, field: "etd_window_end", message: "Cargo Ready가 ETD 가능 종료일보다 늦습니다." });
    }
  });
}

function validateQuoteSheets(header: ImportedSheet | undefined, charges: ImportedSheet | undefined, issues: ImportIssue[]) {
  if (!header) {
    issues.push({ level: "WARNING", sheet: "견적헤더", row: null, field: null, message: "견적헤더 시트가 없어 선적계획만 가져옵니다." });
    return;
  }
  issueMissingHeaders(header, ["quote_ref", "shipment_ref", "valid_until", "forwarder_name", "header_total", "currency", "total_scope"], issues);
  if (!charges) {
    issues.push({ level: "WARNING", sheet: "견적비용", row: null, field: null, message: "견적비용 시트가 없어 KCCI 비용범위 비교를 수행할 수 없습니다." });
    return;
  }
  issueMissingHeaders(charges, ["quote_ref", "line_no", "category", "amount", "quantity", "kcci_comparable_yn"], issues);
  const lineTotals = new Map<string, number>();
  charges.records.forEach((record, index) => {
    const ref = text(record.quote_ref as Cell);
    const amount = Number(record.amount ?? 0);
    const quantity = Number(record.quantity ?? 0);
    if (!ref || amount < 0 || quantity <= 0) {
      issues.push({ level: "BLOCKING", sheet: charges.name, row: index + 2, field: "amount", message: "비용라인의 견적번호·금액·수량을 확인하세요." });
      return;
    }
    lineTotals.set(ref, (lineTotals.get(ref) ?? 0) + amount * quantity);
  });
  header.records.forEach((record, index) => {
    const ref = text(record.quote_ref as Cell);
    const total = Number(record.header_total ?? 0);
    const lines = lineTotals.get(ref);
    if (!ref || total <= 0) {
      issues.push({ level: "BLOCKING", sheet: header.name, row: index + 2, field: "header_total", message: "견적번호와 총액을 확인하세요." });
    } else if (lines === undefined) {
      issues.push({ level: "BLOCKING", sheet: header.name, row: index + 2, field: "quote_ref", message: `${ref}의 비용라인이 없습니다.` });
    } else if (Math.abs(lines - total) > 0.01) {
      issues.push({ level: "BLOCKING", sheet: header.name, row: index + 2, field: "header_total", message: `${ref} 총액과 비용라인 합계가 ${Math.abs(lines - total).toFixed(2)} 차이 납니다.` });
    }
  });
}

export function validateImportedSheets(fileName: string, fileType: ImportResult["fileType"], sheets: ImportedSheet[]): ImportResult {
  const issues: ImportIssue[] = [];
  const shipment = sheets.find((sheet) => sheet.name === "선적계획") ?? sheets[0];
  const quoteHeader = sheets.find((sheet) => sheet.name === "견적헤더");
  const quoteCharges = sheets.find((sheet) => sheet.name === "견적비용");
  if (!shipment) {
    issues.push({ level: "BLOCKING", sheet: "선적계획", row: null, field: null, message: "읽을 수 있는 선적계획 데이터가 없습니다." });
  } else {
    validateShipmentSheet(shipment, issues);
  }
  if (fileType === "XLSX") validateQuoteSheets(quoteHeader, quoteCharges, issues);
  issues.push({ level: "INFO", sheet: "파일", row: null, field: null, message: "로컬 MVP에서는 브라우저 안에서만 파싱하며 서버 악성코드 검사는 수행하지 않습니다." });
  const blocking = issues.filter((issue) => issue.level === "BLOCKING").length;
  const warnings = issues.filter((issue) => issue.level === "WARNING").length;
  return {
    fileName,
    fileType,
    sheets,
    counts: {
      shipments: shipment?.records.length ?? 0,
      quotes: quoteHeader?.records.length ?? 0,
      charges: quoteCharges?.records.length ?? 0,
    },
    issues,
    blocking,
    warnings,
    canApprove: blocking === 0,
    preview: shipment?.records.slice(0, 5) ?? [],
    security: {
      mode: "LOCAL_BROWSER_PARSE",
      malwareScanPerformed: false,
      notice: "운영 배포에서는 S3 Quarantine과 GuardDuty 검사 후 파싱해야 합니다.",
    },
  };
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];
    if (current === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (current === '"') {
      quoted = !quoted;
    } else if (current === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((current === "\n" || current === "\r") && !quoted) {
      if (current === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += current;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

export async function parsePortPulseFile(file: File): Promise<ImportResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) {
    const csv = await file.text();
    return validateImportedSheets(file.name, "CSV", [sheetFromRows("선적계획", parseCsvRows(csv))]);
  }
  if (!lower.endsWith(".xlsx")) throw new Error(".xlsx 또는 .csv 파일만 지원합니다.");
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheets = workbook.worksheets.map((worksheet) => {
    const rows: Cell[][] = [];
    const columnCount = Math.max(worksheet.actualColumnCount, worksheet.columnCount);
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const values = Array.from({ length: columnCount }, (_, index) => normalizeExcelCell(row.getCell(index + 1).value));
      if (values.some((value) => text(value) !== "")) rows.push(values);
    }
    return sheetFromRows(worksheet.name, rows);
  });
  return validateImportedSheets(file.name, "XLSX", sheets);
}

function normalizeExcelCell(value: unknown): Cell {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("result" in record) return normalizeExcelCell(record.result);
    if (typeof record.text === "string") return record.text;
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text) : "").join("");
    }
    if (typeof record.error === "string") return record.error;
  }
  return String(value);
}
