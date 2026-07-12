import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

function request(path = "/", init = {}) {
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the PortPulse market-first dashboard", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>PortPulse \| 수출 선적 의사결정 대시보드<\/title>/i);
  assert.match(html, /수출 담당자가 봐야 할/);
  assert.match(html, /최근 해양·물류 주요뉴스/);
  assert.match(html, /글로벌 운임지수/);
  assert.match(html, /USER DATA · SYNTHETIC/);
  assert.match(html, /부산발 40ft Dry Spot/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("returns grounded market data with source health", async () => {
  const response = await request("/api/market");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(Array.isArray(payload.freight) && payload.freight.length >= 10);
  assert.ok(Array.isArray(payload.exchange) && payload.exchange.length === 4);
  assert.ok(Array.isArray(payload.news) && payload.news.length >= 3);
  assert.equal(payload.freight[0].provenance, "MARKET_OBSERVED");
  assert.ok(["LIVE", "FALLBACK"].includes(payload.health.exchange));
});

test("returns the versioned dashboard contract with licensed data boundaries", async () => {
  const response = await request("/api/dashboard");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-portpulse-schema"), "portpulse.dashboard.v1");
  const payload = await response.json();
  assert.equal(payload.schemaVersion, "portpulse.dashboard.v1");
  assert.equal(payload.macro.usdKrw.source, "한국은행 ECOS");
  assert.ok(payload.macro.usdKrw.points.length >= 8);
  assert.equal(payload.freight.kcci[0].code, "KCCI");
  assert.equal(payload.freight.kcci[0].unit, "PT");
  const fbx = payload.freight.global.find((item) => item.id === "FBX_GLOBAL");
  const scfi = payload.freight.global.find((item) => item.id === "SCFI");
  assert.equal(fbx.status, "PUBLIC_ATTRIBUTED");
  assert.equal(scfi.status, "LICENSE_REQUIRED");
  assert.equal(scfi.value, null);
  assert.ok(payload.sources.some((source) => source.id === "NEWS"));
});

test("answers shipment questions with evidence and limitations", async () => {
  const response = await request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "SHP-2026-0001이 왜 재견적 대상이야?" }),
  });
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.match(answer.answer, /SHP-2026-0001/);
  assert.match(answer.answer, /회사 예산/);
  assert.ok(answer.facts.length >= 3);
  assert.ok(answer.exclusions.some((value) => value.includes("Local Charge")));
  assert.equal(answer.suggestedView, "quotes");
});

test("ships the validated workbook template", async () => {
  const template = await readFile(new URL("../public/portpulse-import-template.xlsx", import.meta.url));
  assert.ok(template.length > 30_000);
  assert.equal(template.subarray(0, 2).toString("utf8"), "PK");
});
