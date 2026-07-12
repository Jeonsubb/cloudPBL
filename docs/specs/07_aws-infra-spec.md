# PortPulse AWS 인프라 명세

이 문서는 PortPulse의 AWS 기반 인프라 구성을 정의한다.

PortPulse는 정적 웹, API, 파일 업로드, 시장 데이터 배치 수집, 관계형 데이터 저장, Bedrock 기반 설명, Push 알림으로 구성된다.

---

## 1. 인프라 목표

PortPulse 인프라는 다음 목표를 가진다.

1. 사용자가 웹에서 시장 데이터와 선적 분석 결과를 빠르게 볼 수 있어야 한다.
2. 회사별 선적, 견적, 예산, 분석 결과를 안전하게 분리해야 한다.
3. KCCI, SCFI, ECOS, 관세청, 뉴스 데이터를 정기적으로 수집하고 저장해야 한다.
4. 리스크 점수 계산은 Lambda 룰 엔진에서 수행해야 한다.
5. Bedrock은 계산된 결과를 자연어로 설명하는 역할을 해야 한다.
6. 위험 선적은 텔레그램/카카오톡/이메일 등으로 Push 알림을 보낼 수 있어야 한다.

---

## 2. 전체 AWS 구성

```text
사용자
→ Route 53
→ CloudFront
→ S3 Static Web Hosting
→ API Gateway
→ Lambda
→ Aurora PostgreSQL
→ Amazon Bedrock
→ Alert Lambda
→ Telegram/Kakao/Email
```

시장 데이터 수집은 별도 배치 흐름으로 동작한다.

```text
EventBridge Scheduler
→ Market Ingest Lambda
→ 외부 API/뉴스 수집
→ Raw Data S3
→ Aurora PostgreSQL
→ Risk Calculate Lambda
→ Daily Briefing Lambda
→ Alert Lambda
```

---

## 3. AWS 서비스별 역할

| 영역 | AWS 서비스 | 역할 | MVP 필요도 |
| --- | --- | --- | --- |
| 도메인 | Route 53 | 서비스 도메인 연결 | 후순위 |
| 웹 배포 | S3 | React 빌드 결과물 저장 | 선택 |
| CDN | CloudFront | 정적 웹 전달, HTTPS | 선택 |
| 인증 | Cognito | 로그인, 회사별 사용자 인증 | 2차 |
| API | API Gateway HTTP API | 프론트 요청을 Lambda로 전달 | 필수 |
| 백엔드 | Lambda | API 처리, 리스크 계산, Bedrock 호출 | 필수 |
| 사용자 파일 | S3 Upload Bucket | 견적서/엑셀 원본 저장 | 필수 |
| 원문 데이터 | S3 Raw Data Bucket | 뉴스/외부 API 원문 저장 | 2차 |
| DB | Aurora PostgreSQL | 회사/선적/시장/리스크 데이터 저장 | 최종 |
| 스케줄 | EventBridge Scheduler | 매일 아침 데이터 수집 실행 | 2차 |
| AI | Amazon Bedrock | 챗봇, 브리핑, 알림 문구 생성 | 필수 |
| AI 도구 | Bedrock Agent Action Group | Bedrock이 Lambda 도구 호출 | 확장 |
| 문서 추출 | Textract | 스캔 PDF/이미지 견적서 추출 | 확장 |
| 알림 | Lambda + 외부 API | Telegram/Kakao/Email 발송 | 필수 |
| 로그 | CloudWatch | Lambda 로그, 에러 추적 | 필수 |
| 비밀값 | Secrets Manager/SSM | API Key, Telegram Token 보관 | 2차 |

---

## 4. 네트워크/배포 구조

## 4-1. MVP 배포 구조

초기 MVP는 단순하게 시작한다.

```text
Frontend
  - 로컬 Vite 또는 S3 정적 배포

Backend
  - API Gateway HTTP API
  - Lambda Python

Data
  - 샘플 JSON 또는 PostgreSQL
  - 최종 구조는 Aurora PostgreSQL 호환
```

MVP에서 Aurora를 바로 붙이지 않아도 된다. 단, DB 스키마와 API 응답은 Aurora로 이전 가능한 구조로 유지한다.

## 4-2. 최종 배포 구조

```text
Route 53
→ CloudFront
→ S3 Frontend Bucket
→ API Gateway
→ Lambda
→ Aurora PostgreSQL
```

CloudFront는 정적 웹을 전달하고, API 요청은 API Gateway 도메인으로 분리하거나 CloudFront path behavior로 연결할 수 있다.

