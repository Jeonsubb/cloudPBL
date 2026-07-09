# API 명세 초안

기본 경로는 `/api`로 가정합니다.

## 인증

프론트엔드는 Cognito 로그인 후 받은 토큰을 API 요청 헤더에 포함합니다.

```http
Authorization: Bearer <id_token>
```

## 선적

### 선적 목록 조회

```http
GET /api/shipments
```

응답 예시:

```json
{
  "items": [
    {
      "shipmentId": "shp_001",
      "name": "부산-LA 자동차 부품 1차",
      "originPort": "Busan",
      "destinationPort": "Los Angeles",
      "cargoReadyDate": "2026-07-15",
      "dueDate": "2026-08-03",
      "status": "QUOTE_RECEIVED",
      "riskLevel": "HIGH",
      "riskScore": 78
    }
  ]
}
```

### 선적 등록

```http
POST /api/shipments
```

요청 예시:

```json
{
  "name": "부산-LA 자동차 부품 1차",
  "originPort": "Busan",
  "destinationPort": "Los Angeles",
  "cargoReadyDate": "2026-07-15",
  "dueDate": "2026-08-03",
  "containerType": "FCL",
  "incoterms": "FOB"
}
```

## 파일 업로드

### 업로드 URL 발급

```http
POST /api/uploads/presigned-url
```

요청 예시:

```json
{
  "shipmentId": "shp_001",
  "fileName": "forwarder_quote.xlsx",
  "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}
```

응답 예시:

```json
{
  "uploadUrl": "https://...",
  "s3Key": "companies/demo/shipments/shp_001/original/forwarder_quote.xlsx"
}
```

## 리스크

### 리스크 결과 조회

```http
GET /api/shipments/{shipmentId}/risk
```

응답 예시:

```json
{
  "shipmentId": "shp_001",
  "riskScore": 78,
  "riskLevel": "HIGH",
  "reasons": [
    "견적 유효기간이 2일 남았지만 부킹이 완료되지 않았습니다.",
    "최근 부산발 운임지수가 상승했습니다.",
    "관련 항로에 지정학 리스크 뉴스가 감지되었습니다."
  ],
  "recommendedActions": [
    "오늘 안에 포워더에게 견적 유효기간 연장을 요청하세요.",
    "선복 확보 가능 여부를 재확인하세요."
  ]
}
```

## 챗봇

### 질문하기

```http
POST /api/chat
```

요청 예시:

```json
{
  "shipmentId": "shp_001",
  "message": "이 선적이 왜 위험한지 쉽게 설명해줘"
}
```

응답 예시:

```json
{
  "answer": "현재 가장 큰 위험은 견적 만료와 납기 여유 부족입니다..."
}
```

## 리포트

### 리포트 생성

```http
POST /api/reports
```

요청 예시:

```json
{
  "shipmentId": "shp_001",
  "type": "ONE_PAGE"
}
```
