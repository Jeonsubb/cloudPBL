# PortPulse Final — 시장 데이터 파이프라인

PortPulse의 최종 작업 폴더. 한국은행 ECOS 시계열(환율·기준금리), KOBC KCCI 컨테이너선 운임지수,
해운 전문지 뉴스를 수집한다. 수출기업 대시보드 기준으로 국고채 3년물은 제외했다(직접 연관성 낮음).

```text
ECOS API ──(매일 18:10 KST, EventBridge)────────> Lambda(collector)      ──> DynamoDB portpulse-market-timeseries
KOBC 웹(엑셀 다운로드 폼) ──(매주 월 15:00 KST)──> Lambda(kcci-collector)  ──┘  (ECOS는 로컬 실행도 가능: src/local-run.mjs)
해운 전문지 RSS 4곳 ──(3시간마다)────────────────> Lambda(news-collector) ──> DynamoDB portpulse-news

DynamoDB(시장+뉴스) ──> Lambda(query/news-query) ──> API Gateway ──> 대시보드(frontend/index.html)
DynamoDB(시장+뉴스) ──(매일 07:00 KST)──> Lambda(news-digest) ──> Bedrock(Claude) ──> 텔레그램 봇
```

## 수집 지표

| id | 지표 | 소스 | 주기 | 데이터 시작일 |
|---|---|---|---|---|
| `FX_USD_KRW` | 원/달러 | ECOS 731Y001/0000001 | 일별(영업일 1회 고시, 실시간 아님) | 1980-01-04 |
| `FX_JPY_KRW` | 원/엔(100엔) | ECOS 731Y001/0000002 | 일별 | 1977-04-01 |
| `FX_EUR_KRW` | 원/유로 | ECOS 731Y001/0000003 | 일별 | 1999-01-04 |
| `FX_CNY_KRW` | 원/위안 | ECOS 731Y001/0000053 | 일별 | 2016-01-04 |
| `BOK_BASE_RATE` | 한국은행 기준금리 | ECOS 722Y001/0101000 | 일별(금통위 결정 시에만 값 변경) | 1999-05-06 |
| `KCCI` | KOBC 컨테이너선 운임 종합지수 | KOBC KCCI (공식 API 없음 — 엑셀 다운로드 폼 스크레이핑) | 주간(매주 월 14시 발표) | 2022-11-07 |
| `KUWI`~`KSEI` (13개) | 항로별 세부지수(북미서안·유럽·중국 등) | 위와 동일 | 위와 동일 | 2022-11-07 |

각 지표엔 `category`(shipping/fx/rate)가 붙어 있고, 대시보드는 이걸로 KCCI를 히어로 카드, 환율·금리를 그룹 카드로 배치한다.

항로 13개는 DynamoDB에는 다 쌓이지만 `market-series.mjs`가 `featured: true`인 `KCCI`(종합지수)만 API/대시보드에 노출한다 — 카드 14개를 다 띄우면 산만해서. 특정 항로가 필요해지면 `lambda/kcci-series.mjs`에서 해당 항목 `featured: true`로 바꾸면 바로 API/카드에 나온다.

## 폴더

```text
lambda/     [수집기 — 각자 스케줄·외부 API가 달라 Lambda 분리 유지]
              collector.mjs+ecos.mjs+series.mjs(ECOS: 환율4·기준금리, 매일)
              kcci-collector.mjs+kcci.mjs+kcci-series.mjs(KCCI, 매주)
              news-collector.mjs+news-sources.mjs+news-score.mjs+news-dedupe.mjs(뉴스 수집+중복제거, 3시간마다)
              news-digest.mjs(일일 브리핑: Bedrock→텔레그램, 매일)
            [조회 — api.mjs 하나로 통합, 아래 모듈에 경로만 위임]
              api.mjs(통합 라우터, Lambda 1개) → query.mjs(/series) · news-query.mjs(/news/top)
              · shipment-query.mjs(/shipments, decision.mjs+sample-portfolio.mjs 사용)
              market-series.mjs: query.mjs가 쓰는 통합 지표 레지스트리
            [그 외]
              chat.mjs(플로팅 챗봇, POST라 별도 Lambda 유지)
            — Lambda 배포 자산. npm 의존성: xlsx(KCCI 파싱), @aws-sdk/client-bedrock-runtime·secrets-manager(브리핑/어드바이저/챗봇/중복제거)
src/        ECOS 로컬 실행기와 SVG 차트 렌더러
infra/      AWS CDK 스택 (DynamoDB + Lambda + EventBridge 일별/주간 스케줄)
data/       로컬 수집 JSON (gitignore)
charts/     로컬 렌더링 SVG 차트
```

