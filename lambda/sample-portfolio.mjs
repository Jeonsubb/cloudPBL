// 데모용 샘플 회사 포트폴리오(가상 데이터). 실제 서비스에선 엑셀 임포트/DB로 대체.
// 2026-07-15(KST) 기준으로 결정엔진의 모든 분기가 나오도록 구성:
//  0001 긴급수용(ACCEPT) / 0002 재견적(REQUOTE) / 0003 관찰(WATCH) /
//  0004 비교불가(UNSUPPORTED) / 0005 견적없음(REQUEST_QUOTE) / 0006 바이어통제(NO_CONTROL)
const charge = (code, name, category, amount, quantity, kcciComparable) => ({
  code, name, category, amount, quantity, kcciComparable,
});

export const SHIPMENTS = [
  {
    id: "SHP-2026-0001", provenance: "SYNTHETIC",
    cargoReadyDate: "2026-07-18", etdWindowStart: "2026-07-22", etdWindowEnd: "2026-07-25",
    requiredDeliveryDate: "2026-08-12",
    pol: "KRPUS", pod: "USLGB", originLabel: "부산", destinationLabel: "롱비치", routeCode: "KUWI",
    loadType: "FCL", equipment: "40HC", containerCount: 2, cargoProfile: "DRY",
    description: "자동차 브레이크 부품", incoterm: "CFR", bookingController: "SELLER",
    targetBudget: 12800, currency: "USD", costScope: "ORIGIN_ALL_IN", status: "DECISION_REQUIRED",
  },
  {
    id: "SHP-2026-0002", provenance: "SYNTHETIC",
    cargoReadyDate: "2026-07-18", etdWindowStart: "2026-07-30", etdWindowEnd: "2026-08-04",
    requiredDeliveryDate: "2026-09-20",
    pol: "KRPUS", pod: "NLRTM", originLabel: "부산", destinationLabel: "로테르담", routeCode: "KNEI",
    loadType: "FCL", equipment: "40HC", containerCount: 1, cargoProfile: "DRY",
    description: "산업용 샤프트", incoterm: "CIF", bookingController: "SELLER",
    targetBudget: 5600, currency: "USD", costScope: "ORIGIN_ALL_IN", status: "DECISION_REQUIRED",
  },
  {
    id: "SHP-2026-0003", provenance: "SYNTHETIC",
    cargoReadyDate: "2026-07-20", etdWindowStart: "2026-07-28", etdWindowEnd: "2026-08-01",
    requiredDeliveryDate: "2026-08-25",
    pol: "KRPUS", pod: "SGSIN", originLabel: "부산", destinationLabel: "싱가포르", routeCode: "KSEI",
    loadType: "FCL", equipment: "40GP", containerCount: 1, cargoProfile: "DRY",
    description: "산업용 플라스틱 부품", incoterm: "CPT", bookingController: "SELLER",
    targetBudget: 1600, currency: "USD", costScope: "ORIGIN_ALL_IN", status: "QUOTING",
  },
  {
    id: "SHP-2026-0004", provenance: "SYNTHETIC",
    cargoReadyDate: "2026-07-19", etdWindowStart: "2026-07-27", etdWindowEnd: "2026-07-30",
    requiredDeliveryDate: "2026-08-18",
    pol: "KRPUS", pod: "JPTYO", originLabel: "부산", destinationLabel: "도쿄", routeCode: "KJI",
    loadType: "FCL", equipment: "20GP", containerCount: 1, cargoProfile: "DRY",
    description: "정밀 기어", incoterm: "CFR", bookingController: "SELLER",
    targetBudget: 700, currency: "USD", costScope: "ORIGIN_ALL_IN", status: "QUOTING",
  },
  {
    id: "SHP-2026-0005", provenance: "SYNTHETIC",
    cargoReadyDate: "2026-07-22", etdWindowStart: "2026-07-31", etdWindowEnd: "2026-08-05",
    requiredDeliveryDate: "2026-09-10",
    pol: "KRPUS", pod: "USNYC", originLabel: "부산", destinationLabel: "뉴욕", routeCode: "KUEI",
    loadType: "FCL", equipment: "40HC", containerCount: 1, cargoProfile: "DRY",
    description: "전기 제어반", incoterm: "CFR", bookingController: "SELLER",
    targetBudget: 8800, currency: "USD", costScope: "ORIGIN_ALL_IN", status: "DECISION_REQUIRED",
  },
  {
    id: "SHP-2026-0006", provenance: "SYNTHETIC",
    cargoReadyDate: "2026-07-21", etdWindowStart: "2026-07-29", etdWindowEnd: "2026-08-02",
    requiredDeliveryDate: "2026-08-28",
    pol: "KRPUS", pod: "CNSHA", originLabel: "부산", destinationLabel: "상하이", routeCode: "KCI",
    loadType: "FCL", equipment: "40HC", containerCount: 1, cargoProfile: "DRY",
    description: "기계 부품", incoterm: "FOB", bookingController: "BUYER",
    targetBudget: 900, currency: "USD", costScope: "ORIGIN_ALL_IN", status: "DECISION_REQUIRED",
  },
];

