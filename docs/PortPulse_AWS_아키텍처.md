# PortPulse AWS 아키텍처 — 고도화안

> 작성 기준일: 2026-07-13
> 기준 기획: 부산 수출 중소기업의 선적·견적 의사결정 지원
> 설계 원칙: 결정론적 계산이 먼저, 생성형 AI 설명은 나중

---

## 0. 기존 3조 아키텍처에서 바뀐 핵심

| 구분 | 기존 구조 | 고도화 구조 |
|---|---|---|
| 의사결정 | Bedrock Supervisor와 Sub-Agent가 운임·거시·뉴스를 종합 판단 | 버전이 있는 Scoring Lambda가 계산·판정하고 Bedrock은 결과를 설명 |
| AI 구성 | Bedrock 멀티에이전트가 코어 | Amazon Bedrock Converse API 단일 모델을 옵션으로 사용 |
| 회사 데이터 | Excel을 S3→Lambda→Aurora에 바로 적재 | Presigned Upload→검역→악성코드 검사→Staging 검증→사용자 확정→Aurora |
| 시장 데이터 | KCCI·SCFI·ECOS·관세청·뉴스를 모두 자동수집 | 소스별 접근권한·주기·라이선스를 Registry로 관리하고 실패 시 명시적 폴백 |
| 저장소 | Aurora 중심, 원본·정제 경계 불명확 | S3 Raw/Quarantine/Report와 Aurora Operational을 분리 |
| 비동기 처리 | Lambda 직접 연결 | SQS·DLQ와 Step Functions로 수집·파싱·점수·알림을 분리 |
| 시계열·ML | Timestream·SageMaker 옵션 | 데이터 규모와 라벨이 부족한 MVP에서는 제외 |
| RAG | OpenSearch Serverless가 기본 | MVP 제외. 필요성이 확인되면 Bedrock Knowledge Bases + S3 Vectors |
| 알림 | SNS에서 카카오·Telegram으로 직접 전송처럼 표현 | Notification SQS→Sender Lambda→외부 채널 API. SNS는 운영 알람용 |
| 보안 | 인증·암호화 개요 | tenant 강제, PostgreSQL RLS, KMS, 파일 검역, 감사 Snapshot, PII 최소화 |

Amazon Bedrock Agents Classic은 AWS 문서상 2026-07-30부터 신규 고객에게 열리지 않을 예정이므로 새 구현의 기반으로 선택하지 않는다. 단순한 근거형 설명은 Converse API와 애플리케이션 관리 Tool Use로 충분하다.

---

## 0-1. 지금 AWS를 얼마나 넣을 것인가

결론은 **AWS-aware but not AWS-dependent**다. 지금 전체 인프라를 먼저 만들지도 않고, 로컬 코드를 나중에 전면 재작성하지도 않는다.

| 지금 고정할 경계 | 로컬 MVP | AWS Pilot |
|---|---|---|
| `DashboardContract` | `/api/dashboard` JSON | API Gateway/Lambda가 같은 JSON 반환 |
| `MarketProvider` | ECOS·KCCI·공식 RSS TypeScript 어댑터 | EventBridge → Source Adapter Lambda |
| `SnapshotRepository` | 내장 검증 Snapshot | S3 Raw + last-known-good, 필요 시 Aurora 발행 |
| `DecisionEngine` | 순수 TypeScript 규칙 | Scoring Lambda에서 동일 코어 호출 |
| `ExplanationProvider` | 결정론적 템플릿 | Bedrock Converse + 템플릿 폴백 |

현재 코드는 계약과 공급자 파일을 분리했지만 `getDashboardPayload()`가 환경변수와 공급자를 직접 참조한다. 다음 리팩터링에서 Clock·Config·Repository를 주입하고, Lambda는 얇은 Handler Adapter만 추가한다. 시장 대시보드만 검증하는 단계에는 Aurora·Step Functions·Bedrock을 억지로 넣지 않는다.