## 로컬 실행

```bash
ECOS_API_KEY=발급키 npm run collect   # 키 없으면 sample 키로 자동 분할 수집
```

ECOS 인증키는 https://ecos.bok.or.kr → 서비스 이용 → 인증키 신청에서 즉시 무료 발급.
sample 키는 호출당 10건 제한이 있어 9일 단위로 나눠 호출한다(동작은 하지만 느림).

## AWS 배포

```bash
cd infra
npm install
npx cdk bootstrap                      # 계정·리전 최초 1회
ECOS_API_KEY=발급키 npx cdk deploy     # 키를 Lambda 환경변수로 주입
```

배포 후 확인:

```bash
# 수동 1회 실행 (최근 30일 수집)
aws lambda invoke --function-name portpulse-ecos-collector \
  --payload '{"days":30}' --cli-binary-format raw-in-base64-out /dev/stdout

# 전체 이력 백필 (실키 필수 — sample 키는 9일 창이라 46년치는 비현실적으로 느림)
# days는 각 시리즈 historyStart(series.mjs)부터 오늘까지 달력일 수. 넉넉히 17000 이상 권장.
aws lambda invoke --function-name portpulse-ecos-collector \
  --payload '{"days":17000}' --cli-binary-format raw-in-base64-out /dev/stdout

# 저장 데이터 조회
aws dynamodb query --table-name portpulse-market-timeseries \
  --key-condition-expression "series = :s" \
  --expression-attribute-values '{":s":{"S":"ECOS#FX_USD_KRW"}}' \
  --max-items 5 --no-scan-index-forward

# KCCI 전체 이력 백필 (출시일 2022-11-07부터, weeks는 넉넉히)
aws lambda invoke --function-name portpulse-kcci-collector \
  --payload '{"weeks":250}' --cli-binary-format raw-in-base64-out /dev/stdout
```

## DynamoDB 스키마

| 속성 | 예시 | 비고 |
|---|---|---|
| `series` (PK) | `ECOS#FX_USD_KRW`, `KCCI#KCCI` | 소스별 접두어(prefix)로 화물운임공표 등 추가 확장 대비 |
| `date` (SK) | `2026-07-14` | 관측일. 같은 키 재수집 시 upsert |
| `value` | `1504.9` | |
| `unit` / `label` / `source` / `fetchedAt` | | 출처·수집시각 함께 저장 (근거 표시용) |

## 왜 Aurora가 아니라 DynamoDB인가

- 시장 시계열은 "시리즈별 날짜 범위 조회"가 전부라 키-레인지 모델로 충분하다.
- Aurora Serverless v2는 유휴 시에도 최소 ACU 비용(월 수만 원대)이 나가지만, 이 테이블은 온디맨드 과금으로 사실상 0원이다.
- 회사·견적·선적 같은 관계형 데이터는 기존 `portpulse-aws`의 Aurora 스키마를 그대로 쓰고, 시장 데이터만 이 테이블에서 읽는 구조로 분리한다. 나중에 Aurora로 옮기려면 `collector.mjs`의 `batchWrite`만 교체하면 된다.

## API Gateway + 대시보드

`infra/lib/market-stack.mjs`가 HTTP API + Lambda를 배포한다. **읽기 전용 조회 5개 경로는 `lambda/api.mjs`
Lambda(`portpulse-api-query`) 하나로 통합**돼 있다 — 전부 "API Gateway가 부르면 DB 읽고 응답"하는 동일한
트리거·패턴이라, 각자 별도 Lambda로 두는 대신 `api.mjs`가 경로를 보고 기존 모듈(`query.mjs`/`news-query.mjs`/
`shipment-query.mjs`)의 핸들러로 그대로 위임한다(로직 중복 없음, 함수 개수만 줄임). 스케줄이 서로 다른
수집기(Ecos/Kcci/News)와 상태를 들고 가는 챗봇(`chat.mjs`)은 이 통합 대상에서 제외했다.

