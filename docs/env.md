# 환경변수 설정

## 프론트엔드

`frontend/.env.example`을 복사해 `frontend/.env`를 만듭니다.

| 변수 | 설명 |
| --- | --- |
| VITE_API_BASE_URL | API Gateway 주소 |
| VITE_COGNITO_USER_POOL_ID | Cognito User Pool ID |
| VITE_COGNITO_CLIENT_ID | Cognito App Client ID |
| VITE_AWS_REGION | AWS 리전 |

## 백엔드

`backend/.env.example`을 복사해 `backend/.env`를 만듭니다.

| 변수 | 설명 |
| --- | --- |
| AWS_REGION | AWS 리전 |
| UPLOAD_BUCKET_NAME | 사용자 원본 파일 S3 버킷 |
| RAW_DATA_BUCKET_NAME | 뉴스/시장 원문 S3 버킷 |
| DATABASE_URL | PostgreSQL/Aurora 접속 문자열 |
| BEDROCK_MODEL_ID | Bedrock 모델 ID |
| TELEGRAM_BOT_TOKEN | 텔레그램 봇 토큰 |
| TELEGRAM_CHAT_ID | 알림 받을 채팅 ID |

실제 비밀값은 Git에 올리지 않습니다.