공개 시장 응답과 사용자 응답도 분리한다.

- `GET /v1/market-dashboard`: 사용자 정보 없음, 공개 Cache 가능
- `GET /v1/tenant-overview`: Cognito 인증, `private, no-store`
- 프런트엔드는 두 응답을 합성하며 공개 Cache에 회사 데이터가 섞이지 않게 한다.

---

## 1. 전체 구조

~~~mermaid
flowchart LR
    User["수출기업 담당자<br/>웹·Excel 업로드"]

    subgraph Edge["1. Web / Identity"]
        R53["Route 53"]
        WAF["AWS WAF"]
        CF["CloudFront"]
        WebS3["S3 Private SPA<br/>OAC"]
        Cognito["Amazon Cognito<br/>User Pool"]
    end

    subgraph Api["2. Application API"]
        APIGW["API Gateway<br/>HTTP API + JWT"]
        ApiFn["Lambda API<br/>Shipment·Quote·Report"]
        UploadFn["Lambda<br/>Presigned URL"]
        ChatFn["Lambda<br/>Chat Orchestrator"]
    end

    subgraph Upload["3. File Ingestion"]
        Quarantine["S3 Quarantine<br/>tenant prefix + KMS"]
        Malware["GuardDuty<br/>Malware Protection for S3"]
        ImportQ["SQS Import Queue<br/>+ DLQ"]
        ImportFlow["Step Functions<br/>Import Workflow"]
        Parser["Lambda<br/>XLSX/CSV Parser"]
        Validator["Lambda<br/>Schema·Rule Validator"]
        ErrorReport["S3 Error Report"]
    end

    subgraph Data["4. Operational Data"]
        Aurora["Aurora PostgreSQL<br/>Serverless v2 + Data API<br/>tenant RLS"]
        Raw["S3 Raw / Curated<br/>immutable source snapshots"]
        Rule["Rule & Source Registry<br/>in Aurora"]
    end

    subgraph Market["5. External Data Pipeline"]
        Scheduler["EventBridge Scheduler"]
        MarketFlow["Step Functions<br/>Source Workflow"]
        Adapter["Source Adapter Lambdas"]
        KCCI["KOBC KCCI<br/>public reusable · Monday"]
        FX["ECOS<br/>FX·Base rate·KTB 3Y"]
        FBX["FBX<br/>approved/manual Snapshot"]
        SCFI["SCFI<br/>license link-only"]
        Customs["관세청 API<br/>운송비·무역통계"]
        Port["PORT-MIS / Port-i<br/>approved·optional"]
        News["해수부·관세청 RSS<br/>metadata only"]
    end

    subgraph Decision["6. Decision Core"]
        ChangeQ["SQS Decision Queue<br/>+ DLQ"]
        Score["Lambda Rule Engine<br/>comparability·cost·schedule"]
        Snapshot["Decision + Evidence<br/>immutable snapshot"]
        Bedrock["Amazon Bedrock<br/>Converse API"]
        Template["Deterministic<br/>Template Fallback"]
    end

    subgraph Delivery["7. Report / Notification"]
        NotifyQ["SQS Notification Queue<br/>+ DLQ"]
        ReportFn["Lambda<br/>HTML·CSV Report"]
        Sender["Lambda Channel Adapter"]
        SES["Amazon SES<br/>email"]
        Telegram["Telegram Bot API<br/>demo option"]
        Kakao["Kakao Alimtalk Provider<br/>phase 2"]
        ReportS3["S3 Reports<br/>short-lived download URL"]
    end

    subgraph Ops["8. Security / Operations"]
        KMS["AWS KMS"]
        Secrets["Secrets Manager"]
        CW["CloudWatch<br/>Logs·Metrics·Alarms"]
        Trail["CloudTrail"]
    end

    User --> R53 --> CF
    WAF -.protects.-> CF
    CF --> WebS3
    User --> Cognito
    CF --> APIGW
    Cognito -.JWT.-> APIGW
    APIGW --> ApiFn
    APIGW --> UploadFn
    APIGW --> ChatFn

    ApiFn --> Aurora
    UploadFn --> Quarantine
    Quarantine --> Malware --> ImportQ --> ImportFlow
    ImportFlow --> Parser --> Validator
    Validator -->|valid + confirmed| Aurora
    Validator -->|row errors| ErrorReport

    Scheduler --> MarketFlow --> Adapter
    Adapter --> KCCI & FX & FBX & Customs & Port & News
    SCFI -.license required.-> Adapter
    Adapter --> Raw
    Raw --> Validator
    Validator --> Rule

    Aurora --> ChangeQ
    Rule --> ChangeQ
    ChangeQ --> Score
    Score --> Snapshot
    Snapshot --> Aurora
    Snapshot --> NotifyQ
    Snapshot --> ReportFn

    ChatFn -->|approved queries| Aurora
    ChatFn --> Bedrock
    Snapshot --> Bedrock
    Bedrock -.failure.-> Template
    Template --> ChatFn

    ReportFn --> ReportS3
    NotifyQ --> Sender
    Sender --> SES & Telegram & Kakao

    KMS -.encrypts.-> Quarantine & Raw & Aurora & ReportS3
    Secrets -.credentials.-> Adapter & Sender & ApiFn
    CW -.observes.-> ApiFn & ImportFlow & MarketFlow & Score & Sender & Bedrock
    Trail -.audits.-> Data & Ops
