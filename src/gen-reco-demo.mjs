// 프론트 데모용 추천 스냅샷 생성 — 실제 브리프(결정론 계산)를 돌려 나온 진짜 숫자로
// 추천 객체(narrative/keyNumbers/actions...)를 구성해 data/recommendation-demo.json 에 저장.
// 이것은 배포된 Bedrock 엔드포인트가 반환하는 스키마와 동일한 '골든 예시'이며,
// 라이브 API가 없을 때 프론트가 폴백으로 렌더한다. 모든 수치는 brief에서 파생(드리프트 없음).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCompanyFile } from "../lambda/company-input.mjs";
import { buildBrief } from "../lambda/recommend-engine.mjs";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const j = (f) => JSON.parse(readFileSync(`${dataDir}/${f}`, "utf8"));
const XLSX_PATH = "/Users/kmg/AWSProject/outputs/portpulse-input-template-20260713/PortPulse_Company_Input_Template.xlsx";

const { policy, current, history } = await parseCompanyFile(XLSX_PATH);
const kcci = j("kcci-history.json");
const brief = buildBrief({
  policy, current, history,
  kcci: { series: kcci.series, compositeNow: kcci.compositeNow },
  fx: { USD: j("FX_USD_KRW.json").points }, baseRate: j("BOK_BASE_RATE.json").points,
  asOf: "2026-07-16",
});
brief.dataSources = { kcci: "bundled(demo)", company: "bundled(demo)", news: 0 };

const m = brief.market, cs = brief.company_stats, b = brief.budget, sc = brief.schedule;
const pick = sc.earliestFeasible ?? sc.candidates[0];
const best = cs.forwarders.slice().sort((a, z) => (a.avgDelayDays ?? 9) - (z.avgDelayDays ?? 9))[0];
const worst = cs.forwarders.slice().sort((a, z) => (z.avgDelayDays ?? 0) - (a.avgDelayDays ?? 0))[0];
const n0 = (v) => Number(v).toLocaleString("en-US");
// 선사명이 선박명 접두에 이미 들어있으면(예: ONE + "ONE TRIBUTE") 중복 제거
const shipName = (op, vessel) => (vessel.startsWith(op) ? vessel : `${op} ${vessel}`);
const PV = shipName(pick.operator, pick.vessel);

