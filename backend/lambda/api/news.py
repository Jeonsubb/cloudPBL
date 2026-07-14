"""
PortPulse - GET /api/news
운임 영향 뉴스 요약 조회
"""

import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.response import success, error, cors_preflight
from shared.db import get_db


def handler(event, context):
    """뉴스 조회 핸들러"""
    if event.get("httpMethod") == "OPTIONS":
        return cors_preflight()

    try:
        db = get_db()

        # 쿼리 파라미터
        params = event.get("queryStringParameters") or {}
        limit = int(params.get("limit", "10"))
        category = params.get("category")  # 선택적 필터

        if category:
            news_list = db.query(
                """
                SELECT id, title, summary, category, source_url, 
                       impact_level, published_date
                FROM news
                WHERE category = :category
                ORDER BY published_date DESC
                LIMIT :limit
                """,
                {"category": category, "limit": limit},
            )
        else:
            news_list = db.query(
                """
                SELECT id, title, summary, category, source_url,
                       impact_level, published_date
                FROM news
                ORDER BY published_date DESC
                LIMIT :limit
                """,
                {"limit": limit},
            )

        return success({"news": news_list, "total": len(news_list)})

    except Exception as e:
        print(f"Error in news handler: {e}")
        return error(str(e), 500)
