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
lambda/     collector.mjs+ecos.mjs+series.mjs(ECOS: 환율4·기준금리) / kcci-collector.mjs+kcci.mjs+kcci-series.mjs(KCCI)
            news-collector.mjs+news-sources.mjs+news-score.mjs(뉴스) / news-query.mjs(뉴스 조회)
            news-digest.mjs(일일 브리핑: Bedrock→텔레그램)
            market-series.mjs(조회 API용 통합 레지스트리) / query.mjs(시장 데이터 조회 핸들러)
            — Lambda 배포 자산. npm 의존성: xlsx(KCCI 파싱), @aws-sdk/client-bedrock-runtime·secrets-manager(브리핑)
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

`infra/lib/market-stack.mjs`가 HTTP API(`GET /series`, `GET /series/{id}?days=N`, `GET /news/top`)와 조회 전용 Lambda
(`lambda/query.mjs`, `lambda/news-query.mjs`)를 배포한다.
`frontend/index.html`은 이 API를 fetch해서 오늘의 뉴스 목록과 카드별 현재값·등락·기간 선택(1주/1개월/1년/3년/전체) 차트를 그린다.

## KCCI는 왜 공식 API 대신 엑셀 다운로드 폼을 쓰는가

- 공공데이터포털(data.go.kr)의 "한국해양진흥공사_KCCI지수" 파일데이터는 실제 파일을 갖고 있지 않고 KOBC 자체 페이지로 안내만 한다 — 막다른 길.
- 국가물류통합정보센터(nlic.go.kr)도 KOBC 데이터를 재노출하는 또 다른 웹 UI일 뿐, 별도 API는 없다.
- KOBC 사이트의 "Timeseries & Graphs" 탭 다운로드 버튼이 호출하는 `POST /ebz/shippinginfo/timeseries/excel/download.do?mId=0304000000` (`sDay`/`eDay` 파라미터)가 실질적으로 유일하게 동작하는 방법이며, 인증 없이 전체 이력을 한 번에 반환한다(2026-07-14 실호출로 확인, 184건 전체가 잘리지 않고 옴).
- 응답은 레거시 `.xls`(OLE2)라 `xlsx`(SheetJS)로 파싱한다 — 이 프로젝트에서 유일하게 npm 의존성이 필요한 지점.

## 뉴스 파이프라인

해운·항만·운임 관련 뉴스를 RSS로 수집해 DynamoDB(`portpulse-news`, PK=`date` SK=`articleId`)에 쌓고,
제목 키워드 점수(`lambda/news-score.mjs`)로 그날의 상위 기사만 대시보드에 노출한다.

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

## 다음 단계 (미구현 — 결정/작업 필요)

1. **SCFI(상하이 컨테이너 운임지수) 수집** — 뉴스에 자주 인용되는 글로벌 대표 지표지만 상하이해운거래소가 유료/비공개라 무료 시계열 소스가 없음. 대안: (a) 뉴스 본문에서 수치 파싱, (b) 유료 API 결정 필요. **보류(소스 결정 대기)**.
2. **국제 유가(WTI/브렌트) 수집** — 벙커유·운송비 선행지표. ECOS엔 깔끔한 일별 소스가 없어 별도 무료 소스(EIA 등) 조사 필요. **보류(소스 결정 대기)**.
3. 해양수산부 화물운임공표정보 API 수집기 (`apis.data.go.kr/1192000/CychgFrghtOut3/Info3`, data.go.kr 키 필요)
4. 노출됐던 텔레그램 봇 토큰 재발급(@BotFather `/revoke`) 후 Secrets Manager 갱신 — 코드/배포 변경 불필요.
