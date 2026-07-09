import json
import os

import requests

from common.response import json_response


def handler(event, context):
    body = json.loads(event.get("body") or "{}")
    message = body.get("message", "[PortPulse] 위험 선적이 감지되었습니다.")

    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        return json_response(200, {"sent": False, "reason": "Telegram env is not configured."})

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    response = requests.post(url, json={"chat_id": chat_id, "text": message}, timeout=10)
    response.raise_for_status()

    return json_response(200, {"sent": True})
