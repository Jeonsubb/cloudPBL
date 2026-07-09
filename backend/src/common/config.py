import os


AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-2")
UPLOAD_BUCKET_NAME = os.getenv("UPLOAD_BUCKET_NAME", "")
RAW_DATA_BUCKET_NAME = os.getenv("RAW_DATA_BUCKET_NAME", "")
DATABASE_URL = os.getenv("DATABASE_URL", "")
BEDROCK_MODEL_ID = os.getenv(
    "BEDROCK_MODEL_ID",
    "anthropic.claude-3-5-sonnet-20240620-v1:0",
)
