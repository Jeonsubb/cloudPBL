"""
PortPulse - ECOS 데이터 수집기
한국은행 ECOS Open API로 환율·기준금리 수집
"""

import json
import os
import sys
import requests
from datetime import datetime, date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.db import get_db

ECOS_API_KEY = os.environ.get("ECOS_API_KEY", "")
ECOS_BASE_URL = "https://ecos.bok.or.kr/api"

# 통계 코드
STAT_CODES = {
    "exchange_rate": {
        "table": "731Y001",     # 원/달러 환율
        "item": "0000001",      # 매매기준율
        "cycle": "D",           # 일별
    },
    "interest_rate": {
        "table": "722Y001",     # 한국은행 기준금리
        "item": "0101000",
        "cycle": "M",           # 월별
    },
}


def handler(event, context):
    """ECOS 데이터 수집 Lambda 핸들러"""
    print(f"ECOS collector triggered at {datetime.now().isoformat()}")

    results = []

    try:
        # 환율 수집
        exchange_data = fetch_exchange_rate()
        if exchange_data:
            save_to_db(exchange_data)
            results.append(f"exchange_rate: {len(exchange_data)} records")

        # 기준금리 수집
        interest_data = fetch_interest_rate()
        if interest_data:
            save_to_db(interest_data)
            results.append(f"interest_rate: {len(interest_data)} records")

        summary = " | ".join(results) if results else "No data collected"
        print(f"ECOS collection complete: {summary}")
        return {"statusCode": 200, "body": summary}

    except Exception as e:
        print(f"ECOS collector error: {e}")
        return {"statusCode": 500, "body": str(e)}


def fetch_exchange_rate():
    """원/달러 환율 조회"""
    today = date.today()
    start_date = (today - timedelta(days=7)).strftime("%Y%m%d")
    end_date = today.strftime("%Y%m%d")

    stat = STAT_CODES["exchange_rate"]
    url = (
        f"{ECOS_BASE_URL}/StatisticSearch/{ECOS_API_KEY}/json/kr/1/10/"
        f"{stat['table']}/{stat['cycle']}/{start_date}/{end_date}/{stat['item']}"
    )

    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()

        rows = data.get("StatisticSearch", {}).get("row", [])
        if not rows:
            return None

        results = []
        prev_value = None

        for row in rows:
            value = float(row.get("DATA_VALUE", "0").replace(",", ""))
            recorded_date = _parse_ecos_date(row.get("TIME", ""), stat["cycle"])

            change_rate = 0
            if prev_value and prev_value > 0:
                change_rate = ((value - prev_value) / prev_value) * 100
            prev_value = value

            results.append({
                "data_type": "exchange_rate",
                "route": None,
                "currency_pair": "USD/KRW",
                "index_value": value,
                "change_rate": round(change_rate, 2),
                "recorded_date": recorded_date,
                "raw_data": row,
            })

        return results

    except Exception as e:
        print(f"Exchange rate fetch error: {e}")
        return None


def fetch_interest_rate():
    """한국은행 기준금리 조회"""
    today = date.today()
    start_date = (today - timedelta(days=90)).strftime("%Y%m%d")
    end_date = today.strftime("%Y%m%d")

    stat = STAT_CODES["interest_rate"]
    url = (
        f"{ECOS_BASE_URL}/StatisticSearch/{ECOS_API_KEY}/json/kr/1/5/"
        f"{stat['table']}/{stat['cycle']}/{start_date}/{end_date}/{stat['item']}"
    )

    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()

        rows = data.get("StatisticSearch", {}).get("row", [])
        if not rows:
            return None

        results = []
        for row in rows:
            value = float(row.get("DATA_VALUE", "0").replace(",", ""))
            recorded_date = _parse_ecos_date(row.get("TIME", ""), stat["cycle"])

            results.append({
                "data_type": "interest_rate",
                "route": None,
                "currency_pair": None,
                "index_value": value,
                "change_rate": 0,
                "recorded_date": recorded_date,
                "raw_data": row,
            })

        return results

    except Exception as e:
        print(f"Interest rate fetch error: {e}")
        return None


def save_to_db(records):
    """수집 데이터를 DB에 저장 (upsert)"""
    db = get_db()

    for record in records:
        existing = db.query(
            """
            SELECT id FROM market_data
            WHERE data_type = :data_type
              AND recorded_date = CAST(:recorded_date AS DATE)
              AND (currency_pair = :currency_pair OR (currency_pair IS NULL AND :currency_pair IS NULL))
            """,
            {
                "data_type": record["data_type"],
                "recorded_date": record["recorded_date"],
                "currency_pair": record.get("currency_pair"),
            },
        )

        if existing:
            db.execute(
                """
                UPDATE market_data 
                SET index_value = :index_value,
                    change_rate = :change_rate,
                    raw_data = CAST(:raw_data AS JSONB)
                WHERE id = :id
                """,
                {
                    "index_value": record["index_value"],
                    "change_rate": record["change_rate"],
                    "raw_data": json.dumps(record["raw_data"], ensure_ascii=False),
                    "id": existing[0]["id"],
                },
            )
        else:
            db.execute(
                """
                INSERT INTO market_data 
                    (data_type, route, currency_pair, index_value, change_rate, recorded_date, raw_data)
                VALUES 
                    (:data_type, :route, :currency_pair, :index_value, :change_rate,
                     CAST(:recorded_date AS DATE), CAST(:raw_data AS JSONB))
                """,
                {
                    "data_type": record["data_type"],
                    "route": record.get("route"),
                    "currency_pair": record.get("currency_pair"),
                    "index_value": record["index_value"],
                    "change_rate": record["change_rate"],
                    "recorded_date": record["recorded_date"],
                    "raw_data": json.dumps(record["raw_data"], ensure_ascii=False),
                },
            )


def _parse_ecos_date(time_str, cycle):
    """ECOS 날짜 형식 파싱"""
    try:
        if cycle == "D" and len(time_str) == 8:
            return f"{time_str[:4]}-{time_str[4:6]}-{time_str[6:8]}"
        elif cycle == "M" and len(time_str) == 6:
            return f"{time_str[:4]}-{time_str[4:6]}-01"
        elif cycle == "Q":
            return f"{time_str[:4]}-{int(time_str[5]) * 3:02d}-01"
    except Exception:
        pass
    return date.today().isoformat()