---

## 5. S3 구성

## 5-1. Frontend Bucket

React/Vite 빌드 결과물을 저장한다.

| 항목 | 값 |
| --- | --- |
| 용도 | 정적 웹 파일 저장 |
| 예시 이름 | portpulse-frontend-{env} |
| 접근 | CloudFront Origin Access Control |
| 암호화 | SSE-S3 |

## 5-2. Upload Bucket

사용자가 업로드한 견적서, 엑셀, 부킹 확인서 원본을 저장한다.

| 항목 | 값 |
| --- | --- |
| 용도 | 사용자 원본 파일 저장 |
| 예시 이름 | portpulse-user-uploads-{env} |
| 업로드 방식 | S3 Presigned URL |
| 암호화 | SSE-S3 또는 SSE-KMS |
| 공개 접근 | 차단 |
| 이벤트 | ObjectCreated → ParseDocument Lambda |

S3 Key 규칙:

```text
companies/{companyId}/shipments/{shipmentId}/original/{fileName}
```

예:

```text
companies/company_demo_001/shipments/shp_001/original/forwarder_quote.xlsx
```

## 5-3. Raw Data Bucket

외부 API 원문, 뉴스 원문, 수집 로그를 저장한다.

| 항목 | 값 |
| --- | --- |
| 용도 | 시장 데이터 원문 저장 |
| 예시 이름 | portpulse-raw-data-{env} |
| 저장 데이터 | KCCI/SCFI/ECOS/관세청 응답, 뉴스 원문 |
| 보관 목적 | 재처리, 출처 추적, 발표 근거 |

S3 Key 규칙:

```text
market/{source}/{yyyy}/{mm}/{dd}/{fileName}
news/{yyyy}/{mm}/{dd}/{fileName}
```

---

## 6. API Gateway 구성

API Gateway는 HTTP API를 우선 사용한다.

| 항목 | 값 |
| --- | --- |
| 타입 | API Gateway HTTP API |
| 인증 | Cognito JWT Authorizer |
| CORS | 프론트엔드 도메인 허용 |
| Lambda 연동 | Proxy Integration |

### 공개 Route

```text
GET /api/public/market-snapshot
GET /api/public/demo-recommendation
POST /api/demo/session
```

### 인증 필요 Route

```text
GET  /api/shipments
POST /api/shipments
POST /api/uploads/presigned-url
POST /api/shipments/{shipmentId}/risk/calculate
GET  /api/shipments/{shipmentId}/risk/latest
POST /api/chat
POST /api/alerts/risk
```

---

## 7. Lambda 구성

## 7-1. API Lambda

| Lambda | 역할 |
| --- | --- |
| PublicMarketFunction | 랜딩 시장 데이터 조회 |
| DemoSessionFunction | 데모 회사 진입 |
| ShipmentFunction | 선적 목록/등록/수정 |
| UploadUrlFunction | S3 Presigned URL 발급 |
| QuoteFunction | 견적 조회/수정 |
| RiskFunction | 리스크 계산/조회 |
| ChatFunction | Bedrock 챗봇 호출 |
| AlertFunction | 위험 선적 알림 발송 |

## 7-2. 배치 Lambda

| Lambda | 트리거 | 역할 |
| --- | --- | --- |
| MarketIngestFunction | EventBridge Scheduler | KCCI/SCFI/ECOS/관세청/뉴스 수집 |
| ParseDocumentFunction | S3 ObjectCreated | 업로드 파일 파싱 |
| DailyBriefingFunction | EventBridge Scheduler | 회사별 아침 브리핑 생성 |
| RiskBatchFunction | EventBridge Scheduler 또는 수동 | 등록된 선적 리스크 일괄 재계산 |

## 7-3. Lambda 환경변수

| 변수 | 설명 |
| --- | --- |
| AWS_REGION | AWS 리전 |
| UPLOAD_BUCKET_NAME | 사용자 업로드 버킷 |
| RAW_DATA_BUCKET_NAME | 원문 데이터 버킷 |
| DATABASE_URL | Aurora PostgreSQL 접속 문자열 |
| BEDROCK_MODEL_ID | Bedrock 모델 ID |
| TELEGRAM_BOT_TOKEN | 텔레그램 봇 토큰 |
| TELEGRAM_CHAT_ID | 텔레그램 채팅 ID |
| KCCI_API_KEY | KCCI API Key |
| ECOS_API_KEY | 한국은행 ECOS API Key |
| CUSTOMS_API_KEY | 관세청 API Key |

