import json

import boto3

from common.config import AWS_REGION, BEDROCK_MODEL_ID
from common.response import json_response


bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)


def handler(event, context):
    body = json.loads(event.get("body") or "{}")
    message = body.get("message", "이 선적이 왜 위험한지 설명해줘")
    risk_context = body.get(
        "riskContext",
        "견적 유효기간이 2일 남았고, 최근 운임 지표가 상승했으며, 관련 항로에 지정학 리스크가 감지됨.",
    )

    prompt = f"""
너는 중소 수출기업의 물류 담당자를 돕는 AI 비서다.
아래 리스크 근거를 바탕으로 쉽고 실무적으로 답변해라.
점수는 새로 만들지 말고, 제공된 근거만 설명해라.

[리스크 근거]
{risk_context}

[사용자 질문]
{message}
"""

    response = bedrock.converse(
        modelId=BEDROCK_MODEL_ID,
        messages=[
            {
                "role": "user",
                "content": [{"text": prompt}],
            }
        ],
    )
    answer = response["output"]["message"]["content"][0]["text"]
    return json_response(200, {"answer": answer})
