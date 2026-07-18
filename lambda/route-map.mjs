// 회사 엑셀의 pol/pod는 "Busan, KR" / "Hamburg, DE" 같은 도시명 문자열이다.
// 이를 UN/LOCODE와 KCCI 세부항로 코드(kcci-series.mjs)로 매핑한다.
// README 다음단계 5번(도시명→routeCode 매핑 테이블 구축) 해소분.
// 데모 범위: 부산 출발 + 주요 목적항 위주. 실서비스에선 전체 LOCODE 사전으로 확장.

// UN/LOCODE 별칭 → 표준 LOCODE
const PORT_ALIASES = {
  "busan": "KRPUS", "busan, kr": "KRPUS", "부산": "KRPUS", "krpus": "KRPUS",
  "hamburg": "DEHAM", "hamburg, de": "DEHAM", "deham": "DEHAM",
  "rotterdam": "NLRTM", "rotterdam, nl": "NLRTM", "nlrtm": "NLRTM",
  "long beach": "USLGB", "long beach, us": "USLGB", "uslgb": "USLGB",
  "los angeles": "USLAX", "los angeles, us": "USLAX", "uslax": "USLAX",
  "new york": "USNYC", "new york, us": "USNYC", "usnyc": "USNYC",
  "singapore": "SGSIN", "singapore, sg": "SGSIN", "sgsin": "SGSIN",
  "shanghai": "CNSHA", "shanghai, cn": "CNSHA", "cnsha": "CNSHA",
  "tokyo": "JPTYO", "tokyo, jp": "JPTYO", "jptyo": "JPTYO",
  "barcelona": "ESBCN", "barcelona, es": "ESBCN", "esbcn": "ESBCN",
  "jebel ali": "AEJEA", "jebel ali, ae": "AEJEA", "aejea": "AEJEA",
  "sydney": "AUSYD", "sydney, au": "AUSYD", "ausyd": "AUSYD",
  "santos": "BRSSZ", "santos, br": "BRSSZ", "brssz": "BRSSZ",
  "manzanillo": "MXZLO", "manzanillo, mx": "MXZLO", "mxzlo": "MXZLO",
  "durban": "ZADUR", "durban, za": "ZADUR", "zadur": "ZADUR",
  "lagos": "NGLOS", "lagos, ng": "NGLOS", "nglos": "NGLOS",
  "tema": "GHTEM", "tema, gh": "GHTEM", "ghtem": "GHTEM",
};

// 목적항 LOCODE → KCCI 세부항로 코드
const POD_TO_ROUTE = {
  DEHAM: "KNEI", NLRTM: "KNEI",          // 북유럽
  USLGB: "KUWI", USLAX: "KUWI",          // 미주서안
  USNYC: "KUEI",                          // 미주동안
  SGSIN: "KSEI",                          // 동남아
  CNSHA: "KCI",                           // 중국
  JPTYO: "KJI",                           // 일본
  ESBCN: "KMDI",                          // 지중해
  AEJEA: "KMEI",                          // 중동
  AUSYD: "KAUI",                          // 오세아니아
  BRSSZ: "KLEI",                          // 중남미동안
  MXZLO: "KLWI",                          // 중남미서안
  ZADUR: "KSAI",                          // 남아공(ShipDa 스케줄 커버 없음 — synthetic 폴백)
  NGLOS: "KWAI", GHTEM: "KWAI",           // 서아공(ShipDa 스케줄 커버 없음 — synthetic 폴백)
};

const LOCODE_LABEL = {
  KRPUS: { name: "Busan", cc: "KR" },
  DEHAM: { name: "Hamburg", cc: "DE" }, NLRTM: { name: "Rotterdam", cc: "NL" },
  USLGB: { name: "Long Beach", cc: "US" }, USLAX: { name: "Los Angeles", cc: "US" },
  USNYC: { name: "New York", cc: "US" }, SGSIN: { name: "Singapore", cc: "SG" },
  CNSHA: { name: "Shanghai", cc: "CN" }, JPTYO: { name: "Tokyo", cc: "JP" },
  ESBCN: { name: "Barcelona", cc: "ES" }, AEJEA: { name: "Jebel Ali", cc: "AE" },
  AUSYD: { name: "Sydney", cc: "AU" }, BRSSZ: { name: "Santos", cc: "BR" },
  MXZLO: { name: "Manzanillo", cc: "MX" }, ZADUR: { name: "Durban", cc: "ZA" },
  NGLOS: { name: "Lagos", cc: "NG" }, GHTEM: { name: "Tema", cc: "GH" },
};

const ROUTE_LABEL = {
  KUWI: "미주서안", KUEI: "미주동안", KNEI: "북유럽", KMDI: "지중해",
  KSEI: "동남아", KCI: "중국", KJI: "일본",
  KMEI: "중동", KAUI: "오세아니아", KLEI: "중남미동안", KLWI: "중남미서안",
  KSAI: "남아공", KWAI: "서아공",
};

export function toLocode(cityOrCode) {
  if (!cityOrCode) return null;
  const key = String(cityOrCode).trim().toLowerCase();
  if (PORT_ALIASES[key]) return PORT_ALIASES[key];
  // "City, CC" 형태에서 도시만 재시도
  const city = key.split(",")[0].trim();
  return PORT_ALIASES[city] ?? (key.length === 5 ? key.toUpperCase() : null);
}

export function resolveRoute(polRaw, podRaw) {
  const pol = toLocode(polRaw);
  const pod = toLocode(podRaw);
  const routeCode = pod ? POD_TO_ROUTE[pod] ?? null : null;
  return {
    pol, pod,
    polLabel: pol ? LOCODE_LABEL[pol] : null,
    podLabel: pod ? LOCODE_LABEL[pod] : null,
    routeCode,
    routeLabel: routeCode ? ROUTE_LABEL[routeCode] ?? routeCode : null,
    supported: Boolean(pol === "KRPUS" && routeCode),
  };
}

export { LOCODE_LABEL, ROUTE_LABEL };
