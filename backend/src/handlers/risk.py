import json

from common.response import json_response
from services.risk_rules import calculate_risk


def handler(event, context):
    body = json.loads(event.get("body") or "{}")
    shipment = body.get(
        "shipment",
        {
            "shipmentId": "shp_001",
            "status": "QUOTE_RECEIVED",
            "dueDate": "2026-08-03",
        },
    )
    quote = body.get(
        "quote",
        {
            "validUntil": "2026-07-11",
            "eta": "2026-07-31",
        },
    )
    market = body.get(
        "market",
        {
            "freightTrend": "UP",
            "eventRisk": "HORMUZ",
        },
    )

    result = calculate_risk(shipment, quote, market)
    return json_response(200, {"shipmentId": shipment.get("shipmentId"), **result})