- `GET /series`, `GET /series/{id}?days=N`
- `GET /news/top`
- `GET /shipments`, `GET /shipments/{id}/advisor`
- (별도 유지) `POST /chat` → `lambda/chat.mjs`

`frontend/index.html`은 이 API를 fetch해서 오늘의 뉴스, 선적 의사결정 카드, 카드별 현재값·등락·기간 선택(1주/1개월/1년/3년/전체) 차트를 그린다.

## 선적 의사결정 + AI 어드바이저

수출기업의 선적계획·포워더 견적을 우리 실시간 KCCI 항로 지수·환율과 비교해 **다음 행동(수용/재견적/관찰/견적요청/바이어확인) + 기한 + 신뢰도**를 계산하고,
Bedrock이 그 결과를 근거로 실무 조언을 생성한다. (현재는 `lambda/sample-portfolio.mjs`의 가상 샘플 6건 — 실서비스에선 엑셀 임포트/DB로 대체)

- `lambda/decision.mjs`: 규칙엔진(`decision-v1.0.0`, portpulse-mvp 로직 포팅). 비교가능성 판정 → 예산편차/KCCI편차/납기버퍼/견적유효 계산 → 행동 결정. **순수 함수, 숫자·행동은 여기서만 확정.**
- `lambda/shipment-query.mjs`: 실시간 KCCI 13개 항로(전주 대비 변동)와 환율을 DynamoDB에서 읽어 결정카드를 만들고, `/advisor`에서 Bedrock 호출.
- **AI 역할(적극 추천형)**: 규칙엔진이 정한 행동은 고정하고, Bedrock이 "왜 그런지 + 오늘 할 구체적 행동(재견적 시 얼마 인하 요청 등)"을 제안. 데이터에 없는 수치(미래 운임·정확 ETA)는 생성 금지, "AI 참고 의견" 라벨 필수.

> 참고: 기획서 원안은 "Bedrock은 설명만, 결정 안 함"이지만, 데모 방향으로 **적극 추천형**을 채택함. 근거 기반·면책 표기로 리스크를 관리하되, 운영 전환 시 이 경계를 재검토할 것.

## 플로팅 챗봇 (오른쪽 하단)

`lambda/chat.mjs` (`POST /chat`)가 오늘의 시장 스냅샷(환율·기준금리·KCCI+급등락 항로) + 뉴스 상위 + 샘플 선적 포트폴리오를 컨텍스트로 붙여 Bedrock으로 답한다.
대화 이력은 프론트가 들고 있다가 매 요청에 함께 보내는 방식(서버는 상태 없음, `MAX_HISTORY_TURNS=12`로 컷).

- 아직 **RAG·회사 실제 문서(계약서/사내DB) 연동은 없음** — 시스템 프롬프트에 명시해 회사 고유 정보를 물으면 그렇게 안내하도록 함. 다음 단계로 예정.

## KCCI는 왜 공식 API 대신 엑셀 다운로드 폼을 쓰는가

- 공공데이터포털(data.go.kr)의 "한국해양진흥공사_KCCI지수" 파일데이터는 실제 파일을 갖고 있지 않고 KOBC 자체 페이지로 안내만 한다 — 막다른 길.
- 국가물류통합정보센터(nlic.go.kr)도 KOBC 데이터를 재노출하는 또 다른 웹 UI일 뿐, 별도 API는 없다.
- KOBC 사이트의 "Timeseries & Graphs" 탭 다운로드 버튼이 호출하는 `POST /ebz/shippinginfo/timeseries/excel/download.do?mId=0304000000` (`sDay`/`eDay` 파라미터)가 실질적으로 유일하게 동작하는 방법이며, 인증 없이 전체 이력을 한 번에 반환한다(2026-07-14 실호출로 확인, 184건 전체가 잘리지 않고 옴).
- 응답은 레거시 `.xls`(OLE2)라 `xlsx`(SheetJS)로 파싱한다 — 이 프로젝트에서 유일하게 npm 의존성이 필요한 지점.

## 뉴스 파이프라인

