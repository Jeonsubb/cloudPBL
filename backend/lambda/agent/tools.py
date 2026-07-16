"""Read-only action group tools for the PortPulse Supervisor Agent."""

import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.db import get_db
from shared.routes import normalize_route


def handler(event, context):
    """Dispatch a Bedrock function-details action to a read-only DB tool."""
    action_group = event.get("actionGroup", "PortPulseReadTools")
    function_name = event.get("function", "")
    parameters = {
        item.get("name"): item.get("value")
        for item in event.get("parameters", [])
        if item.get("name")
    }

    try:
        db = get_db()
        if function_name == "GetMarketSnapshot":
            result = _get_market_snapshot(db, parameters.get("route"))
        elif function_name == "GetHighImpactNews":
            result = _get_high_impact_news(
                db,
                parameters.get("limit"),
                parameters.get("category"),
            )
        elif function_name == "GetShipmentRisk":
            user_id = (event.get("sessionAttributes") or {}).get("userId")
            result = _get_shipment_risk(db, parameters.get("shipmentId"), user_id)
        else:
            raise ValueError(f"지원하지 않는 Agent Tool입니다: {function_name}")

        return _tool_response(event, action_group, function_name, {"ok": True, "data": result})
    except ValueError as exc:
        return _tool_response(
            event,
            action_group,
            function_name,
            {"ok": False, "error": str(exc)},
            response_state="REPROMPT",
        )
    except Exception as exc:
        print(f"Agent tool error ({function_name}): {exc}")
        return _tool_response(
            event,
            action_group,
            function_name,
            {"ok": False, "error": "데이터 조회 중 오류가 발생했습니다."},
            response_state="FAILURE",
        )


def _get_market_snapshot(db, route=None):
    route_code = normalize_route(route, default="composite" if not route else None)
    kcci = db.query(
        """
        SELECT route, index_value, change_rate, recorded_date
        FROM market_data
        WHERE data_type = 'kcci' AND route = :route
        ORDER BY recorded_date DESC LIMIT 1
        """,
        {"route": route_code},
    )
    scfi = db.query(
        """
        SELECT route, index_value, change_rate, recorded_date
        FROM market_data
        WHERE data_type = 'scfi' AND route = 'composite'
        ORDER BY recorded_date DESC LIMIT 1
        """
    )
    exchange = db.query(
        """
        SELECT currency_pair, index_value, change_rate, recorded_date
        FROM market_data
        WHERE data_type = 'exchange_rate' AND currency_pair = 'USD/KRW'
        ORDER BY recorded_date DESC LIMIT 1
        """
    )
    interest = db.query(
        """
        SELECT index_value, recorded_date
        FROM market_data
        WHERE data_type = 'interest_rate'
        ORDER BY recorded_date DESC LIMIT 1
        """
    )
    return {
        "route": route_code,
        "kcci": kcci[0] if kcci else None,
        "scfi": scfi[0] if scfi else None,
        "exchangeRate": exchange[0] if exchange else None,
        "interestRate": interest[0] if interest else None,
    }


def _get_high_impact_news(db, requested_limit=None, category=None):
    limit = _bounded_int(requested_limit, default=5, minimum=1, maximum=10)
    if category:
        rows = db.query(
            """
            SELECT id, title, summary, category, source_url, impact_level, published_date
            FROM news
            WHERE impact_level = 'HIGH' AND category = :category
            ORDER BY published_date DESC LIMIT :limit
            """,
            {"category": str(category), "limit": limit},
        )
    else:
        rows = db.query(
            """
            SELECT id, title, summary, category, source_url, impact_level, published_date
            FROM news
            WHERE impact_level = 'HIGH'
            ORDER BY published_date DESC LIMIT :limit
            """,
            {"limit": limit},
        )
    return {"news": rows, "count": len(rows)}


def _get_shipment_risk(db, shipment_id, user_id):
    if not shipment_id:
        raise ValueError("선적 ID가 필요합니다.")
    if not user_id:
        raise ValueError("사용자 세션을 확인할 수 없습니다.")

    try:
        normalized_id = int(shipment_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("선적 ID는 정수여야 합니다.") from exc

    rows = db.query(
        """
        SELECT id, origin, destination, booking_date, shipping_date,
               volume, unit, incoterms, budget_per_unit, current_quote,
               flexibility, category, risk_level, risk_score, updated_at
        FROM shipments
        WHERE id = :id AND user_id = :user_id
        LIMIT 1
        """,
        {"id": normalized_id, "user_id": user_id},
    )
    if not rows:
        raise ValueError("해당 선적 건을 찾을 수 없습니다.")
    return {"shipment": rows[0]}


def _bounded_int(value, default, minimum, maximum):
    if value in (None, ""):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("limit은 정수여야 합니다.") from exc
    return max(minimum, min(parsed, maximum))


def _tool_response(event, action_group, function_name, body, response_state=None):
    function_response = {
        "responseBody": {
            "TEXT": {
                "body": json.dumps(body, ensure_ascii=False, default=_json_default)
            }
        }
    }
    if response_state:
        function_response["responseState"] = response_state

    return {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": action_group,
            "function": function_name,
            "functionResponse": function_response,
        },
        "sessionAttributes": event.get("sessionAttributes", {}),
        "promptSessionAttributes": event.get("promptSessionAttributes", {}),
    }


def _json_default(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"JSON으로 변환할 수 없는 타입입니다: {type(value).__name__}")
