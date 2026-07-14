#!/usr/bin/env bash
# PortPulse 로컬 배포용 비밀값을 한 번 입력해 안전한 로컬 파일에 저장한다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_FILE="$SCRIPT_DIR/.env.deploy"
TEMP_FILE="$SECRETS_FILE.tmp"

IFS= read -r -s -p "관세청 PUBLIC_DATA_API_KEY 입력 후 Enter: " PUBLIC_DATA_API_KEY
echo
IFS= read -r -s -p "한국은행 ECOS_API_KEY 입력 후 Enter: " ECOS_API_KEY
echo

if [[ -z "$PUBLIC_DATA_API_KEY" || -z "$ECOS_API_KEY" ]]; then
  echo "API 키가 비어 있어 저장하지 않았습니다." >&2
  exit 1
fi

if [[ "$PUBLIC_DATA_API_KEY" == *"키"* || "$ECOS_API_KEY" == *"키"* ]]; then
  echo "예시 문구가 아닌 실제 발급값을 입력해주세요." >&2
  exit 1
fi

umask 077
{
  printf 'export PUBLIC_DATA_API_KEY=%q\n' "$PUBLIC_DATA_API_KEY"
  printf 'export ECOS_API_KEY=%q\n' "$ECOS_API_KEY"
  printf 'export AWS_PROFILE=%q\n' "portpulse"
  printf 'export AWS_REGION=%q\n' "ap-northeast-2"
  printf 'export BEDROCK_REGION=%q\n' "ap-northeast-2"
  printf 'export BEDROCK_MODEL_ID=%q\n' "apac.anthropic.claude-sonnet-4-20250514-v1:0"
  printf 'export ENABLE_SCHEDULES=%q\n' "false"
  printf 'export ENABLE_NOTIFICATIONS=%q\n' "false"
} > "$TEMP_FILE"

mv "$TEMP_FILE" "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"

echo "저장 완료: $SECRETS_FILE"
echo "이 파일은 .gitignore에 의해 Git에 포함되지 않습니다."
