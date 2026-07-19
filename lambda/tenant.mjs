// 멀티테넌시 공용 — 회사 식별과 회사별 저장 경로.
// companyId = Cognito 사용자 sub(JWT claims). authorizer 없는(무인/로컬) 호출은 "demo"로 폴백.
export const DEFAULT_COMPANY_ID = "demo";

// HTTP API(JWT authorizer) 이벤트에서 companyId 추출.
export function companyIdFromEvent(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  return claims?.sub || DEFAULT_COMPANY_ID;
}

// 회사별 S3 키.
export const companyExcelKey = (companyId) => `companies/${companyId}/company-input.xlsx`;
export const currentShipmentKey = (companyId) => `companies/${companyId}/current-shipment.json`;
export const companyPrefix = (companyId) => `companies/${companyId}/`;

// 추천 이력 DDB PK 네임스페이스 — 회사간 격리.
export const recoPartitionKey = (companyId, shipmentId) => `${companyId}#${shipmentId}`;
