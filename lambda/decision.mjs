// 선적 의사결정 규칙엔진 (portpulse-mvp/lib/portpulse.ts decision-v1.0.0 포팅).
// 순수 함수 — 회사 선적/견적 + 실시간 시장맵(KCCI 항로)을 받아 결정카드를 계산한다.
// AI는 이 결과를 "설명·추천"만 하고, 여기서 결정된 행동/숫자를 바꾸지 않는다.
const MS_DAY = 86_400_000;
const RULE_VERSION = "decision-v1.0.0";

export function daysBetween(from, to) {
  return Math.ceil(
    (new Date(`${to.slice(0, 10)}T00:00:00+09:00`).getTime() -
      new Date(`${from.slice(0, 10)}T00:00:00+09:00`).getTime()) / MS_DAY,
  );
}

const lineTotal = (line) => line.amount * line.quantity;
export const quoteChargeTotal = (q) => q.charges.reduce((s, c) => s + lineTotal(c), 0);
export const quoteComparableTotal = (q) =>
  q.charges.filter((c) => c.kcciComparable).reduce((s, c) => s + lineTotal(c), 0);

export function getComparability(shipment, quote) {
  if (!quote) return "NO_QUOTE";
  if (shipment.bookingController === "BUYER") return "NO_CONTROL";
  const eligible =
    shipment.pol === "KRPUS" &&
    shipment.loadType === "FCL" &&
    (shipment.equipment === "40GP" || shipment.equipment === "40HC") &&
    shipment.cargoProfile === "DRY" &&
    shipment.containerCount > 0 &&
    Boolean(shipment.routeCode) &&
    quoteComparableTotal(quote) > 0;
  return eligible ? "DIRECT" : "UNSUPPORTED";
}

/**
 * @param shipment 회사 선적
 * @param quotes   해당 선적의 견적 배열
 * @param marketByRoute { [routeCode]: { name, value, weeklyChangePct, observedAt } } — 실시간 KCCI
 * @param asOf      기준일 YYYY-MM-DD (KST)
 */
export function buildDecisionCard(shipment, quotes, marketByRoute, asOf) {
  const activeQuotes = quotes.filter((q) => daysBetween(asOf, q.validUntil) >= 0);
  const selected =
    [...activeQuotes].sort((a, b) => a.total - b.total)[0] ??
    [...quotes].sort((a, b) => b.validUntil.localeCompare(a.validUntil))[0] ??
    null;
  const comparability = getComparability(shipment, selected);
  const market = shipment.routeCode ? marketByRoute[shipment.routeCode] : null;

  const budgetVariancePct = selected ? ((selected.total - shipment.targetBudget) / shipment.targetBudget) * 100 : null;
  const deliveryBufferDays = selected ? daysBetween(selected.plannedEta, shipment.requiredDeliveryDate) : null;
  const quoteValidityDays = selected ? daysBetween(asOf, selected.validUntil) : null;
  const comparablePerFeu =
    selected && shipment.containerCount > 0 ? quoteComparableTotal(selected) / shipment.containerCount : null;
  const kcciVariancePct =
    comparability === "DIRECT" && market && comparablePerFeu !== null
      ? ((comparablePerFeu - market.value) / market.value) * 100
      : null;

  let action = "WATCH_UNTIL";
  let actionLabel = "기한까지 관찰";
  let priority = "WATCH";
  const reasons = [];
  const counterSignals = [];

  if (!selected) {
    action = "REQUEST_QUOTE"; actionLabel = "견적 요청"; priority = "DATA";
    reasons.push("유효한 포워더 견적이 없어 비용·일정 비교를 시작할 수 없습니다.");
  } else if (comparability === "NO_CONTROL") {
    action = "MANUAL_CONFIRM"; actionLabel = "바이어 확인 요청"; priority = "DATA";
    reasons.push("바이어가 국제운송 부킹을 통제하는 거래입니다.");
    reasons.push("출발지 비용과 마감만 관리하고 직접 부킹 권고는 생성하지 않습니다.");
  } else if ((deliveryBufferDays ?? 99) <= 3 || (quoteValidityDays ?? 99) <= 1) {
    action = "ACCEPT_QUOTE"; actionLabel = "견적 검토·수용"; priority = "URGENT";
    reasons.push(`납기 버퍼가 ${deliveryBufferDays ?? "확인 불가"}일로 짧거나 견적 만료가 임박했습니다.`);
  } else if ((budgetVariancePct ?? 0) > 5 || (kcciVariancePct ?? 0) > 8) {
    action = "REQUEST_REQUOTE"; actionLabel = "재견적 요청"; priority = "ACTION";
    if ((budgetVariancePct ?? 0) > 5) reasons.push(`현재 견적이 회사 예산보다 ${budgetVariancePct.toFixed(1)}% 높습니다.`);
    if ((kcciVariancePct ?? 0) > 8) reasons.push(`비교 가능한 해상비가 동일 항로 KCCI보다 ${kcciVariancePct.toFixed(1)}% 높습니다.`);
  } else {
    reasons.push("현재 견적이 예산 범위에 있고 일정상 짧은 관찰 여유가 있습니다.");
  }

  if (market && market.weeklyChangePct > 8) {
    counterSignals.push(`${market.name} KCCI가 전주 대비 ${market.weeklyChangePct.toFixed(2)}% 상승해 오래 기다리는 것은 위험할 수 있습니다.`);
  }
  if (selected && !selected.direct) {
    counterSignals.push(`선택 견적은 환적 ${selected.transshipments}회로 일정 변동 가능성이 있습니다.`);
  }
  if (comparability === "UNSUPPORTED") {
    reasons.push(`${shipment.equipment}/${shipment.cargoProfile}/${shipment.loadType} 조건은 KCCI 절대금액 직접 비교 대상이 아닙니다.`);
  }

  const deadline = selected ? [selected.validUntil, shipment.etdWindowStart].sort()[0] : shipment.etdWindowStart;
  const dataCoveragePct = selected ? (comparability === "DIRECT" ? 92 : 78) : 54;
  const confidence = comparability === "DIRECT" && selected ? "HIGH" : selected ? "MEDIUM" : "LOW";
  const summary = selected
    ? `${shipment.originLabel}→${shipment.destinationLabel} ${shipment.equipment} × ${shipment.containerCount || 1}. ${actionLabel}이 필요합니다.`
    : `${shipment.originLabel}→${shipment.destinationLabel} 선적에 비교 가능한 견적을 먼저 등록해야 합니다.`;

  return {
    shipmentId: shipment.id,
    quoteId: selected?.id ?? null,
    action, actionLabel, deadline, priority, confidence, summary,
    reasons, counterSignals,
    budgetVariancePct, kcciVariancePct, deliveryBufferDays, quoteValidityDays,
    comparability, dataCoveragePct,
    ruleVersion: RULE_VERSION,
    evaluatedAt: asOf,
    market: market ? { code: shipment.routeCode, name: market.name, value: market.value, weeklyChangePct: market.weeklyChangePct, observedAt: market.observedAt } : null,
  };
}