해운·항만·운임 관련 뉴스를 RSS로 수집해 DynamoDB(`portpulse-news`, PK=`date` SK=`articleId`)에 쌓고,
제목 키워드 점수(`lambda/news-score.mjs`)로 그날의 상위 기사만 대시보드에 노출한다.

- **중복 제거(`lambda/news-dedupe.mjs`)**: 같은 사안을 다른 매체가 보도한 기사(제목만 다름)를 Bedrock으로 묶어 대표 1건만 남긴다.
  `news-collector.mjs`가 3시간마다 수집 후 **한 번만** 호출 — 대시보드 조회(`news-query.mjs`)는 이미 계산된 `duplicate` 플래그만 읽어서 매번 Bedrock을 부르지 않는다(비용·응답속도 모두 이득).
- 소스(`lambda/news-sources.mjs`): 해사신문(Shipping Market 카테고리), 해운산업신문, 쉬핑뉴스넷, 해사정보신문 — 전부 인증 불필요 RSS.
  한국해운신문(maritimepress.co.kr)은 RSS가 엉뚱한 사이트 콘텐츠를 반환하는 버그가 확인되어 제외.
- 점수 규칙: 운임/KCCI/SCFI/물동량/체선/공급과잉(3점) > 항만/컨테이너/선사/시황/파업 등(2점) > 해운/물류/수출입(1점).
  Bedrock 등 LLM 기반 판단 대신 규칙 기반으로 시작 — 비용·복잡도 없이 바로 구현 가능하고, 나중에 AI 판단으로 바꾸고 싶으면
  `news-score.mjs`만 교체하면 되는 구조.
- 수집 주기 3시간: 각 피드가 4~6일치 기사를 담고 있어(2026-07-14 확인) 한 번 놓쳐도 안전.
- API: `GET /news/top?date=YYYY-MM-DD&limit=N` (date 기본값은 오늘, KST 기준)

```bash
# 수동 1회 실행
aws lambda invoke --function-name portpulse-news-collector \
  --payload '{}' --cli-binary-format raw-in-base64-out /dev/stdout
```

대시보드 뉴스 목록(`GET /news/top`)은 키워드 점수 상위를 보여주고, **일일 브리핑(아래)** 은 그 후보를 Bedrock이 다시 큐레이션한다.

## 일일 시황 브리핑 (Bedrock → 텔레그램)

`lambda/news-digest.mjs`가 매일 07:00 KST(EventBridge)에 실행되어:
1. 최근 2일 뉴스 후보(키워드 점수>0, ~25건) + 시장 지표(환율 4종·기준금리·KCCI 종합/13개 항로 주간 등락)를 DynamoDB에서 수집
2. Bedrock(Claude, `global.anthropic.claude-opus-4-5-20251101-v1:0` 크로스리전 추론 프로필)에 넘겨
   **중복 뉴스 병합 + 중요 뉴스 3~5개 선별 + 해운 중심 시황 분석**을 JSON으로 생성
3. 뉴스 링크는 코드가 원본 그대로 붙이고(LLM URL 변형 방지), 텔레그램으로 전송

- 텔레그램 토큰/chatId는 Secrets Manager `portpulse/telegram-bot`에 저장(코드·git에 없음). 미설정 시 전송만 건너뛰고 생성 텍스트는 반환.
- Bedrock 아키텍처: DB 정형 데이터 → Lambda가 고정 템플릿으로 조립 → 프롬프트로 생성(상태 없는 텍스트 입출력). 입력이 자체 데이터+고정 프롬프트뿐이라 가드레일/에이전트는 현 단계 불필요.

```bash
aws lambda invoke --function-name portpulse-news-digest \
  --payload '{}' --cli-binary-format raw-in-base64-out /dev/stdout
```

## 프론트엔드 페이지 구조

빌드 도구 없는 순정 멀티페이지(HTML+JS). 공통 스타일/로직은 `common.css`/`common.js` 한 벌로 모아
각 페이지가 `<link>`/`<script src>`로 불러 쓴다(같은 렌더 함수를 `limit`/`compact` 옵션만 다르게 호출).

