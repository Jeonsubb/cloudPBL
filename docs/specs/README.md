# PortPulse 서비스 명세 문서

이 디렉터리는 PortPulse MVP 구현 전 기획/설계 명세를 정리한다.

## 문서 순서

| 순서 | 문서 | 설명 |
| --- | --- | --- |
| 02 | `02_user-flow.md` | 최초 등록, 매일 브리핑, 위험 알림 플로우 |
| 03 | `03_feature-spec.md` | 화면별 기능과 MVP 우선순위 |
| 04 | `04_data-spec.md` | 공개 데이터, 회사별 데이터, 분석 데이터 구조 |
| 06 | `06_api-spec.md` | 프론트엔드와 백엔드 API 계약 |
| 07 | `07_aws-infra-spec.md` | AWS 서비스별 역할과 MVP/최종 인프라 구조 |

## 프로토타입

HTML 화면 목업은 `../prototypes` 디렉터리에 있다.

| 파일 | 설명 |
| --- | --- |
| `portpulse-screen-wireframes.html` | 8개 화면 단위 와이어프레임 |
| `portpulse-web-mockup.html` | 초기 통합 대시보드 목업 |

## 현재 설계 방향

PortPulse는 로그인 화면으로 바로 시작하지 않는다. 먼저 공개 랜딩/시장 대시보드에서 KCCI, SCFI, 환율, 뉴스 이벤트와 샘플 부킹 추천을 보여준다.

로그인 후에는 회사별 선적/견적/예산 데이터와 공개 시장 데이터를 결합해 개인화된 부킹 타이밍 추천을 생성한다.

AWS 최종 구조는 S3, CloudFront, API Gateway, Lambda, Aurora PostgreSQL, EventBridge Scheduler, Amazon Bedrock, Push 알림으로 구성한다. MVP에서는 샘플 데이터 또는 로컬 DB로 시작하되, API와 데이터 구조는 Aurora 이전이 가능하도록 유지한다.
