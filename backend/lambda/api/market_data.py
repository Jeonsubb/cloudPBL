"""
PortPulse - GET /api/market-data
Home 대시보드용: KCCI, SCFI, 환율 최신 데이터 조회
"""

import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.response import success, error, cors_preflight
from shared.db import get_db


def handler(event, context):
    """시장 데이터 조회 핸들러"""
    if event.get("httpMethod") == "OPTIONS":
        return cors_preflight()

    try:
        db = get_db()

        # 최신 KCCI 종합지수
        kcci_data = db.query("""
            SELECT index_value, change_rate, recorded_date, raw_data
            FROM market_data
            WHERE data_type = 'kcci' AND route = 'composite'
            ORDER BY recorded_date DESC
            LIMIT 1
        """)

        # KCCI 항로별 데이터
        kcci_routes = db.query("""
            SELECT route, index_value, change_rate, recorded_date
            FROM market_data
            WHERE data_type = 'kcci' AND route != 'composite'
              AND recorded_date = (
                SELECT MAX(recorded_date) FROM market_data WHERE data_type = 'kcci'
              )
            ORDER BY route
        """)

        # 최신 SCFI
        scfi_data = db.query("""
            SELECT route, index_value, change_rate, recorded_date, raw_data
            FROM market_data
            WHERE data_type = 'scfi' AND route = 'composite'
            ORDER BY recorded_date DESC
            LIMIT 1
        """)

        # 최신 환율
        exchange_data = db.query("""
            SELECT index_value, change_rate, recorded_date
            FROM market_data
            WHERE data_type = 'exchange_rate' AND currency_pair = 'USD/KRW'
            ORDER BY recorded_date DESC
            LIMIT 1
        """)

        # 최신 기준금리
        interest_data = db.query("""
            SELECT index_value, recorded_date
            FROM market_data
            WHERE data_type = 'interest_rate'
            ORDER BY recorded_date DESC
            LIMIT 1
        """)

        # KCCI 시계열 (최근 12주)
        kcci_history = db.query("""
            SELECT index_value, recorded_date
            FROM market_data
            WHERE data_type = 'kcci' AND route = 'composite'
            ORDER BY recorded_date DESC
            LIMIT 12
        """)

        # SCFI 시계열 (최근 12주)
        scfi_history = db.query("""
            SELECT index_value, recorded_date
            FROM market_data
            WHERE data_type = 'scfi' AND route = 'composite'
            ORDER BY recorded_date DESC
            LIMIT 12
        """)

        scfi_latest = scfi_data[0] if scfi_data else None
        if scfi_latest:
            scfi_latest["history"] = list(reversed(scfi_history))

        response_body = {
            "kcci": {
                "composite": kcci_data[0] if kcci_data else None,
                "routes": kcci_routes,
                "history": list(reversed(kcci_history)),
            },
            "scfi": scfi_latest,
            "exchange_rate": exchange_data[0] if exchange_data else None,
            "interest_rate": interest_data[0] if interest_data else None,
        }

        return success(response_body)

    except Exception as e:
        print(f"Error in market_data handler: {e}")
        return error(str(e), 500)
