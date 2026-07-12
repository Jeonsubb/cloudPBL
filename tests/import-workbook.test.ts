import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePortPulseFile } from "../lib/import-workbook";

test("parses and validates the distributed PortPulse workbook", async () => {
  const bytes = await readFile(new URL("../public/portpulse-import-template.xlsx", import.meta.url));
  const file = new File([bytes], "portpulse-import-template.xlsx");
  const result = await parsePortPulseFile(file);

  assert.deepEqual(result.counts, { shipments: 8, quotes: 12, charges: 61 });
  assert.equal(result.blocking, 0);
  assert.equal(result.warnings, 4);
  assert.equal(result.canApprove, true);
  assert.equal(result.security.malwareScanPerformed, false);
  assert.ok(result.issues.some((issue) => issue.message.includes("KCCI 절대금액 직접 비교 대상이 아닙니다")));
});
