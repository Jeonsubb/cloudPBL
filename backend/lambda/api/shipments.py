"""
PortPulse - /api/shipments
POST: 새 선적 건 등록
GET: 내 선적 건 목록 조회
"""

import json
import sys
import os
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.response import success, error, cors_preflight
from shared.db import get_db


def handler(event, context):
    """선적 건 CRUD 핸들러"""
    if event.get("httpMethod") == "OPTIONS":
        return cors_preflight()

    method = event.get("httpMethod", "GET")

    if method == "POST":
        return create_shipment(event)
    elif method == "GET":
        return list_shipments(event)
    else:
        return error("Method not allowed", 405)


def create_shipment(event):
    """새 선적 건 등록"""
    try:
        body = json.loads(event.get("body", "{}"))
        db = get_db()

        # 필수 필드 검증
        required = ["destination", "shipping_date", "volume"]
        for field in required:
            if not body.get(field):
                return error(f"필수 항목이 누락되었습니다: {field}")

        # 사용자 ID (Cognito에서 추출, 없으면 기본값)
        user_id = _get_user_id(event)
        booking_date = _parse_date(body.get("booking_date"), "booking_date", required=False)
        shipping_date = _parse_date(body.get("shipping_date"), "shipping_date", required=True)

        created = db.query(
            """
            INSERT INTO shipments 
                (user_id, origin, destination, booking_date, shipping_date,
                 volume, unit, incoterms, budget_per_unit, current_quote,
                 flexibility, category)
            VALUES 
                (:user_id, :origin, :destination,
                 CAST(:booking_date AS DATE), CAST(:shipping_date AS DATE),
                 :volume, :unit, :incoterms, :budget, :current_quote,
                 :flexibility, :category)
            RETURNING id, user_id, origin, destination, booking_date, shipping_date,
                      volume, unit, incoterms, budget_per_unit, current_quote,
                      flexibility, category, risk_level, risk_score, created_at
            """,
            {
                "user_id": user_id,
                "origin": body.get("origin", "부산"),
                "destination": body["destination"],
                "booking_date": booking_date,
                "shipping_date": shipping_date,
                "volume": int(body["volume"]),
                "unit": body.get("unit", "FEU"),
                "incoterms": body.get("incoterms", "CIF"),
                "budget": float(body["budget"]) if body.get("budget") else None,
                "current_quote": float(body["current_quote"]) if body.get("current_quote") else None,
                "flexibility": body.get("flexibility"),
                "category": body.get("category", "일반화물"),
            },
        )

        shipment = created[0] if created else None
        return success({
            "message": "선적 건이 등록되었습니다.",
            "shipment": shipment,
            "id": shipment["id"] if shipment else None,
        }, 201)

    except json.JSONDecodeError:
        return error("잘못된 요청 형식입니다.")
    except ValueError as e:
        return error(str(e))
    except Exception as e:
        print(f"Error creating shipment: {e}")
        return error(str(e), 500)


def list_shipments(event):
    """내 선적 건 목록 조회"""
    try:
        db = get_db()
        user_id = _get_user_id(event)

        shipments = db.query(
            """
            SELECT id, origin, destination, booking_date, shipping_date,
                   volume, unit, incoterms, budget_per_unit, current_quote,
                   flexibility, category, risk_level, risk_score, created_at
            FROM shipments
            WHERE user_id = :user_id
            ORDER BY shipping_date ASC
            """,
            {"user_id": user_id},
        )

        return success({"shipments": shipments})

    except Exception as e:
        print(f"Error listing shipments: {e}")
        return error(str(e), 500)


def _get_user_id(event):
    """요청에서 사용자 ID 추출 (Cognito 또는 기본값)"""
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("claims", {})
    )
    return claims.get("sub", "demo-user")


def _parse_date(value, field_name, required=False):
    """폼 날짜를 검증하고 YYYY-MM-DD 문자열로 정규화한다."""
    if not value:
        if required:
            raise ValueError(f"필수 날짜가 누락되었습니다: {field_name}")
        return None

    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError as exc:
        raise ValueError(
            f"{field_name}은 YYYY-MM-DD 형식이어야 합니다."
        ) from exc
