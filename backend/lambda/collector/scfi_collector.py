"""
PortPulse - SCFI 데이터 수집기
Shanghai Shipping Exchange 공개 페이지에서 주간 SCFI를 수집
"""

import json
import os
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.db import get_db


SCFI_URL = "https://www.sse.net.cn/index/singleIndex?indexType=scfi"

ROUTE_KEYWORDS = {
    "comprehensive index": "composite",
    "shanghai containerized freight index": "composite",
    "scfi": "composite",
    "composite": "composite",
    "europe": "europe",
    "mediterranean": "mediterranean",
    "us west": "us_west",
    "uswc": "us_west",
    "west coast": "us_west",
    "us east": "us_east",
    "usec": "us_east",
    "east coast": "us_east",
    "persian gulf": "middle_east",
    "australia": "oceania",
    "new zealand": "oceania",
    "south america": "south_america",
    "west africa": "africa",
    "south africa": "africa",
    "japan": "japan",
    "korea": "korea",
    "southeast asia": "sea",
}


def handler(event, context):
    """SCFI 데이터 수집 Lambda 핸들러"""
    print(f"SCFI collector triggered at {datetime.now().isoformat()}")

    try:
        records = fetch_scfi_data()
        if not records:
            return {"statusCode": 204, "body": "No SCFI data available"}

        save_to_db(records)
        print(f"Saved {len(records)} SCFI records")
        return {"statusCode": 200, "body": f"Collected {len(records)} SCFI records"}

    except Exception as e:
        print(f"SCFI collector error: {e}")
        return {"statusCode": 500, "body": str(e)}


def fetch_scfi_data():
    """공식 SCFI 조회 페이지의 최신 종합지수를 읽는다."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
    }
    response = requests.get(SCFI_URL, headers=headers, timeout=30)
    response.raise_for_status()
    return parse_scfi_html(response.text)


def parse_scfi_html(html):
    """2026년 이후 공식 SSE HTML 표에서 종합지수를 변환한다."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.lb1")
    if not table:
        raise ValueError("SCFI table not found")

    header_cells = table.select_one("tr.csx1").find_all("td")
    date_matches = re.findall(r"\d{4}-\d{2}-\d{2}", " ".join(cell.get_text(" ", strip=True) for cell in header_cells))
    if len(date_matches) < 2:
        raise ValueError("SCFI publication dates not found")
    previous_date, published_date = date_matches[-2:]

    composite_row = None
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if cells and "Comprehensive Index" in cells[0].get_text(" ", strip=True):
            composite_row = cells
            break
    if not composite_row or len(composite_row) < 6:
        raise ValueError("SCFI Comprehensive Index row not found")

    previous_index = float(composite_row[3].get_text(strip=True).replace(",", ""))
    current_index = float(composite_row[4].get_text(strip=True).replace(",", ""))
    absolute_change = float(composite_row[5].get_text(strip=True).replace(",", ""))
    return [{
        "data_type": "scfi",
        "route": "composite",
        "index_value": current_index,
        "change_rate": _calculate_change_rate(current_index, previous_index),
        "recorded_date": published_date,
        "raw_data": {
            "routeName": "Comprehensive Index",
            "previousIndex": previous_index,
            "absoluteChange": absolute_change,
            "previousDate": previous_date,
            "collectedAt": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
            "source": "Shanghai Shipping Exchange Institute",
            "sourceUrl": SCFI_URL,
        },
    }]


def parse_scfi_payload(payload):
    """SSE 최신 지수 JSON을 market_data 저장 형식으로 변환한다."""
    if payload.get("status") != 1:
        raise ValueError(payload.get("msg") or "SCFI API returned an error")

    data = payload.get("data") or {}
    published_date = data.get("currentDate")
    previous_date = data.get("lastDate")
    if not published_date:
        raise ValueError("SCFI current date not found")

    collected_at = datetime.now(ZoneInfo("Asia/Seoul")).isoformat()
    records_by_route = {}
    for item in data.get("lineDataList") or []:
        properties = item.get("properties") or {}
        route_name = properties.get("lineName_EN") or ""
        route = _map_route(route_name)
        if not route:
            continue

        current_index = item.get("currentContent")
        if current_index is None:
            continue

        previous_index = item.get("lastContent")
        change_rate = item.get("percentage")
        if change_rate is None:
            change_rate = _calculate_change_rate(current_index, previous_index)

        record = {
            "data_type": "scfi",
            "route": route,
            "index_value": float(current_index),
            "change_rate": round(float(change_rate), 2) if change_rate is not None else None,
            "recorded_date": published_date,
            "raw_data": {
                "dataItemTypeName": item.get("dataItemTypeName"),
                "routeName": route_name,
                "unit": properties.get("unit_EN"),
                "weighting": properties.get("weighting_EN"),
                "previousIndex": previous_index,
                "absoluteChange": item.get("absolute"),
                "previousDate": previous_date,
                "collectedAt": collected_at,
                "source": "Shanghai Shipping Exchange",
                "sourceUrl": SCFI_URL,
            },
        }

        # 동일 항로의 20ft/40ft 항목이 함께 오면 가중치가 있는 항목을 우선한다.
        existing = records_by_route.get(route)
        if existing is None or _parse_weight(record["raw_data"]["weighting"]) > _parse_weight(
            existing["raw_data"]["weighting"]
        ):
            records_by_route[route] = record

    records = list(records_by_route.values())

    if not any(record["route"] == "composite" for record in records):
        raise ValueError("SCFI Comprehensive Index row not found")

    return records


def _calculate_change_rate(current_index, previous_index):
    if not previous_index:
        return None
    return round(((current_index - previous_index) / previous_index) * 100, 2)


def _parse_weight(value):
    if not value:
        return 0.0
    try:
        return float(str(value).replace("%", "").strip())
    except (TypeError, ValueError):
        return 0.0


def _map_route(label):
    lowered = label.lower()
    for keyword, route in ROUTE_KEYWORDS.items():
        if keyword in lowered:
            return route
    return None
def save_to_db(records):
    """SCFI 레코드를 기존 market_data 테이블에 upsert"""
    db = get_db()

    for record in records:
        existing = db.query(
            """
            SELECT id FROM market_data
            WHERE data_type = :data_type
              AND route = :route
              AND recorded_date = CAST(:recorded_date AS DATE)
            """,
            {
                "data_type": record["data_type"],
                "route": record["route"],
                "recorded_date": record["recorded_date"],
            },
        )

        params = {
            "data_type": record["data_type"],
            "route": record["route"],
            "index_value": record["index_value"],
            "change_rate": record["change_rate"],
            "recorded_date": record["recorded_date"],
            "raw_data": json.dumps(record["raw_data"], ensure_ascii=False),
        }

        if existing:
            db.execute(
                """
                UPDATE market_data
                SET index_value = :index_value,
                    change_rate = :change_rate,
                    raw_data = CAST(:raw_data AS JSONB)
                WHERE data_type = :data_type
                  AND route = :route
                  AND recorded_date = CAST(:recorded_date AS DATE)
                """,
                params,
            )
        else:
            db.execute(
                """
                INSERT INTO market_data
                    (data_type, route, index_value, change_rate, recorded_date, raw_data)
                VALUES
                    (:data_type, :route, :index_value, :change_rate,
                     CAST(:recorded_date AS DATE), CAST(:raw_data AS JSONB))
                """,
                params,
            )
