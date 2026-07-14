"""
PortPulse - GET /api/risk-analysis/{shipment_id}
특정 선적 건의 리스크 분석 결과 반환
Bedrock 에이전트를 호출해 종합 판단 생성
"""

import json
import sys
import os
import boto3
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.response import success, error, cors_preflight
from shared.db import get_db

BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "ap-northeast-2")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "apac.anthropic.claude-sonnet-4-20250514-v1:0")


def handler(event, context):
    """리스크 분석 핸들러"""
    if event.get("httpMethod") == "OPTIONS":
        return cors_preflight()

    try:
        # shipment_id 추출
        path_params = event.get("pathParameters") or {}
        shipment_id = path_params.get("id")

        if not shipment_id:
            return error("선적 건 ID가 필요합니다.")

        db = get_db()

        # 선적 건 조회
        shipments = db.query(
            "SELECT * FROM shipments WHERE id = :id",
            {"id": int(shipment_id)},
        )
        if not shipments:
            return error("선적 건을 찾을 수 없습니다.", 404)

        shipment = shipments[0]
        method = event.get("httpMethod", "GET")
        is_scenario = method == "POST"

        if is_scenario:
            body = json.loads(event.get("body") or "{}")
            allowed_overrides = {
                "booking_date", "shipping_date", "volume", "unit", "incoterms",
                "budget_per_unit", "current_quote", "flexibility",
            }
            shipment = {
                **shipment,
                **{key: value for key, value in body.items() if key in allowed_overrides},
            }

        # 해당 항로의 최근 시장 데이터 수집
        route_code = _map_destination_to_route(shipment["destination"])
        market_context = _get_market_context(db, route_code)

        # Bedrock으로 리스크 분석
        analysis = (
            _rule_based_analysis(shipment, market_context)
            if is_scenario
            else _analyze_risk(shipment, market_context)
        )
        analysis["shipment_id"] = int(shipment_id)
        analysis["scenario"] = is_scenario
        analysis["shipment"] = {
            key: shipment.get(key)
            for key in (
                "id", "origin", "destination", "booking_date", "shipping_date",
                "volume", "unit", "incoterms", "budget_per_unit",
                "current_quote", "flexibility", "category",
            )
        }

        # DB에 리스크 레벨 업데이트
        if not is_scenario:
            db.execute(
                """
                UPDATE shipments
                SET risk_level = :risk_level, risk_score = :risk_score, updated_at = NOW()
                WHERE id = :id
                """,
                {
                    "risk_level": analysis["risk_level"],
                    "risk_score": analysis["risk_score"],
                    "id": int(shipment_id),
                },
            )
            _save_analysis_alert(db, shipment, analysis)

        return success(analysis)

    except Exception as e:
        print(f"Error in risk_analysis handler: {e}")
        return error(str(e), 500)


def _map_destination_to_route(destination):
    """도착지를 KCCI 항로 코드로 매핑"""
    route_map = {
        "미주서안": "us_west",
        "미주동안": "us_east",
        "유럽": "europe",
        "동남아": "sea",
        "일본": "japan",
        "중국": "china",
    }
    return route_map.get(destination, "us_west")


def _save_analysis_alert(db, shipment, analysis):
    """리스크 분석 결과를 알림 내역에 저장한다."""
    params = {
        "user_id": shipment.get("user_id", "demo-user"),
        "shipment_id": int(shipment["id"]),
        "title": f"{shipment.get('destination', '')} 부킹 리스크 {analysis['risk_level']}",
        "message": analysis.get("summary", "리스크 분석이 완료되었습니다."),
        "risk_level": analysis["risk_level"],
        "data_sources": json.dumps(analysis.get("data_sources", []), ensure_ascii=False),
    }
    recent = db.query(
        """
        SELECT id FROM alerts
        WHERE user_id = :user_id AND shipment_id = :shipment_id
          AND alert_type = 'booking_timing'
          AND created_at >= NOW() - INTERVAL '1 hour'
        ORDER BY created_at DESC LIMIT 1
        """,
        {"user_id": params["user_id"], "shipment_id": params["shipment_id"]},
    )
    if recent:
        db.execute(
            """
            UPDATE alerts
            SET title = :title, message = :message, risk_level = :risk_level,
                data_sources = CAST(:data_sources AS JSONB), created_at = NOW()
            WHERE id = :id
            """,
            {**params, "id": recent[0]["id"]},
        )
    else:
        db.execute(
            """
            INSERT INTO alerts
                (user_id, shipment_id, alert_type, title, message, risk_level, data_sources)
            VALUES
                (:user_id, :shipment_id, 'booking_timing', :title, :message,
                 :risk_level, CAST(:data_sources AS JSONB))
            """,
            params,
        )


