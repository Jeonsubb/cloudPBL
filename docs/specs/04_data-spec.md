# PortPulse 데이터 명세

PortPulse의 데이터는 크게 4종류로 나눈다.

1. 공개 시장 데이터
2. 회사/사용자 데이터
3. 선적/견적 데이터
4. 분석/알림 데이터

랜딩 화면에서는 공개 시장 데이터만 보여준다. 로그인 이후에는 회사별 선적 데이터와 공개 시장 데이터를 결합해 개인화된 부킹 타이밍을 계산한다.

---

## 1. 데이터 분류

| 분류 | 설명 | 공개 여부 | 저장 위치 |
| --- | --- | --- | --- |
| 공개 시장 데이터 | KCCI, SCFI, 환율, 뉴스 등 | 공개 가능 | Aurora, S3 |
| 회사 데이터 | 회사명, 업종, 기본 항로 | 비공개 | Aurora |
| 사용자 데이터 | 이메일, 역할, 알림 설정 | 비공개 | Cognito, Aurora |
| 선적 데이터 | 항로, 선적 예정일, 물량, 예산 | 비공개 | Aurora |
| 견적 데이터 | 운임, 부대비용, 유효기간, ETD/ETA | 비공개 | Aurora, S3 |
| 분석 결과 | 리스크 점수, 추천 행동, 근거 | 회사별 비공개 | Aurora |
| 알림 로그 | 발송 채널, 메시지, 성공 여부 | 회사별 비공개 | Aurora |

---

## 2. 공개 시장 데이터

공개 시장 데이터는 랜딩/시장 대시보드와 로그인 후 대시보드에서 모두 사용된다.

### 2-1. KCCI

부산발 항로별 컨테이너 운임 수준과 변동을 판단하는 메인 데이터다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | string | kcci_20260713_uswc | 데이터 ID |
| source | string | KCCI | 데이터 출처 |
| route_code | string | BUSAN_USWC | 내부 항로 코드 |
| route_name | string | 부산 → 미주서안 | 표시용 항로명 |
| value | number | 2340 | 지수 값 |
| unit | string | point | 단위 |
| observed_date | date | 2026-07-13 | 기준일 |
| week_over_week_rate | number | 7.8 | 전주 대비 변화율 |
| trend | string | UP | UP/DOWN/FLAT |
| created_at | datetime | 2026-07-13T00:00:00Z | 저장 시각 |

### 2-2. SCFI

글로벌 운임 추세를 보완하는 보조 지표다. 부산발 KCCI가 메인이며, SCFI는 방향성 참고 용도로 사용한다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | string | scfi_20260713 | 데이터 ID |
| source | string | SCFI | 데이터 출처 |
| route_code | string | SHANGHAI_USWC | SCFI 항로 코드 |
| route_name | string | 상하이 → 미주서안 | 표시용 항로명 |
| value | number | 2506 | 지수 값 |
| unit | string | point | 단위 |
| observed_date | date | 2026-07-13 | 기준일 |
| four_week_avg | number | 2410 | 4주 평균 |
| trend | string | UP | UP/DOWN/FLAT |

### 2-3. ECOS 환율/거시 데이터

원화 기준 비용 부담을 해석하기 위해 사용한다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | string | ecos_fx_20260713 | 데이터 ID |
| source | string | ECOS | 데이터 출처 |
| indicator_code | string | USD_KRW | 지표 코드 |
| indicator_name | string | 원/달러 환율 | 표시명 |
| value | number | 1380 | 값 |
| unit | string | KRW/USD | 단위 |
| observed_date | date | 2026-07-13 | 기준일 |
| day_over_day_rate | number | -0.4 | 전일 대비 변화율 |
| trend | string | DOWN | UP/DOWN/FLAT |

### 2-4. 관세청 통계

운임 데이터가 아니라 물동량, 품목, 성수기 신호를 보조적으로 해석하는 데이터다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | string | customs_202607_auto_parts | 데이터 ID |
| source | string | CUSTOMS | 데이터 출처 |
| hs_code | string | 8708 | 품목 코드 |
| item_name | string | 자동차 부품 | 품목명 |
| export_value | number | 1200000 | 수출 금액 |
| export_weight | number | 84000 | 수출 중량 |
| destination_country | string | US | 목적국 |
| observed_month | string | 2026-07 | 기준월 |
| seasonality_signal | string | HIGH | 성수기 신호 |

