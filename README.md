# PortPulse

부산 수출 중소기업을 위한 해운 부킹 타이밍 리스크 분석 서비스입니다. 선적 건을 등록하면 운임 지수, 환율, 뉴스, 항만/물류 지표를 바탕으로 현재 부킹 리스크를 보여주고, Amazon Bedrock 기반 챗봇과 알림 기능을 제공합니다.

## 주요 기능

- 오늘의 해운 리스크 대시보드
- 선적 건 등록 및 조회
- 선적 건별 AI 리스크 분석
- 부킹 시나리오 비교 화면
- 시장 뉴스와 리스크 알림 조회
- Amazon Bedrock 기반 물류 챗봇
- AWS Lambda 스케줄 기반 시장 데이터 수집
- Telegram 일일 브리핑 알림

## 기술 스택

- Frontend: React, Vite, React Router, lucide-react
- Backend: Python Lambda, API Gateway, Amazon Bedrock
- Database: Aurora Serverless v2 PostgreSQL, RDS Data API
- Infra: AWS SAM, CloudFormation, S3, CloudFront, EventBridge Scheduler

## 프로젝트 구조

```text
.
├── src/                         # React 프론트엔드
│   ├── components/              # 공통 UI 컴포넌트
│   ├── pages/                   # 화면 단위 컴포넌트
│   ├── services/api.js          # 백엔드 API 호출 모듈
│   ├── App.jsx                  # 라우팅 구성
│   └── main.jsx                 # React 진입점
├── public/                      # 정적 아이콘 리소스
├── backend/                     # Lambda 백엔드 코드
│   ├── lambda/
│   │   ├── admin/               # DB 초기화 Lambda
│   │   ├── api/                 # API Gateway용 Lambda 핸들러
│   │   ├── collector/           # 시장 데이터 수집 Lambda
│   │   └── notifier/            # Telegram 알림 Lambda
│   ├── bedrock/agents/          # Bedrock 에이전트 설정/프롬프트 지식 문서
│   ├── shared/                  # DB, 응답 포맷 등 공통 모듈
│   └── requirements.txt         # Python 의존성
├── infra/                       # AWS SAM 배포 구성
│   ├── template.yaml            # AWS 리소스 정의
│   ├── deploy.sh                # 빌드/배포 자동화 스크립트
│   └── configure-secrets.sh     # 로컬 배포용 비밀값 저장 스크립트
├── .env.example                 # 프론트엔드 환경변수 예시
├── package.json                 # 프론트엔드 스크립트/의존성
└── vite.config.js               # Vite 설정
```

## 프론트엔드 화면 구성

| 경로 | 파일 | 설명 |
| --- | --- | --- |
| `/` | `src/pages/Home.jsx` | 시장 지표, 뉴스, 최근 선적 건을 보여주는 대시보드 |
| `/register` | `src/pages/ShipmentRegistration.jsx` | 선적 조건 입력 및 등록 |
| `/analysis` | `src/pages/RiskAnalysis.jsx` | 선적 건 기반 AI 리스크 분석 |
| `/scenario` | `src/pages/ScenarioComparison.jsx` | 부킹 시점/조건별 리스크 비교 |
| `/alerts` | `src/pages/Alerts.jsx` | 리스크 알림과 일일 브리핑 조회 |

프론트엔드는 `src/services/api.js`를 통해 백엔드 API를 호출합니다. API 기본 주소는 `VITE_API_URL` 환경변수로 지정하며, 값이 없으면 `/api`를 사용합니다.

## 백엔드 API

SAM 템플릿 기준 주요 API는 다음과 같습니다.

| Method | Path | Lambda | 용도 |
| --- | --- | --- | --- |
| `GET` | `/api/market-data` | `backend/lambda/api/market_data.py` | KCCI, SCFI, 환율 등 시장 데이터 조회 |
| `GET` | `/api/news` | `backend/lambda/api/news.py` | 수집된 해운/물류 뉴스 조회 |
| `GET` | `/api/shipments` | `backend/lambda/api/shipments.py` | 등록된 선적 건 목록 조회 |
| `POST` | `/api/shipments` | `backend/lambda/api/shipments.py` | 선적 건 등록 |
| `GET` | `/api/risk-analysis/{id}` | `backend/lambda/api/risk_analysis.py` | 특정 선적 건 리스크 분석 |
| `POST` | `/api/chat` | `backend/lambda/api/chat.py` | Bedrock 챗봇 메시지 처리 |
| `GET` | `/api/alerts` | `backend/lambda/api/alerts.py` | 알림 목록 조회 |

## 로컬 실행

### 1. Node 의존성 설치

```bash
npm install
```

### 2. 프론트엔드 환경변수 설정

필요하면 `.env.example`을 참고해 `.env`를 만듭니다.

```bash
VITE_API_URL=https://배포된-api-url/dev
```

로컬에서 화면만 확인할 때는 `VITE_API_URL`을 비워도 됩니다. 단, 백엔드 API가 없으면 대시보드/등록/분석 데이터 요청은 실패할 수 있습니다.