def _get_market_context(db, route_code):
    """리스크 분석용 시장 데이터 수집"""
    # 해당 항로 KCCI 최근 4주
    kcci_trend = db.query(
        """
        SELECT index_value, change_rate, recorded_date
        FROM market_data
        WHERE data_type = 'kcci' AND route = :route
        ORDER BY recorded_date DESC
        LIMIT 4
        """,
        {"route": route_code},
    )

    # 환율
    exchange = db.query(
        """
        SELECT index_value, change_rate FROM market_data
        WHERE data_type = 'exchange_rate'
        ORDER BY recorded_date DESC LIMIT 1
        """
    )

    # 최근 고영향 뉴스
    high_impact_news = db.query(
        """
        SELECT title, category, impact_level FROM news
        WHERE impact_level = 'HIGH'
        ORDER BY published_date DESC LIMIT 3
        """
    )

    return {
        "kcci_trend": kcci_trend,
        "exchange_rate": exchange[0] if exchange else None,
        "high_impact_news": high_impact_news,
    }


def _analyze_risk(shipment, market_context):
    """Bedrock Claude를 사용한 리스크 분석"""
    bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

    prompt = f"""당신은 해운 물류 리스크 분석 전문가입니다. 아래 정보를 바탕으로 이 선적 건의 부킹 리스크를 분석해주세요.

## 선적 건 정보
- 항로: {shipment['origin']} → {shipment['destination']}
- 선적 예정일: {shipment['shipping_date']}
- 물량: {shipment['volume']} {shipment['unit']}
- 조건: {shipment['incoterms']}
- 기준 예산: ${shipment.get('budget_per_unit', 'N/A')}/{shipment['unit']}
- 납기 여유: {shipment.get('flexibility', 'N/A')}

## 시장 데이터
- KCCI 최근 4주 추이: {json.dumps(market_context['kcci_trend'], ensure_ascii=False, default=str)}
- 현재 환율: {market_context.get('exchange_rate')}
- 고영향 뉴스: {json.dumps(market_context['high_impact_news'], ensure_ascii=False, default=str)}

## 요청 사항
다음 JSON 형식으로 응답해주세요:
{{
  "risk_level": "HIGH/MEDIUM/LOW",
  "risk_score": 0-100,
  "summary": "종합 판단 한줄 요약",
  "causes": [
    {{"title": "원인 제목", "description": "설명", "severity": "HIGH/MEDIUM/LOW"}}
  ],
  "budget_impact": {{
    "estimated_excess_pct": 숫자,
    "estimated_excess_amount": 총초과금액(USD),
    "explanation": "설명"
  }},
  "recommendations": ["추천 행동 1", "추천 행동 2", "추천 행동 3"],
  "data_sources": ["KCCI", "ECOS", "해운뉴스"]
}}
"""

    try:
        response = bedrock.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 2000,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
            }),
        )

        result = json.loads(response["body"].read())
        content = result["content"][0]["text"]

        # JSON 파싱 (마크다운 코드블록 제거)
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            content = content.split("```")[1].split("```")[0]

        analysis = json.loads(content.strip())
        return analysis

    except Exception as e:
        print(f"Bedrock analysis error: {e}")
        # 폴백: 규칙 기반 분석
        return _rule_based_analysis(shipment, market_context)


