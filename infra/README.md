# PortPulse Infra

AWS SAM 기반 인프라 초안입니다.

## 포함된 리소스

- API Gateway HTTP API
- Lambda 함수
- S3 업로드 버킷
- S3 시장 원문 데이터 버킷
- Cognito User Pool
- EventBridge Scheduler

## 배포

```bash
sam build
sam deploy --guided
```

## 주의

- Aurora PostgreSQL은 MVP에서 비용과 VPC 설정 부담이 있어 `database/schema.sql`로 스키마를 먼저 제공합니다.
- 실제 배포 시에는 Aurora Serverless v2 또는 RDS PostgreSQL을 연결하면 됩니다.
- Bedrock 모델 사용 전 AWS 콘솔에서 모델 접근 권한을 허용해야 합니다.