### 3. 개발 서버 실행

```bash
npm run dev
```

### 4. 빌드 확인

```bash
npm run build
```

### 5. 린트

```bash
npm run lint
```

## 백엔드 개발 메모

Python Lambda 코드는 `backend/` 아래에 있습니다. 필요한 패키지는 `backend/requirements.txt`에 정의되어 있습니다.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

백엔드는 Aurora PostgreSQL을 RDS Data API로 호출합니다. 주요 환경변수는 다음과 같습니다.

```bash
AWS_REGION=ap-northeast-2
DB_CLUSTER_ARN=arn:aws:rds:ap-northeast-2:ACCOUNT_ID:cluster:portpulse-db
DB_SECRET_ARN=arn:aws:secretsmanager:ap-northeast-2:ACCOUNT_ID:secret:portpulse-db-creds
DB_NAME=portpulse
USE_DATA_API=true
PUBLIC_DATA_API_KEY=공공데이터포털_API_KEY
ECOS_API_KEY=한국은행_ECOS_API_KEY
BEDROCK_REGION=ap-northeast-2
BEDROCK_MODEL_ID=apac.anthropic.claude-sonnet-4-20250514-v1:0
```

DB 스키마 초기화는 배포 후 `backend/lambda/admin/init_db.py` Lambda가 수행합니다. `infra/deploy.sh`는 배포 후 이 Lambda를 자동 호출합니다.

## AWS 배포

배포에는 다음 도구와 권한이 필요합니다.

- Node.js, npm
- AWS CLI
- AWS SAM CLI
- AWS 자격 증명
- 공공데이터포털 API 키
- 한국은행 ECOS API 키
- Bedrock 모델 호출 권한

### 1. 배포용 비밀값 저장

```bash
./infra/configure-secrets.sh
```

이 스크립트는 `infra/.env.deploy`에 로컬 배포용 값을 저장합니다. 이 파일은 Git에 올리면 안 됩니다.

직접 환경변수로 설정해도 됩니다.

```bash
export PUBLIC_DATA_API_KEY='공공데이터포털-키'
export ECOS_API_KEY='한국은행-ECOS-키'
export AWS_PROFILE='portpulse'
export AWS_REGION='ap-northeast-2'
export BEDROCK_REGION='ap-northeast-2'
export BEDROCK_MODEL_ID='apac.anthropic.claude-sonnet-4-20250514-v1:0'
export ENABLE_SCHEDULES='false'
```

### 2. dev 배포

```bash
./infra/deploy.sh dev
```

배포 스크립트는 다음 순서로 동작합니다.

1. 프론트엔드 빌드
2. SAM 빌드
3. CloudFormation 배포
4. DB 스키마 초기화 Lambda 호출
5. `dist/`를 S3에 업로드
6. CloudFront 캐시 무효화
7. 배포 결과 출력

최초 배포나 테스트 중에는 `ENABLE_SCHEDULES=false`를 유지하는 것을 권장합니다. Lambda 수동 검증이 끝난 뒤 스케줄 수집이 필요하면 `ENABLE_SCHEDULES=true`로 재배포합니다.

### 3. Telegram 알림 사용

Telegram 일일 브리핑을 켜려면 다음 값을 추가합니다.

```bash
export ENABLE_NOTIFICATIONS='true'
export TELEGRAM_BOT_TOKEN='텔레그램-봇-토큰'
export TELEGRAM_CHAT_ID='텔레그램-채팅-ID'
```

알림은 `ENABLE_SCHEDULES=true`일 때만 EventBridge 스케줄로 실행됩니다.

## Git에 올리면 안 되는 파일

다음 파일/폴더는 공유하거나 커밋하지 않습니다.

- `.env`
- `.env.*`
- `infra/.env.deploy`
- `node_modules/`
- `dist/`
- `infra/.aws-sam/`
- `backend/**/__pycache__/`
- AWS 자격 증명, API 키, Telegram 토큰이 들어간 파일

현재 `.gitignore`는 `.env`, `node_modules`, `dist` 등을 제외합니다. 배포 산출물과 Python 캐시까지 확실히 제외하려면 `.gitignore`에 해당 패턴을 추가해야 합니다.

## 초기 세팅리스트

1. `npm install`
2. `.env.example`을 참고해 필요하면 `.env` 작성
3. `npm run dev`로 프론트 화면 확인
4. 실제 API 연동이 필요하면 AWS 배포 후 `VITE_API_URL` 설정
5. 배포 담당자는 `./infra/configure-secrets.sh` 실행 후 `./infra/deploy.sh dev`

## 참고

- 로컬 프론트만 실행하면 API 데이터가 없을 수 있습니다.
- `ScenarioComparison` 화면은 현재 정적 예시 데이터 중심입니다.
- Bedrock 모델 ID는 계정/리전에 따라 호출 가능한 값이 다를 수 있으므로 배포 전에 AWS 콘솔에서 사용 가능 여부를 확인해야 합니다.
