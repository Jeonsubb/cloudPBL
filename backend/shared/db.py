"""
PortPulse - Database utility module
Aurora PostgreSQL 연결 관리 (AWS RDS Data API 또는 psycopg2)
개발 환경에서는 로컬 PostgreSQL / 프로덕션에서는 Aurora Serverless v2
"""

import os
import json
import boto3
from datetime import datetime, date
from decimal import Decimal


# 환경변수
DB_CLUSTER_ARN = os.environ.get("DB_CLUSTER_ARN", "")
DB_SECRET_ARN = os.environ.get("DB_SECRET_ARN", "")
DB_NAME = os.environ.get("DB_NAME", "portpulse")
USE_DATA_API = os.environ.get("USE_DATA_API", "true").lower() == "true"


class Database:
    """Aurora PostgreSQL Data API wrapper"""

    def __init__(self):
        if USE_DATA_API:
            self.client = boto3.client("rds-data")
        self.cluster_arn = DB_CLUSTER_ARN
        self.secret_arn = DB_SECRET_ARN
        self.database = DB_NAME

    def execute(self, sql, parameters=None):
        """SQL 실행 (Data API)"""
        params = {
            "resourceArn": self.cluster_arn,
            "secretArn": self.secret_arn,
            "database": self.database,
            "sql": sql,
        }
        if parameters:
            params["parameters"] = self._format_params(parameters)

        response = self.client.execute_statement(**params)
        return response

    def query(self, sql, parameters=None):
        """SELECT 쿼리 실행 후 딕셔너리 리스트 반환"""
        params = {
            "resourceArn": self.cluster_arn,
            "secretArn": self.secret_arn,
            "database": self.database,
            "sql": sql,
            "includeResultMetadata": True,
        }
        if parameters:
            params["parameters"] = self._format_params(parameters)

        response = self.client.execute_statement(**params)
        columns = [col["name"] for col in response.get("columnMetadata", [])]
        rows = []
        for record in response.get("records", []):
            row = {}
            for i, field in enumerate(record):
                row[columns[i]] = self._extract_value(field)
            rows.append(row)
        return rows

    def _format_params(self, params):
        """파라미터를 Data API 형식으로 변환"""
        formatted = []
        for name, value in params.items():
            param = {"name": name}
            if isinstance(value, str):
                param["value"] = {"stringValue": value}
            elif isinstance(value, int):
                param["value"] = {"longValue": value}
            elif isinstance(value, float):
                param["value"] = {"doubleValue": value}
            elif isinstance(value, bool):
                param["value"] = {"booleanValue": value}
            elif value is None:
                param["value"] = {"isNull": True}
            else:
                param["value"] = {"stringValue": str(value)}
            formatted.append(param)
        return formatted

    def _extract_value(self, field):
        """Data API 응답 필드에서 값 추출"""
        if "stringValue" in field:
            return field["stringValue"]
        elif "longValue" in field:
            return field["longValue"]
        elif "doubleValue" in field:
            return field["doubleValue"]
        elif "booleanValue" in field:
            return field["booleanValue"]
        elif "isNull" in field:
            return None
        return None


# 싱글톤 인스턴스
_db_instance = None


def get_db():
    global _db_instance
    if _db_instance is None:
        _db_instance = Database()
    return _db_instance


# DB 스키마 초기화 SQL
INIT_SCHEMA_SQL = """
-- 시장 데이터 (KCCI, SCFI, 환율 등)
CREATE TABLE IF NOT EXISTS market_data (
    id SERIAL PRIMARY KEY,
    data_type VARCHAR(20) NOT NULL,  -- 'kcci', 'scfi', 'exchange_rate', 'interest_rate'
    route VARCHAR(50),               -- 항로 (KCCI용): 'us_west', 'europe', 'sea' 등
    index_value DECIMAL(10,2),
    change_rate DECIMAL(6,2),
    currency_pair VARCHAR(10),       -- 환율용: 'USD/KRW'
    recorded_date DATE NOT NULL,
    raw_data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_data_type_date ON market_data(data_type, recorded_date DESC);
CREATE INDEX IF NOT EXISTS idx_market_data_route ON market_data(route, recorded_date DESC);

-- 선적 건 (사용자 등록)
CREATE TABLE IF NOT EXISTS shipments (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    origin VARCHAR(20) DEFAULT '부산',
    destination VARCHAR(30) NOT NULL,
    booking_date DATE,
    shipping_date DATE NOT NULL,
    volume INTEGER NOT NULL,
    unit VARCHAR(5) DEFAULT 'FEU',
    incoterms VARCHAR(5) DEFAULT 'CIF',
    budget_per_unit DECIMAL(10,2),
    current_quote DECIMAL(10,2),
    flexibility VARCHAR(20),
    category VARCHAR(30),
    risk_level VARCHAR(10),          -- 'LOW', 'MEDIUM', 'HIGH'
    risk_score INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_user ON shipments(user_id);

-- 뉴스
CREATE TABLE IF NOT EXISTS news (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    summary TEXT,
    category VARCHAR(50),            -- '홍해', '항만혼잡', '운임인상', '파업' 등
    source_url VARCHAR(500),
    impact_level VARCHAR(10),        -- 'HIGH', 'MEDIUM', 'LOW'
    published_date DATE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_date ON news(published_date DESC);

-- 경보 이력
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    shipment_id INTEGER REFERENCES shipments(id),
    alert_type VARCHAR(30) NOT NULL, -- 'booking_timing', 'daily_briefing', 'event'
    title VARCHAR(200),
    message TEXT NOT NULL,
    risk_level VARCHAR(10),
    data_sources JSONB,              -- 근거 데이터 출처
    sent_via VARCHAR(20),            -- 'telegram', 'kakao'
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id, created_at DESC);
"""