```text
index.html           홈 — 전 기능 요약 종합 대시보드(AI 추천 요약·뉴스 top5·KCCI 히어로·스케줄 6건·선적 KPI+2건)
recommendation.html  AI 선적 추천 전체(서사+근거+리스크) + 회사 데이터 연결(엑셀 업로드/현재 선적 폼)
market.html          해운 운임 지수 + 환율·금리 전체(range 선택기 포함)
schedule.html        실시간 스케줄 전 항로(항로별 그룹 헤더)
shipments.html        선적 의사결정 카드 전체 + AI 어드바이저
news.html             뉴스 전체 목록(더보기 페이지네이션)
common.css/common.js  공통 스타일·API 호출·차트·챗봇·연결패널 로직
```

각 페이지 상단 `<nav class="pnav">`(공통 `renderNav()`)로 이동. 라이브 API가 아직 없는 엔드포인트
(`/recommendations`, `/company/*`, `/shipments/current`)는 실패 시 조용히 데모 스냅샷으로 폴백한다.

## AI 선적 추천 시스템 (신규 — 대시보드 센터피스)

회사 입력 엑셀 + KCCI 시계열 + 실제 선박 스케줄 + 환율·금리·뉴스를 **Bedrock에 복합 입력**해,
"지금 이 배로 보내라 / 지금은 미뤄라"를 근거와 함께 **서사형 추천**으로 생성한다. `GET /recommendations`.

```text
회사 엑셀(S3) ─┐
KCCI 이력 ─────┤
환율·금리 ─────┼→ ① buildBrief(순수계산: 모든 숫자 확정) → ② Bedrock(서사 생성, JSON 강제) → 대시보드
실제 스케줄 ───┤                                                          └→ DynamoDB 추천이력
뉴스 상위 ─────┘                                                          매일 07:30 재평가 → stance 변하면 텔레그램
```

**① 결정론 계산부(숫자는 여기서만 확정 — Bedrock 창작 금지)**
- `company-input.mjs`: 엑셀 3시트 파싱(정책·현재선적·과거실적). 헤더행 동적 탐색 + 엑셀 시리얼 날짜 변환.
- `route-map.mjs`: `pol`/`pod` 도시명("Busan, KR"/"Hamburg, DE") → UN/LOCODE → KCCI `routeCode` 매핑(다음단계 5번 해소).
- `ocean-services.mjs`: hmm21.com 공개 스케줄에서 수집한 **실제 서비스 루프**(서비스코드·선사·선박풀·소요일). 6항로(북유럽/미주서안/미주동안/동남아/중국).
- `schedule-gen.mjs`: 서비스를 주간 케이던스로 굴려 **과거·미래 항차 생성**. 운임은 `anchorUsd × (ETD주 KCCI지수/현재지수) × 항차지터(±6%, 결정적)` — "과거 대비 지금 얼마나 비싼지"가 데이터에서 자연 발생.
- `market-stats.mjs`: KCCI 백분위(52주/전체)·z점수·12주 추세·yoy·국면(ELEVATED/RISING 등).
- `company-stats.mjs`: 자사 시장연동 공정가(최근 실거래 × 그간 지수변화), 포워더 성적표(지연·견적초과·정시율), 예산 맥락.
- `recommend-engine.mjs`: 위를 합쳐 브리프 + 납기·버퍼로 **탑승가능 항차 필터** + 타이밍 판독(부드러운 휴리스틱).

**② Bedrock 생성부**
- `recommend.mjs`: 브리프+뉴스를 프롬프트로 조립 → Converse → **JSON 스키마 강제**(verdict/stance/narrative/keyNumbers/actions/risks/watchTriggers) → parse 검증 실패 시 1회 자가수정 재시도 → DynamoDB 저장.
- `recommend-monitor.mjs`: 매일 07:30 KST 재평가. stance가 바뀌면(예: 관망→지금예약) 텔레그램 알림 — 추천을 살아있게 만드는 루프.

**③ 회사 데이터 입력 경로 2종** (`company-upload.mjs`)
- 엑셀 업로드: 브라우저가 presigned S3 URL로 직접 PUT(Lambda가 파일 바이너리를 안 거침). 정책·과거실적·(선택)현재선적을 담는다.
- 현재 선적 폼(`POST /shipments/current`): **견적/추천에 필요한 화물 정보만** 받는다 — 출발지·도착지·화물준비일·납기일·장비·수량·화물종류·예산·인코텀즈 등. 주문번호·선적ID·고객사명 같은 사내 참조번호는 견적을 받는 데 필요한 정보가 아니라서 폼에 없고, `shipmentId`는 저장 시 자동 채번(`CUR-YYYYMMDD-HHmm`)한다. 우선순위는 **UI 폼 제출본 > 엑셀 시트값 > 데모 폴백**.