비밀값은 최종 구조에서 Secrets Manager 또는 SSM Parameter Store로 관리한다.

---

## 8. Aurora PostgreSQL 구성

Aurora는 회사별 선적 데이터와 시장 데이터를 결합하는 데이터 허브다.

### 8-1. 저장 대상

| 데이터 | 저장 이유 |
| --- | --- |
| 회사/사용자 | 회사별 접근 제어 |
| 선적/견적 | 개인화 분석 기준 |
| 시장 지표 | 과거 추세, 재분석, 출처 추적 |
| 뉴스 이벤트 | 리스크 근거, AI 설명 context |
| 리스크 결과 | 이력 관리, 알림 기준 |
| 알림 로그 | 발송 추적 |
| 브리핑 | 매일 생성 결과 보관 |

### 8-2. 왜 API 호출만 하지 않고 DB에 저장하는가

KCCI, 환율, 뉴스 등을 매번 실시간 API로만 호출할 수도 있다. 하지만 PortPulse에서는 저장하는 편이 유리하다.

| 이유 | 설명 |
| --- | --- |
| 과거 추세 필요 | 운임 상승/하락 판단은 과거값 비교가 필요 |
| 재현성 | 어제 왜 HIGH였는지 다시 설명 가능 |
| 비용/속도 | 매 화면마다 외부 API를 호출하지 않음 |
| 장애 대응 | 외부 API 실패 시 마지막 정상 데이터 사용 |
| 알림 근거 | 발송 당시 사용한 데이터 스냅샷 보관 |
| AI 출처 | Bedrock 응답에 사용한 source ref 추적 |

따라서 MVP에서는 샘플 데이터나 로컬 DB로 시작해도 되지만, 최종 구조에서는 시장 데이터를 Aurora에 적재하는 것이 적합하다.

### 8-3. DB 접근 방식

MVP에서는 Lambda가 직접 PostgreSQL에 연결할 수 있다.

운영 구조에서는 다음 중 하나를 선택한다.

| 방식 | 설명 |
| --- | --- |
| Lambda direct connection | 단순하지만 동시 접속 관리 필요 |
| RDS Proxy | Lambda 동시성 증가 시 안정적 |
| Data API | Aurora Serverless 사용 시 선택 가능 |

PBL MVP에서는 단순성을 위해 direct connection 또는 샘플 JSON으로 시작하고, 발표에서 RDS Proxy 확장을 설명한다.

---

## 9. EventBridge Scheduler

매일 아침 시장 데이터 수집과 브리핑 생성을 실행한다.

### 9-1. 스케줄

```text
cron(0 0 * * ? *)
```

UTC 00:00은 한국시간 09:00이다.

### 9-2. 실행 흐름

```text
09:00 KST
→ MarketIngestFunction
→ 시장 데이터 저장
→ RiskBatchFunction
→ 회사별 선적 리스크 재계산
→ DailyBriefingFunction
→ AlertFunction
```

---

## 10. Amazon Bedrock 구성

Bedrock은 계산 엔진이 아니라 설명 엔진이다.

### 10-1. 역할

| 기능 | 설명 |
| --- | --- |
| 챗봇 | 사용자의 질문에 선적/시장 context 기반 답변 |
| 리스크 설명 | 룰 엔진 결과를 쉬운 자연어로 설명 |
| 일일 브리핑 | 시장 데이터와 고위험 선적 요약 |
| 알림 문구 | Push 메시지 문구 생성 |

### 10-2. 금지 사항

Bedrock이 다음을 임의로 계산하면 안 된다.

```text
리스크 점수
예산 초과율
초과 예상액
부킹 추천 상태
```

이 값들은 Lambda 룰 엔진이 계산하고, Bedrock에는 context로 전달한다.

### 10-3. 확장 구조

최종 구조에서는 Bedrock Agent Action Group을 사용한다.

```text
Bedrock Agent
→ Action Group Lambda
→ Aurora 조회
→ 시장 데이터/선적/리스크 context 반환
→ Bedrock 답변 생성
```

Sub-agent 역할:

| Agent | 역할 |
| --- | --- |
| 뉴스 수집 에이전트 | 운임 영향 뉴스 요약 |
| 운임 분석 에이전트 | KCCI/SCFI 방향성 판단 |
| 거시 해석 에이전트 | 환율/금리 비용 영향 해석 |
| 종합 브리핑 에이전트 | 개인화 경보 생성 |

