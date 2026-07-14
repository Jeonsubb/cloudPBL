"""
PortPulse - Push 알림 Lambda (텔레그램 봇)
매일 아침 시황 브리핑 + 부킹 타이밍 경보를 텔레그램으로 발송

트리거:
1. EventBridge 스케줄 (매일 아침 6:30 KST) → 일일 브리핑
2. Supervisor 에이전트 호출 → 이벤트 경보
"""

import json
import os
import sys
import requests
import boto3
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.db import get_db

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_API_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

def handler(event, context):
    """
    Push 알림 Lambda 핸들러
    
    event 형식:
    - {"action": "daily_briefing"} → 전체 사용자 일일 브리핑
    - {"action": "booking_alert", "user_id": "...", "shipment_id": ...} → 특정 선적 건 경보
    - {"action": "event_alert", "message": "..."} → 돌발 이벤트 경보
    """
    print(f"Notifier triggered: {json.dumps(event, default=str)}")

    action = event.get("action", "daily_briefing")

    try:
        if action == "daily_briefing":
            return send_daily_briefing()
        elif action == "booking_alert":
            return send_booking_alert(event)
        elif action == "event_alert":
            return send_event_alert(event)
        else:
            return {"statusCode": 400, "body": f"Unknown action: {action}"}

    except Exception as e:
        print(f"Notifier error: {e}")
        return {"statusCode": 500, "body": str(e)}


def send_daily_briefing():
    """
    매일 아침 시황 브리핑 발송
    Supervisor 에이전트가 생성한 브리핑을 모든 구독 사용자에게 전송
    """
    db = get_db()

    # 구독 사용자 목록 (텔레그램 chat_id가 등록된 사용자)
    # 초기에는 환경변수로 지정된 단일 채팅방으로 발송
    chat_ids = _get_subscriber_chat_ids()

    if not chat_ids:
        print("No subscribers found")
        return {"statusCode": 204, "body": "No subscribers"}

    # 에이전트로 브리핑 생성
    from bedrock.agents.supervisor import PortPulseAgent
    agent = PortPulseAgent()

    for chat_id, user_id in chat_ids:
        try:
            briefing = agent.generate_daily_briefing(user_id)
            message = _format_daily_briefing(briefing)

            send_telegram_message(chat_id, message)

            # 경보 이력 저장
            _save_alert_history(
                user_id=user_id,
                alert_type="daily_briefing",
                title="매일 아침 시황 브리핑",
                message=message,
                risk_level=briefing.get("risk_level", "MEDIUM"),
                data_sources=briefing.get("data_sources", []),
            )

            print(f"Briefing sent to {chat_id}")

        except Exception as e:
            print(f"Error sending to {chat_id}: {e}")
            continue

    return {"statusCode": 200, "body": f"Sent to {len(chat_ids)} subscribers"}


def send_booking_alert(event):
    """특정 선적 건에 대한 부킹 타이밍 경보 발송"""
    db = get_db()
    user_id = event.get("user_id", "demo-user")
    shipment_id = event.get("shipment_id")

    # 선적 건 조회
    shipments = db.query(
        "SELECT * FROM shipments WHERE id = :id",
        {"id": int(shipment_id)},
    )

    if not shipments:
        return {"statusCode": 404, "body": "Shipment not found"}

    shipment = shipments[0]

    # 에이전트로 경보 생성
    from bedrock.agents.supervisor import PortPulseAgent
    agent = PortPulseAgent()
    alert = agent.generate_booking_alert(shipment)

    # 메시지 포맷
    message = _format_booking_alert(alert, shipment)

    # 텔레그램 발송
    chat_id = _get_user_chat_id(user_id)
    if chat_id:
        send_telegram_message(chat_id, message)

    # 경보 이력 저장
    _save_alert_history(
        user_id=user_id,
        shipment_id=shipment_id,
        alert_type="booking_timing",
        title=alert.get("title", "부킹 타이밍 경보"),
        message=message,
        risk_level=alert.get("risk_level", "MEDIUM"),
        data_sources=alert.get("data_sources", []),
    )

    return {"statusCode": 200, "body": "Booking alert sent"}


def send_event_alert(event):
    """돌발 이벤트 경보 (홍해, 파업 등)"""
    message = event.get("message", "")
    risk_level = event.get("risk_level", "HIGH")

    if not message:
        return {"statusCode": 400, "body": "Message required"}

    formatted = f"🚨 *PortPulse 긴급 경보*\n\n{message}"

    # 모든 구독자에게 발송
    chat_ids = _get_subscriber_chat_ids()
    for chat_id, user_id in chat_ids:
        try:
            send_telegram_message(chat_id, formatted)
            _save_alert_history(
                user_id=user_id,
                alert_type="event",
                title="긴급 이벤트 경보",
                message=message,
                risk_level=risk_level,
                data_sources=["뉴스"],
            )
        except Exception as e:
            print(f"Event alert error for {chat_id}: {e}")

    return {"statusCode": 200, "body": f"Event alert sent to {len(chat_ids)}"}