~~~

---

## 2. 데이터 흐름

### 2-1. 웹 입력

1. 사용자가 Cognito로 로그인한다.
2. API Gateway JWT Authorizer가 토큰을 검증한다.
3. API Lambda는 token claim에서 tenant_id를 얻는다.
4. 요청 본문의 tenant_id는 무시한다.
5. Lambda는 Aurora Data API로 tenant context를 설정하고 RLS가 적용된 쿼리를 실행한다.
6. 선적·견적 변경 이벤트를 SQS Decision Queue에 넣는다.

### 2-2. Excel 업로드

~~~mermaid
sequenceDiagram
    actor User as 수출기업 사용자
    participant API as API Gateway/Lambda
    participant S3 as S3 Quarantine
    participant GD as GuardDuty
    participant Q as SQS
    participant SF as Step Functions
    participant V as Parser/Validator Lambda
    participant DB as Aurora PostgreSQL

    User->>API: 파일명·크기·Checksum·Schema Version
    API-->>User: 짧은 만료 Presigned PUT URL
    User->>S3: XLSX/CSV 직접 업로드
    S3->>GD: 신규 Object 검사
    GD->>Q: clean tag/event
    Q->>SF: import_id
    SF->>V: 파싱·형식·코드·관계 검증
    alt 오류 있음
        V-->>User: 행·필드·수정방법 오류 리포트
    else 검증 통과
        V->>DB: staging 저장
        User->>API: 매핑 미리보기 승인
        API->>DB: operational table 반영
    end
~~~

업로드 ObjectCreated 이벤트는 중복될 수 있다고 가정한다. bucket + key + versionId 또는 eTag를 import idempotency key로 저장한다.

### 2-3. 외부 데이터 수집

1. EventBridge Scheduler가 source_registry의 주기에 따라 Step Functions를 실행한다.
2. Source Adapter Lambda가 공식 API 또는 허용된 파일을 가져온다.
3. 원본 응답을 S3 Raw에 수정 불가능한 Snapshot으로 저장한다.
4. Validator가 스키마, 기준일, 단위, 결측, 이전 값 대비 이상을 검사한다.
5. 정상 데이터만 Aurora market_observation에 발행한다.
6. source_status에 fresh, stale, expired, failed와 마지막 성공시각을 기록한다.
7. 새 관측이 열린 선적에 영향을 줄 때만 Decision Queue에 재평가 메시지를 넣는다.

### 2-4. 결정과 설명