export const QUOTES = [
  // 0001 — 유효기간 임박(07-16) → 긴급 수용
  {
    id: "Q-0001-A", shipmentId: "SHP-2026-0001", provenance: "SYNTHETIC",
    quotedAt: "2026-07-11", validUntil: "2026-07-16", forwarder: "해동로지스 [가상]", carrier: "MOK CARRIER 1",
    plannedEtd: "2026-07-24", plannedEta: "2026-08-09", direct: true, transshipments: 0,
    total: 13900, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 6200, 2, true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 420, 2, true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 110, 2, true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 180, 2, false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 80, 1, false),
    ],
  },
  {
    id: "Q-0001-B", shipmentId: "SHP-2026-0001", provenance: "SYNTHETIC",
    quotedAt: "2026-07-12", validUntil: "2026-07-17", forwarder: "부산글로벌포워딩 [가상]", carrier: "MOK CARRIER 2",
    plannedEtd: "2026-07-25", plannedEta: "2026-08-11", direct: true, transshipments: 0,
    total: 14470, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 6500, 2, true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 420, 2, true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 110, 2, true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 170, 2, false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 70, 1, false),
    ],
  },
  // 0002 — 예산 크게 초과 → 재견적
  {
    id: "Q-0002-A", shipmentId: "SHP-2026-0002", provenance: "SYNTHETIC",
    quotedAt: "2026-07-13", validUntil: "2026-07-28", forwarder: "해동로지스 [가상]", carrier: "MOK CARRIER 3",
    plannedEtd: "2026-08-01", plannedEta: "2026-08-27", direct: true, transshipments: 0,
    total: 8050, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 6800, 1, true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 700, 1, true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 250, 1, true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 220, 1, false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 80, 1, false),
    ],
  },
  // 0003 — 예산 내, 여유 충분 → 관찰
  {
    id: "Q-0003-A", shipmentId: "SHP-2026-0003", provenance: "SYNTHETIC",
    quotedAt: "2026-07-13", validUntil: "2026-07-30", forwarder: "부산글로벌포워딩 [가상]", carrier: "MOK CARRIER 4",
    plannedEtd: "2026-07-30", plannedEta: "2026-08-06", direct: true, transshipments: 0,
    total: 1520, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 980, 1, true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 180, 1, true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 280, 1, false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 80, 1, false),
    ],
  },
  // 0004 — 20GP라 KCCI 직접 비교 불가(UNSUPPORTED)
  {
    id: "Q-0004-A", shipmentId: "SHP-2026-0004", provenance: "SYNTHETIC",
    quotedAt: "2026-07-13", validUntil: "2026-07-29", forwarder: "해동로지스 [가상]", carrier: "MOK CARRIER 5",
    plannedEtd: "2026-07-29", plannedEta: "2026-08-03", direct: true, transshipments: 0,
    total: 640, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 360, 1, true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 90, 1, true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 150, 1, false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 40, 1, false),
    ],
  },
  // 0006 — 바이어 부킹 통제(NO_CONTROL). 견적 있어도 직접 권고 생성 안 함
  {
    id: "Q-0006-A", shipmentId: "SHP-2026-0006", provenance: "SYNTHETIC",
    quotedAt: "2026-07-13", validUntil: "2026-07-27", forwarder: "바이어 지정 포워더 [가상]", carrier: "MOK CARRIER 6",
    plannedEtd: "2026-07-30", plannedEta: "2026-08-04", direct: true, transshipments: 0,
    total: 780, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 520, 1, true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 200, 1, false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 60, 1, false),
    ],
  },
  // 0005 — 견적 없음(REQUEST_QUOTE)
];
