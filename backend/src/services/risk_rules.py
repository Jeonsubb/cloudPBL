from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any


@dataclass
class RuleResult:
    name: str
    score: int
    reason: str
    action: str


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


def calculate_risk(shipment: dict[str, Any], quote: dict[str, Any], market: dict[str, Any]) -> dict[str, Any]:
    today = date.today()
    results: list[RuleResult] = []

    valid_until = _parse_date(quote.get("validUntil"))
    if valid_until and (valid_until - today).days <= 3 and shipment.get("status") != "BOOKED":
        results.append(
            RuleResult(
                name="QUOTE_EXPIRING",
                score=30,
                reason="견적 유효기간이 3일 이하로 남았지만 부킹이 완료되지 않았습니다.",
                action="포워더에게 견적 유효기간 연장 또는 즉시 부킹 가능 여부를 확인하세요.",
            )
        )

    eta = _parse_date(quote.get("eta"))
    due_date = _parse_date(shipment.get("dueDate"))
    if eta and due_date and (due_date - eta).days <= 5:
        results.append(
            RuleResult(
                name="DUE_DATE_TIGHT",
                score=25,
                reason="예상 도착일과 납기일 사이 여유가 5일 이하입니다.",
                action="고객 납기일 조정 가능성 또는 더 빠른 스케줄을 확인하세요.",
            )
        )

    if market.get("freightTrend") == "UP":
        results.append(
            RuleResult(
                name="FREIGHT_RISING",
                score=10,
                reason="최근 운임 지표가 상승세입니다.",
                action="운임 재견적 가능성과 할증 적용 여부를 확인하세요.",
            )
        )

    if market.get("eventRisk") in {"HORMUZ", "RED_SEA", "STRIKE"}:
        results.append(
            RuleResult(
                name="EVENT_RISK",
                score=10,
                reason="관련 항로에 지정학 또는 항만 운영 리스크 이벤트가 감지되었습니다.",
                action="선사 스케줄 변경, 보험료, 유류할증료 반영 여부를 확인하세요.",
            )
        )

    score = min(sum(item.score for item in results), 100)
    level = "LOW"
    if score >= 70:
        level = "HIGH"
    elif score >= 40:
        level = "MEDIUM"

    return {
        "riskScore": score,
        "riskLevel": level,
        "reasons": [item.reason for item in results],
        "recommendedActions": [item.action for item in results],
        "appliedRules": [item.name for item in results],
    }
