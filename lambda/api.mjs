// 읽기/쓰기 API 통합 라우터.
// MarketQuery(query.mjs)+NewsQuery(news-query.mjs)+ShipmentQuery(shipment-query.mjs)+
// Recommend(recommend.mjs)+CompanyUpload(company-upload.mjs)를 한 Lambda로 합쳐서 관리 포인트를 줄인다
// — 전부 "API Gateway가 부르면 DB/S3 읽거나 쓰고 응답"하는 동일한 트리거·패턴이라 합쳐도 안전하다
// (수집기처럼 스케줄·외부 API가 다른 것들은 분리 유지). 각 모듈의 handler는 그대로 두고 경로로만 위임한다.
// 주의: /shipments/current는 companyUpload가 처리 — 더 구체적인 경로라 shipments 접두 검사보다 먼저 확인한다.
import { handler as marketHandler } from "./query.mjs";
import { handler as newsHandler } from "./news-query.mjs";
import { handler as shipmentHandler } from "./shipment-query.mjs";
import { handler as recommendHandler } from "./recommend.mjs";
import { handler as companyUploadHandler } from "./company-upload.mjs";

export async function handler(event) {
  const path = event.rawPath || event.requestContext?.http?.path || "";
  if (path.startsWith("/news")) return newsHandler(event);
  if (path.startsWith("/recommendations")) return recommendHandler(event);
  if (path.startsWith("/company") || path === "/shipments/current") return companyUploadHandler(event);
  if (path.startsWith("/shipments")) return shipmentHandler(event);
  return marketHandler(event);
}
