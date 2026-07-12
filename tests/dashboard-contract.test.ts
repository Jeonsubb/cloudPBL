import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardFallback } from "../lib/dashboard-contract";
import { parseKcciHtml } from "../lib/dashboard-providers";

const KCCI_CODES = ["KCCI", "KUWI", "KUEI", "KNEI", "KMDI", "KMEI", "KAUI", "KLEI", "KLWI", "KSAI", "KWAI", "KCI", "KJI", "KSEI"];

function kcciFixture(changeFor = (code: string) => code === "KUWI" ? "-12(-1.25%)" : "10(1.00%)") {
  const rows = KCCI_CODES.map((code, index) => `<tr><td>${code}</td><td>Route ${code}</td><td>5%</td><td><b>${1_000 + index}</b></td><td>${990 + index}</td><td>${changeFor(code)}</td></tr>`).join("");
  return `<table><thead><th>Current Index<br>2026-07-13</th></thead><tbody>${rows}</tbody></table>`;
}

test("bundled dashboard fallback is explicit and chronologically sorted", () => {
  const payload = createDashboardFallback(new Date("2026-07-13T05:40:00+09:00"));
  assert.equal(payload.mode, "FALLBACK");
  assert.equal(payload.macro.usdKrw.mode, "BUNDLED_DEMO");
  assert.equal(payload.freight.kcciMode, "BUNDLED_DEMO");
  assert.match(payload.notices[0], /검증 데모 Snapshot/);
  assert.doesNotMatch(payload.notices.join(" "), /마지막 정상/);
  assert.deepEqual(payload.news.map((item) => item.publishedAt), [...payload.news.map((item) => item.publishedAt)].sort().reverse());
  const fbx = payload.freight.global.find((item) => item.id === "FBX_GLOBAL")!;
  assert.equal(fbx.observedAt, null);
  assert.ok(fbx.verifiedAt);
  assert.match(fbx.attributionUrl, /terminal\.freightos\.com/);
});

test("KCCI parser preserves negative changes and requires all 14 series", () => {
  const rows = parseKcciHtml(kcciFixture());
  assert.equal(rows.length, 14);
  assert.equal(rows.find((item) => item.code === "KUWI")?.weeklyChangePct, -1.25);
  assert.equal(rows[0].observedAt, "2026-07-13");

  assert.throws(
    () => parseKcciHtml(kcciFixture((code) => code === "KSEI" ? "N/A" : "10(1.00%)")),
    /incomplete or duplicated/,
  );
});
