#!/usr/bin/env bash
# PortPulse build, SAM deploy, and frontend upload script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_FILE="$SCRIPT_DIR/.env.deploy"

# configure-secrets.sh로 저장한 로컬 배포 설정을 자동으로 읽는다.
if [[ -f "$SECRETS_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
fi

# AWS CLI가 less/vim 형태의 pager를 열어 배포를 멈추지 않게 한다.
export AWS_PAGER=""
export AWS_PROFILE="${AWS_PROFILE:-portpulse}"

STAGE="${1:-dev}"
REGION="${AWS_REGION:-ap-northeast-2}"
BEDROCK_REGION="${BEDROCK_REGION:-$REGION}"
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-apac.anthropic.claude-sonnet-4-20250514-v1:0}"
ENABLE_SCHEDULES="${ENABLE_SCHEDULES:-false}"
ENABLE_NOTIFICATIONS="${ENABLE_NOTIFICATIONS:-false}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

if [[ "$STAGE" != "dev" && "$STAGE" != "prod" ]]; then
  echo "STAGE는 dev 또는 prod만 사용할 수 있습니다." >&2
  exit 1
fi

for command_name in node npm aws sam; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "필수 명령을 찾을 수 없습니다: $command_name" >&2
    exit 1
  fi
done

required_variables=(
  PUBLIC_DATA_API_KEY
  ECOS_API_KEY
)

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    if ! IFS= read -r -s -p "$variable_name 입력 후 Enter: " "$variable_name"; then
      echo
      echo "필수 환경변수가 설정되지 않았습니다: $variable_name" >&2
      exit 1
    fi
    echo
    export "$variable_name"
    if [[ -z "${!variable_name:-}" ]]; then
      echo "값이 입력되지 않았습니다: $variable_name" >&2
      exit 1
    fi
  fi
done

if [[ "$PUBLIC_DATA_API_KEY" == *"키"* || "$ECOS_API_KEY" == *"키"* ]]; then
  echo "API 키 환경변수에 예시 문구가 들어 있습니다. 실제 발급값으로 다시 설정해주세요." >&2
  exit 1
fi

if [[ "$ENABLE_NOTIFICATIONS" == "true" ]]; then
  for variable_name in TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
    if [[ -z "${!variable_name:-}" ]]; then
      echo "텔레그램 알림 활성화 시 필수 환경변수입니다: $variable_name" >&2
      exit 1
    fi
  done
fi

echo "PortPulse 배포 시작 (stage=$STAGE, region=$REGION, schedules=$ENABLE_SCHEDULES)"

echo "프론트엔드 빌드"
cd "$PROJECT_DIR"
npm run build

echo "SAM 빌드"
cd "$SCRIPT_DIR"
sam build --template-file template.yaml --no-use-container

PARAMETER_OVERRIDES=(
  "Stage=$STAGE"
  "PublicDataApiKey=$PUBLIC_DATA_API_KEY"
  "EcosApiKey=$ECOS_API_KEY"
  "BedrockRegion=$BEDROCK_REGION"
  "BedrockModelId=$BEDROCK_MODEL_ID"
  "EnableSchedules=$ENABLE_SCHEDULES"
  "EnableNotifications=$ENABLE_NOTIFICATIONS"
)

if [[ "$ENABLE_NOTIFICATIONS" == "true" ]]; then
  PARAMETER_OVERRIDES+=(
    "TelegramBotToken=$TELEGRAM_BOT_TOKEN"
    "TelegramChatId=$TELEGRAM_CHAT_ID"
  )
fi

echo "CloudFormation 배포"
sam deploy \
  --stack-name "portpulse-$STAGE" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
  --parameter-overrides "${PARAMETER_OVERRIDES[@]}" \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --resolve-s3

echo "데이터베이스 스키마 초기화"
DB_INIT_FUNCTION="$(aws cloudformation describe-stacks \
  --stack-name "portpulse-$STAGE" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseInitializerFunctionName'].OutputValue" \
  --output text)"
DB_INIT_RESULT="${TMPDIR:-/tmp}/portpulse-db-init-$STAGE.json"

aws lambda invoke \
  --region "$REGION" \
  --function-name "$DB_INIT_FUNCTION" \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  --no-cli-pager \
  "$DB_INIT_RESULT"

if ! grep -q '"statusCode": 200' "$DB_INIT_RESULT"; then
  echo "DB 스키마 초기화에 실패했습니다: $DB_INIT_RESULT" >&2
  exit 1
fi

echo "프론트엔드 S3 업로드"
BUCKET_NAME="$(aws cloudformation describe-stacks \
  --stack-name "portpulse-$STAGE" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='WebBucketName'].OutputValue" \
  --output text)"

if [[ -z "$BUCKET_NAME" || "$BUCKET_NAME" == "None" ]]; then
  echo "CloudFormation 출력에서 WebBucketName을 찾지 못했습니다." >&2
  exit 1
fi

aws s3 sync "$PROJECT_DIR/dist" "s3://$BUCKET_NAME/" --delete

echo "CloudFront 캐시 무효화"
DIST_ID="$(aws cloudformation describe-stacks \
  --stack-name "portpulse-$STAGE" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
  --output text)"

if [[ -n "$DIST_ID" && "$DIST_ID" != "None" ]]; then
  aws cloudfront create-invalidation \
    --distribution-id "$DIST_ID" \
    --paths "/*" \
    --no-cli-pager
fi

echo "배포 완료"
aws cloudformation describe-stacks \
  --stack-name "portpulse-$STAGE" \
  --region "$REGION" \
  --query "Stacks[0].Outputs" \
  --output table
