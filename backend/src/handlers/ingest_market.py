from datetime import datetime

from common.response import json_response


def handler(event, context):
    # MVP에서는 샘플 데이터를 먼저 저장하고,
    # 이후 KCCI, SCFI, ECOS, 관세청, 뉴스 수집기로 교체한다.
    sample = {
        "collectedAt": datetime.utcnow().isoformat(),
        "indices": [
            {"source": "KCCI", "route": "Busan-USWC", "value": 3747, "trend": "UP"},
            {"source": "SCFI", "route": "Shanghai-USWC", "value": 2450, "trend": "UP"},
        ],
        "events": [
            {
                "type": "HORMUZ",
                "title": "호르무즈 해협 긴장 고조로 에너지·운임 리스크 확대",
                "affectedRoutes": ["Middle East", "Europe", "Global Fuel"],
            }
        ],
    }
    return json_response(200, sample)