# === 텔레그램 API ===

def send_telegram_message(chat_id, text, parse_mode="Markdown"):
    """텔레그램 메시지 발송"""
    url = f"{TELEGRAM_API_URL}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True,
    }

    response = requests.post(url, json=payload, timeout=10)

    if response.status_code != 200:
        # Markdown 파싱 실패 시 plain text로 재시도
        if "can't parse entities" in response.text.lower():
            payload["parse_mode"] = None
            response = requests.post(url, json=payload, timeout=10)

    if response.status_code != 200:
        print(f"Telegram API error: {response.status_code} - {response.text}")
        raise Exception(f"Telegram send failed: {response.text}")

    return response.json()


# === 메시지 포맷팅 ===

def _format_daily_briefing(briefing):
    """일일 브리핑 텔레그램 메시지 포맷"""
    risk_level = briefing.get("risk_level", "MEDIUM")
    risk_emoji = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "🟢"}.get(risk_level, "⚪")

    text = briefing.get("briefing_text", "")
    sources = briefing.get("data_sources", [])
    actions = briefing.get("action_items", [])

    message = f"""⚓ *PortPulse 아침 브리핑*
{datetime.now().strftime('%Y-%m-%d %H:%M')}

{risk_emoji} 종합 리스크: *{risk_level}*

{text}"""

    if actions:
        message += "\n\n📋 *추천 행동:*\n"
        message += "\n".join(f"  • {a}" for a in actions)

    if sources:
        message += f"\n\n📊 출처: {', '.join(sources)}"

    return message


def _format_booking_alert(alert, shipment):
    """부킹 타이밍 경보 메시지 포맷"""
    risk_level = alert.get("risk_level", "MEDIUM")
    risk_emoji = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "🟢"}.get(risk_level, "⚪")
    decision = alert.get("decision", "monitor")
    decision_text = {
        "book_now": "⚡ 즉시 부킹 권고",
        "wait": "⏳ 대기 권고",
        "monitor": "👀 모니터링 계속",
    }.get(decision, "모니터링")

    origin = shipment.get("origin", "부산")
    dest = shipment.get("destination", "")
    shipping_date = shipment.get("shipping_date", "")
    volume = shipment.get("volume", "")
    unit = shipment.get("unit", "FEU")

    message = f"""⚠️ *PortPulse 부킹 경보*

{risk_emoji} 리스크: *{risk_level}*
{decision_text}

📦 {origin} → {dest}
📅 선적: {shipping_date} | {volume} {unit}

{alert.get('message', alert.get('reasoning', ''))}"""

    excess = alert.get("estimated_excess_pct", 0)
    if excess > 0:
        amount = alert.get("estimated_excess_amount_usd", 0)
        message += f"\n\n💰 예산 대비 +{excess:.0f}% 초과 예상 (약 ${amount:,.0f})"

    sources = alert.get("data_sources", [])
    if sources:
        message += f"\n\n📊 근거: {', '.join(sources)}"

    return message


# === 유틸리티 ===

def _get_subscriber_chat_ids():
    """구독 사용자의 텔레그램 chat_id 목록 조회"""
    # 초기 버전: 환경변수에서 단일 chat_id 사용
    default_chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if default_chat_id:
        return [(default_chat_id, "demo-user")]

    # 추후: DB에서 구독자 목록 조회
    # db = get_db()
    # subscribers = db.query("SELECT telegram_chat_id, user_id FROM subscribers WHERE active = true")
    # return [(s['telegram_chat_id'], s['user_id']) for s in subscribers]

    return []


def _get_user_chat_id(user_id):
    """특정 사용자의 텔레그램 chat_id 조회"""
    # 초기 버전
    return os.environ.get("TELEGRAM_CHAT_ID", "")


def _save_alert_history(user_id, alert_type, title, message, risk_level, data_sources, shipment_id=None):
    """경보 이력 DB 저장"""
    try:
        db = get_db()
        db.execute(
            """
            INSERT INTO alerts (user_id, shipment_id, alert_type, title, message, 
                               risk_level, data_sources, sent_via, sent_at)
            VALUES (:user_id, :shipment_id, :alert_type, :title, :message,
                    :risk_level, :data_sources, 'telegram', NOW())
            """,
            {
                "user_id": user_id,
                "shipment_id": shipment_id,
                "alert_type": alert_type,
                "title": title,
                "message": message[:500],  # 메시지 길이 제한
                "risk_level": risk_level,
                "data_sources": json.dumps(data_sources, ensure_ascii=False),
            },
        )
    except Exception as e:
        print(f"Alert history save error: {e}")