1. Scoring Lambda가 선적·견적·비용·스케줄과 시장 Snapshot을 읽는다.
2. Control→Readiness→Comparability Gate를 순서대로 적용한다.
3. 비용·일정·최신성 지표를 계산한다.
4. 행동, 행동기한, 신뢰도, 비교 제외 사유를 결정한다.
5. 입력값·규칙버전·근거 ID를 Decision Snapshot으로 저장한다.
6. Bedrock에는 원본 Excel이 아니라 계산이 끝난 최소 JSON만 전달한다.
7. Bedrock 실패 시 Template Renderer가 같은 숫자로 설명문을 만든다.

---

## 3. 서비스별 책임

아래 `필수` 표시는 **사용자 데이터까지 운영하는 Pilot** 기준이다. 시장 대시보드만 먼저 올리는 AWS Pilot은 API Gateway·Lambda·EventBridge·S3 Snapshot·Secrets Manager·CloudWatch만으로 시작하고, Cognito·Aurora·파일 검역·SQS·Step Functions·Bedrock은 해당 단계가 열릴 때 추가한다.

| 계층 | AWS 서비스 | 책임 | MVP |
|---|---|---|---|
| DNS·Edge | Route 53, CloudFront, WAF | DNS, TLS, CDN, 기본 웹 공격 방어 | 필수 |
| 정적 웹 | S3 Private Bucket + OAC | SPA 배포. Public Website Hosting 미사용 | 필수 |
| 인증 | Cognito User Pool | 로그인, MFA 옵션, 그룹·사용자 관리 | 필수 |
| API | API Gateway HTTP API | JWT 검증, Rate Limit, Route | 필수 |
| 애플리케이션 | Lambda | CRUD, Upload URL, 조회, 보고서, Chat Orchestration | 필수 |
| 파일 | S3 | Quarantine, Raw, Curated, Error, Report 영역 분리 | 필수 |
| 파일 보안 | GuardDuty Malware Protection for S3 | 신규 업로드 악성코드 검사 | 운영 필수, 데모 선택 |
| 비동기 | SQS + DLQ | Import, Decision, Notification의 재시도·완충 | 필수 |
| 워크플로 | Step Functions Standard | 수집·파일 검증의 단계, 재시도, 감사 상태 | 필수 |
| 운영 DB | Aurora PostgreSQL Serverless v2 | 관계형 회사·선적·견적·판정·감사 데이터 | 필수 |
| DB 접근 | RDS Data API | 저트래픽 Lambda의 연결 없는 HTTPS SQL | MVP |
| 일정 | EventBridge Scheduler | 소스별 수집과 마감 재평가 | 필수 |
| AI | Amazon Bedrock Converse API | 계산 완료 결과의 설명·질의 | 선택이지만 데모 권장 |
| 알림 | SES + 외부 API Adapter | 이메일 기본, Telegram 데모, Kakao 2단계 | 이메일 필수 |
| 키·암호화 | KMS, Secrets Manager | 저장 암호화와 외부 API Secret | 필수 |
| 관측성 | CloudWatch, CloudTrail | 실패·신선도·비용·감사 | 필수 |

---

## 4. 운영 데이터 모델

