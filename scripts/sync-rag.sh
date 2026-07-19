#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${STACK_NAME:-portpulse-market}"
REGION="${PORTPULSE_REGION:-${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-northeast-2}}}"
DOCS_DIR="${KB_DOCS_DIR:-/Users/kimminseo/knowledge-base}"

if [[ ! -d "$DOCS_DIR" ]]; then
  echo "RAG 문서 폴더를 찾을 수 없습니다: $DOCS_DIR" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "메타데이터 검증에 필요한 jq를 찾을 수 없습니다." >&2
  exit 1
fi

METADATA_INVALID=0
while IFS= read -r -d '' metadata_file; do
  metadata_size="$(wc -c < "$metadata_file" | tr -d ' ')"
  if (( metadata_size > 1024 )); then
    echo "메타데이터가 Bedrock 제한(1,024바이트)을 초과합니다: $metadata_file ($metadata_size bytes)" >&2
    METADATA_INVALID=1
  fi

  if ! jq empty "$metadata_file" >/dev/null 2>&1; then
    echo "올바른 JSON 메타데이터가 아닙니다: $metadata_file" >&2
    METADATA_INVALID=1
  elif ! jq -e '[.metadataAttributes[]?.value.stringValue? | select(. == "")] | length == 0' "$metadata_file" >/dev/null; then
    echo "빈 문자열 메타데이터 값이 있습니다: $metadata_file" >&2
    METADATA_INVALID=1
  fi
done < <(find "$DOCS_DIR" -type f -name '*.metadata.json' -print0)

if (( METADATA_INVALID != 0 )); then
  exit 1
fi

output_value() {
  local key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text
}

KB_BUCKET="$(output_value KBBucketName)"
KNOWLEDGE_BASE_ID="$(output_value KnowledgeBaseId)"
DATA_SOURCE_ID="$(output_value KBDataSourceId)"

if [[ -z "$KB_BUCKET" || "$KB_BUCKET" == "None" || -z "$KNOWLEDGE_BASE_ID" || "$KNOWLEDGE_BASE_ID" == "None" || -z "$DATA_SOURCE_ID" || "$DATA_SOURCE_ID" == "None" ]]; then
  echo "CloudFormation 출력에서 Knowledge Base 정보를 찾지 못했습니다. 먼저 CDK 스택을 배포하세요." >&2
  exit 1
fi

echo "문서 동기화: $DOCS_DIR → s3://$KB_BUCKET/docs/"
aws s3 sync "$DOCS_DIR/" "s3://$KB_BUCKET/docs/" \
  --delete \
  --region "$REGION"

echo "Knowledge Base ingestion 시작"
INGESTION_JOB_ID="$(aws bedrock-agent start-ingestion-job \
  --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
  --data-source-id "$DATA_SOURCE_ID" \
  --region "$REGION" \
  --query 'ingestionJob.ingestionJobId' \
  --output text)"

echo "Ingestion job: $INGESTION_JOB_ID"
while true; do
  STATUS="$(aws bedrock-agent get-ingestion-job \
    --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
    --data-source-id "$DATA_SOURCE_ID" \
    --ingestion-job-id "$INGESTION_JOB_ID" \
    --region "$REGION" \
    --query 'ingestionJob.status' \
    --output text)"
  echo "상태: $STATUS"

  case "$STATUS" in
    COMPLETE)
      FAILED_COUNT="$(aws bedrock-agent get-ingestion-job \
        --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
        --data-source-id "$DATA_SOURCE_ID" \
        --ingestion-job-id "$INGESTION_JOB_ID" \
        --region "$REGION" \
        --query 'ingestionJob.statistics.numberOfDocumentsFailed' \
        --output text)"
      FAILURE_REASON="$(aws bedrock-agent get-ingestion-job \
        --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
        --data-source-id "$DATA_SOURCE_ID" \
        --ingestion-job-id "$INGESTION_JOB_ID" \
        --region "$REGION" \
        --query 'ingestionJob.failureReasons[0]' \
        --output text)"

      if [[ "$FAILED_COUNT" != "0" && "$FAILED_COUNT" != "None" ]] || [[ "$FAILURE_REASON" != "None" ]]; then
        echo "Ingestion은 종료됐지만 일부 문서 처리에 실패했습니다." >&2
        aws bedrock-agent get-ingestion-job \
          --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
          --data-source-id "$DATA_SOURCE_ID" \
          --ingestion-job-id "$INGESTION_JOB_ID" \
          --region "$REGION"
        exit 1
      fi

      echo "RAG 문서 동기화가 완료되었습니다."
      break
      ;;
    FAILED|STOPPED)
      aws bedrock-agent get-ingestion-job \
        --knowledge-base-id "$KNOWLEDGE_BASE_ID" \
        --data-source-id "$DATA_SOURCE_ID" \
        --ingestion-job-id "$INGESTION_JOB_ID" \
        --region "$REGION"
      exit 1
      ;;
  esac

  sleep 5
done
