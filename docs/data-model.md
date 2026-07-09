# 데이터 모델 초안

최종 아키텍처는 Aurora PostgreSQL을 기준으로 합니다. MVP에서는 같은 스키마를 로컬 PostgreSQL 또는 간단한 SQLite로 먼저 검증할 수 있습니다.

## companies

회사 단위 데이터 분리를 위한 테이블입니다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid | 회사 ID |
| name | text | 회사명 |
| created_at | timestamp | 생성일 |

## users

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid | 사용자 ID |
| company_id | uuid | 회사 ID |
| email | text | 로그인 이메일 |
| role | text | admin/member |
| created_at | timestamp | 생성일 |

## shipments

사용자의 실제 선적 건입니다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid | 선적 ID |
| company_id | uuid | 회사 ID |
| name | text | 선적명 |
| origin_port | text | 출발 항만 |
| destination_port | text | 도착 항만 |
| cargo_ready_date | date | 화물 준비일 |
| due_date | date | 납기일 |
| container_type | text | FCL/LCL |
| incoterms | text | FOB/CIF 등 |
| status | text | 등록/견적수신/부킹완료 등 |
| created_at | timestamp | 생성일 |

## quotes

포워더 견적서에서 추출한 정보입니다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid | 견적 ID |
| shipment_id | uuid | 선적 ID |
| forwarder_name | text | 포워더명 |
| freight_cost | numeric | 기본 운임 |
| currency | text | 통화 |
| surcharge | numeric | 부대비용 |
| valid_until | date | 견적 유효기간 |
| etd | date | 예상 출항일 |
| eta | date | 예상 도착일 |
| raw_file_key | text | S3 원본 파일 경로 |
| created_at | timestamp | 생성일 |

## market_indices

KCCI, SCFI, 환율 등 시장 수치 데이터입니다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid | 데이터 ID |
| source | text | KCCI/SCFI/ECOS 등 |
| route | text | 항로 |
| value | numeric | 수치 |
| unit | text | 단위 |
| observed_date | date | 기준일 |
| created_at | timestamp | 수집일 |

## market_events

뉴스와 리포트에서 추출한 이벤트입니다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid | 이벤트 ID |
| title | text | 기사/뉴스 제목 |
| source | text | 출처 |
| url | text | 원문 링크 |
| event_type | text | 호르무즈/홍해/파업/운임급등 등 |
| affected_routes | text[] | 영향 가능 항로 |
| summary | text | 요약 |
| published_at | timestamp | 게시일 |

## risk_results

선적별 리스크 결과입니다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid | 결과 ID |
| shipment_id | uuid | 선적 ID |
| risk_score | integer | 0~100 |
| risk_level | text | LOW/MEDIUM/HIGH |
| reasons | jsonb | 적용된 위험 사유 |
| recommended_actions | jsonb | 추천 대응 |
| calculated_at | timestamp | 계산일 |
