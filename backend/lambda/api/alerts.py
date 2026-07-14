"""
PortPulse - GET /api/alerts
부킹 타이밍 경보 이력 조회
"""

import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.response import success, error, cors_preflight
from shared.db import get_db


def handler(event, context):
    """경보 이력 조회 핸들러"""
    if event.get("httpMethod") == "OPTIONS":
        return cors_preflight()

    try:
        db = get_db()
        user_id = _get_user_id(event)

        params = event.get("queryStringParameters") or {}
        limit = int(params.get("limit", "20"))
        alert_type = params.get("type")  # 'booking_timing', 'daily_briefing', 'event'

        if alert_type:
            alerts_list = db.query(
                """
                SELECT a.id, a.alert_type, a.title, a.message, a.risk_level,
                       a.data_sources, a.sent_via, a.sent_at, a.created_at,
                       s.origin, s.destination, s.shipping_date
                FROM alerts a
                LEFT JOIN shipments s ON a.shipment_id = s.id
                WHERE a.user_id = :user_id AND a.alert_type = :alert_type
                ORDER BY a.created_at DESC
                LIMIT :limit
                """,
                {"user_id": user_id, "alert_type": alert_type, "limit": limit},
            )
        else:
            alerts_list = db.query(
                """
                SELECT a.id, a.alert_type, a.title, a.message, a.risk_level,
                       a.data_sources, a.sent_via, a.sent_at, a.created_at,
                       s.origin, s.destination, s.shipping_date
                FROM alerts a
                LEFT JOIN shipments s ON a.shipment_id = s.id
                WHERE a.user_id = :user_id
                ORDER BY a.created_at DESC
                LIMIT :limit
                """,
                {"user_id": user_id, "limit": limit},
            )

        return success({"alerts": alerts_list, "total": len(alerts_list)})

    except Exception as e:
        print(f"Error in alerts handler: {e}")
        return error(str(e), 500)


def _get_user_id(event):
    """요청에서 사용자 ID 추출"""
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("claims", {})
    )
    return claims.get("sub", "demo-user")
