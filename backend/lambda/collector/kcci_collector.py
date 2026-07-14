"""
PortPulse - KCCI 데이터 수집기

한국해양진흥공사(KOBC)의 공식 KCCI HTML 표에서 종합지수와 항로별
지수를 읽어 Aurora ``market_data`` 테이블에 저장한다.
"""

import json
import os
import re
import sys
from datetime import datetime

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.db import get_db


KCCI_URL = (
    "https://www.kobc.or.kr/ebz/shippinginfo/"
    "kcci/gridList.do?mId=0304000000"
)

# KOBC 표의 지수 코드를 프로젝트 내부 항로 코드로 변환한다.
KCCI_CODE_TO_ROUTE = {
    "KCCI": "composite",
    "KUWI": "us_west",
    "KUEI": "us_east",
    "KNEI": "europe",
    "KMDI": "mediterranean",
    "KMEI": "middle_east",
    "KAUI": "oceania",
    "KLEI": "latin_america_east",
    "KLWI": "latin_america_west",
    "KSAI": "south_africa",
    "KWAI": "west_africa",
    "KCI": "china",
    "KJI": "japan",
    "KSEI": "sea",
}

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; PortPulse/1.0; "
        "+https://www.kobc.or.kr/)"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
}


def handler(event, context):
    """KCCI 데이터 수집 Lambda 핸들러."""
    print(f"KCCI collector triggered at {datetime.now().isoformat()}")

    try:
        records = fetch_kcci_data()
        save_to_db(records)
        print(f"Successfully saved {len(records)} KCCI records")
        return {
            "statusCode": 200,
            "body": f"Collected {len(records)} KCCI records",
        }
    except Exception as error:
        print(f"KCCI collector error: {error}")
        return {"statusCode": 500, "body": str(error)}


def fetch_kcci_data():
    """KOBC 공식 페이지를 요청하고 KCCI 표를 파싱한다."""
    response = requests.get(
        KCCI_URL,
        headers=REQUEST_HEADERS,
        timeout=30,
    )
    response.raise_for_status()
    response.encoding = response.apparent_encoding or response.encoding
    return parse_kcci_html(response.text)


def parse_kcci_html(html):
    """KOBC KCCI HTML에서 DB 저장 형식의 레코드를 만든다."""
    soup = BeautifulSoup(html, "html.parser")
    table = _find_kcci_table(soup)
    recorded_date, previous_date = _extract_header_dates(table)
    records = []

    for row in table.select("tr"):
        cells = [
            cell.get_text(" ", strip=True)
            for cell in row.select("th, td")
        ]
        code_index = next(
            (
                index
                for index, value in enumerate(cells)
                if value.strip().upper() in KCCI_CODE_TO_ROUTE
            ),
            None,
        )
        if code_index is None:
            continue

        code = cells[code_index].strip().upper()
        values = cells[code_index + 1 :]
        if len(values) < 5:
            raise ValueError(f"Unexpected KCCI row structure: {cells}")

        route_name, weight, current_text, previous_text, change_text = values[:5]
        change_value, change_rate = _parse_change(change_text)
        records.append(
            {
                "data_type": "kcci",
                "route": KCCI_CODE_TO_ROUTE[code],
                "index_value": _parse_number(current_text),
                "change_rate": change_rate,
                "recorded_date": recorded_date,
                "raw_data": {
                    "code": code,
                    "routeName": route_name,
                    "weight": weight,
                    "previousIndex": _parse_number(previous_text),
                    "changeValue": change_value,
                    "weeklyChange": change_text,
                    "previousDate": previous_date,
                    "source": "KOBC",
                    "sourceUrl": KCCI_URL,
                    "collectedAt": datetime.now().isoformat(),
                },
            }
        )

    if not records or not any(record["route"] == "composite" for record in records):
        raise ValueError("KCCI Comprehensive Index row not found")

    return records


def _find_kcci_table(soup):
    for table in soup.select("table"):
        text = table.get_text(" ", strip=True)
        if "KCCI" in text and "Current Index" in text:
            return table
    raise ValueError("KCCI data table not found")


def _extract_header_dates(table):
    dates = []
    for value in re.findall(r"\b\d{4}-\d{2}-\d{2}\b", table.get_text(" ", strip=True)):
        if value not in dates:
            dates.append(value)
    if not dates:
        raise ValueError("KCCI current index date not found")
    return dates[0], dates[1] if len(dates) > 1 else None


def _parse_number(value):
    match = re.search(r"[-+]?\d[\d,]*(?:\.\d+)?", value.replace("−", "-"))
    if not match:
        raise ValueError(f"Invalid KCCI number: {value}")
    return float(match.group(0).replace(",", ""))


def _parse_change(value):
    normalized = value.replace("−", "-")
    match = re.search(
        r"([-+]?\d[\d,]*(?:\.\d+)?)\s*\(\s*([-+]?\d+(?:\.\d+)?)\s*%\s*\)",
        normalized,
    )
    if not match:
        raise ValueError(f"Invalid KCCI weekly change: {value}")
    return float(match.group(1).replace(",", "")), float(match.group(2))


def save_to_db(records):
    """같은 날짜·항로는 갱신하고, 처음 수집한 값은 삽입한다."""
    db = get_db()

    for record in records:
        params = {
            **record,
            "raw_data": json.dumps(record["raw_data"], ensure_ascii=False),
        }
        identity_params = {
            "data_type": record["data_type"],
            "route": record["route"],
            "recorded_date": record["recorded_date"],
        }
        existing = db.query(
            """
            SELECT id FROM market_data
            WHERE data_type = :data_type
              AND route = :route
              AND recorded_date = CAST(:recorded_date AS DATE)
            """,
            identity_params,
        )
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
            continue

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
