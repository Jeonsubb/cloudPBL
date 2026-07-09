from common.response import json_response


def handler(event, context):
    # MVP 1차 구현:
    # - S3 업로드 이벤트에서 bucket/key를 읽는다.
    # - xlsx는 openpyxl로 파싱한다.
    # - PDF/이미지는 추후 Textract 또는 Bedrock 문서 입력으로 확장한다.
    records = event.get("Records", [])
    parsed = []
    for record in records:
        s3_info = record.get("s3", {})
        parsed.append(
            {
                "bucket": s3_info.get("bucket", {}).get("name"),
                "key": s3_info.get("object", {}).get("key"),
                "status": "RECEIVED",
            }
        )

    return json_response(200, {"parsed": parsed})
