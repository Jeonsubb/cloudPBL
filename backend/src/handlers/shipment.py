import json
import uuid
from datetime import datetime

from common.response import json_response


DEMO_SHIPMENTS = [
    {
        "shipmentId": "shp_001",
        "name": "부산-LA 자동차 부품 1차",
        "originPort": "Busan",
        "destinationPort": "Los Angeles",
        "cargoReadyDate": "2026-07-15",
        "dueDate": "2026-08-03",
        "status": "QUOTE_RECEIVED",
        "riskLevel": "HIGH",
        "riskScore": 78,
    }
]


def handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")

    if method == "GET":
        return json_response(200, {"items": DEMO_SHIPMENTS})

    if method == "POST":
        body = json.loads(event.get("body") or "{}")
        item = {
            "shipmentId": f"shp_{uuid.uuid4().hex[:8]}",
            **body,
            "status": body.get("status", "REGISTERED"),
            "createdAt": datetime.utcnow().isoformat(),
        }
        return json_response(201, item)

    return json_response(405, {"message": "Method not allowed"})
