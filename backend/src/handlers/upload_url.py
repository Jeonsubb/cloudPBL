import json
import uuid

import boto3

from common.config import AWS_REGION, UPLOAD_BUCKET_NAME
from common.response import json_response


s3 = boto3.client("s3", region_name=AWS_REGION)


def handler(event, context):
    body = json.loads(event.get("body") or "{}")
    shipment_id = body.get("shipmentId", "unknown")
    file_name = body.get("fileName", f"{uuid.uuid4()}.bin")
    content_type = body.get("contentType", "application/octet-stream")
    company_id = body.get("companyId", "demo-company")

    key = f"companies/{company_id}/shipments/{shipment_id}/original/{file_name}"
    upload_url = s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": UPLOAD_BUCKET_NAME,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=900,
    )

    return json_response(200, {"uploadUrl": upload_url, "s3Key": key})
