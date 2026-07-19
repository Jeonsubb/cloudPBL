# PortPulse Bedrock Agent — Agent 극대화 설계

규칙엔진을 제거하고 Agent가 직접 의사결정하는 구조로 재설계.
코드 기준: `infra/lib/portpulse-agent.mjs`(에이전트 정의) · `lambda/agent-tools.mjs`(도구 실행기).

## 설계 철학: Agent 역할 극대화

기존 구조는 **규칙엔진(decision.mjs)이 행동을 확정**하고 Agent는 "설명만" 했다.
새 구조는 **Agent가 데이터를 직접 보고 판단까지** 한다:

```text
[이전] 선적 데이터 → 규칙엔진(decision.mjs) → 행동 확정 → Agent는 설명만
[이후] 선적 데이터 → Agent(도구로 조회) → Agent가 직접 판단·행동 결정·근거 제시
```

**왜 바꿨나**: Agent의 판단 능력을 최대한 활용하기 위해. 규칙엔진은 고정된 if-else라
새로운 상황(시장 급변, 복합 조건)에 유연하게 대응하지 못한다. Agent는 시장 추세·뉴스·납기·예산을
종합적으로 고려해 상황에 맞는 판단을 내릴 수 있다.

## 에이전트 구성

| 항목 | 값 |
|---|---|
| 이름 | `portpulse-agent` (별칭 `live`) |
| 모델 | `apac.anthropic.claude-sonnet-4-20250514-v1:0` |
| 지침 | `portpulse-agent.mjs`의 `AGENT_INSTRUCTION` — 판단 기준 포함 |
| 세션 | 유휴 15분(`idleSessionTtlInSeconds: 900`) |
| 도구 실행기 | Lambda 1개(`portpulse-agent-tools`) — 액션그룹 4개 디스패치 |

## 도구(액션그룹) 스펙

### market-data — 시장 시계열 조회

| 함수 | 파라미터 | 반환 |
|---|---|---|
| `get_market_snapshot` | 없음 | 환율 4종·기준금리·KCCI 종합 최신값+변동, 주간 급등락 항로 |
| `get_market_series` | `seriesId`(필수), `days`(기본 90) | 시계열 포인트(200개 초과 시 샘플링) |

### news-data — 해운 뉴스

| 함수 | 파라미터 | 반환 |
|---|---|---|
| `get_top_news` | `date`(기본 오늘), `limit`(기본 5) | 키워드 점수 상위 기사 |

### company-data — 회사·선적 데이터 + 추천 생성

| 함수 | 파라미터 | 반환 | 변경점 |
|---|---|---|---|
| `get_shipment_portfolio` | 없음 | 선적 원본 데이터(상세정보·견적·KCCI 시장가·납기까지 일수) | **신규** — 규칙엔진 결과 대신 원본 데이터 반환, Agent가 직접 판단 |
| `get_current_shipment` | 없음 | 회사 "이번 선적" + 정책 | 기존과 동일 |
| `get_latest_recommendation` | 없음 | 최신 AI 선적 추천 이력 | 기존과 동일 |
| `generate_recommendation` | 없음 | 시장·스케줄·뉴스 종합 → 새 추천 생성·저장 후 결과 반환 | **신규** — Agent가 추천 갱신 트리거 가능 |

### web-search — 웹 검색

| 함수 | 파라미터 | 반환 |
|---|---|---|
| `web_search` | `query`(필수), `maxResults`(기본 5) | Tavily 검색 결과 |

## Agent 의사결정 기준 (instruction에 내장)

Agent는 도구로 데이터를 수집한 뒤 다음 기준을 종합적으로 판단한다:

### 1. 긴급도
- 납기까지 남은 일수 ≤ 배송소요일+5일 → 즉시 예약
- 견적 유효기간 1~2일 내 만료 → 즉시 검토
- 탑승 가능 항차 ≤ 2개 → 미루기 어려움