~~~mermaid
erDiagram
    TENANT ||--o{ USER_ACCOUNT : has
    TENANT ||--o{ SHIPMENT : owns
    SHIPMENT ||--o{ QUOTE : receives
    QUOTE ||--o{ QUOTE_CHARGE : contains
    SHIPMENT ||--o| BOOKING : becomes
    BOOKING ||--o{ MILESTONE : has
    BOOKING ||--o{ CONTAINER : uses
    SHIPMENT ||--o{ ACTUAL_CHARGE : settles
    SHIPMENT ||--o{ DECISION_SNAPSHOT : evaluated_as
    DECISION_SNAPSHOT ||--o{ DECISION_EVIDENCE : cites
    MARKET_SOURCE ||--o{ MARKET_OBSERVATION : publishes
    MARKET_OBSERVATION ||--o{ DECISION_EVIDENCE : supports
    RULESET ||--o{ DECISION_SNAPSHOT : governs
    TENANT ||--o{ NOTIFICATION_PREF : configures
    DECISION_SNAPSHOT ||--o{ NOTIFICATION_EVENT : triggers
    IMPORT_JOB ||--o{ IMPORT_ERROR : returns
    TENANT ||--o{ IMPORT_JOB : submits

    SHIPMENT {
      uuid shipment_id PK
      uuid tenant_id
      string shipment_ref
      date cargo_ready_date
      date required_delivery_date
      string pol_unlocode
      string pod_unlocode
      string equipment_size_type
      int container_count
      string cargo_profile
      string incoterm_code
      string booking_controller
      string cost_scope
    }

    QUOTE {
      uuid quote_id PK
      uuid shipment_id
      datetime quoted_at
      datetime valid_until
      string currency
      decimal header_total
      date planned_etd
      date planned_eta
      boolean direct
    }

    QUOTE_CHARGE {
      uuid charge_id PK
      uuid quote_id
      string category
      decimal amount
      string currency
      string basis
      decimal quantity
      boolean kcci_comparable
    }

    DECISION_SNAPSHOT {
      uuid decision_id PK
      uuid shipment_id
      string action
      datetime action_deadline
      string confidence
      string ruleset_version
      datetime evaluated_at
      json input_hashes
    }
~~~

모든 tenant 소유 테이블은 tenant_id를 직접 포함한다. Join을 거쳐서만 tenant를 확인하는 구조를 피하면 RLS 정책과 감사가 단순해진다.

---

## 5. 외부 데이터 계약과 폴백

| Source | 정상 경로 | 실패 시 | 만료 시 행동 |
|---|---|---|---|
| KCCI | KOBC 공식 최신표, 월요일 14:10 KST 수집 | S3 last-known-good + 수동 파일 업로드 | 14개 코드 완전성 실패 시 발행 금지, stale 배지 |
| 관세청 해상 수출 운송비 | 공공 파일/API | 이전 월 값 | 월간 벤치마크에서 제외 |
| 관세청 품목·항구 통계 | 공공 API | Cache + 지수 Backoff + DLQ | 계절성 설명에서 제외 |
| ECOS | 운영 인증키 공식 API. USD/KRW·기준금리·국고채 3년 | S3 last-known-good. sample은 개발환경에만 허용 | 환율 노출액 신뢰도 하향, `KEY_REQUIRED` 표시 |
| PORT-MIS | 승인된 API | 해당 요소 제외 | ETA·선복으로 대체하지 않음 |
| Port-i / ChainPortal | 터미널별 승인 API | 사용자 Booking Confirmation | 승인 전 자동 연동 표시 금지 |
| 해양·통상 뉴스 | 해수부·관세청 RSS 10~30분, 제목·발행처·시각·링크만 | 마지막 공식 메타데이터 + `새 발행 없음` | 48시간 경과 시 stale, 본문·사진·Bedrock 입력 금지 |
| FBX Global | 승인 API/PO 또는 관리자가 검증한 공개 Snapshot | 마지막 `verified_at` Snapshot | Freightos 크레딧·Terminal 링크, 자동수집·AI 사용은 승인 전 금지 |
| SCFI | 서면 재배포권 확보 후 Connector | Link-only | 라이선스 전 Collector·DB 적재·Bedrock 입력 비활성화 |

source_registry 필수 필드:

- source_id, owner, endpoint_type
- license_status, redistribution_allowed
- ai_use_allowed, attribution_url, license_basis
- expected_frequency, expected_by
- schema_version, parser_version
- last_attempt_at, last_success_at, observed_at, published_at, verified_at, effective_at
- freshness_status, consecutive_failures
- fallback_policy, owner_contact

---

## 6. AI 설계

### 6-1. MVP

- Lambda가 Bedrock Converse API에 Decision Snapshot과 Evidence만 전달
- 모델은 설명, 질문의 의도 분류, 승인된 Query Tool 선택만 수행
- Tool은 application code가 실행하고 tenant filter가 적용된 결과만 모델에 돌려줌
- Guardrails로 민감정보, 금지 주제, 허용되지 않은 자동 실행을 제한
- 응답 구조: answer, evidence_ids, data_as_of, limitations

### 6-2. 하지 않는 것

- LLM이 SQL을 자유 생성해 DB에 직접 접근
- LLM이 운임·예산·납기 숫자를 다시 계산
- 회사 원본 Excel·정산서 전체를 공용 Knowledge Base에 적재
- 뉴스 문장을 시스템 지시문으로 취급
- 모델 응답만으로 알림이나 부킹을 실행

### 6-3. RAG가 필요해지는 시점

정적 관세·Incoterms·수출 실무 가이드가 충분히 쌓이고 챗봇 검색 수요가 확인되면 S3 문서 + Bedrock Knowledge Bases + S3 Vectors를 추가한다. 최신 시장 숫자는 RAG가 아니라 Aurora의 구조화 데이터에서 읽는다.

---

## 7. 멀티테넌트 보안

1. Cognito access token의 서명·issuer·audience·scope를 API Gateway가 검증한다.
2. tenant_id는 서버가 user sub→membership에서 해석한다.
3. PostgreSQL session context와 RLS를 적용한다.
4. 서비스 DB Role은 table owner가 아니며 BYPASSRLS 권한을 가지지 않는다.
5. 모든 SQL에도 tenant_id 조건을 명시해 방어층을 겹친다.
6. S3 Object Key는 quarantine/{tenant_id}/{import_id}/... 구조로 발급한다.
7. Presigned URL은 짧게 만료하고 파일 확장자·크기·Checksum·Object Key를 고정한다.
8. 업로드가 clean tag를 받기 전 Parser Role은 읽을 수 없다.
9. KMS Key Policy, IAM, S3 Bucket Policy에서 최소권한을 적용한다.
10. 로그에는 원본 파일 내용과 전체 B/L·수출신고·컨테이너 번호를 남기지 않는다.
11. Decision Snapshot은 append-only로 두고 재평가는 새 버전으로 저장한다.

---

## 8. Aurora 선택

### 데모·저트래픽

- Aurora PostgreSQL Serverless v2
- 지원 버전에서 MinCapacity 0 ACU Auto-Pause
- RDS Data API
- Resume 지연을 고려한 지수 Backoff
- 큰 Result Set은 Page 처리하거나 S3 Report로 생성

### 운영 SLA가 중요해질 때

- 최소 0.5 ACU 이상으로 상시 기동
- 연결 수가 늘면 RDS Proxy 검토
- Reader와 Multi-AZ는 실제 부하·복구목표를 보고 추가

RDS Proxy의 열린 연결은 Auto-Pause 목표와 충돌할 수 있으므로 데모의 Data API 방식과 운영의 Proxy 방식을 동시에 섞지 않는다.

---

## 9. 알림

### 이벤트

- decision.changed
- action_deadline.approaching
- quote.expiring
- cutoff.conflict
- source.stale
- import.failed

### 중복 방지

notification_dedupe_key = tenant_id + decision_id + channel + template_version

같은 Decision Snapshot으로 같은 채널에 두 번 보내지 않는다. Quiet Hours, 채널별 Opt-in, 실패횟수, Provider Message ID를 저장한다.

### 채널 우선순위

1. 인앱 알림: 항상 원본
2. SES 이메일: MVP 기본
3. Telegram: 데모 연결코드 방식
4. Kakao Alimtalk: 사업자 채널·승인 템플릿·공식 Provider 계약 후

---

## 10. 관측성과 운영지표

### 기술

- API p95 latency, 4xx/5xx
- Import success rate, row error rate, processing time
- Queue age, retry count, DLQ messages
- Source freshness, consecutive failures, schema drift
- Decision evaluation latency, action distribution, low-confidence rate
- Notification success, dedupe, provider failure
- Bedrock latency, token cost, fallback rate
- Aurora resume failures와 Data API errors

### 제품

- 선적+견적 등록 완료시간
- KCCI 직접 비교 가능 비율
- 데이터 누락으로 Manual Review가 된 비율
- 재견적·확인요청·부킹 등 실제 후속조치
- 승인 견적 대비 실제 정산 편차
- 계획 ETA 대비 실제 도착 편차

---

## 11. 비용 통제

- 주간 KCCI는 매일 수집하지 않고 발표주기에 맞춘다.
- 시장 변화가 열린 선적에 영향을 줄 때만 재평가한다.
- Bedrock은 사용자가 설명을 열거나 브리핑을 생성할 때 호출하고, 숫자 계산에는 호출하지 않는다.
- OpenSearch Serverless, Timestream, SageMaker, NAT Gateway는 MVP 기본구성에서 제외한다.
- Lambda가 외부 API를 호출해야 할 뿐 VPC 내부 리소스가 필요 없으면 VPC 밖에 둔다.
- Aurora Auto-Pause를 쓰는 데모는 Data API를 사용한다.
- S3 Lifecycle로 원본·Report·오류파일의 보존기간을 구분한다.
- AWS Budgets와 CloudWatch 비용 알람을 환경별로 둔다.

---

## 12. 배포 구조

| 환경 | 목적 | 데이터 |
|---|---|---|
| local | 규칙·파서 단위 테스트 | 합성 데이터만 |
| dev | 통합·데모 개발 | 합성 + 허용된 시장 Snapshot |
| staging | 업로드·권한·마이그레이션 검증 | 비식별 테스트 |
| prod | 실제 고객 | tenant 격리·백업·보존정책 적용 |

- IaC: AWS CDK 또는 SAM 중 하나로 통일
- GitHub Actions는 OIDC AssumeRole을 사용하고 장기 Access Key를 저장하지 않음
- DB Migration은 버전 관리하고 배포 전 Backup·Rollback 경로 확보
- Rule Set과 Prompt도 코드처럼 버전·승인·Rollback 관리
- dev/prod의 S3, Cognito, DB, KMS, Secret을 분리

---

## 13. 장애 시 사용자 동작

| 장애 | 서비스 동작 |
|---|---|
| KCCI 수집 실패 | 마지막 정상 기준일 표시, 일정 시간 후 stale, 금액 권고 억제 |
| API Rate Limit | Cache, Backoff, DLQ, 운영 알람 |
| Excel 오류 | 값을 임의 수정하지 않고 행별 오류파일 반환 |
| 파일 이벤트 중복 | import idempotency key로 한 번만 반영 |
| Aurora Auto-Resume 지연 | 재시도 후 “잠시 후 다시 시도”와 Request ID |
| Bedrock 장애 | 계산결과와 Template 설명 제공, 챗봇만 제한 |
| Port 데이터 결측 | 항만 요소를 점수에서 제외하고 unknown 표시 |
| Telegram·Kakao 장애 | SQS 재시도·DLQ, 인앱 원본 유지 |
| 뉴스 오탐 | 고위험 자동판정 금지, 관리자 검증 전 참고 배지 |

---

## 14. 단계별 아키텍처

### MVP-0

- 로컬 반응형 웹과 `portpulse.dashboard.v1` 계약
- Next `/api/dashboard` → ECOS·KCCI·공식 RSS Provider
- 내장 검증 Snapshot과 소스별 SAMPLE·STALE·BUNDLED_DEMO·LICENSE_REQUIRED 상태
- 브라우저 표준 Excel 검증과 순수 TypeScript Scoring Core
- 결정론적 챗봇·HTML/CSV 리포트

현재 `portpulse-mvp/` 로컬 프로토타입은 위 운영구조의 UI·데이터 계약·규칙엔진·폴백을 검증한다. 첫 화면 기준 계약은 `/api/dashboard`, 챗봇은 `/api/chat`, Excel 검증은 브라우저 로컬 파서다. 기존 `/api/market`은 보조 화면 호환용이며 차후 `/api/dashboard`로 통합한다. vinext Route Handler가 Lambda로 자동 변환된다고 가정하지 않고, 같은 Use Case를 호출하는 얇은 Lambda Handler를 추가한다. 로컬 파일 파싱은 GuardDuty 검사를 대체하지 않는다.

### AWS 시장 데이터 Pilot

- API Gateway + Dashboard Lambda
- EventBridge + Source Adapter Lambda
- S3 Raw·Curated·last-known-good Snapshot, Secrets Manager, CloudWatch
- ECOS 영업일·KCCI 월요일·공식 RSS 10~30분 수집
- `SOURCE_REGISTRY`, `INGESTION_RUN`, `MARKET_OBSERVATION`, `NEWS_ITEM`, `DASHBOARD_SNAPSHOT`

### 사용자 데이터 Pilot

- Cognito, Aurora PostgreSQL Serverless v2 + Data API, tenant RLS
- Presigned Upload, Quarantine, GuardDuty Malware Protection
- 선적·견적·Charge Line·Decision Snapshot 저장
- 필요가 확인된 비동기 흐름에 SQS/DLQ·Step Functions 추가

### AI 단계

- 계산 완료 `DecisionSnapshot + Evidence ID`만 Bedrock Converse에 전달
- 기사 전문·원본 Excel·FBX/SCFI 제한 데이터 전달 금지
- Bedrock 장애 시 TemplateExplanationProvider 사용

### 2단계

- Port-i·UNI-PASS·포워더/선사 승인 연동
- 문서 필드 추출·매핑 UI
- Bedrock Knowledge Bases + S3 Vectors
- Kakao Alimtalk Provider
- 실제 라벨 축적 후 예측 서비스 별도 검토

---

## 15. 구현 체크리스트

- [ ] 지원대상과 비교 불가 조건이 코드·UI·문서에서 동일한가?
- [ ] 모든 금액에 currency, unit, basis, cost_scope가 있는가?
- [ ] tenant_id를 요청 본문에서 신뢰하지 않는가?
- [ ] Aurora RLS와 애플리케이션 tenant filter가 모두 있는가?
- [ ] 업로드가 S3를 거치고 clean 판정 전 파싱되지 않는가?
- [ ] Import·Decision·Notification에 DLQ와 idempotency가 있는가?
- [ ] 각 외부 소스에 기준시각·라이선스·신선도·폴백이 있는가?
- [ ] expired 데이터에서 단정적인 권고가 억제되는가?
- [ ] LLM 없이도 계산·결정 카드·Template 설명이 동작하는가?
- [ ] 모든 권고를 입력 Snapshot과 Rule Set으로 재현할 수 있는가?
- [ ] 알림이 중복 발송되지 않는가?
- [ ] 목업과 실제 관측값이 UI에서 구분되는가?

---

## 16. 주요 AWS 근거

- API Gateway JWT Authorizer: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html
- S3 Presigned URL: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- S3 Upload Checksum: https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html
- GuardDuty Malware Protection for S3: https://docs.aws.amazon.com/guardduty/latest/ug/gdu-malware-protection-s3.html
- Step Functions Workflow Type: https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html
- Aurora Serverless v2 Auto-Pause: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html
- RDS Data API: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html
- AWS PostgreSQL Multi-tenant RLS Guidance: https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/welcome.html
- Bedrock Tool Use: https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html
- Bedrock Guardrails: https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-how.html
- Bedrock Knowledge Bases + S3 Vectors: https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-bedrock-kb.html
- Bedrock Agents Classic 변경 안내: https://docs.aws.amazon.com/bedrock/latest/userguide/agents-action-create.html

---

*이 구조의 코어는 AI가 아니라, 데이터 범위를 맞추고 판단을 재현할 수 있게 만드는 파이프라인과 규칙엔진이다.*
