# PortPulse Bedrock Agent — 도구·지침·기능별 통합 설계

다음단계 4번(Bedrock Agent 형태로 재구성)과 10번(agent tool 및 instruction 구체화)의 결과 문서.
코드 기준: `infra/lib/portpulse-agent.mjs`(에이전트 정의) · `lambda/agent-tools.mjs`(도구 실행기).

## 왜 에이전트인가 (그리고 어디까지만)

기존 구조는 **호출부 Lambda가 모든 컨텍스트를 미리 조립**해 Converse로 보냈다. 챗봇이 대표적 —
질문이 "환율 얼마야?"든 "선적 어떻게 할까?"든 매번 시장 스냅샷+뉴스+포트폴리오 전체를 DB에서 읽어
프롬프트에 붙였다. 에이전트 재구성 후엔 **모델이 질문을 보고 필요한 도구만 호출**한다:

```text
[이전] 사용자 → chat Lambda(시장+뉴스+포트폴리오 전부 조회·조립) → Converse → 응답
[이후] 사용자 → chat Lambda(InvokeAgent만) → Bedrock Agent ⇄ agent-tools Lambda(필요한 것만) → 응답
                                                    └ 세션(대화 이력) 서버측 보관, 유휴 30분
```

단, **전부 에이전트화하지 않았다.** 입력이 고정되고 출력 스키마가 엄격한 배치 파이프라인은
에이전트를 끼우면 오히려 손해(지연·비용·JSON 파싱 불안정)라서 직접 Converse를 유지했다.
경계 기준은 한 줄로: **"입력이 뭐가 필요할지 실행 전에 알 수 없으면 에이전트, 알 수 있으면 파이프라인."**

## 에이전트 구성

| 항목 | 값 |
|---|---|
| 이름 | `portpulse-agent` (별칭 `live` — 코드는 항상 별칭 호출) |
| 모델 | `global.anthropic.claude-opus-4-5-20251101-v1:0` (기존 Lambda들과 동일, `BEDROCK_AGENT_MODEL_ID`로 교체 가능) |
| 지침 | `infra/lib/portpulse-agent.mjs`의 `AGENT_INSTRUCTION` — 임무(챗봇/어드바이저), 도구 사용 원칙, 응답 규칙(기준일 인용·AI 면책 라벨·수치 창작 금지) |
| 세션 | 유휴 30분(`idleSessionTtlInSeconds: 1800`). 대화 이력은 에이전트가 보관, 프론트는 `sessionId`만 왕복 |
| 도구 실행기 | Lambda 1개(`portpulse-agent-tools`) — 액션그룹 4개가 전부 여기로 들어와 function 이름으로 분기 |

## 도구(액션그룹) 스펙

액션그룹 스키마(`portpulse-agent.mjs`)와 실행기 디스패치(`agent-tools.mjs`)는 1:1 — 한쪽을 바꾸면 반드시 같이 바꾼다.

### market-data — DB 조회(환율·금리·KCCI)

| 함수 | 파라미터 | 반환 | 데이터 소스 |
|---|---|---|---|
| `get_market_snapshot` | 없음 | 환율 4종·기준금리·KCCI 종합 최신값+전기 대비 변동, 주간 ±3% 급등락 항로 | DynamoDB `portpulse-market-timeseries` |
| `get_market_series` | `seriesId`(필수), `days`(기본 90, 최대 3650) | 시계열 포인트(200개 초과 시 균등 샘플링). 미지의 id면 전체 지표 목록 반환 | 〃 (KCCI 13개 항로 전부 조회 가능 — 대시보드 노출용 featured 제한 없음) |

### news-data — 해운 뉴스

| 함수 | 파라미터 | 반환 | 데이터 소스 |
|---|---|---|---|
| `get_top_news` | `date`(기본 오늘 KST), `limit`(기본 5, 최대 20) | 키워드 점수 상위 기사(제목·매체·발행시각·링크), 중복 제거본 | DynamoDB `portpulse-news` |

### company-data — 회사·선적 데이터

| 함수 | 파라미터 | 반환 | 데이터 소스 |
|---|---|---|---|
| `get_shipment_decisions` | 없음 | 샘플 포트폴리오 6건 결정카드(행동·우선순위·마감·편차·근거 — 규칙엔진 확정값) | `decision.mjs` + 실시간 KCCI |
| `get_current_shipment` | 없음 | 회사의 "이번 선적" + 정책. 출처 우선순위: UI폼 > 업로드 엑셀 > 번들 샘플 | S3 `portpulse-company-uploads` |
| `get_latest_recommendation` | 없음 | 최신 AI 선적 추천(stance·verdict·narrative·actions) | DynamoDB `portpulse-recommendations` |

### web-search — 웹 검색

| 함수 | 파라미터 | 반환 | 데이터 소스 |
|---|---|---|---|
| `web_search` | `query`(필수), `maxResults`(기본 5, 최대 8) | 제목·URL·스니펫(400자 컷) | Tavily API |

- API 키는 Secrets Manager `portpulse/web-search`(`{"apiKey":"tvly-..."}`)에만 둔다. **미설정이면 에러 대신
  "미설정" 안내를 반환**해 에이전트가 내부 DB만으로 답하도록 유도한다(텔레그램 시크릿과 같은 패턴).
