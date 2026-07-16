// 로컬 end-to-end 검증기 — 회사 엑셀 + 생성 KCCI 이력 + 환율/금리로 추천 브리프를 계산해 출력.
// Bedrock 없이 결정론 계산부(스케줄·통계·타이밍)를 전부 확인한다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "../lambda/company-input.mjs";
import { buildBrief } from "../lambda/recommend-engine.mjs";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const j = (f) => JSON.parse(readFileSync(`${dataDir}/${f}`, "utf8"));

const XLSX_PATH = process.argv[2] ??
  "/Users/kmg/AWSProject/outputs/portpulse-input-template-20260713/PortPulse_Company_Input_Template.xlsx";

const { policy, current, history } = await parseCompanyFile(XLSX_PATH);
const kcci = j("kcci-history.json");
const fxDoc = j("FX_USD_KRW.json");
const rateDoc = j("BOK_BASE_RATE.json");

const brief = buildBrief({
  policy, current, history,
  kcci: { series: kcci.series, compositeNow: kcci.compositeNow },
  fx: { USD: fxDoc.points },
  baseRate: rateDoc.points,
  asOf: "2026-07-16",
});

console.log("═".repeat(70));
console.log(`${brief.company} · ${brief.shipment.id} · ${brief.shipment.lane} (${brief.shipment.routeLabel})`);
console.log("═".repeat(70));
console.log(`선적: ${brief.shipment.equipment}×${brief.shipment.containers} ${brief.shipment.commodity}`);
console.log(`화물준비 ${brief.shipment.cargoReadyDate} · 납기 ${brief.shipment.requiredDeliveryDate} (버퍼 ${brief.shipment.minDeliveryBufferDays}일 → 도착 마감 ${brief.shipment.deadlineLatestEta})`);
console.log(`예산 $${brief.shipment.budgetTotal} ($${brief.shipment.budgetPerFeu}/FEU)`);
console.log();
console.log("── 시장(KCCI " + brief.market.routeLabel + ")");
const m = brief.market;
console.log(`현재 ${m.indexNow}pt · 전주 ${m.wowPct}% · 4주 ${m.m1Pct}% · 12주 ${m.m3Pct}% · yoy ${m.yoyPct}%`);
console.log(`52주 백분위 ${m.pctile52} · z ${m.z52} · 저점대비 +${m.fromMin52Pct}% · 고점대비 ${m.fromMax52Pct}% · 국면 ${m.regime}/${m.momentum}`);
console.log(`종합 KCCI ${brief.composite.now}pt (백분위 ${brief.composite.pctile52}, yoy ${brief.composite.yoyPct}%)`);
console.log();
console.log("── 자사 이력 통계 (" + brief.company_stats.sampleSize + "건)");
const cs = brief.company_stats;
console.log(`시장연동 공정가 $${cs.projectedFairPerFeu}/FEU (최근 실거래 $${cs.historicalPerFeu.last} × 지수 ${cs.indexChangeSinceLastPct}% since ${cs.lastShipmentDate})`);
console.log(`자사 지불 추세: $${cs.historicalPerFeu.first} → $${cs.historicalPerFeu.last}/FEU (${cs.historicalPerFeu.trendPct}%)`);
for (const f of cs.forwarders) console.log(`  · ${f.forwarder}: ${f.shipments}건, 평균지연 ${f.avgDelayDays}일, 견적초과 ${f.avgQuoteOverrunPct}%, 정시율 ${f.onTimeRate}%, 선사 ${f.carriers.join("/")}`);
console.log();
console.log("── 예산 맥락");
const b = brief.budget;
console.log(`예산 $${b.budgetPerFeu}/FEU · 자사투영대비 ${b.vsProjectedPct}% · 최근지불대비 ${b.vsLastPaidPct}% · 현물대비 ${b.vsSpotNowPct}%`);
console.log();
console.log("── 스케줄 (" + brief.schedule.feasibleCount + "/" + brief.schedule.boardable + " 탑승가능·납기충족)");
for (const c of brief.schedule.candidates.slice(0, 8)) {
  const flag = c.comfortable ? "✅여유" : c.feasible ? "🟡납기빠듯" : "❌납기초과";
  console.log(`  ${flag} ${c.etd}→${c.eta} ${c.operator}/${c.service} ${c.vessel} ${c.direct ? "직항" : "환적"} $${c.priceUSD}/FEU (버퍼 ${c.deliveryBufferDays}일, 예산 ${c.vsBudgetPct}%)`);
}
console.log();
console.log("── 타이밍 판독:", brief.timing.lean);
for (const s of brief.timing.signals) console.log("  ·", s);
console.log();
console.log(`FX USD/KRW ${brief.fx?.value} (${brief.fx?.date}, 1M ${brief.fx?.m1Pct}%) · 기준금리 ${brief.baseRate?.value}%`);
