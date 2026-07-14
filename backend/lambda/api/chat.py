"""
PortPulse - POST /api/chat
AI 챗봇: Bedrock Claude를 활용한 해운 리스크 상담
"""

import json
import sys
import os
import boto3

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.response import success, error, cors_preflight
from shared.db import get_db

BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "ap-northeast-2")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "apac.anthropic.claude-sonnet-4-20250514-v1:0")


SYSTEM_PROMPT = """당신은 PortPulse AI 리스크 상담 어시스턴트입니다.
부산 수출 중소기업의 부킹 타이밍 최적화를 돕습니다.

역할:
- 해운 운임 시황 설명 (KCCI, SCFI 기반)
- 부킹 타이밍 조언 (지금 잡을지, 기다릴지)
- 리스크 요인 설명 (홍해, 파업, 성수기 등)
- 환율·거시 영향 해석

규칙:
- 한국어로 응답
- 간결하고 실용적으로 (중소기업 실무자 대상)
- 근거 데이터 출처(KCCI·SCFI·ECOS)를 가능한 명시
- 모르는 것은 모른다고 솔직히 말하기
- 투자 조언이 아닌 물류 의사결정 보조임을 명확히

현재 시장 컨텍스트:
{market_context}
"""


def handler(event, context):
    """챗봇 핸들러"""
    if event.get("httpMethod") == "OPTIONS":
        return cors_preflight()

    body = {}
    try:
        body = json.loads(event.get("body", "{}"))
        user_message = body.get("message", "").strip()
        conversation_history = body.get("history", [])

        if not user_message:
            return error("메시지를 입력해주세요.")

        # 시장 데이터 컨텍스트 수집
        market_context = _get_chat_context()

        # Bedrock 호출
        bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

        # 대화 이력 구성
        messages = []
        for msg in conversation_history[-10:]:  # 최근 10개만
            if msg.get("role") not in {"user", "assistant"} or not msg.get("content"):
                continue
            messages.append({
                "role": msg["role"],
                "content": msg["content"],
            })
        messages.append({"role": "user", "content": user_message})

        response = bedrock.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1500,
                "system": SYSTEM_PROMPT.format(market_context=market_context),
                "messages": messages,
                "temperature": 0.7,
            }),
        )

        result = json.loads(response["body"].read())
        ai_response = result["content"][0]["text"]

        return success({
            "reply": ai_response,
            "model": BEDROCK_MODEL_ID,
        })

    except Exception as e:
        print(f"Error in chat handler: {e}")
        # 폴백 응답
        return success({
            "reply": _fallback_response(body.get("message", "")),
            "model": "fallback",
        })


def _get_chat_context():
    """챗봇에 제공할 최신 시장 데이터 요약"""
    try:
        db = get_db()

        kcci = db.query("""
            SELECT index_value, change_rate, recorded_date
            FROM market_data
            WHERE data_type = 'kcci' AND route = 'composite'
            ORDER BY recorded_date DESC LIMIT 1
        """)

        exchange = db.query("""
            SELECT index_value FROM market_data
            WHERE data_type = 'exchange_rate'
            ORDER BY recorded_date DESC LIMIT 1
        """)

        news = db.query("""
            SELECT title, category FROM news
            WHERE impact_level = 'HIGH'
            ORDER BY published_date DESC LIMIT 3
        """)

        context_parts = []
        if kcci:
            context_parts.append(
                f"- KCCI 종합: {kcci[0]['index_value']}p (전주 대비 {kcci[0].get('change_rate', 'N/A')}%)"
            )
        if exchange:
            context_parts.append(f"- 원/달러: {exchange[0]['index_value']}원")
        if news:
            context_parts.append("- 주요 뉴스: " + " / ".join(n["title"] for n in news))

        return "\n".join(context_parts) if context_parts else "시장 데이터 로딩 중"

    except Exception:
        return "시장 데이터 조회 불가"


def _fallback_response(message):
    """Bedrock 실패 시 기본 응답"""
    message_lower = message.lower() if message else ""

    if "운임" in message or "kcci" in message_lower:
        return "현재 KCCI 부산발 운임지수는 상승 추세입니다. 정확한 수치는 대시보드에서 확인해주세요. 성수기 진입으로 추가 상승 압력이 있습니다."
    elif "부킹" in message or "타이밍" in message:
        return "현재 운임 상승 추세를 고려하면, 가능하다면 조기 부킹을 검토해보시는 것이 좋겠습니다. 정확한 판단은 리스크 분석 페이지에서 선적 건을 등록하시면 개인화된 추천을 받으실 수 있습니다."
    elif "홍해" in message or "수에즈" in message:
        return "홍해 사태로 인한 수에즈 운하 우회가 지속되고 있습니다. 유럽 항로 운임에 직접적 영향을 미치며, 간접적으로 아시아-미주 노선 선복에도 영향을 줍니다."
    elif "환율" in message:
        return "원/달러 환율이 높은 수준을 유지하고 있어 CIF 조건의 경우 실결제 부담이 증가합니다. 운임과 환율을 종합적으로 고려한 판단이 필요합니다."
    else:
        return "해운 운임, 부킹 타이밍, 리스크 요인에 대해 질문해주세요. 예: '부산-미주서안 지금 운임 어때?', '2주 뒤에 부킹하면 어때?'"
