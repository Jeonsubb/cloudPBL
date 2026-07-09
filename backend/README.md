# PortPulse Backend

AWS Lambda 기반 백엔드 함수 모음입니다.

## 주요 Lambda

| 함수 | 역할 |
| --- | --- |
| upload_url | S3 Presigned URL 발급 |
| shipment | 선적 등록/조회 |
| parse_document | 업로드 문서 파싱·정규화 |
| ingest_market | 시장 데이터 수집 배치 |
| risk | 룰 기반 리스크 계산 |
| chat | Bedrock 챗봇/설명 생성 |
| alert | 위험 선적 알림 발송 |

## 실행 준비

```bash
python -m venv .venv
pip install -r requirements.txt
```