- 지침상 웹 검색은 **내부 DB에 없는 것**(SCFI, 유가, 글로벌 항만 이슈)에만 쓰고 출처를 밝힌다.

## 기능별 통합 방식 (다음단계 10번의 답)

| 기능 | 방식 | 이유 |
|---|---|---|
| **챗봇** (`POST /chat`) | **에이전트 전면 전환.** `chat.mjs`는 InvokeAgent만 하고 데이터 권한이 없다. 세션은 에이전트가 보관 | 질문마다 필요한 데이터가 달라 도구 선택형이 정확히 맞는 형태. 멀티턴 이력 관리도 공짜로 해결 |
| **솔루션 제공 ①** 어드바이저 (`GET /shipments/{id}/advisor`) | **에이전트 호출.** 결정카드(규칙엔진 확정 숫자)는 프롬프트로 넘기고, 에이전트가 뉴스·웹검색으로 맥락 보강 가능 | 자유 서술 출력이라 에이전트 적합. 단 숫자·행동은 `decision.mjs`가 확정 — 에이전트는 설명·행동제안만 |
| **솔루션 제공 ②** AI 선적 추천 (`GET /recommendations`) | **파이프라인 유지(직접 Converse).** `recommend-engine.mjs`가 모든 숫자 확정 → JSON 스키마 강제 생성 | 입력(브리프)이 실행 전에 완전 확정되고, 출력이 엄격한 JSON(파싱 실패 시 1회 자가수정)이라 에이전트를 끼우면 스키마 안정성만 나빠짐 |
| **텔레그램 푸시 ①** 일일 브리핑 (`news-digest`, 07:00) | **파이프라인 유지.** 후보 뉴스+지표를 고정 템플릿으로 조립 → Converse → 코드가 원본 링크를 붙여 전송 | 스케줄 배치라 "도구를 골라 부를" 판단이 없음. 링크를 LLM에 통과시키지 않는 원칙(URL 변형 방지)도 유지 |
| **텔레그램 푸시 ②** stance 변화 알림 (`recommend-monitor`, 07:30) | **파이프라인 유지.** 추천 재평가는 위 ②를 그대로 호출 | 〃 |

원하면 브리핑도 에이전트로 옮길 수 있으나(도구로 뉴스·지표를 모으게), 얻는 것(구조 통일)보다
잃는 것(JSON·링크 안정성, 배치 비용)이 커서 현 단계는 유지가 결론.

## 요청 흐름 요약

```text
프론트 챗봇 ── POST /chat {message, sessionId} ──> portpulse-chat ── InvokeAgent(별칭 live) ──┐
프론트 어드바이저 ─ GET /shipments/{id}/advisor ──> portpulse-api-query(결정카드 계산 후) ────┤
                                                                                              ▼
                                                                                     portpulse-agent
                                                                                              │ (필요 시)
                                                              ┌───────────────┬───────────────┼───────────────┐
                                                        market-data       news-data     company-data     web-search
                                                              └───────────────┴───────┬───────┴───────────────┘
                                                                          portpulse-agent-tools Lambda
                                                                       (DynamoDB ×3 · S3 · Tavily)
```

## 배포·운영

```bash
cd infra && npx cdk deploy          # 에이전트·별칭·도구 Lambda까지 함께 배포(autoPrepare)

# (선택) 웹 검색 켜기 — Tavily 키 발급(tavily.com) 후:
aws secretsmanager put-secret-value --secret-id portpulse/web-search \
  --secret-string '{"apiKey":"tvly-..."}'

# 동작 확인 — 도구 Lambda 단독:
aws lambda invoke --function-name portpulse-agent-tools \
  --payload '{"actionGroup":"market-data","function":"get_market_snapshot","parameters":[]}' \
  --cli-binary-format raw-in-base64-out /dev/stdout

# 동작 확인 — 에이전트 경유(챗봇 API):
curl -X POST "$API_URL/chat" -H 'content-type: application/json' \
  -d '{"message":"오늘 원달러 환율이랑 KCCI 어때?"}'
```

배포 후 콘솔에서 확인할 것:
- Bedrock 콘솔 → Agents → `portpulse-agent`가 **Prepared** 상태인지, 별칭 `live`가 최신 버전을 가리키는지.
- `foundationModel`에 크로스리전 추론 프로필 ID를 그대로 넣었다 — CreateAgent가 거부하면
  `arn:aws:bedrock:{region}:{account}:inference-profile/{id}` ARN으로 바꿔 재배포(코드 주석 참조).

## 스키마 변경 시 체크리스트

1. `lambda/agent-tools.mjs`: 함수 구현 + `TOOLS` 디스패치에 추가.
2. `infra/lib/portpulse-agent.mjs`: 해당 액션그룹 `functionSchema`에 같은 이름·파라미터로 추가.
3. 필요한 테이블/시크릿 권한을 `PortpulseAgent` 생성자에서 grant.
4. `cdk deploy` — autoPrepare가 에이전트를 자동 재준비한다(콘솔 수동 Prepare 불필요).
5. 이 문서의 도구 표 갱신.