### 2-5. 뉴스 이벤트

홍해, 파업, 항만 혼잡, 유가, 얼라이언스 개편 등 운임에 영향을 줄 수 있는 이벤트를 저장한다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | string | news_20260713_001 | 뉴스 ID |
| source | string | 해운 전문 뉴스 | 출처 |
| title | string | 미주 서안 항만 혼잡 확대 | 제목 |
| url | string | https://example.com/news/1 | 원문 URL |
| event_type | string | PORT_CONGESTION | 이벤트 유형 |
| affected_routes | string[] | BUSAN_USWC | 영향 항로 |
| summary | string | 항만 체류시간 증가... | 요약 |
| severity | string | MEDIUM | LOW/MEDIUM/HIGH |
| published_at | datetime | 2026-07-13T08:00:00Z | 게시 시각 |
| collected_at | datetime | 2026-07-13T09:00:00Z | 수집 시각 |

---

## 3. 회사/사용자 데이터

### 3-1. companies

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | company_demo_001 | 회사 ID |
| name | string | 부산 수출기업 데모 | 회사명 |
| industry | string | 자동차 부품 | 업종 |
| region | string | 부산 | 지역 |
| default_origin_port | string | Busan | 기본 출발 항만 |
| created_at | datetime | 2026-07-13T00:00:00Z | 생성 시각 |

### 3-2. users

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | user_001 | 사용자 ID |
| company_id | uuid | company_demo_001 | 회사 ID |
| email | string | demo@portpulse.kr | 이메일 |
| name | string | 김물류 | 이름 |
| role | string | admin | admin/member |
| created_at | datetime | 2026-07-13T00:00:00Z | 생성 시각 |

### 3-3. notification_settings

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | noti_001 | 설정 ID |
| company_id | uuid | company_demo_001 | 회사 ID |
| user_id | uuid | user_001 | 사용자 ID |
| daily_briefing_enabled | boolean | true | 매일 브리핑 여부 |
| briefing_time | string | 09:00 | 브리핑 시간 |
| telegram_enabled | boolean | true | 텔레그램 사용 여부 |
| kakao_enabled | boolean | false | 카카오 사용 여부 |
| email_enabled | boolean | true | 이메일 사용 여부 |
| risk_threshold | string | HIGH | 알림 기준 위험도 |
| budget_overrun_rate_threshold | number | 10 | 예산 초과율 기준 |
| extra_cost_threshold | number | 1000 | 초과 금액 기준 |

---

## 4. 선적/견적 데이터

### 4-1. shipments

사용자가 직접 입력하는 핵심 데이터다. PortPulse 개인화 판단의 기준이 된다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | shp_001 | 선적 ID |
| company_id | uuid | company_demo_001 | 회사 ID |
| name | string | 자동차 부품 1차 | 선적명 |
| origin_port | string | Busan | 출발 항만 |
| destination_region | string | USWC | 도착 권역 |
| destination_port | string | Los Angeles | 도착 항만 |
| lane_code | string | BUSAN_USWC | 내부 항로 코드 |
| planned_ship_week | string | 2026-W33 | 선적 예정 주차 |
| cargo_ready_date | date | 2026-08-10 | 화물 준비일 |
| due_date | date | 2026-09-05 | 납기일 |
| incoterms | string | CIF | CIF/CFR/FOB 등 |
| cargo_item | string | 자동차 부품 | 품목 |
| hs_code | string | 8708 | HS 코드 |
| volume_feu | number | 4 | FEU 기준 물량 |
| budget_per_feu | number | 2800 | FEU당 기준 예산 |
| budget_currency | string | USD | 예산 통화 |
| status | string | REGISTERED | REGISTERED/QUOTE_RECEIVED/BOOKED |
| created_at | datetime | 2026-07-13T00:00:00Z | 생성 시각 |
| updated_at | datetime | 2026-07-13T00:00:00Z | 수정 시각 |

