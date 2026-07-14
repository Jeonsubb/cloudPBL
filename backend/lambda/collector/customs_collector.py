"""
PortPulse - 관세청 수출입실적 데이터 수집기
품목별 물동량·성수기 신호 파악용
소스: 관세청 수출입무역통계 Open API (수출 FOB 기준)
"""

import json
import os
import sys
import requests
from xml.etree import ElementTree
from datetime import datetime, date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.db import get_db

API_KEY = os.environ.get("PUBLIC_DATA_API_KEY", "")

# 관세청 수출입실적 API
CUSTOMS_API_URL = "https://unipass.customs.go.kr/ets/index.do"
# 대체: 공공데이터포털 관세청 API
PUBLIC_DATA_CUSTOMS_URL = "https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList"

# 부산항 주요 수출 품목 코드 (HS 4자리)
TRACKED_ITEMS = {
    "8703": "자동차",
    "8542": "반도체",
    "8517": "통신기기",
    "2710": "석유제품",
    "1604": "수산가공품",
    "3902": "합성수지",
    "7208": "철강판",
}


def handler(event, context):
    """관세청 데이터 수집 Lambda 핸들러"""
    print(f"Customs collector triggered at {datetime.now().isoformat()}")

    try:
        export_data = fetch_export_stats()

        if export_data:
            save_to_db(export_data)
            print(f"Saved {len(export_data)} customs records")
            return {"statusCode": 200, "body": f"Collected {len(export_data)} records"}
        else:
            print("No customs data available")
            return {"statusCode": 204, "body": "No data"}

    except Exception as e:
        print(f"Customs collector error: {e}")
        return {"statusCode": 500, "body": str(e)}


def fetch_export_stats():
    """관세청 수출 실적 조회 (월별)"""
    today = date.today()
    # 매월 15일경 전월 통계가 확정되므로 확정된 최근 2개월을 조회한다.
    latest_month_offset = -1 if today.day >= 15 else -2
    end_yymm = _shift_month(today, latest_month_offset)
    start_yymm = _shift_month(today, latest_month_offset - 1)

    results = []

    for hs_code, item_name in TRACKED_ITEMS.items():
        try:
            params = {
                "serviceKey": API_KEY,
                "strtYymm": start_yymm,
                "endYymm": end_yymm,
                "hsSgn": hs_code,
                "numOfRows": 100,
                "pageNo": 1,
            }

            response = requests.get(PUBLIC_DATA_CUSTOMS_URL, params=params, timeout=30)
            response.raise_for_status()
            root = ElementTree.fromstring(response.content)
            result_code = root.findtext(".//resultCode")
            if result_code and result_code != "00":
                raise ValueError(root.findtext(".//resultMsg") or f"resultCode={result_code}")

            monthly = {}
            for node in root.findall(".//item"):
                item = {child.tag: (child.text or "") for child in node}
                year_month = (item.get("year") or "").replace(".", "")
                if len(year_month) != 6:
                    continue
                aggregate = monthly.setdefault(year_month, {
                    "export_weight": 0.0,
                    "export_amount": 0.0,
                    "item_count": 0,
                })
                aggregate["export_weight"] += _float_value(item.get("expWgt"))
                aggregate["export_amount"] += _float_value(item.get("expDlr"))
                aggregate["item_count"] += 1

            for year_month, aggregate in monthly.items():
                results.append({
                    "hs_code": hs_code,
                    "item_name": item_name,
                    "export_weight": aggregate["export_weight"],
                    "export_amount": aggregate["export_amount"],
                    "year_month": year_month,
                    "raw_data": {"aggregated_sub_items": aggregate["item_count"]},
                })
        except Exception as e:
            print(f"Customs API error ({hs_code}): {e}")

    return results


def _float_value(value):
    try:
        return float(str(value or "0").replace(",", ""))
    except ValueError:
        return 0.0


def _shift_month(base_date, offset):
    month_index = base_date.year * 12 + (base_date.month - 1) + offset
    year, month_zero_based = divmod(month_index, 12)
    return f"{year}{month_zero_based + 1:02d}"


def save_to_db(records):
    """물동량 데이터를 market_data 테이블에 저장 (성수기 신호용)"""
    db = get_db()

    for record in records:
        year_month = record["year_month"]
        recorded_date = f"{year_month[:4]}-{year_month[4:6]}-01"

        existing = db.query(
            """
            SELECT id FROM market_data
            WHERE data_type = 'trade_volume' 
              AND route = :hs_code
              AND recorded_date = CAST(:recorded_date AS DATE)
            """,
            {
                "hs_code": record["hs_code"],
                "recorded_date": recorded_date,
            },
        )

        raw = {
            "hs_code": record["hs_code"],
            "item_name": record["item_name"],
            "export_weight_kg": record["export_weight"],
            "export_amount_usd": record["export_amount"],
            "index_value_unit": "million_usd",
            **record.get("raw_data", {}),
        }
        # market_data.index_value는 DECIMAL(10,2)이므로 대규모 통관 금액은 백만 달러 단위로 저장한다.
        amount_million_usd = record["export_amount"] / 1_000_000

        if existing:
            db.execute(
                """
                UPDATE market_data
                SET index_value = :amount, raw_data = CAST(:raw_data AS JSONB)
                WHERE id = :id
                """,
                {
                    "amount": amount_million_usd,
                    "raw_data": json.dumps(raw, ensure_ascii=False),
                    "id": existing[0]["id"],
                },
            )
        else:
            db.execute(
                """
                INSERT INTO market_data (data_type, route, index_value, recorded_date, raw_data)
                VALUES ('trade_volume', :hs_code, :amount,
                        CAST(:recorded_date AS DATE), CAST(:raw_data AS JSONB))
                """,
                {
                    "hs_code": record["hs_code"],
                    "amount": amount_million_usd,
                    "recorded_date": recorded_date,
                    "raw_data": json.dumps(raw, ensure_ascii=False),
                },
            )