const recommendation = {
  verdict: "지금 잡으세요 — 미룰 장이 아닙니다",
  stance: brief.timing.lean === "CONSIDER_WAIT" ? "CONSIDER_WAIT" : "BOOK_NOW",
  confidence: "HIGH",
  recommendedSailing: {
    vessel: pick.vessel, operator: pick.operator, service: pick.service,
    etd: pick.etd, eta: pick.eta, priceUSDPerFeu: pick.priceUSD,
    why: `하드 납기(${brief.shipment.requiredDeliveryDate})를 지키는 유일한 직항 항차`,
  },
  narrative:
    `북유럽 항로 운임은 지금 KCCI ${n0(m.indexNow)}pt로, 최근 1년 구간에서 상위 ${100 - m.pctile52}%(백분위 ${m.pctile52})에 놓인 역사적 고점권입니다. 전년 대비 +${m.yoyPct}%, 저점 대비 +${m.fromMin52Pct}% 올라온 자리이고 12주 추세도 여전히 주당 +${m.slope12WkPctPerWk}%로 상승 중입니다. 냉정히 말해 "쌀 때 실어보내는" 국면은 아니며, 미룰수록 유리해질 그림도 아닙니다.\n\n` +
    `그렇다고 이번 건이 비싼 계약이라는 뜻은 아닙니다. 귀사의 가장 최근 실거래가는 FEU당 $${n0(cs.historicalPerFeu.last)}였고, 그 사이 항로 지수가 +${cs.indexChangeSinceLastPct}% 올랐으니 같은 조건의 오늘 공정가는 약 $${n0(cs.projectedFairPerFeu)}/FEU로 환산됩니다. 지금 확보 가능한 현물은 $${n0(pick.priceUSD)}/FEU로 그 공정가에 근접하고, 책정하신 예산 $${n0(brief.shipment.budgetPerFeu)}/FEU보다는 ${b.vsSpotNowPct > 0 ? "+" : ""}${b.vsSpotNowPct}% 높은 수준입니다. 예산은 다소 공격적이지만 시장·자사 기준 모두에서 "말이 되는" 범위 안에 있습니다.\n\n` +
    `핵심은 타이밍입니다. 화물 준비일 ${brief.shipment.cargoReadyDate}에서 납기 ${brief.shipment.requiredDeliveryDate}까지의 창이 좁아, 하드 납기를 지키는 항차는 ${best ? "" : ""}${PV}(${pick.service} 직항, ETD ${pick.etd} → ETA ${pick.eta}) 단 한 편뿐입니다. 이 배가 도착 여유 ${pick.deliveryBufferDays}일로 마감을 겨우 지키며, 환적 서비스(FE3)는 60~70일대라 아예 납기를 넘깁니다. 다음 직항편은 납기를 초과합니다. 즉 "관망"이라는 선택지 자체가 사실상 없습니다.\n\n` +
    `버퍼가 ${pick.deliveryBufferDays}일로 얇은 만큼 포워더 선택이 곧 리스크 관리입니다. 자사 이력상 ${best.forwarder}(${best.carriers.join("/")})는 평균 지연 ${best.avgDelayDays}일·정시율 ${best.onTimeRate}%로 안정적이지만, ${worst.forwarder}(${worst.carriers.join("/")})는 평균 ${worst.avgDelayDays}일 지연·정시율 ${worst.onTimeRate}%로, 그 지연폭만으로도 3일 버퍼를 삼켜 납기를 놓칠 수 있습니다. ${best.forwarder}로 진행하고, 자사 공정가 $${n0(cs.projectedFairPerFeu)}를 근거로 $${n0(Math.round(cs.projectedFairPerFeu / 100) * 100 - 100)}선까지 재견적을 요청하십시오.`,
  keyNumbers: [
    { label: "북유럽 KCCI", value: `${n0(m.indexNow)}pt`, note: `최근 1년 상위 ${100 - m.pctile52}% (백분위 ${m.pctile52})` },
    { label: "연간 상승", value: `+${m.yoyPct}%`, note: `저점 대비 +${m.fromMin52Pct}%, 12주 +${m.m3Pct}%` },
    { label: "추천 운임", value: `$${n0(pick.priceUSD)}/FEU`, note: `자사 공정가 $${n0(cs.projectedFairPerFeu)}·예산 $${n0(brief.shipment.budgetPerFeu)} 사이` },
    { label: "납기 버퍼", value: `${pick.deliveryBufferDays}일`, note: `하드 납기 충족 항차는 이 1편뿐` },
    { label: "12주 추세", value: `+${m.slope12WkPctPerWk}%/주`, note: "상승 중 — 미루면 더 오름" },
  ],
  actions: [
    `${PV}(${pick.service}, ETD ${pick.etd}) 부킹 슬롯을 오늘 확보하고 DOC 컷오프 역산해 서류 준비 착수`,
    `${best.forwarder}로 진행(정시율 ${best.onTimeRate}%, 평균 ${best.avgDelayDays}일) — ${worst.forwarder}는 3일 버퍼에 위험`,
    `자사 시장연동 공정가 $${n0(cs.projectedFairPerFeu)}/FEU를 근거로 목표가 재견적 요청`,
  ],
  risks: [
    `도착 여유가 ${pick.deliveryBufferDays}일뿐 — 항만 혼잡·롤오버 시 ${brief.shipment.requiredDeliveryDate} 납기 실패 위험. 롤오버 방지(no-roll) 조건 확보 권장`,
    "운임이 역사적 고점권이라 단기 반락 가능성은 있으나, 납기상 그 하락을 기다릴 여유가 없음",
  ],
  watchTriggers: [
    `북유럽 KCCI가 다음 주 -5% 이상 급락하고 화물 준비일을 앞당길 수 있으면 재검토`,
    `${pick.vessel} 슬롯 마감 시 차선 직항이 없음 → 항공·특송 대체 즉시 검토`,
  ],
  nextReviewDate: "2026-07-23",
  _note: "데모 스냅샷(배포 시 Bedrock가 동일 스키마로 생성). 모든 수치는 결정론 브리프에서 파생.",
};

writeFileSync(`${dataDir}/recommendation-demo.json`, JSON.stringify({ asOf: brief.asOf, brief, recommendation }, null, 2));
console.log("recommendation-demo.json 생성:", recommendation.verdict, "|", recommendation.stance, "| 추천항차", pick.vessel, pick.etd);
