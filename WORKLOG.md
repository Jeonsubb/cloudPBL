# PortPulse 작업 기록 (WORKLOG)

> 수출입 중소기업용 해운 운임·환율·시황 + AI 선적 추천 대시보드.
> AWS 서버리스(CDK). 이 문서는 "무슨 작업을 어떤 흐름으로 했는지"의 단일 기록이다.
> 최종 갱신: 2026-07-19 (RAG 15문서 재연결·인라인 출처 UI·공개배포 완료)

---

## 0. 지금 바로 쓰는 정보

- **라이브 사이트(CloudFront)**: https://d3dm5tpf1yghyj.cloudfront.net ← 여기로 접속
- **API**: https://t7ggohc5tb.execute-api.ap-northeast-2.amazonaws.com
- **데모 로그인**: `demo@portpulse.io` / `Portpulse2026` (회사명: GreenWave Korea Co., Ltd.)
- **리전/스택**: ap-northeast-2 / `portpulse-market` (CloudFormation)
- **로컬 실행**: `cd frontend && python3 -m http.server 4173` → http://localhost:4173
- **배포**: `cd infra && npx cdk deploy` (⚠️ 반드시 `npx cdk diff` 로 삭제 항목 없는지 먼저 확인)

### 주요 리소스 ID
| 항목 | 값 |
|---|---|
| Cognito User Pool | `ap-northeast-2_rDBGCCBDr` |
| Cognito App Client | `7j7pmgejoq07qdppeb6htt8n6p` |
| Bedrock Agent | `F32TJKPUTQ` / alias `AXFQDW09SC` |
| Bedrock Guardrail | `1r94h375essr` (DRAFT 참조) |
| Knowledge Base | `OM4HXRSTIC` / data source `MZPYT16QFG` (KOBC·DCSA 15문서 인제스천 완료) |
| DynamoDB | portpulse-market-timeseries / -news / -recommendations / -schedule |
| S3 | portpulse-company-uploads-{account} / portpulse-knowledge-base-{account} |

---

## 1. 시스템 개요 / 데이터 흐름

**수집(EventBridge 스케줄 → Lambda → DynamoDB)**
- `ecos-collector`(일): 환율 4종·기준금리(ECOS) + 국제유가 WTI/브렌트(FRED, API키 불필요·일별)
- `kcci-collector`(주 월): KOBC KCCI 컨테이너 운임 종합지수 + 13개 세부항로
- `news-collector`(3시간): 해운 RSS + Bedrock 중복제거 → 점수화
- `schedule-collector`(주 월): **ShipDa 공개 스케줄 API로 부산발 실제 선박 스케줄 11개 항로** 수집,
  운임은 KCCI 앵커 × 시장비율 × 선사티어배수 × 지터로 **합성**(실거래가 비공개라 불가) → `portpulse-schedule`

**조회/AI(API Gateway HTTP API → Lambda)**
- `api-query`(=api.mjs 라우터): /series·/news/top·/schedule·/shipments·/recommendations·/company·… 통합
- `chat`: Bedrock **Agent** 호출(도구로 시장·뉴스·회사선적 조회 + 웹검색). Guardrail 부착.
- `agent-tools`: 에이전트 액션그룹 실행기(DynamoDB/S3 조회)

**알림(EventBridge → Lambda → Telegram)**
- `news-digest`(아침): 시황 브리핑. `reco-monitor`(매일): 회사별 추천 재평가, stance 바뀌면 알림.

**프론트(정적 S3 + CloudFront)**: index/recommendation/market/schedule/shipments/news/login.html + common.js/css

---

## 2. 작업 이력 (시간순 흐름)

### A. 실제 선박 스케줄 소스 구축 (완료·배포)
- ShipDa(www.ship-da.com) 스케줄 화면이 쓰는 비공개-공개 API `api-prod.ship-da.com/vesselSchedule/quote/list`를
  네트워크 분석으로 발견 → 로그인 없이 부산발 실제 스케줄(선사·선박·항차·ETD/ETA·환적) 취득 검증.
- **운임은 로그인해도 항상 null**(견적의뢰 방식) → 실거래가 수집 불가 확정 → 합성 유지 결정.
- 11/13 항로 실제 커버(남아공 KSAI·서아공 KWAI만 ShipDa 미커버 → 합성 폴백).
- `schedule-collector.mjs` + `portpulse-schedule` 테이블 + 주간 자동수집 규칙. 백필 완료.
- 합성운임: 같은 항로·주라도 선사간 10~20% 차이가 업계 정상 → **선사 티어 배수**(KMTC/SINOKOR/HEUNG-A 저가,
  MAERSK 프리미엄 등) + 지터 ±10% 반영.
- `/schedule`(미리보기, 항로별 균등분산) + `/schedule/{routeCode}`(전체보기) API.

### B. 국제유가 추가 (완료·배포)
- ECOS 유가는 월별뿐 → **FRED 일별**(DCOILWTICO/DCOILBRENTEU, API키 불필요)로 전환(`fred.mjs`).
- 함정: FRED WAF가 Node 기본 UA 차단 → `User-Agent: curl/8.7.1` 로 우회. 휴장일 빈값→0 파싱버그 수정.
- 1986~현재 전체 백필. 시황 페이지에 WTI/브렌트 카드.

### C. 입력 양식 (완료)
- `PortPulse_Company_Input_Template.xlsx`: 0_시작안내/1_정책/2_현재선적/3_과거실적/**4_예정선적(다건)**/5_컬럼설명/6_값목록.
- recommendation 페이지에 "양식 다운로드" 버튼.

