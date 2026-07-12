# PortPulse API 명세

이 문서는 PortPulse 프론트엔드와 백엔드가 주고받는 API를 정의한다.

MVP에서는 샘플 데이터 또는 로컬 DB를 사용할 수 있지만, API 형태는 최종 AWS 구조와 동일하게 유지한다.

---

## 1. 기본 원칙

### 1-1. Base URL

```text
https://{api-id}.execute-api.ap-northeast-2.amazonaws.com
```

로컬 개발 환경에서는 다음처럼 사용한다.

```text
http://localhost:3000
```

### 1-2. 공통 Prefix

```text
/api
```

### 1-3. 인증

공개 랜딩/시장 프리뷰 API는 인증 없이 접근 가능하다.

회사별 선적, 견적, 리스크, 알림 API는 Cognito 토큰을 사용한다.

```http
Authorization: Bearer <id_token>
```

### 1-4. 공통 응답 형식

성공 응답은 리소스별 JSON을 반환한다.

에러 응답은 다음 형식을 사용한다.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "선적 예정 주차는 필수입니다.",
    "details": {
      "field": "plannedShipWeek"
    }
  }
}
```

### 1-5. 주요 에러 코드

| 코드 | HTTP | 설명 |
| --- | --- | --- |
| UNAUTHORIZED | 401 | 인증 토큰 없음 또는 만료 |
| FORBIDDEN | 403 | 다른 회사 데이터 접근 |
| NOT_FOUND | 404 | 리소스 없음 |
| VALIDATION_ERROR | 400 | 입력값 오류 |
| PARSE_FAILED | 422 | 파일 파싱 실패 |
| EXTERNAL_API_FAILED | 502 | 외부 데이터 API 실패 |
| BEDROCK_FAILED | 502 | Bedrock 호출 실패 |
| INTERNAL_ERROR | 500 | 서버 내부 오류 |

---

## 2. 공개 API

공개 API는 랜딩/시장 대시보드에서 사용한다. 실제 회사 선적, 견적, 예산 데이터는 포함하지 않는다.

## 2-1. 공개 시장 요약 조회

```http
GET /api/public/market-snapshot?laneCode=BUSAN_USWC
```

### Query

| 이름 | 필수 | 예시 | 설명 |
| --- | --- | --- | --- |
| laneCode | 아니오 | BUSAN_USWC | 항로 코드 |

### Response

```json
{
  "laneCode": "BUSAN_USWC",
  "laneName": "부산 → 미주서안",
  "observedDate": "2026-07-13",
  "indices": [
    {
      "source": "KCCI",
      "value": 2340,
      "unit": "point",
      "trend": "UP",
      "weekOverWeekRate": 7.8
    },
    {
      "source": "SCFI",
      "value": 2506,
      "unit": "point",
      "trend": "UP"
    }
  ],
  "fx": {
    "source": "ECOS",
    "indicatorCode": "USD_KRW",
    "value": 1380,
    "unit": "KRW/USD",
    "trend": "DOWN",
    "dayOverDayRate": -0.4
  },
  "events": [
    {
      "eventType": "PORT_CONGESTION",
      "title": "미주 서안 항만 혼잡 확대",
      "severity": "MEDIUM",
      "affectedRoutes": ["BUSAN_USWC"]
    }
  ]
}
```

## 2-2. 랜딩 샘플 추천 조회

```http
GET /api/public/demo-recommendation?laneCode=BUSAN_USWC
```

### Response

```json
{
  "title": "8월 3주차 미주서안 선적은 2주 내 부킹 확정 권고",
  "laneCode": "BUSAN_USWC",
  "plannedShipWeek": "2026-W33",
  "budgetPerFeu": 2800,
  "estimatedCostPerFeu": 3304,
  "budgetOverrunRate": 18,
  "volumeFeu": 4,
  "estimatedExtraCost": 2016,
  "recommendation": "BOOK_WITHIN_2_WEEKS",
  "summary": "예산 대비 예상 운임이 높고 단기 운임 상승 압력이 남아 있습니다."
}
```

---

## 3. 회사/사용자 API

## 3-1. 내 회사 정보 조회

```http
GET /api/me
```

### Response

```json
{
  "user": {
    "id": "user_001",
    "email": "demo@portpulse.kr",
    "name": "김물류",
    "role": "admin"
  },
  "company": {
    "id": "company_demo_001",
    "name": "부산 수출기업 데모",
    "industry": "자동차 부품",
    "region": "부산",
    "defaultOriginPort": "Busan"
  }
}
```

## 3-2. 데모 회사 진입

발표 MVP에서만 사용하는 엔드포인트다.

```http
POST /api/demo/session
```

### Response

```json
{
  "demoToken": "demo-session-token",
  "companyId": "company_demo_001",
  "redirectTo": "/dashboard"
}
```

---

## 4. 선적 API

## 4-1. 선적 목록 조회

```http
GET /api/shipments?status=ACTIVE&riskLevel=HIGH
```

### Query

| 이름 | 필수 | 예시 | 설명 |
| --- | --- | --- | --- |
| status | 아니오 | ACTIVE | 선적 상태 |
| riskLevel | 아니오 | HIGH | 위험도 필터 |
| laneCode | 아니오 | BUSAN_USWC | 항로 필터 |

### Response

```json
{
  "items": [
    {
      "shipmentId": "shp_001",
      "name": "자동차 부품 1차",
      "originPort": "Busan",
      "destinationRegion": "USWC",
      "destinationPort": "Los Angeles",
      "laneCode": "BUSAN_USWC",
      "plannedShipWeek": "2026-W33",
      "incoterms": "CIF",
      "volumeFeu": 4,
      "budgetPerFeu": 2800,
      "budgetCurrency": "USD",
      "status": "QUOTE_RECEIVED",
      "riskLevel": "HIGH",
      "riskScore": 82,
      "bookingRecommendation": "BOOK_WITHIN_2_WEEKS"
    }
  ]
}
```

## 4-2. 선적 상세 조회

```http
GET /api/shipments/{shipmentId}
```

### Response

```json
{
  "shipmentId": "shp_001",
  "companyId": "company_demo_001",
  "name": "자동차 부품 1차",
  "originPort": "Busan",
  "destinationRegion": "USWC",
  "destinationPort": "Los Angeles",
  "laneCode": "BUSAN_USWC",
  "plannedShipWeek": "2026-W33",
  "cargoReadyDate": "2026-08-10",
  "dueDate": "2026-09-05",
  "incoterms": "CIF",
  "cargoItem": "자동차 부품",
  "hsCode": "8708",
  "volumeFeu": 4,
  "budgetPerFeu": 2800,
  "budgetCurrency": "USD",
  "status": "QUOTE_RECEIVED",
  "createdAt": "2026-07-13T00:00:00Z",
  "updatedAt": "2026-07-13T00:00:00Z"
}
```

## 4-3. 선적 등록

```http
POST /api/shipments
```

### Request

```json
{
  "name": "자동차 부품 1차",
  "originPort": "Busan",
  "destinationRegion": "USWC",
  "destinationPort": "Los Angeles",
  "plannedShipWeek": "2026-W33",
  "cargoReadyDate": "2026-08-10",
  "dueDate": "2026-09-05",
  "incoterms": "CIF",
  "cargoItem": "자동차 부품",
  "hsCode": "8708",
  "volumeFeu": 4,
  "budgetPerFeu": 2800,
  "budgetCurrency": "USD"
}
```

### Response

```json
{
  "shipmentId": "shp_001",
  "status": "REGISTERED",
  "nextAction": "UPLOAD_QUOTE"
}
```

## 4-4. 선적 수정

```http
PATCH /api/shipments/{shipmentId}
```

## 4-5. 선적 상태 변경

```http
POST /api/shipments/{shipmentId}/status
```

### Request

```json
{
  "status": "BOOKED"
}
```

---

## 5. 파일/견적 API

## 5-1. 업로드 URL 발급

```http
POST /api/uploads/presigned-url
```

### Request

```json
{
  "shipmentId": "shp_001",
  "fileName": "forwarder_quote.xlsx",
  "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}
```

### Response

```json
{
  "uploadUrl": "https://s3-presigned-url",
  "s3Bucket": "portpulse-user-uploads",
  "s3Key": "companies/company_demo_001/shipments/shp_001/original/forwarder_quote.xlsx",
  "expiresIn": 900
}
```

## 5-2. 업로드 완료 알림

프론트엔드가 S3 업로드 성공 후 호출한다. S3 이벤트 파싱과 병행 가능하다.

```http
POST /api/uploads/complete
```

### Request

```json
{
  "shipmentId": "shp_001",
  "s3Key": "companies/company_demo_001/shipments/shp_001/original/forwarder_quote.xlsx"
}
```

### Response

```json
{
  "fileId": "file_001",
  "parseStatus": "QUEUED"
}
```

## 5-3. 견적 추출 결과 조회

```http
GET /api/shipments/{shipmentId}/quotes/latest
```

### Response

```json
{
  "quoteId": "quote_001",
  "shipmentId": "shp_001",
  "forwarderName": "ABC Logistics",
  "oceanFreightPerFeu": 2950,
  "surchargePerFeu": 180,
  "totalCostPerFeu": 3130,
  "currency": "USD",
  "validUntil": "2026-07-20",
  "etd": "2026-08-18",
  "eta": "2026-09-02",
  "parseStatus": "PARSED"
}
```

## 5-4. 견적 추출값 수정

```http
PATCH /api/quotes/{quoteId}
```

---

## 6. 시장 데이터 API

## 6-1. 시장 데이터 조회

```http
GET /api/market/snapshot?laneCode=BUSAN_USWC
```

로그인 후 대시보드에서 사용한다. 공개 API보다 더 많은 내부 참조 ID를 포함할 수 있다.

## 6-2. 시장 데이터 수동 수집 실행

관리자 또는 발표 데모용 API다.

```http
POST /api/admin/market/ingest
```

### Response

```json
{
  "jobId": "market_ingest_20260713_0900",
  "status": "STARTED"
}
```

---

## 7. 리스크/부킹 추천 API

## 7-1. 리스크 계산 실행

```http
POST /api/shipments/{shipmentId}/risk/calculate
```

### Request

```json
{
  "mode": "LATEST_MARKET_DATA"
}
```

### Response

```json
{
  "riskResultId": "risk_001",
  "shipmentId": "shp_001",
  "riskScore": 82,
  "riskLevel": "HIGH",
  "bookingRecommendation": "BOOK_WITHIN_2_WEEKS",
  "budgetOverrunRate": 18,
  "estimatedExtraCost": 2016,
  "currency": "USD",
  "reasons": [
    "KCCI 부산-미주서안 항로가 전주 대비 7.8% 상승했습니다.",
    "예산 $2,800/FEU 대비 예상 비용이 약 18% 높습니다.",
    "8월 3주차 선적 예정으로 부킹 판단 시간이 길지 않습니다."
  ],
  "recommendedActions": [
    "2주 내 부킹 확정을 검토하세요.",
    "포워더에게 선복 확보 가능 여부를 확인하세요.",
    "견적 유효기간 연장을 요청하세요."
  ],
  "sourceRefs": [
    {
      "source": "KCCI",
      "id": "kcci_20260713_uswc"
    }
  ],
  "calculatedAt": "2026-07-13T09:00:00Z"
}
```

## 7-2. 최신 리스크 결과 조회

```http
GET /api/shipments/{shipmentId}/risk/latest
```

## 7-3. 리스크 이력 조회

```http
GET /api/shipments/{shipmentId}/risk/history
```

---

## 8. AI 챗봇/브리핑 API

## 8-1. 챗봇 질문

```http
POST /api/chat
```

### Request

```json
{
  "shipmentId": "shp_001",
  "message": "왜 지금 부킹해야 해?"
}
```

### Response

```json
{
  "answer": "현재는 2주 내 부킹 확정을 권고합니다. 근거는 KCCI 단기 상승, 예산 초과 가능성, 납기 여유 부족입니다.",
  "sourceRefs": [
    {
      "source": "RISK_RESULT",
      "id": "risk_001"
    },
    {
      "source": "KCCI",
      "id": "kcci_20260713_uswc"
    }
  ]
}
```

## 8-2. 일일 브리핑 조회

```http
GET /api/briefings/daily?date=2026-07-13
```

### Response

```json
{
  "briefingId": "briefing_001",
  "briefingDate": "2026-07-13",
  "title": "미주서안 운임 상승, 예산 초과 주의",
  "summary": "오늘 부산발 미주서안 KCCI는 전주 대비 상승했습니다...",
  "highRiskShipments": [
    {
      "shipmentId": "shp_001",
      "name": "자동차 부품 1차",
      "riskLevel": "HIGH"
    }
  ],
  "sourceRefs": []
}
```

## 8-3. 일일 브리핑 생성

배치 Lambda 또는 관리자 데모용 API에서 사용한다.

```http
POST /api/briefings/daily/generate
```

---

## 9. 알림 API

## 9-1. 알림 설정 조회

```http
GET /api/notification-settings
```

## 9-2. 알림 설정 수정

```http
PUT /api/notification-settings
```

### Request

```json
{
  "dailyBriefingEnabled": true,
  "briefingTime": "09:00",
  "telegramEnabled": true,
  "kakaoEnabled": false,
  "emailEnabled": true,
  "riskThreshold": "HIGH",
  "budgetOverrunRateThreshold": 10,
  "extraCostThreshold": 1000
}
```

## 9-3. 테스트 알림 발송

```http
POST /api/alerts/test
```

## 9-4. 위험 선적 알림 발송

```http
POST /api/alerts/risk
```

### Request

```json
{
  "shipmentId": "shp_001",
  "riskResultId": "risk_001",
  "channels": ["TELEGRAM"]
}
```

### Response

```json
{
  "sent": true,
  "logs": [
    {
      "alertLogId": "alert_001",
      "channel": "TELEGRAM",
      "sendStatus": "SENT"
    }
  ]
}
```

## 9-5. 알림 이력 조회

```http
GET /api/alert-logs?shipmentId=shp_001
```

---

## 10. MVP API 우선순위

### 10-1. 1차 MVP 필수

```text
GET  /api/public/market-snapshot
GET  /api/public/demo-recommendation
POST /api/demo/session
GET  /api/shipments
POST /api/shipments
POST /api/uploads/presigned-url
GET  /api/shipments/{shipmentId}/quotes/latest
POST /api/shipments/{shipmentId}/risk/calculate
GET  /api/shipments/{shipmentId}/risk/latest
POST /api/chat
POST /api/alerts/risk
```

### 10-2. 2차 구현

```text
GET  /api/me
PATCH /api/shipments/{shipmentId}
POST /api/uploads/complete
PATCH /api/quotes/{quoteId}
GET  /api/market/snapshot
GET  /api/briefings/daily
PUT  /api/notification-settings
GET  /api/alert-logs
```

### 10-3. 확장

```text
POST /api/admin/market/ingest
GET  /api/shipments/{shipmentId}/risk/history
POST /api/briefings/daily/generate
POST /api/alerts/test
```