### 2. 비용 적정성
- 견적이 목표예산 대비 5%+ 초과 → 재견적 고려
- FEU당 해상비가 KCCI 대비 8%+ 비쌈 → 재견적 고려
- 예산 범위 내 + KCCI 적정 → 수용 가능

### 3. 시장 추세
- KCCI 52주 백분위 80%+(고점) + 상승세 → 빨리 예약
- KCCI 52주 백분위 25%-(저점) → 좋은 가격, 예약 유리
- 하락세 + 납기 여유 → 관망 가능

### 4. 최종 행동
- `BOOK_NOW`: 즉시 예약
- `BOOK_SOON`: 곧 예약
- `CONSIDER_WAIT`: 관망
- `REQUEST_REQUOTE`: 재견적 요청
- `DEADLINE_RISK`: 납기 위험

## 기능별 Agent 활용 방식

| 기능 | 방식 | Agent 역할 |
|---|---|---|
| **챗봇** (POST /chat) | Agent 전면 | 질문 분석 → 도구 선택 → 데이터 기반 답변 |
| **선적 어드바이저** (GET /shipments/{id}/advisor) | Agent 전면 | 원본 데이터를 받아 직접 행동 결정 + 근거 + 실무 조언 |
| **AI 선적 추천** (GET /recommendations) | Agent 도구(generate_recommendation) | Agent가 "추천 갱신해줘" 요청 시 트리거. 내부에서 데이터 수집+Bedrock 추천 |
| **텔레그램 브리핑** (news-digest, 07:00) | 파이프라인 유지 | URL 안정성 때문에 코드가 링크를 직접 붙임 |
| **stance 변화 알림** (reco-monitor, 07:30) | 파이프라인 유지 | 재평가 후 변화 감지 시 알림 |

## 이전 대비 변경 요약

| 항목 | 이전 | 이후 |
|---|---|---|
| `decision.mjs` | 규칙엔진이 행동 확정 | Agent가 직접 판단 (decision.mjs는 더 이상 사용 안 됨) |
| `get_shipment_decisions` | 규칙엔진 결정카드 반환 | → `get_shipment_portfolio`: 원본 데이터 반환 |
| 어드바이저 프롬프트 | "규칙엔진 결정을 설명해라" | "데이터를 분석해서 직접 행동을 결정해라" |
| `generate_recommendation` | 없었음(Agent 도구 아님) | 신규 — Agent가 추천 생성 트리거 가능 |
| agent-tools 타임아웃 | 30초 | 120초 (Bedrock Converse 내부 호출 대응) |
| agent-tools 권한 | DDB 읽기만 | DDB 읽기+쓰기, 스케줄 테이블, Bedrock Converse |

## 요청 흐름

```text
프론트 챗봇 ── POST /chat ──> portpulse-chat ── InvokeAgent(live) ──┐
프론트 어드바이저 ─ GET /shipments/{id}/advisor ──> shipment-query ──┤ (원본 데이터로 Agent 호출)
                                                                     ▼
                                                            portpulse-agent
                                                                     │ (도구 호출)
                          ┌──────────────┬──────────────┬────────────┴────────────┬────────────┐
                    Knowledge Base   market-data     news-data            company-data       web-search
                          │              └──────────────┴────────────┬────────────┴────────────┘
                   S3 문서 + Vectors                        portpulse-agent-tools Lambda
                                                    (DynamoDB ×4 · S3 · Bedrock Converse · Tavily)
```

## 배포·운영

```bash
cd infra && npx cdk deploy

# 동작 확인 — 포트폴리오 원본 데이터(Agent 판단 전):
curl "$API_URL/shipments" | jq '.shipments[0]'

# 동작 확인 — Agent 어드바이저(직접 판단):
curl "$API_URL/shipments/SHP-2026-0001/advisor" | jq '.advice'

# 동작 확인 — 챗봇에서 추천 요청:
curl -X POST "$API_URL/chat" -H 'content-type: application/json' \
  -d '{"message":"이번 선적 추천 갱신해줘"}'
```