### 4-2. quotes

포워더 견적서 또는 엑셀에서 추출한 데이터다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | quote_001 | 견적 ID |
| shipment_id | uuid | shp_001 | 선적 ID |
| forwarder_name | string | ABC Logistics | 포워더명 |
| ocean_freight_per_feu | number | 2950 | FEU당 기본 운임 |
| surcharge_per_feu | number | 180 | FEU당 부대비용 |
| total_cost_per_feu | number | 3130 | FEU당 총 비용 |
| currency | string | USD | 통화 |
| valid_until | date | 2026-07-20 | 견적 유효기간 |
| etd | date | 2026-08-18 | 예상 출항일 |
| eta | date | 2026-09-02 | 예상 도착일 |
| raw_file_key | string | companies/.../quote.xlsx | S3 원본 경로 |
| parse_status | string | PARSED | RECEIVED/PARSED/FAILED |
| created_at | datetime | 2026-07-13T00:00:00Z | 생성 시각 |

### 4-3. uploaded_files

S3에 업로드된 원본 파일 메타데이터다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | file_001 | 파일 ID |
| company_id | uuid | company_demo_001 | 회사 ID |
| shipment_id | uuid | shp_001 | 선적 ID |
| file_name | string | forwarder_quote.xlsx | 파일명 |
| content_type | string | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | MIME 타입 |
| s3_bucket | string | portpulse-user-uploads | 버킷명 |
| s3_key | string | companies/demo/shipments/shp_001/original/forwarder_quote.xlsx | S3 key |
| file_size | number | 104857 | 파일 크기 |
| uploaded_at | datetime | 2026-07-13T00:00:00Z | 업로드 시각 |

---

## 5. 분석 데이터

### 5-1. risk_results

선적별 리스크 계산 결과다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | risk_001 | 결과 ID |
| shipment_id | uuid | shp_001 | 선적 ID |
| company_id | uuid | company_demo_001 | 회사 ID |
| risk_score | number | 82 | 0~100 점수 |
| risk_level | string | HIGH | LOW/MEDIUM/HIGH |
| booking_recommendation | string | BOOK_WITHIN_2_WEEKS | 부킹 추천 상태 |
| budget_overrun_rate | number | 18 | 예산 초과율 |
| estimated_extra_cost | number | 2016 | 총 초과 예상액 |
| currency | string | USD | 통화 |
| reasons | json | [] | 리스크 근거 |
| recommended_actions | json | [] | 추천 행동 |
| source_refs | json | [] | 근거 데이터 참조 |
| calculated_at | datetime | 2026-07-13T09:00:00Z | 계산 시각 |

### 5-2. applied_rules

리스크 계산에 적용된 룰을 추적한다. 발표/디버깅/AI 설명 근거에 유용하다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | rule_result_001 | 적용 결과 ID |
| risk_result_id | uuid | risk_001 | 리스크 결과 ID |
| rule_code | string | BUDGET_OVERRUN | 룰 코드 |
| rule_name | string | 예산 초과 위험 | 룰 이름 |
| score_delta | number | 30 | 가산 점수 |
| reason | string | 예산 대비 예상 운임이 18% 높습니다. | 적용 사유 |
| action | string | 2주 내 부킹 확정을 검토하세요. | 추천 행동 |

### 5-3. booking_recommendation 값

| 값 | 의미 | 표시 문구 |
| --- | --- | --- |
| BOOK_NOW | 즉시 부킹 권고 | 지금 부킹 확정을 권고합니다. |
| BOOK_WITHIN_2_WEEKS | 2주 내 부킹 권고 | 2주 내 부킹 확정을 검토하세요. |
| WATCH | 관찰 필요 | 시장 변동을 더 지켜보세요. |
| WAIT | 대기 가능 | 단기 대기가 가능합니다. |
| INSUFFICIENT_DATA | 데이터 부족 | 판단에 필요한 데이터가 부족합니다. |

---

## 6. AI/브리핑 데이터

### 6-1. ai_messages

