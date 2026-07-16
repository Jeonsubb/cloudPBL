"""
PortPulse - Bedrock 단일 에이전트
DB에서 시장 데이터를 조회하고, Claude Sonnet 한 번 호출로 종합 분석·브리핑 생성

역할:
  - 매일 아침 시황 브리핑 생성 (텔레그램 Push용)
  - 특정 선적 건의 부킹 타이밍 경보 생성
  - Knowledge Base(shipping_domain.md) 기반 도메인 지식 활용
"""

import json
import os
import sys
import boto3
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.db import get_db
from shared.routes import normalize_route

BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "ap-northeast-2")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "apac.anthropic.claude-sonnet-4-20250514-v1:0")


class PortPulseAgent:
    """단일 에이전트 - DB 데이터 + Sonnet 1회 호출로 분석·브리핑 생성"""

    def __init__(self):
        self.bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
        self.db = get_db()

    def generate_daily_briefing(self, user_id):
        """매일 아침 시황 브리핑 생성"""
        # 1. DB에서 모든 시장 데이터 수집
        market_data = self._collect_all_market_data()

        # 2. 사용자 선적 건 조회
        user_shipments = self._get_user_shipments(user_id)

        # 3. Sonnet 한 번 호출로 종합 브리핑 생성
        prompt = f"""당신은 PortPulse 시황 브리핑 에이전트입니다.
부산 중소 수출기업의 물류 담당자에게 매일 아침 보내는 시황 브리핑을 생성해주세요.

## 시장 데이터

### KCCI 부산발 운임지수 (최근 4주)
{json.dumps(market_data['kcci'], ensure_ascii=False, default=str)}

### SCFI 상하이 컨테이너 운임지수 (최근 4주)
{json.dumps(market_data['scfi'], ensure_ascii=False, default=str)}

### 환율·금리
{json.dumps(market_data['macro'], ensure_ascii=False, default=str)}

### 최근 주요 뉴스
{json.dumps(market_data['news'], ensure_ascii=False, default=str)}

### 사용자 선적 건
{json.dumps(user_shipments, ensure_ascii=False, default=str)}

## 브리핑 작성 규칙
- 한국어, 간결체
- 첫 줄: 오늘 종합 리스크 레벨 (🟢LOW / 🟡MEDIUM / 🔴HIGH)
- 핵심 지표 3줄 이내 (KCCI, SCFI, 환율, 주요 이벤트)
- 사용자 선적 건별 액션 추천 (있을 경우)
- 총 200자 이내 (카카오톡/텔레그램용)
- 근거 데이터 출처 명시

JSON 형식으로 응답:
{{
  "risk_level": "HIGH/MEDIUM/LOW",
  "briefing_text": "브리핑 본문",
  "data_sources": ["KCCI", "SCFI", "ECOS", "뉴스"],
  "action_items": ["추천 행동1", "추천 행동2"]
}}"""

        return self._invoke_bedrock(prompt)

    def generate_booking_alert(self, shipment):
        """특정 선적 건에 대한 부킹 타이밍 경보 생성"""
        market_data = self._collect_all_market_data(
            route=normalize_route(shipment.get("destination"), default="composite")
        )

        budget = shipment.get("budget_per_unit", "N/A")
        volume = shipment.get("volume", 1)
        unit = shipment.get("unit", "FEU")

        prompt = f"""당신은 PortPulse 부킹 타이밍 추천 에이전트입니다.
이 선적 건에 대해 "지금 부킹할지 / 기다릴지" 판단해주세요.

## 선적 건 정보
- 항로: {shipment.get('origin', '부산')} → {shipment.get('destination')}
- 선적 예정일: {shipment.get('shipping_date')}
- 물량: {volume} {unit}
- 기준 예산: ${budget}/{unit}
- 납기 여유: {shipment.get('flexibility', 'N/A')}

## 시장 데이터
### KCCI 운임 추이 (최근 4주)
{json.dumps(market_data['kcci'], ensure_ascii=False, default=str)}

### SCFI 운임 추이 (최근 4주)
{json.dumps(market_data['scfi'], ensure_ascii=False, default=str)}

### 환율
{json.dumps(market_data['macro'], ensure_ascii=False, default=str)}

### 주요 뉴스
{json.dumps(market_data['news'], ensure_ascii=False, default=str)}

## 판단 기준
1. KCCI가 계속 상승 중인가? → 즉시 부킹 권고
2. 현재가 고점인가 (4주 내 최고)? → 기다림 권고
3. 예산 대비 초과 예상인가? → 초과분 계산해 경보
4. 납기 여유가 있는가? → 여유 있으면 기다림 가능
5. 성수기(7-9월) 진입인가? → 리스크 가중

JSON 형식으로 경보를 생성해주세요:
{{
  "alert_type": "booking_timing",
  "risk_level": "HIGH/MEDIUM/LOW",
  "decision": "book_now/wait/monitor",
  "title": "경보 제목 (20자 이내)",
  "message": "경보 본문 (150자 이내, 카카오톡/텔레그램용)",
  "estimated_excess_pct": 숫자,
  "estimated_excess_amount_usd": 총초과금액,
  "reasoning": "판단 근거 1-2문장",
  "data_sources": ["KCCI", "SCFI", "ECOS"]
}}"""

        return self._invoke_bedrock(prompt)

    def _collect_all_market_data(self, route=None):
        """분석에 필요한 모든 시장 데이터를 DB에서 한 번에 수집"""
        # KCCI 최근 4주
        route_filter = route or "composite"
        kcci = self.db.query(
            """
            SELECT route, index_value, change_rate, recorded_date
            FROM market_data
            WHERE data_type = 'kcci' AND route = :route
            ORDER BY recorded_date DESC
            LIMIT 4
            """,
            {"route": route_filter},
        )

        # SCFI 최근 4주
        scfi = self.db.query(
            """
            SELECT route, index_value, change_rate, recorded_date
            FROM market_data
            WHERE data_type = 'scfi' AND route = :route
            ORDER BY recorded_date DESC
            LIMIT 4
            """,
            {"route": route_filter},
        )

        # 환율 최근 7일
        exchange = self.db.query("""
            SELECT index_value, change_rate, recorded_date
            FROM market_data
            WHERE data_type = 'exchange_rate'
            ORDER BY recorded_date DESC
            LIMIT 7
        """)

        # 기준금리
        interest = self.db.query("""
            SELECT index_value, recorded_date
            FROM market_data
            WHERE data_type = 'interest_rate'
            ORDER BY recorded_date DESC
            LIMIT 1
        """)

        # 최근 고영향 뉴스
        news = self.db.query("""
            SELECT title, category, impact_level, published_date
            FROM news
            WHERE published_date >= CURRENT_DATE - INTERVAL '3 days'
            ORDER BY
                CASE impact_level WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
                published_date DESC
            LIMIT 5
        """)

        return {
            "kcci": kcci,
            "scfi": scfi,
            "macro": {
                "exchange_rate": exchange,
                "interest_rate": interest[0] if interest else None,
            },
            "news": news,
        }

    def _invoke_bedrock(self, prompt):
        """Bedrock Claude Sonnet 호출"""
        try:
            response = self.bedrock.invoke_model(
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

            # JSON 파싱
            content = content.strip()
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]

            return json.loads(content.strip())

        except Exception as e:
            print(f"Bedrock invoke error: {e}")
            return {"error": str(e)}

    def _get_user_shipments(self, user_id):
        """사용자 선적 건 조회"""
        return self.db.query(
            """
            SELECT id, origin, destination, shipping_date, volume, unit,
                   incoterms, budget_per_unit, flexibility, risk_level
            FROM shipments
            WHERE user_id = :user_id AND shipping_date >= CURRENT_DATE
            ORDER BY shipping_date ASC
            """,
            {"user_id": user_id},
        )

def handler(event, context):
    """Lambda 핸들러 (EventBridge 또는 직접 호출)"""
    agent = PortPulseAgent()
    action = event.get("action", "daily_briefing")

    if action == "daily_briefing":
        user_id = event.get("user_id", "demo-user")
        result = agent.generate_daily_briefing(user_id)
        return {"statusCode": 200, "body": json.dumps(result, ensure_ascii=False)}

    elif action == "booking_alert":
        shipment = event.get("shipment", {})
        result = agent.generate_booking_alert(shipment)
        return {"statusCode": 200, "body": json.dumps(result, ensure_ascii=False)}

    else:
        return {"statusCode": 400, "body": f"Unknown action: {action}"}
