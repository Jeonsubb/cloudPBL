"""PortPulse - POST /api/chat Bedrock Supervisor Agent endpoint."""

import json
import sys
import os
import re
import uuid
import boto3

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.response import success, error, cors_preflight

BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "ap-northeast-2")
BEDROCK_AGENT_ID = os.environ.get("BEDROCK_AGENT_ID", "")
BEDROCK_AGENT_ALIAS_ID = os.environ.get("BEDROCK_AGENT_ALIAS_ID", "")


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

        if not BEDROCK_AGENT_ID or not BEDROCK_AGENT_ALIAS_ID:
            raise RuntimeError("Bedrock Supervisor Agent 환경변수가 설정되지 않았습니다.")

        session_id = _resolve_session_id(body.get("sessionId"), event)

        agent_runtime = boto3.client(
            "bedrock-agent-runtime",
            region_name=BEDROCK_REGION,
        )
        request = {
            "agentId": BEDROCK_AGENT_ID,
            "agentAliasId": BEDROCK_AGENT_ALIAS_ID,
            "sessionId": session_id,
            "inputText": user_message,
            "enableTrace": False,
            "sessionState": {
                "sessionAttributes": {"userId": _get_user_id(event)}
            },
        }

        # 새 Agent 세션일 때만 기존 UI 이력을 가져온다. 이후에는 Agent가 세션을 유지한다.
        if not body.get("sessionId"):
            history = _build_conversation_history(conversation_history)
            if history:
                request["sessionState"]["conversationHistory"] = {"messages": history}

        response = agent_runtime.invoke_agent(**request)
        ai_response = _read_agent_completion(response)

        return success({
            "reply": ai_response,
            "model": "supervisor-agent",
            "sessionId": response.get("sessionId", session_id),
        })

    except Exception as e:
        print(f"Error in chat handler: {e}")
        # 폴백 응답
        return success({
            "reply": _fallback_response(body.get("message", "")),
            "model": "fallback",
        })


def _resolve_session_id(requested_session_id, event):
    """Return an InvokeAgent-compatible session identifier."""
    raw_session_id = requested_session_id or event.get("requestContext", {}).get("requestId")
    if not raw_session_id:
        raw_session_id = str(uuid.uuid4())

    session_id = re.sub(r"[^0-9a-zA-Z._:-]", "-", str(raw_session_id))[:100]
    return session_id if len(session_id) >= 2 else str(uuid.uuid4())


def _build_conversation_history(conversation_history):
    """Convert the legacy UI history to the Bedrock Agent message shape."""
    messages = []
    for message in conversation_history[-10:]:
        role = message.get("role")
        content = message.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        if content.strip():
            messages.append({
                "role": role,
                "content": [{"text": content.strip()}],
            })
    return messages


def _read_agent_completion(response):
    """Collect the final text from the InvokeAgent event stream."""
    chunks = []
    for event in response.get("completion", []):
        chunk = event.get("chunk")
        if chunk and chunk.get("bytes"):
            chunks.append(chunk["bytes"].decode("utf-8"))

    completion = "".join(chunks).strip()
    if not completion:
        raise RuntimeError("Bedrock Supervisor Agent가 빈 응답을 반환했습니다.")
    return completion


def _get_user_id(event):
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("claims", {})
    )
    return claims.get("sub", "demo-user")


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