챗봇 대화 기록이다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | msg_001 | 메시지 ID |
| company_id | uuid | company_demo_001 | 회사 ID |
| user_id | uuid | user_001 | 사용자 ID |
| shipment_id | uuid | shp_001 | 관련 선적 ID |
| role | string | user | user/assistant |
| message | text | 왜 지금 부킹해야 해? | 메시지 내용 |
| model_id | string | anthropic.claude-3-5-sonnet... | Bedrock 모델 |
| source_refs | json | [] | 참조한 데이터 |
| created_at | datetime | 2026-07-13T09:05:00Z | 생성 시각 |

### 6-2. daily_briefings

매일 아침 생성되는 회사별 브리핑이다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | briefing_001 | 브리핑 ID |
| company_id | uuid | company_demo_001 | 회사 ID |
| briefing_date | date | 2026-07-13 | 브리핑 날짜 |
| title | string | 미주서안 운임 상승, 예산 초과 주의 | 제목 |
| summary | text | 오늘 부산발 미주서안 KCCI는... | 요약 |
| high_risk_shipments | json | [] | 고위험 선적 목록 |
| market_snapshot | json | {} | 시장 데이터 스냅샷 |
| source_refs | json | [] | 출처 |
| created_at | datetime | 2026-07-13T09:00:00Z | 생성 시각 |

---

## 7. 알림 데이터

### 7-1. alert_logs

발송된 알림과 실패한 알림을 추적한다.

| 필드 | 타입 | 예시 | 설명 |
| --- | --- | --- | --- |
| id | uuid | alert_001 | 알림 ID |
| company_id | uuid | company_demo_001 | 회사 ID |
| user_id | uuid | user_001 | 사용자 ID |
| shipment_id | uuid | shp_001 | 관련 선적 ID |
| risk_result_id | uuid | risk_001 | 관련 리스크 결과 |
| channel | string | TELEGRAM | TELEGRAM/KAKAO/EMAIL |
| alert_type | string | RISK_ALERT | DAILY_BRIEFING/RISK_ALERT |
| title | string | 위험 선적 경보 | 제목 |
| message | text | 자동차 부품 1차 선적... | 메시지 |
| send_status | string | SENT | PENDING/SENT/FAILED |
| error_message | text | null | 실패 사유 |
| sent_at | datetime | 2026-07-13T09:01:00Z | 발송 시각 |

---

## 8. 랜딩 화면 데이터와 로그인 후 데이터 분리

### 8-1. 랜딩 화면에서 사용 가능한 데이터

| 데이터 | 표시 가능 여부 | 이유 |
| --- | --- | --- |
| KCCI 지수 | 가능 | 공개 시장 지표 |
| SCFI 지수 | 가능 | 공개 시장 지표 |
| 환율 | 가능 | 공개 거시 지표 |
| 뉴스 요약 | 가능 | 공개 기사 요약 |
| 샘플 부킹 추천 | 가능 | 가상의 데모 데이터 |
| 실제 회사 선적 | 불가 | 민감 데이터 |
| 실제 견적서 운임 | 불가 | 민감 데이터 |
| 회사별 예산단가 | 불가 | 민감 데이터 |

### 8-2. 로그인 후 사용 가능한 데이터

| 데이터 | 설명 |
| --- | --- |
| 회사별 선적 목록 | 로그인한 회사의 선적만 표시 |
| 회사별 예산단가 | 예산 초과 계산에 사용 |
| 견적서 추출 데이터 | 실제 운임과 유효기간 판단 |
| 개인화 리스크 결과 | 회사/선적 기준으로 계산 |
| 알림 설정 | 사용자별 채널 설정 |

---

## 9. MVP 샘플 데이터

### 9-1. 샘플 선적

```json
{
  "id": "shp_001",
  "companyId": "company_demo_001",
  "name": "자동차 부품 1차",
  "originPort": "Busan",
  "destinationRegion": "USWC",
  "destinationPort": "Los Angeles",
  "laneCode": "BUSAN_USWC",
  "plannedShipWeek": "2026-W33",
  "incoterms": "CIF",
  "cargoItem": "자동차 부품",
  "volumeFeu": 4,
  "budgetPerFeu": 2800,
  "budgetCurrency": "USD",
  "status": "QUOTE_RECEIVED"
}
```