**AWS 구성(CDK)**: S3(`portpulse-company-uploads` 회사엑셀+현재선적 업로드, CORS 설정) · DynamoDB(`portpulse-recommendations` 이력) ·
API 라우트 `/recommendations`, `/company/upload-url`, `/company/status`, `/shipments/current` (기존 `api.mjs` 통합 Lambda가 위임) · EventBridge 일별 재평가 룰.

**로컬 검증/데모**
```bash
node src/gen-market-history.mjs   # KCCI 합성 시계열(실측 앵커 기반) → data/kcci-history.json
node src/local-recommend.mjs      # 엑셀→브리프 end-to-end 계산 출력(Bedrock 없이 결정론부 전부)
node src/gen-reco-demo.mjs        # 실 브리프 숫자로 추천 데모 스냅샷 → frontend/recommendation-demo.json
```
프론트는 `/recommendations` 라이브 API가 있으면 그걸, 없으면 `recommendation-demo.json`을 폴백 렌더(동일 스키마).
운임(priceUSD)은 합성 참고가이며 스케줄(선사·선박·ETD/ETA)은 실측이다 — 데모 성격을 화면·데이터에 명시.

> 데모 회사(GreenWave Korea, 부산→함부르크 40HC×2, 예산 $9,000)로 돌리면: 북유럽 KCCI가 52주 백분위 96(역사적 고점)·상승 중이고,
> 납기(10/10)를 지키는 직항이 ONE TRIBUTE 단 1편(버퍼 3일)뿐이라 "관망 불가·지금 예약" + 신뢰도 높은 포워더(Bluewave/Maersk) 선택까지 추천이 나온다.

## 다음 단계 (미구현 — 결정/작업 필요)

1. **SCFI(상하이 컨테이너 운임지수) 수집** — 뉴스에 자주 인용되는 글로벌 대표 지표지만 상하이해운거래소가 유료/비공개라 무료 시계열 소스가 없음. 대안: (a) 뉴스 본문에서 수치 파싱, (b) 유료 API 결정 필요. **보류(소스 결정 대기)**.
2. **국제 유가(WTI/브렌트) 수집** — 벙커유·운송비 선행지표. ECOS엔 깔끔한 일별 소스가 없어 별도 무료 소스(EIA 등) 조사 필요. **보류(소스 결정 대기)**.
3. 해양수산부 화물운임공표정보 API 수집기 (`apis.data.go.kr/1192000/CychgFrghtOut3/Info3`, data.go.kr 키 필요)
4. 노출됐던 텔레그램 봇 토큰 재발급(@BotFather `/revoke`) 후 Secrets Manager 갱신 — 코드/배포 변경 불필요.
5. **회사 입력 엑셀 템플릿(`PortPulse_Company_Input_Template.xlsx`) 연동** — 검토 결과 아래 항목 필요:
   - 견적(Quote) 시트가 템플릿에 없음(의도적 제외). `decision.mjs`의 KCCI 비교가 작동하려면 최소한의 비용 라인(해상운임 vs 로컬비용 구분)이 필요 — 별도 견적 입력 방식 설계 필요.
   - `pol`/`pod`가 "Busan, KR" 같은 도시명 문자열 — UN/LOCODE(KRPUS 등) → KCCI `routeCode` 매핑 테이블 신규 구축 필요(~20~30개 주요 항만).
   - `bookingController` 필드가 없고 `freightPayer`(EXPORTER/BUYER/THIRD_PARTY)만 있음 — 근사치로 대체하거나 컬럼 추가 검토.
   - `1_Company_Policy`의 `minDeliveryBufferDays`/`budgetWarningPct`/`preferredMaxTransshipments`는 지금 `decision.mjs`에 하드코딩된 임계값(3일/5%/8%)과 정확히 대응 — 회사별 설정으로 파라미터화하면 좋음.
