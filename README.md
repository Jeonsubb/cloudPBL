# PortPulse

부산항 수출입 중소기업을 위한 **AI 선적 리스크 인텔리전스 서비스**입니다.

사용자가 선적 일정과 포워더 견적서/엑셀 파일을 등록하면, PortPulse가 KCCI·SCFI·환율·수출입 통계·뉴스 데이터를 결합해 비용 상승, 견적 만료, 납기 지연, 부킹 위험을 판단하고 챗봇/리포트/알림 형태로 설명합니다.

## 핵심 사용자

- 부산·경남 지역 중소 수출 제조기업의 무역/물류 담당자
- 소규모 포워더 운영 담당자

## MVP 핵심 기능

1. 로그인 및 회사별 데이터 분리
2. 선적 일정 등록
3. 견적서/엑셀 원본 업로드
4. 업로드 문서 파싱 및 정규화
5. 시장 데이터 수집 배치
6. 룰 기반 선적 리스크 점수 계산
7. Amazon Bedrock 기반 챗봇/리포트 생성
8. 위험 선적 알림 발송

## 저장소 구조

```text
cloudPBL/
  frontend/              # React 웹 대시보드/챗봇
  backend/               # Lambda 백엔드 함수
  infra/                 # AWS SAM/CloudFormation 인프라 템플릿
  docs/                  # 아키텍처, 역할분담, API, 데이터 모델 문서
```

## 빠른 시작

### 1. 백엔드 로컬 준비

```bash
cd backend
python -m venv .venv
pip install -r requirements.txt
```

### 2. 프론트엔드 로컬 준비

```bash
cd frontend
npm install
npm run dev
```

### 3. AWS 배포 준비

```bash
cd infra
sam build
sam deploy --guided
```

> 실제 배포 전에는 AWS 계정, Bedrock 모델 접근 권한, S3 버킷명, Cognito 설정, 알림 토큰을 먼저 준비해야 합니다.

## 주요 문서

- [서비스 아키텍처](docs/architecture.md)
- [기능별 역할분담](docs/role-assignment.md)
- [4~6일 개발계획](docs/development-plan.md)
- [API 명세](docs/api-spec.md)
- [데이터 모델](docs/data-model.md)
