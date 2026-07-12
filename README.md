# PortPulse MVP

부산 수출 중소기업이 최신 해양·물류 뉴스, 환율·금리, 부산발·글로벌 운임과 자사 선적·견적을 한 화면에서 확인하고 다음 행동을 결정하는 웹 MVP입니다.

## 포함 기능

- 시장 중심 첫 화면: 공식 뉴스, ECOS 환율·금리 그래프, KCCI·FBX·SCFI 상태
- 버전이 있는 `/api/dashboard` 통합 계약과 소스별 독립 폴백
- ECOS USD/KRW·기준금리·국고채 3년 연동
- KOBC KCCI 공식 화면 최신 스냅샷 연동과 항로 그래프
- 해양수산부·관세청 공식 RSS 최신순 집계
- Freightos FBX 공개 스냅샷과 SCFI 라이선스 보호 카드
- 선적 등록 Wizard와 상세 근거 Drawer
- 견적 Header/Charge Line 정규화와 합계 대사
- 부산발 40ft Dry FCL에 한정한 KCCI 직접 비교
- Frankfurter v2에서 ECB 환율을 조회하는 `/api/market`
- 표준 Excel/CSV 브라우저 파싱·검증·매핑 미리보기
- 결정 로그 CSV와 인쇄 가능한 주간 브리핑
- `/api/chat` 기반 결정론적 근거형 챗봇
- 데스크톱·태블릿·모바일 반응형 UI

## 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

기본 주소는 `http://localhost:3000`입니다.

ECOS 운영 인증키는 선택 사항입니다. 키가 없으면 공식 `sample` 키의 최근 10개 관측만 사용하며 화면에 `SAMPLE`로 표시합니다.

```bash
cp .env.example .env.local
# .env.local의 ECOS_API_KEY 입력
```

검증:

```bash
npm run build
npm test
npm run lint
```

## 데이터 원칙

- 회사, 선적, 견적, 이력은 `SYNTHETIC` 목업입니다.
- 환율·금리, KCCI, FBX, 공식 뉴스는 `MARKET_OBSERVED`로 분리합니다.
- 데이터마다 `observedAt`과 `fetchedAt`을 분리하고 `LIVE`·`SAMPLE`·`FALLBACK`·`LICENSE_REQUIRED` 상태를 숨기지 않습니다.
- KCCI는 공공데이터 이용범위와 공식 최신 화면을 근거로 수집하며 종합 PT와 항로 USD/FEU를 같은 축에 섞지 않습니다.
- FBX 공개 스냅샷은 Freightos 출처와 원문 링크를 유지합니다. 자동 수집·이력·AI 입력은 별도 조건 확인 전 차단합니다.
- SCFI는 비상업 목적이어도 공개 재배포가 자동 허용되지 않아 숫자 대신 공식 원문과 권한 상태만 제공합니다.
- 뉴스는 해양수산부·관세청 RSS의 제목·발행처·발행시각·원문 링크만 사용하며 본문은 저장·재노출하지 않습니다.
- 20ft, LCL, Reefer, DG, OOG, Buyer Booking은 KCCI 절대금액 비교에서 제외합니다.

## 로컬 MVP와 운영 AWS의 차이

로컬 MVP는 AWS와 같은 데이터 계약·공급자 경계를 사용하지만 AWS SDK에 결합하지 않습니다. 운영 구현은 API Route를 API Gateway/Lambda로, 주기 수집을 EventBridge/Lambda로 옮기고 같은 JSON 계약을 유지합니다.

로컬 파일 파싱은 브라우저 안에서만 실행되며 악성코드 검사를 수행하지 않습니다. 운영 구현은 기획된 AWS 흐름을 따릅니다.

`Presigned S3 Upload → Quarantine → GuardDuty 검사 → Step Functions 검증 → 사용자 승인 → Aurora PostgreSQL`

챗봇 역시 현재는 규칙엔진 결과를 설명하는 결정론적 응답입니다. 운영 단계에서는 같은 JSON 계약을 Amazon Bedrock Converse API에 연결하고, 숫자 계산과 최종 판정은 계속 규칙엔진이 담당합니다.

## 주요 파일

- `app/portpulse-app.tsx`: 전체 제품 UI와 상호작용
- `app/api/market/route.ts`: 시장 데이터 API
- `app/api/dashboard/route.ts`: 첫 화면 통합 데이터 API
- `app/api/chat/route.ts`: 근거형 챗봇 API
- `lib/dashboard-contract.ts`: AWS 전환에도 유지할 대시보드 계약과 안전 폴백
- `lib/dashboard-providers.ts`: ECOS·KCCI·공식 RSS 공급자 어댑터
- `lib/portpulse.ts`: 데이터 모델, 목업, 판정 로직
- `lib/market-providers.ts`: 환율 연동과 폴백
- `lib/import-workbook.ts`: Excel/CSV 검증
- `public/portpulse-import-template.xlsx`: 표준 입력 템플릿

GitHub push와 운영 배포는 별도 요청이 있을 때 수행합니다.
