// 조회 API(query.mjs)가 쓰는 통합 지표 레지스트리.
// 각 수집기(ecos.mjs/kcci.mjs)는 자기 소스에 필요한 상세 필드(statCode 등)를 따로 갖고,
// 여기서는 API 응답과 DynamoDB 파티션 키 접두어(prefix)에 필요한 공통 필드만 모은다.
import { SERIES as ECOS_SERIES } from "./series.mjs";
import { KCCI_SERIES } from "./kcci-series.mjs";

export const SERIES = [
  ...KCCI_SERIES.filter((s) => s.featured).map(({ id, label, unit, prefix, source }) => ({
    id,
    label,
    unit,
    prefix,
    source,
    category: "shipping",
  })),
  ...ECOS_SERIES.map(({ id, label, unit, prefix, statCode, itemCode, category }) => ({
    id,
    label,
    unit,
    prefix,
    source: `ECOS ${statCode}/${itemCode}`,
    category,
  })),
];