MVP에서는 단일 Bedrock 호출로 구현하고, 발표에서 멀티에이전트 확장 구조를 설명한다.

---

## 11. 알림 인프라

### 11-1. Telegram

MVP 1순위 알림 채널이다.

| 항목 | 설명 |
| --- | --- |
| 구현 난이도 | 낮음 |
| 발표 적합성 | 높음 |
| 필요값 | TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID |

### 11-2. Kakao 알림톡

국내 사용자 친화 채널이지만 템플릿 승인과 비즈니스 절차가 필요하다.

MVP에서는 확장 예정으로 설명한다.

### 11-3. Email

브리핑 리포트 발송용으로 적합하다.

SES를 사용할 수 있지만 MVP에서는 선택이다.

---

## 12. 보안 설계

### 12-1. 인증/인가

| 항목 | 방식 |
| --- | --- |
| 사용자 로그인 | Cognito |
| API 인증 | API Gateway JWT Authorizer |
| 회사별 데이터 접근 | company_id 기준 필터링 |

### 12-2. S3 보안

| 항목 | 방식 |
| --- | --- |
| 공개 접근 | 차단 |
| 업로드 | Presigned URL |
| 암호화 | SSE-S3 또는 SSE-KMS |
| 접근 권한 | Lambda IAM 최소권한 |

### 12-3. IAM 원칙

각 Lambda는 필요한 리소스에만 접근한다.

예:

```text
UploadUrlFunction
  - s3:PutObject only on UploadBucket

ParseDocumentFunction
  - s3:GetObject on UploadBucket
  - Aurora write permission

ChatFunction
  - bedrock:Converse
  - Aurora read permission
```

---

## 13. CloudWatch 운영

| 로그 | 설명 |
| --- | --- |
| API Lambda 로그 | 요청 처리, 오류 |
| MarketIngest 로그 | 외부 API 성공/실패 |
| ParseDocument 로그 | 파일 파싱 상태 |
| Risk 로그 | 적용 룰과 점수 |
| Chat 로그 | Bedrock 호출 성공/실패 |
| Alert 로그 | 알림 발송 성공/실패 |

발표에서는 CloudWatch 로그를 보여주면 “운영 가능한 클라우드 서비스”라는 설득력이 커진다.

---

## 14. MVP 구현 범위

### 14-1. 1차 MVP 필수

```text
S3 Upload Bucket
API Gateway HTTP API
Lambda
Bedrock Converse API
Telegram Alert Lambda
샘플 데이터 또는 로컬 DB
CloudWatch Logs
```

### 14-2. 2차 구현

```text
Cognito
Aurora PostgreSQL
EventBridge Scheduler
Raw Data S3 Bucket
Secrets Manager/SSM
S3 업로드 이벤트 파싱
```

### 14-3. 발표용 최종 아키텍처

```text
Route 53
CloudFront
S3 Frontend Bucket
Cognito
API Gateway
Lambda
S3 Upload Bucket
S3 Raw Data Bucket
EventBridge Scheduler
Aurora PostgreSQL
Amazon Bedrock Agent
Telegram/Kakao/Email
CloudWatch
```

---

## 15. SAM/CloudFormation 리소스 초안

현재 repo의 `infra/template.yaml`은 다음 리소스를 우선 포함한다.

```text
UploadBucket
RawDataBucket
Cognito UserPool
Cognito UserPoolClient
HTTP API
UploadUrlFunction
ShipmentFunction
RiskFunction
ChatFunction
ParseDocumentFunction
IngestMarketFunction
AlertFunction
```

추가로 보강할 리소스:

```text
FrontendBucket
CloudFrontDistribution
Api Cognito Authorizer
Aurora PostgreSQL 또는 RDS 설정
Lambda VPC 설정
Secrets Manager Parameters
S3 ObjectCreated Event 연결
DailyBriefingFunction
RiskBatchFunction
```

---

## 16. 개발 순서

```text
1. API Gateway + Lambda 로컬/샘플 데이터 연결
2. 리스크 룰 엔진 구현
3. Bedrock 설명 API 연결
4. 텔레그램 알림 연결
5. S3 Presigned URL 업로드 연결
6. PostgreSQL/Aurora 스키마 연결
7. EventBridge 시장 데이터 배치 연결
8. Cognito 인증 연결
9. CloudFront/S3 정적 웹 배포
10. Bedrock Agent Action Group 확장
```

이 순서로 가면 발표 가능한 MVP를 먼저 만들고, 이후 AWS 완성도를 높일 수 있다.