def _rule_based_analysis(shipment, market_context):
    """Bedrock 실패 시 규칙 기반 폴백 분석"""
    risk_score = 50
    causes = []

    # 부킹일과 선적일 사이의 여유 기간
    booking_date = shipment.get("booking_date")
    shipping_date = shipment.get("shipping_date")
    if booking_date and shipping_date:
        try:
            booking_day = datetime.fromisoformat(str(booking_date)).date()
            shipping_day = datetime.fromisoformat(str(shipping_date)).date()
            lead_days = (shipping_day - booking_day).days
            if lead_days < 7:
                risk_score += 25
                severity = "HIGH"
            elif lead_days < 14:
                risk_score += 15
                severity = "HIGH"
            elif lead_days < 21:
                risk_score += 8
                severity = "MEDIUM"
            else:
                severity = None

            if severity:
                causes.append({
                    "title": "부킹 여유 부족",
                    "description": f"부킹일부터 선적일까지 {max(lead_days, 0)}일로 선복 선택지가 제한됩니다.",
                    "severity": severity,
                })
        except (TypeError, ValueError):
            pass

    # KCCI 추세 분석
    kcci_trend = market_context.get("kcci_trend", [])
    if len(kcci_trend) >= 2:
        recent = kcci_trend[0].get("index_value", 0)
        prev = kcci_trend[1].get("index_value", 0)
        if recent and prev and float(recent) > float(prev):
            risk_score += 15
            change = ((float(recent) - float(prev)) / float(prev)) * 100
            causes.append({
                "title": "KCCI 운임지수 상승세",
                "description": f"최근 {change:.1f}% 상승 중",
                "severity": "HIGH" if change > 5 else "MEDIUM",
            })

    # 환율 부담
    exchange = market_context.get("exchange_rate")
    if exchange and float(exchange.get("index_value", 0)) > 1350:
        risk_score += 10
        causes.append({
            "title": "원/달러 환율 부담 증가",
            "description": f"환율 {exchange['index_value']}원으로 CIF 실결제 비용 상승",
            "severity": "MEDIUM",
        })

    # 성수기 접근
    shipping_date = shipment.get("shipping_date", "")
    if shipping_date:
        month = int(str(shipping_date).split("-")[1]) if "-" in str(shipping_date) else 0
        if month in [7, 8, 9]:  # 성수기
            risk_score += 15
            causes.append({
                "title": "성수기 진입",
                "description": "7-9월 성수기로 선복 확보 경쟁 심화 예상",
                "severity": "HIGH",
            })

    # 고영향 뉴스
    news = market_context.get("high_impact_news", [])
    if news:
        risk_score += 10
        causes.append({
            "title": "돌발 이벤트 감지",
            "description": news[0].get("title", "주요 뉴스 감지"),
            "severity": "HIGH",
        })

    # 리스크 레벨 결정
    risk_score = min(risk_score, 100)
    if risk_score >= 70:
        risk_level = "HIGH"
    elif risk_score >= 40:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    # 예산 초과 추정
    budget = float(shipment.get("budget_per_unit", 0) or 0)
    volume = int(shipment.get("volume", 1) or 1)
    excess_pct = max(0, (risk_score - 40) * 0.5)  # 대략적 추정
    excess_amount = budget * volume * (excess_pct / 100)

    return {
        "risk_level": risk_level,
        "risk_score": risk_score,
        "summary": f"종합 리스크 {risk_level} — {'조기 부킹 검토 필요' if risk_level == 'HIGH' else '상황 모니터링 권장'}",
        "causes": causes,
        "budget_impact": {
            "estimated_excess_pct": round(excess_pct, 1),
            "estimated_excess_amount": round(excess_amount, 0),
            "explanation": f"기준 예산 ${budget} 대비 약 {excess_pct:.0f}% 초과 가능성",
        },
        "recommendations": _get_recommendations(risk_level, shipment),
        "data_sources": ["KCCI", "ECOS", "해운뉴스"],
    }


def _get_recommendations(risk_level, shipment):
    """리스크 레벨별 추천 행동"""
    if risk_level == "HIGH":
        return [
            "이번 주 내 포워더 견적 확보 권장",
            "조기 부킹으로 선복 확보 검토",
            "선적일 앞당기기 또는 물량 분할 고려",
        ]
    elif risk_level == "MEDIUM":
        return [
            "1주 내 포워더 견적 비교",
            "운임 추이 계속 모니터링",
            "대안 항로 견적도 함께 확인",
        ]
    else:
        return [
            "현재 시점은 부킹하기 적합",
            "여유 있게 최적 시점 탐색 가능",
            "예산 내 부킹 가능성 높음",
        ]