### D. Item 1 — Bedrock Agent + Guardrail + Knowledge Base 재구축 (완료·배포)
- ⚠️ **사고 기록**: 앞선 `cdk deploy`가 다른 사람이 만들어 git에 없던 Agent/KB/Guardrail을 삭제함
  (KB 인제스천 문서까지 S3 autoDelete로 유실, 복구 불가 확인).
- 복구: Agent+도구는 전동훈님 git 브랜치(`feature/bedrock-agent`)에서 100% 복원. Guardrail은 의도대로 재작성,
  KB는 S3 Vectors + Titan Embed v2로 재구축하고 KOBC·DCSA 15문서를 인제스천함.
- S3 Vectors 인덱스의 `AMAZON_BEDROCK_TEXT`·`AMAZON_BEDROCK_METADATA`를 non-filterable로 설정해
  2KB 필터 메타데이터 제한 오류를 해결. 문서 15/15 색인 성공, 실패 0건.
- InvokeAgent attribution을 채팅 API가 문장 구간+문서 메타데이터로 반환하고, 프론트는 근거 문장 바로 뒤에
  클릭 가능한 `[1]` 출처를 표시. 클릭 시 비공개 S3 원문을 여는 1시간 presigned URL을 발급한다.
  Agent 구성 해시 기반 alias 갱신으로 이전 KB 버전 고정 문제 방지.
- 함정 해결: Guardrail 토픽 한글명→영문, Sonnet4 온디맨드 불가→APAC 추론프로필(`apac.anthropic.claude-sonnet-4...`),
  Agent alias가 옛 버전 참조→재스냅샷, Guardrail이 항구명을 PII로 오인→ADDRESS 규칙 제거 + DRAFT 참조.
- **교훈: 배포 전 항상 `cdk diff`로 `[-]`(삭제) 없는지 확인.**

### E. Item 2 — 회사별 로그인/멀티테넌시 (Cognito, 완료·배포)
- Cognito User Pool(이메일 셀프가입·인증), 퍼블릭 앱클라이언트(USER_PASSWORD_AUTH), HTTP API JWT authorizer.
- **companyId = Cognito sub**. 회사 데이터 S3 경로 `companies/{companyId}/…`, 추천 PK `{companyId}#…`로 격리.
- 보호 경로: /company·/shipments/current·/recommendations·/chat (JWT 필요). 시장·뉴스·스케줄은 공개.
- 프론트: `login.html`(가입/인증/로그인, SDK 없이 Cognito API 직접 fetch), `common.js`가 IdToken 저장·첨부·게이팅.
- 챗봇은 companyId를 에이전트 sessionAttributes로 전달 → 그 회사 선적만 조회.
- 데모 계정 생성(demo@portpulse.io). 검증: 토큰없으면 401, 있으면 회사 스코프.

### F. Item 4 — 다건 포트폴리오 AI 추천 (완료·배포)
- 입력의 현재+예정 선적(여러 건)을 각각 실제 스케줄·합성운임과 매칭(`buildBrief`) → `summarizePortfolio`로 집계.
- Bedrock 1회 호출로 포트폴리오 종합 판정 + 건별 stance/우선순위/추천항차/근거/액션(확정 수치만 인용).
- **30초 타임아웃 해결**: GET /recommendations는 저장된 최신 결과 즉시 반환, POST /recommendations/refresh는
  자기 자신을 async(Event) 호출해 계산 후 저장 → 프론트 폴링.
- 프론트: 포트폴리오 히어로(KPI) + 건별 카드. 검증 완료(데모 5개 항로, 실제 ONE/SINOKOR/HEUNG-A 선박 매칭).

### G. Item 3 — UI 전면 개편 + 공개 배포 (완료)
- 좌측 사이드바 네비 + 대시보드 첫화면(핵심 정보 추림) + 톤 정리.
- 프론트를 S3 + CloudFront로 배포해 실제 공개 URL 제공.

---

## 3. 코드 지도 (lambda/)
- `api.mjs` 라우터 · `query.mjs` 시장조회 · `schedule-query.mjs` 스케줄/전체보기
- `recommend.mjs` 단건+**포트폴리오** 추천(비동기) · `recommend-engine.mjs` 순수계산(buildBrief/summarizePortfolio)
- `schedule-collector.mjs`(ShipDa) · `schedule-gen.mjs`(합성가 공식) · `ocean-services.mjs`(항로 메타)
- `collector.mjs`+`ecos.mjs`+`fred.mjs`+`series.mjs`(시장수집) · `kcci*`(운임지수) · `news-*`(뉴스)
- `chat.mjs`+`agent-tools.mjs`(에이전트) · `company-input/upload.mjs`(엑셀/폼) · `tenant.mjs`(멀티테넌시)
- `route-map.mjs`(도시→항로) · `company-stats.mjs`·`decision.mjs`·`sample-*.mjs`(샘플)

## 4. 남은 일 / 주의
- KB 문서 비어있음 → kimminseo 원본 받으면 `portpulse-knowledge-base-{account}` 에 넣고 데이터소스 sync.
- ECOS 샘플키 rate-limit → 실키 발급 권장(환율/금리 대량 백필 시).
- 배포는 **항상 cdk diff 먼저**. RETAIN 아닌 개발 스택이라 스택 삭제 시 데이터도 삭제됨.