### 9-2. 샘플 견적

```json
{
  "id": "quote_001",
  "shipmentId": "shp_001",
  "forwarderName": "ABC Logistics",
  "oceanFreightPerFeu": 2950,
  "surchargePerFeu": 180,
  "totalCostPerFeu": 3130,
  "currency": "USD",
  "validUntil": "2026-07-20",
  "etd": "2026-08-18",
  "eta": "2026-09-02"
}
```

### 9-3. 샘플 시장 데이터

```json
{
  "kcci": {
    "routeCode": "BUSAN_USWC",
    "routeName": "부산 → 미주서안",
    "value": 2340,
    "weekOverWeekRate": 7.8,
    "trend": "UP"
  },
  "scfi": {
    "routeCode": "SHANGHAI_USWC",
    "value": 2506,
    "trend": "UP"
  },
  "fx": {
    "indicatorCode": "USD_KRW",
    "value": 1380,
    "trend": "DOWN"
  },
  "events": [
    {
      "eventType": "PORT_CONGESTION",
      "title": "미주 서안 항만 혼잡 확대",
      "affectedRoutes": ["BUSAN_USWC"],
      "severity": "MEDIUM"
    }
  ]
}
```

### 9-4. 샘플 리스크 결과

```json
{
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
  ]
}
```

---

## 10. DB 테이블 초안

1차 구현에서 필요한 테이블은 다음과 같다.

```text
companies
users
notification_settings
shipments
quotes
uploaded_files
market_indices
market_events
risk_results
applied_rules
daily_briefings
ai_messages
alert_logs
```

MVP에서는 모든 테이블을 바로 구현하지 않아도 된다. 우선순위는 다음과 같다.

### 1차 MVP 필수 테이블

```text
shipments
quotes
market_indices
market_events
risk_results
```

### 데모 편의를 위한 선택 테이블

```text
companies
users
alert_logs
```

### 2차 구현 테이블

```text
notification_settings
uploaded_files
applied_rules
daily_briefings
ai_messages
```

---

## 11. 데이터 처리 원칙

### 11-1. AI는 계산하지 않는다

리스크 점수, 예산 초과율, 초과 예상액은 Lambda 룰 엔진이 계산한다. Bedrock은 계산된 결과와 근거를 사용자에게 설명하는 역할을 한다.

### 11-2. 출처를 반드시 남긴다

모든 리스크 결과는 어떤 데이터에 근거했는지 추적 가능해야 한다.

예:

```json
[
  {
    "source": "KCCI",
    "id": "kcci_20260713_uswc",
    "label": "KCCI 부산 → 미주서안 2026-07-13"
  },
  {
    "source": "NEWS",
    "id": "news_20260713_001",
    "label": "미주 서안 항만 혼잡 확대"
  }
]
```

### 11-3. 공개 데이터와 회사 데이터를 분리한다

랜딩 화면은 공개 데이터와 샘플 데이터만 사용한다. 실제 회사 선적, 견적, 예산 정보는 로그인 이후에만 표시한다.

### 11-4. 데이터 부족 상태를 명확히 표시한다

예산단가, 견적서, 항로 매칭 데이터가 부족하면 무리하게 판단하지 않는다.

표시 예:

```text
예산단가가 입력되지 않아 예산 초과 위험은 계산하지 않았습니다.
현재는 운임 추세와 뉴스 이벤트 기준의 시장 리스크만 표시합니다.
```

### 11-5. 관세청 데이터는 운임으로 사용하지 않는다

관세청 통계는 물동량과 성수기 보조 신호다. 운임 수준 판단은 KCCI를 메인으로 사용한다.

---

## 12. 다음 문서로 연결

이 데이터 명세를 기준으로 다음 문서를 작성한다.

```text
05_screen-spec.md
06_api-spec.md
07_aws-architecture.md
08_mvp-plan.md
```

특히 화면 명세에서는 랜딩 화면이 공개 시장 데이터만 사용하고, 메인 대시보드는 회사별 선적 데이터와 시장 데이터를 결합한다는 점을 반영해야 한다.
