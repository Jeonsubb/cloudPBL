export type DataProvenance =
  | "COMPANY_INPUT"
  | "SYNTHETIC"
  | "MARKET_OBSERVED"
  | "DEMO_DERIVED";

export type LoadType = "FCL" | "LCL";
export type CargoProfile = "DRY" | "REEFER" | "DG" | "OOG";
export type BookingController = "SELLER" | "BUYER" | "FORWARDER";
export type CostScope =
  | "OCEAN_COMPARABLE"
  | "OCEAN_ALL_IN"
  | "ORIGIN_ONLY"
  | "ORIGIN_ALL_IN"
  | "DOOR_TO_PORT"
  | "DOOR_TO_DOOR";

export type Shipment = {
  id: string;
  provenance: DataProvenance;
  cargoReadyDate: string;
  etdWindowStart: string;
  etdWindowEnd: string;
  requiredDeliveryDate: string;
  pol: string;
  pod: string;
  originLabel: string;
  destinationLabel: string;
  routeCode: string | null;
  loadType: LoadType;
  equipment: string;
  containerCount: number;
  packageCount?: number;
  grossWeightKg: number;
  volumeCbm?: number;
  cargoProfile: CargoProfile;
  hsCode: string;
  description: string;
  incoterm: string;
  incotermPlace: string;
  bookingController: BookingController;
  mainCarriagePayer: "SELLER" | "BUYER";
  targetBudget: number;
  currency: "USD";
  costScope: CostScope;
  hardDeadline: boolean;
  maxShiftDays: number;
  status: "PLANNED" | "QUOTING" | "DECISION_REQUIRED" | "BOOKED";
};

export type ChargeLine = {
  code: string;
  name: string;
  category:
    | "OCEAN_BASE"
    | "FUEL_SURCHARGE"
    | "ORIGIN_LOCAL"
    | "DESTINATION_LOCAL"
    | "INLAND"
    | "CUSTOMS"
    | "INSURANCE"
    | "OTHER";
  amount: number;
  quantity: number;
  basis: string;
  kcciComparable: boolean;
};

export type Quote = {
  id: string;
  shipmentId: string;
  provenance: DataProvenance;
  quotedAt: string;
  validUntil: string;
  forwarder: string;
  carrier: string;
  plannedEtd: string;
  plannedEta: string;
  direct: boolean;
  transshipments: number;
  freeTimeDays: number;
  total: number;
  currency: "USD";
  scope: CostScope;
  charges: ChargeLine[];
  notes: string;
};

export type FreightIndex = {
  code: string;
  name: string;
  value: number;
  unit: "PT" | "USD/FEU";
  weeklyChangePct: number;
  observedAt: string;
  publishedAt: string;
  source: string;
  sourceUrl: string;
  provenance: "MARKET_OBSERVED";
};

export type ExchangeRate = {
  pair: "USD/KRW" | "EUR/KRW" | "CNY/KRW" | "JPY/KRW";
  value: number;
  changePct: number | null;
  observedAt: string;
  source: string;
  sourceUrl: string;
  provenance: "MARKET_OBSERVED";
  freshness: "LIVE" | "FALLBACK";
};

export type NewsItem = {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  url: string;
  category: "물류" | "운임" | "통상" | "항만" | "환율";
  regions: string[];
  relatedShipmentIds: string[];
  provenance: "MARKET_OBSERVED";
};

export type DecisionAction =
  | "REQUEST_REQUOTE"
  | "ACCEPT_QUOTE"
  | "WATCH_UNTIL"
  | "REQUEST_QUOTE"
  | "MANUAL_CONFIRM";

export type DecisionCard = {
  shipmentId: string;
  quoteId: string | null;
  action: DecisionAction;
  actionLabel: string;
  deadline: string;
  priority: "URGENT" | "ACTION" | "WATCH" | "DATA";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  reasons: string[];
  counterSignals: string[];
  budgetVariancePct: number | null;
  kcciVariancePct: number | null;
  deliveryBufferDays: number | null;
  quoteValidityDays: number | null;
  comparability: "DIRECT" | "UNSUPPORTED" | "NO_CONTROL" | "NO_QUOTE";
  dataCoveragePct: number;
  ruleVersion: string;
  evaluatedAt: string;
  evidenceIds: string[];
};

export type ChatAnswer = {
  answer: string;
  facts: string[];
  exclusions: string[];
  sources: { label: string; url?: string }[];
  asOf: string;
  suggestedView: "dashboard" | "shipments" | "quotes" | "market" | "imports";
};

export const DEMO_AS_OF = "2026-07-12T09:10:00+09:00";

const charge = (
  code: string,
  name: string,
  category: ChargeLine["category"],
  amount: number,
  quantity: number,
  basis: string,
  kcciComparable: boolean,
): ChargeLine => ({ code, name, category, amount, quantity, basis, kcciComparable });

export const mockShipments: Shipment[] = [
  {
    id: "SHP-2026-0001", provenance: "SYNTHETIC", cargoReadyDate: "2026-07-20",
    etdWindowStart: "2026-07-25", etdWindowEnd: "2026-07-29", requiredDeliveryDate: "2026-08-21",
    pol: "KRPUS", pod: "USLGB", originLabel: "부산", destinationLabel: "롱비치", routeCode: "KUWI",
    loadType: "FCL", equipment: "40HC", containerCount: 2, grossWeightKg: 18700,
    cargoProfile: "DRY", hsCode: "870899", description: "자동차 브레이크 부품", incoterm: "CFR",
    incotermPlace: "LONG BEACH PORT", bookingController: "SELLER", mainCarriagePayer: "SELLER",
    targetBudget: 12800, currency: "USD", costScope: "ORIGIN_ALL_IN", hardDeadline: true,
    maxShiftDays: 2, status: "DECISION_REQUIRED",
  },
  {
    id: "SHP-2026-0002", provenance: "SYNTHETIC", cargoReadyDate: "2026-07-18",
    etdWindowStart: "2026-07-28", etdWindowEnd: "2026-08-02", requiredDeliveryDate: "2026-09-05",
    pol: "KRPUS", pod: "NLRTM", originLabel: "부산", destinationLabel: "로테르담", routeCode: "KNEI",
    loadType: "FCL", equipment: "40HC", containerCount: 1, grossWeightKg: 14300,
    cargoProfile: "DRY", hsCode: "848310", description: "산업용 샤프트", incoterm: "CIF",
    incotermPlace: "ROTTERDAM PORT", bookingController: "SELLER", mainCarriagePayer: "SELLER",
    targetBudget: 5600, currency: "USD", costScope: "ORIGIN_ALL_IN", hardDeadline: true,
    maxShiftDays: 3, status: "DECISION_REQUIRED",
  },
  {
    id: "SHP-2026-0003", provenance: "SYNTHETIC", cargoReadyDate: "2026-07-16",
    etdWindowStart: "2026-07-21", etdWindowEnd: "2026-07-24", requiredDeliveryDate: "2026-08-10",
    pol: "KRPUS", pod: "SGSIN", originLabel: "부산", destinationLabel: "싱가포르", routeCode: "KSEI",
    loadType: "FCL", equipment: "40GP", containerCount: 1, grossWeightKg: 9200,
    cargoProfile: "DRY", hsCode: "392690", description: "산업용 플라스틱 부품", incoterm: "CPT",
    incotermPlace: "SINGAPORE PORT", bookingController: "SELLER", mainCarriagePayer: "SELLER",
    targetBudget: 1400, currency: "USD", costScope: "ORIGIN_ALL_IN", hardDeadline: false,
    maxShiftDays: 4, status: "QUOTING",
  },
  {
    id: "SHP-2026-0004", provenance: "SYNTHETIC", cargoReadyDate: "2026-07-17",
    etdWindowStart: "2026-07-22", etdWindowEnd: "2026-07-25", requiredDeliveryDate: "2026-08-03",
    pol: "KRPUS", pod: "JPTYO", originLabel: "부산", destinationLabel: "도쿄", routeCode: "KJI",
    loadType: "FCL", equipment: "20GP", containerCount: 1, grossWeightKg: 7800,
    cargoProfile: "DRY", hsCode: "848390", description: "정밀 기어", incoterm: "CFR",
    incotermPlace: "TOKYO PORT", bookingController: "SELLER", mainCarriagePayer: "SELLER",
    targetBudget: 620, currency: "USD", costScope: "ORIGIN_ALL_IN", hardDeadline: true,
    maxShiftDays: 1, status: "DECISION_REQUIRED",
  },
  {
    id: "SHP-2026-0005", provenance: "SYNTHETIC", cargoReadyDate: "2026-07-21",
    etdWindowStart: "2026-07-31", etdWindowEnd: "2026-08-04", requiredDeliveryDate: "2026-09-04",
    pol: "KRPUS", pod: "DEHAM", originLabel: "부산", destinationLabel: "함부르크", routeCode: "KNEI",
    loadType: "FCL", equipment: "40RF", containerCount: 1, grossWeightKg: 8200,
    cargoProfile: "REEFER", hsCode: "210690", description: "건강기능식품", incoterm: "CIF",
    incotermPlace: "HAMBURG PORT", bookingController: "SELLER", mainCarriagePayer: "SELLER",
    targetBudget: 8000, currency: "USD", costScope: "ORIGIN_ALL_IN", hardDeadline: true,
    maxShiftDays: 2, status: "QUOTING",
  },
  {
    id: "SHP-2026-0006", provenance: "SYNTHETIC", cargoReadyDate: "2026-07-18",
    etdWindowStart: "2026-07-26", etdWindowEnd: "2026-07-30", requiredDeliveryDate: "2026-08-28",
    pol: "KRPUS", pod: "USLGB", originLabel: "부산", destinationLabel: "롱비치", routeCode: "KUWI",
    loadType: "LCL", equipment: "LCL", containerCount: 0, packageCount: 18, grossWeightKg: 1640,
    volumeCbm: 9.6, cargoProfile: "DRY", hsCode: "940360", description: "소형 목재가구", incoterm: "CFR",
    incotermPlace: "LONG BEACH CFS", bookingController: "FORWARDER", mainCarriagePayer: "SELLER",
    targetBudget: 2200, currency: "USD", costScope: "ORIGIN_ALL_IN", hardDeadline: false,
    maxShiftDays: 5, status: "QUOTING",
  },
  {
    id: "SHP-2026-0007", provenance: "SYNTHETIC", cargoReadyDate: "2026-07-22",
    etdWindowStart: "2026-07-30", etdWindowEnd: "2026-08-03", requiredDeliveryDate: "2026-09-12",
    pol: "KRPUS", pod: "USNYC", originLabel: "부산", destinationLabel: "뉴욕", routeCode: "KUEI",
    loadType: "FCL", equipment: "40HC", containerCount: 1, grossWeightKg: 15800,
    cargoProfile: "DRY", hsCode: "870899", description: "자동차 애프터마켓 부품", incoterm: "FOB",
    incotermPlace: "BUSAN PORT", bookingController: "BUYER", mainCarriagePayer: "BUYER",
    targetBudget: 900, currency: "USD", costScope: "ORIGIN_ONLY", hardDeadline: false,
    maxShiftDays: 5, status: "PLANNED",
  },
  {
    id: "SHP-2026-0008", provenance: "SYNTHETIC", cargoReadyDate: "2026-07-25",
    etdWindowStart: "2026-07-29", etdWindowEnd: "2026-08-05", requiredDeliveryDate: "2026-09-03",
    pol: "KRPUS", pod: "AEAUH", originLabel: "부산", destinationLabel: "아부다비", routeCode: "KMEI",
    loadType: "FCL", equipment: "40HC", containerCount: 1, grossWeightKg: 16000,
    cargoProfile: "DRY", hsCode: "848180", description: "산업용 밸브", incoterm: "DAP",
    incotermPlace: "ABU DHABI WAREHOUSE", bookingController: "SELLER", mainCarriagePayer: "SELLER",
    targetBudget: 8200, currency: "USD", costScope: "DOOR_TO_DOOR", hardDeadline: true,
    maxShiftDays: 3, status: "DECISION_REQUIRED",
  },
];

export const mockQuotes: Quote[] = [
  {
    id: "Q-0001-A", shipmentId: "SHP-2026-0001", provenance: "SYNTHETIC", quotedAt: "2026-07-10",
    validUntil: "2026-07-15", forwarder: "해동로지스 [가상]", carrier: "MOK CARRIER 1",
    plannedEtd: "2026-07-27", plannedEta: "2026-08-15", direct: true, transshipments: 0,
    freeTimeDays: 7, total: 13900, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 6200, 2, "PER_CONTAINER", true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 420, 2, "PER_CONTAINER", true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 110, 2, "PER_CONTAINER", true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 180, 2, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 80, 1, "PER_BL", false),
    ], notes: "Space guarantee 미확인",
  },
  {
    id: "Q-0001-B", shipmentId: "SHP-2026-0001", provenance: "SYNTHETIC", quotedAt: "2026-07-11",
    validUntil: "2026-07-16", forwarder: "부산글로벌포워딩 [가상]", carrier: "MOK CARRIER 2",
    plannedEtd: "2026-07-29", plannedEta: "2026-08-18", direct: true, transshipments: 0,
    freeTimeDays: 10, total: 14470, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 6500, 2, "PER_CONTAINER", true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 420, 2, "PER_CONTAINER", true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 110, 2, "PER_CONTAINER", true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 170, 2, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 70, 1, "PER_BL", false),
    ], notes: "유효기간이 하루 더 김",
  },
  {
    id: "Q-0002-A", shipmentId: "SHP-2026-0002", provenance: "SYNTHETIC", quotedAt: "2026-07-10",
    validUntil: "2026-07-17", forwarder: "해동로지스 [가상]", carrier: "MOK CARRIER 3",
    plannedEtd: "2026-07-31", plannedEta: "2026-08-29", direct: true, transshipments: 0,
    freeTimeDays: 7, total: 5585, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 4800, 1, "PER_CONTAINER", true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 350, 1, "PER_CONTAINER", true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 100, 1, "PER_CONTAINER", true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 180, 1, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 80, 1, "PER_BL", false),
      charge("INS", "Marine Insurance", "INSURANCE", 75, 1, "PER_SHIPMENT", false),
    ], notes: "보험료 포함",
  },
  {
    id: "Q-0002-B", shipmentId: "SHP-2026-0002", provenance: "SYNTHETIC", quotedAt: "2026-07-11",
    validUntil: "2026-07-18", forwarder: "동남해운대리점 [가상]", carrier: "MOK CARRIER 4",
    plannedEtd: "2026-08-02", plannedEta: "2026-09-02", direct: true, transshipments: 0,
    freeTimeDays: 10, total: 5790, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 5000, 1, "PER_CONTAINER", true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 360, 1, "PER_CONTAINER", true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 110, 1, "PER_CONTAINER", true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 170, 1, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 70, 1, "PER_BL", false),
      charge("INS", "Marine Insurance", "INSURANCE", 80, 1, "PER_SHIPMENT", false),
    ], notes: "납기 버퍼가 작음",
  },
  {
    id: "Q-0003-A", shipmentId: "SHP-2026-0003", provenance: "SYNTHETIC", quotedAt: "2026-07-09",
    validUntil: "2026-07-15", forwarder: "부산글로벌포워딩 [가상]", carrier: "MOK CARRIER 5",
    plannedEtd: "2026-07-22", plannedEta: "2026-08-03", direct: true, transshipments: 0,
    freeTimeDays: 7, total: 1260, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 820, 1, "PER_CONTAINER", true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 160, 1, "PER_CONTAINER", true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 40, 1, "PER_CONTAINER", true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 170, 1, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 70, 1, "PER_BL", false),
    ], notes: "직항",
  },
  {
    id: "Q-0003-B", shipmentId: "SHP-2026-0003", provenance: "SYNTHETIC", quotedAt: "2026-07-10",
    validUntil: "2026-07-16", forwarder: "해동로지스 [가상]", carrier: "MOK CARRIER 6",
    plannedEtd: "2026-07-24", plannedEta: "2026-08-05", direct: true, transshipments: 0,
    freeTimeDays: 7, total: 1310, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 900, 1, "PER_CONTAINER", true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 160, 1, "PER_CONTAINER", true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 40, 1, "PER_CONTAINER", true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 150, 1, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 60, 1, "PER_BL", false),
    ], notes: "후발 ETD",
  },
  {
    id: "Q-0004-A", shipmentId: "SHP-2026-0004", provenance: "SYNTHETIC", quotedAt: "2026-07-10",
    validUntil: "2026-07-17", forwarder: "동남해운대리점 [가상]", carrier: "MOK CARRIER 7",
    plannedEtd: "2026-07-23", plannedEta: "2026-07-27", direct: true, transshipments: 0,
    freeTimeDays: 5, total: 600, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 250, 1, "PER_CONTAINER", false),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 80, 1, "PER_CONTAINER", false),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 20, 1, "PER_CONTAINER", false),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 170, 1, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 80, 1, "PER_BL", false),
    ], notes: "20ft: KCCI 직접 비교 제외",
  },
  {
    id: "Q-0005-A", shipmentId: "SHP-2026-0005", provenance: "SYNTHETIC", quotedAt: "2026-07-11",
    validUntil: "2026-07-18", forwarder: "콜드체인파트너 [가상]", carrier: "MOK CARRIER 8",
    plannedEtd: "2026-08-02", plannedEta: "2026-09-01", direct: false, transshipments: 1,
    freeTimeDays: 5, total: 8230, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 6500, 1, "PER_CONTAINER", false),
      charge("RFR", "Reefer Surcharge", "OTHER", 900, 1, "PER_CONTAINER", false),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 400, 1, "PER_CONTAINER", false),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 100, 1, "PER_CONTAINER", false),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 250, 1, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 80, 1, "PER_BL", false),
    ], notes: "Reefer·환적",
  },
  {
    id: "Q-0006-A", shipmentId: "SHP-2026-0006", provenance: "SYNTHETIC", quotedAt: "2026-07-09",
    validUntil: "2026-07-15", forwarder: "부산LCL센터 [가상]", carrier: "MOK CARRIER 9",
    plannedEtd: "2026-07-30", plannedEta: "2026-08-24", direct: false, transshipments: 1,
    freeTimeDays: 3, total: 2158, currency: "USD", scope: "ORIGIN_ALL_IN",
    charges: [
      charge("LCL", "LCL Ocean Freight", "OCEAN_BASE", 180, 9.6, "PER_CBM", false),
      charge("CFS", "Origin CFS", "ORIGIN_LOCAL", 350, 1, "PER_SHIPMENT", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 80, 1, "PER_BL", false),
    ], notes: "9.6 CBM 기준",
  },
  {
    id: "Q-0007-A", shipmentId: "SHP-2026-0007", provenance: "SYNTHETIC", quotedAt: "2026-07-10",
    validUntil: "2026-07-18", forwarder: "해동로지스 [가상]", carrier: "MOK CARRIER 1",
    plannedEtd: "2026-08-03", plannedEta: "2026-09-09", direct: false, transshipments: 1,
    freeTimeDays: 7, total: 850, currency: "USD", scope: "ORIGIN_ONLY",
    charges: [
      charge("TRK", "Origin Trucking", "INLAND", 600, 1, "PER_SHIPMENT", false),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 170, 1, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 80, 1, "PER_BL", false),
    ], notes: "FOB·Buyer Booking, 출발지 비용만",
  },
  {
    id: "Q-0008-A", shipmentId: "SHP-2026-0008", provenance: "SYNTHETIC", quotedAt: "2026-07-10",
    validUntil: "2026-07-16", forwarder: "중동로지스 [가상]", carrier: "MOK CARRIER 2",
    plannedEtd: "2026-08-01", plannedEta: "2026-08-26", direct: true, transshipments: 0,
    freeTimeDays: 7, total: 8160, currency: "USD", scope: "DOOR_TO_DOOR",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 6500, 1, "PER_CONTAINER", true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 400, 1, "PER_CONTAINER", true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 100, 1, "PER_CONTAINER", true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 180, 1, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 80, 1, "PER_BL", false),
      charge("INL", "Destination Inland", "INLAND", 900, 1, "PER_SHIPMENT", false),
    ], notes: "Door 견적",
  },
  {
    id: "Q-0008-B", shipmentId: "SHP-2026-0008", provenance: "SYNTHETIC", quotedAt: "2026-07-11",
    validUntil: "2026-07-17", forwarder: "걸프포워딩 [가상]", carrier: "MOK CARRIER 3",
    plannedEtd: "2026-08-03", plannedEta: "2026-08-31", direct: false, transshipments: 1,
    freeTimeDays: 5, total: 8270, currency: "USD", scope: "DOOR_TO_DOOR",
    charges: [
      charge("OFT", "Ocean Freight", "OCEAN_BASE", 6700, 1, "PER_CONTAINER", true),
      charge("BAF", "Bunker Adjustment", "FUEL_SURCHARGE", 420, 1, "PER_CONTAINER", true),
      charge("LSS", "Low Sulphur", "FUEL_SURCHARGE", 110, 1, "PER_CONTAINER", true),
      charge("THC", "Origin THC", "ORIGIN_LOCAL", 170, 1, "PER_CONTAINER", false),
      charge("DOC", "Documentation", "ORIGIN_LOCAL", 70, 1, "PER_BL", false),
      charge("INL", "Destination Inland", "INLAND", 800, 1, "PER_SHIPMENT", false),
    ], notes: "환적 1회",
  },
];

export const mockFreightIndices: FreightIndex[] = [
  { code: "KCCI", name: "종합지수", value: 4330, unit: "PT", weeklyChangePct: 10.46, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KUWI", name: "미서안", value: 6922, unit: "USD/FEU", weeklyChangePct: 15.97, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KUEI", name: "미동안", value: 8421, unit: "USD/FEU", weeklyChangePct: 16.68, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KNEI", name: "유럽", value: 5332, unit: "USD/FEU", weeklyChangePct: 12.97, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KMDI", name: "지중해", value: 6468, unit: "USD/FEU", weeklyChangePct: 10.07, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KMEI", name: "중동", value: 7164, unit: "USD/FEU", weeklyChangePct: 5.62, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KAUI", name: "호주", value: 3574, unit: "USD/FEU", weeklyChangePct: 15.44, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KLEI", name: "중남미동안", value: 7854, unit: "USD/FEU", weeklyChangePct: 0, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KLWI", name: "중남미서안", value: 5851, unit: "USD/FEU", weeklyChangePct: 0.19, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KSAI", name: "남아프리카", value: 3602, unit: "USD/FEU", weeklyChangePct: 3.42, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KWAI", name: "서아프리카", value: 5419, unit: "USD/FEU", weeklyChangePct: 3.02, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KCI", name: "중국", value: 57, unit: "USD/FEU", weeklyChangePct: 5.56, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KJI", name: "일본", value: 239, unit: "USD/FEU", weeklyChangePct: 7.66, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
  { code: "KSEI", name: "동남아", value: 1125, unit: "USD/FEU", weeklyChangePct: 2.46, observedAt: "2026-07-06", publishedAt: "2026-07-06", source: "KOBC KCCI", sourceUrl: "https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000", provenance: "MARKET_OBSERVED" },
];

export const mockExchangeRates: ExchangeRate[] = [
  { pair: "USD/KRW", value: 1504.92, changePct: -0.5, observedAt: "2026-07-10", source: "ECB via Frankfurter", sourceUrl: "https://frankfurter.dev/", provenance: "MARKET_OBSERVED", freshness: "FALLBACK" },
  { pair: "EUR/KRW", value: 1720.13, changePct: -0.54, observedAt: "2026-07-10", source: "ECB cross-rate via Frankfurter", sourceUrl: "https://frankfurter.dev/", provenance: "MARKET_OBSERVED", freshness: "FALLBACK" },
  { pair: "CNY/KRW", value: 222.15, changePct: -0.18, observedAt: "2026-07-10", source: "ECB cross-rate via Frankfurter", sourceUrl: "https://frankfurter.dev/", provenance: "MARKET_OBSERVED", freshness: "FALLBACK" },
  { pair: "JPY/KRW", value: 9.3, changePct: -0.18, observedAt: "2026-07-10", source: "ECB cross-rate via Frankfurter (per JPY)", sourceUrl: "https://frankfurter.dev/", provenance: "MARKET_OBSERVED", freshness: "FALLBACK" },
];

export const mockNews: NewsItem[] = [
  {
    id: "NEWS-2026-07-01", title: "부산 수출기업 93.1%, 물류비 상승 체감",
    summary: "부산지역 주요 수출기업 조사에서 물류비 부담과 대응계획 부재가 함께 나타났습니다. 개별 선적 영향은 견적과 항로를 별도로 확인해야 합니다.",
    source: "한국무역협회", publishedAt: "2026-05-22", category: "물류", regions: ["부산", "중동"],
    relatedShipmentIds: ["SHP-2026-0008"], provenance: "MARKET_OBSERVED",
    url: "https://www.kita.net/board/totalTradeNews/totalTradeNewsDetail.do?no=101682&siteId=1",
  },
  {
    id: "NEWS-2026-07-02", title: "5월 중동향 해상 수출 운송비, 전년 동월 대비 100.2% 증가",
    summary: "40ft·2TEU FCL 단일화주 CIF/CFR 신고자료 기준입니다. 개별 Door 견적이나 리퍼·LCL 운임과 직접 비교하면 안 됩니다.",
    source: "관세청", publishedAt: "2026-06-16", category: "운임", regions: ["중동"],
    relatedShipmentIds: ["SHP-2026-0008"], provenance: "MARKET_OBSERVED",
    url: "https://www.customs.go.kr/kcs/na/ntt/selectNttInfo.do?bbsId=1362&mi=2891&nttSn=10166825&nttSnUrl=7165f29308d85363e87120ca30b47f4c",
  },
  {
    id: "NEWS-2026-07-03", title: "수출물류 애로: 운항 지연과 운임·전쟁할증료가 주요 이슈",
    summary: "193개 기업의 469건 접수 사례에서 운항 지연 27.5%, 운임·전쟁할증료 24.9%가 집계됐습니다. 자발적 애로 접수 비율임에 유의해야 합니다.",
    source: "한국무역협회", publishedAt: "2026-03-19", category: "물류", regions: ["글로벌"],
    relatedShipmentIds: ["SHP-2026-0001", "SHP-2026-0002", "SHP-2026-0008"], provenance: "MARKET_OBSERVED",
    url: "https://www.kita.net/board/totalTradeNews/totalTradeNewsDetail.do?no=100225&siteId=1",
  },
  {
    id: "NEWS-2026-07-04", title: "수출기업 72.5%, 원자재·물류비 상승으로 단가 인하 여력 없어",
    summary: "수출기업 1,193개사 조사 결과로, 물류비만의 단독 효과는 아닙니다. PortPulse에서는 선적별 예산 노출액을 따로 계산합니다.",
    source: "한국무역협회", publishedAt: "2026-01-08", category: "통상", regions: ["글로벌"],
    relatedShipmentIds: [], provenance: "MARKET_OBSERVED",
    url: "https://www.kita.net/board/totalTradeNews/totalTradeNewsDetail.do?no=98477&siteId=1",
  },
];

const MS_DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.ceil((new Date(`${to}T00:00:00+09:00`).getTime() - new Date(`${from.slice(0, 10)}T00:00:00+09:00`).getTime()) / MS_DAY);

export const lineTotal = (line: ChargeLine) => line.amount * line.quantity;
export const quoteChargeTotal = (quote: Quote) => quote.charges.reduce((sum, item) => sum + lineTotal(item), 0);
export const quoteComparableTotal = (quote: Quote) => quote.charges.filter((item) => item.kcciComparable).reduce((sum, item) => sum + lineTotal(item), 0);

export function getComparability(shipment: Shipment, quote?: Quote): DecisionCard["comparability"] {
  if (!quote) return "NO_QUOTE";
  if (shipment.bookingController === "BUYER") return "NO_CONTROL";
  const eligible = shipment.pol === "KRPUS"
    && shipment.loadType === "FCL"
    && (shipment.equipment === "40GP" || shipment.equipment === "40HC")
    && shipment.cargoProfile === "DRY"
    && shipment.containerCount > 0
    && Boolean(shipment.routeCode)
    && quoteComparableTotal(quote) > 0;
  return eligible ? "DIRECT" : "UNSUPPORTED";
}

export function buildDecisionCard(
  shipment: Shipment,
  quotes = mockQuotes.filter((item) => item.shipmentId === shipment.id),
  freightIndices = mockFreightIndices,
  asOf = DEMO_AS_OF,
): DecisionCard {
  const activeQuotes = quotes.filter((quote) => daysBetween(asOf, quote.validUntil) >= 0);
  const selected = [...activeQuotes].sort((a, b) => a.total - b.total)[0] ?? [...quotes].sort((a, b) => b.validUntil.localeCompare(a.validUntil))[0];
  const comparability = getComparability(shipment, selected);
  const market = freightIndices.find((index) => index.code === shipment.routeCode);
  const budgetVariancePct = selected ? ((selected.total - shipment.targetBudget) / shipment.targetBudget) * 100 : null;
  const deliveryBufferDays = selected ? daysBetween(selected.plannedEta, shipment.requiredDeliveryDate) : null;
  const quoteValidityDays = selected ? daysBetween(asOf, selected.validUntil) : null;
  const comparablePerFeu = selected && shipment.containerCount > 0
    ? quoteComparableTotal(selected) / shipment.containerCount
    : null;
  const kcciVariancePct = comparability === "DIRECT" && market && comparablePerFeu !== null
    ? ((comparablePerFeu - market.value) / market.value) * 100
    : null;

  let action: DecisionAction = "WATCH_UNTIL";
  let actionLabel = "기한까지 관찰";
  let priority: DecisionCard["priority"] = "WATCH";
  const reasons: string[] = [];
  const counterSignals: string[] = [];

  if (!selected) {
    action = "REQUEST_QUOTE";
    actionLabel = "견적 요청";
    priority = "DATA";
    reasons.push("유효한 포워더 견적이 없어 비용·일정 비교를 시작할 수 없습니다.");
  } else if (comparability === "NO_CONTROL") {
    action = "MANUAL_CONFIRM";
    actionLabel = "바이어 확인 요청";
    priority = "DATA";
    reasons.push("바이어가 국제운송 부킹을 통제하는 거래입니다.");
    reasons.push("출발지 비용과 마감만 관리하고 직접 부킹 권고는 생성하지 않습니다.");
  } else if ((deliveryBufferDays ?? 99) <= 3 || (quoteValidityDays ?? 99) <= 1) {
    action = "ACCEPT_QUOTE";
    actionLabel = "견적 검토·수용";
    priority = "URGENT";
    reasons.push(`납기 버퍼가 ${deliveryBufferDays ?? "확인 불가"}일로 짧거나 견적 만료가 임박했습니다.`);
  } else if ((budgetVariancePct ?? 0) > 5 || (kcciVariancePct ?? 0) > 8) {
    action = "REQUEST_REQUOTE";
    actionLabel = "재견적 요청";
    priority = "ACTION";
    if ((budgetVariancePct ?? 0) > 5) reasons.push(`현재 견적이 회사 예산보다 ${budgetVariancePct!.toFixed(1)}% 높습니다.`);
    if ((kcciVariancePct ?? 0) > 8) reasons.push(`비교 가능한 해상비가 동일 항로 KCCI보다 ${kcciVariancePct!.toFixed(1)}% 높습니다.`);
  } else {
    reasons.push("현재 견적이 예산 범위에 있고 일정상 짧은 관찰 여유가 있습니다.");
  }

  if (market && market.weeklyChangePct > 8) {
    counterSignals.push(`${market.name} KCCI가 전주 대비 ${market.weeklyChangePct.toFixed(2)}% 상승해 오래 기다리는 것은 위험할 수 있습니다.`);
  }
  if (selected && !selected.direct) counterSignals.push(`선택 견적은 환적 ${selected.transshipments}회로 일정 변동 가능성이 있습니다.`);
  if (comparability === "UNSUPPORTED") reasons.push(`${shipment.equipment}/${shipment.cargoProfile}/${shipment.loadType} 조건은 KCCI 절대금액 직접 비교 대상이 아닙니다.`);

  const deadline = selected
    ? [selected.validUntil, shipment.etdWindowStart].sort()[0]
    : shipment.etdWindowStart;
  const coverage = selected ? (comparability === "DIRECT" ? 92 : 78) : 54;
  const confidence: DecisionCard["confidence"] = comparability === "DIRECT" && selected ? "HIGH" : selected ? "MEDIUM" : "LOW";
  const summary = selected
    ? `${shipment.originLabel}→${shipment.destinationLabel} ${shipment.equipment} × ${shipment.containerCount || 1}. ${actionLabel}이 필요합니다.`
    : `${shipment.originLabel}→${shipment.destinationLabel} 선적에 비교 가능한 견적을 먼저 등록해야 합니다.`;

  return {
    shipmentId: shipment.id,
    quoteId: selected?.id ?? null,
    action,
    actionLabel,
    deadline,
    priority,
    confidence,
    summary,
    reasons,
    counterSignals,
    budgetVariancePct,
    kcciVariancePct,
    deliveryBufferDays,
    quoteValidityDays,
    comparability,
    dataCoveragePct: coverage,
    ruleVersion: "decision-v1.0.0",
    evaluatedAt: asOf,
    evidenceIds: [shipment.id, selected?.id, market ? `KCCI-${market.observedAt}-${market.code}` : null].filter(Boolean) as string[],
  };
}

export const mockDecisionCards = mockShipments.map((shipment) => buildDecisionCard(shipment));

export function buildDashboardSummary(decisions = mockDecisionCards) {
  const actionable = decisions.filter((item) => item.priority === "URGENT" || item.priority === "ACTION");
  const budgetExposure = decisions.reduce((sum, item) => {
    if (!item.quoteId || (item.budgetVariancePct ?? 0) <= 0) return sum;
    const quote = mockQuotes.find((candidate) => candidate.id === item.quoteId);
    const shipment = mockShipments.find((candidate) => candidate.id === item.shipmentId);
    return sum + (quote && shipment ? Math.max(0, quote.total - shipment.targetBudget) : 0);
  }, 0);
  return {
    actionDue: actionable.length,
    urgent: decisions.filter((item) => item.priority === "URGENT").length,
    budgetExposure,
    dataReview: decisions.filter((item) => item.comparability !== "DIRECT").length,
    directComparable: decisions.filter((item) => item.comparability === "DIRECT").length,
  };
}

const topDecisionSummary = () => mockDecisionCards
  .filter((item) => item.priority === "URGENT" || item.priority === "ACTION")
  .sort((a, b) => a.deadline.localeCompare(b.deadline))
  .map((item) => `${item.shipmentId} ${item.actionLabel}(${item.deadline})`)
  .join(", ");

export function answerPortPulseQuestion(question: string): ChatAnswer {
  const normalized = question.trim().toLowerCase();
  const kcciUrl = mockFreightIndices[0].sourceUrl;
  const base = {
    asOf: DEMO_AS_OF,
    sources: [{ label: "PortPulse 규칙 decision-v1.0.0" }, { label: "KOBC KCCI 2026-07-06", url: kcciUrl }],
  };

  if (normalized.includes("shp-2026-0001") || normalized.includes("0001")) {
    const card = mockDecisionCards.find((item) => item.shipmentId === "SHP-2026-0001")!;
    return {
      ...base,
      answer: `SHP-2026-0001은 ${card.actionLabel} 대상입니다. 현재 최저 유효 견적 ${card.quoteId}가 회사 예산을 웃돌기 때문입니다. 동일 기준 KCCI보다는 낮아, 재견적 사유를 시장 대비 고가로 설명하지 않습니다.`,
      facts: [
        `견적 총액 USD ${mockQuotes.find((item) => item.id === card.quoteId)!.total.toLocaleString("ko-KR")}`,
        `예산 편차 ${card.budgetVariancePct!.toFixed(1)}%`,
        `KCCI 비교 편차 ${card.kcciVariancePct!.toFixed(1)}%`,
        `납기 버퍼 ${card.deliveryBufferDays}일`,
      ],
      exclusions: ["THC·DOC 등 Local Charge는 KCCI 비교에서 제외", "선복 보장 여부는 확인되지 않음"],
      suggestedView: "quotes",
    };
  }

  if (normalized.includes("7일") || normalized.includes("급한") || normalized.includes("먼저")) {
    return {
      ...base,
      answer: `현재 우선 확인할 선적은 ${topDecisionSummary()}입니다. 행동기한과 견적 유효기간 중 빠른 날짜를 기준으로 정렬했습니다.`,
      facts: [`조치 필요 ${buildDashboardSummary().actionDue}건`, `긴급 ${buildDashboardSummary().urgent}건`],
      exclusions: ["부킹 실행은 하지 않음", "날짜가 누락된 선적은 데이터 확인 항목으로 분리"],
      suggestedView: "shipments",
    };
  }

  if (normalized.includes("q-0001") || normalized.includes("견적") && normalized.includes("비교")) {
    const a = mockQuotes.find((item) => item.id === "Q-0001-A")!;
    const b = mockQuotes.find((item) => item.id === "Q-0001-B")!;
    return {
      ...base,
      answer: `Q-0001-A가 총액 기준 USD ${(b.total - a.total).toLocaleString("ko-KR")} 낮고 ETA도 3일 빠릅니다. B는 Free Time이 3일 더 깁니다.`,
      facts: [`A 총액 USD ${a.total.toLocaleString("ko-KR")}`, `B 총액 USD ${b.total.toLocaleString("ko-KR")}`, `A Free Time ${a.freeTimeDays}일 / B ${b.freeTimeDays}일`],
      exclusions: ["두 견적 모두 Space Guarantee 미확인", "Local Charge는 KCCI 절대금액 비교에서 제외"],
      suggestedView: "quotes",
    };
  }

  if (normalized.includes("kcci") || normalized.includes("직접 비교") || normalized.includes("비교할 수 없")) {
    return {
      ...base,
      answer: "KCCI 직접 비교는 부산발 40ft Dry FCL, 수출자 부킹 통제, 항로 매핑, 비교 가능한 Ocean/Fuel 비용라인이 모두 있을 때만 가능합니다.",
      facts: [`직접 비교 가능 ${buildDashboardSummary().directComparable}건`, "KCCI 발표 기준일 2026-07-06", "항로 운임 단위 USD/FEU"],
      exclusions: ["20ft·LCL·Reefer·DG·OOG", "THC·DOC·내륙운송·Door Charge", "바이어 부킹 거래"],
      suggestedView: "market",
    };
  }

  if (normalized.includes("환율") || normalized.includes("원화") || normalized.includes("usd")) {
    const usd = mockExchangeRates[0];
    const openUsd = mockQuotes.reduce((sum, item) => sum + item.total, 0);
    return {
      ...base,
      answer: `마지막 정상 USD/KRW 참고환율은 ${usd.value.toLocaleString("ko-KR")}원입니다. 데모 견적 총액을 단순 환산하면 약 ${Math.round(openUsd * usd.value / 1_000_000).toLocaleString("ko-KR")}백만원입니다.`,
      facts: [`USD/KRW ${usd.value.toLocaleString("ko-KR")}`, `기준일 ${usd.observedAt}`, `USD 견적 합계 ${openUsd.toLocaleString("ko-KR")}`],
      exclusions: ["회사 적용환율·선물환 미반영", "포워더 청구환율이 있으면 해당 값을 우선"],
      sources: [...base.sources, { label: usd.source, url: usd.sourceUrl }],
      suggestedView: "market",
    };
  }

  if (normalized.includes("뉴스") || normalized.includes("이슈")) {
    return {
      ...base,
      answer: `열린 선적과 관련 가능성이 높은 항목은 “${mockNews[1].title}”입니다. SHP-2026-0008 중동향 선적과 항로가 겹치지만 인과관계를 단정할 수는 없습니다.`,
      facts: mockNews.slice(0, 3).map((item) => `${item.source} · ${item.title}`),
      exclusions: ["뉴스를 운임 예측값으로 변환하지 않음", "개별 선적 영향은 최신 견적·스케줄로 재확인 필요"],
      sources: mockNews.slice(0, 3).map((item) => ({ label: item.source, url: item.url })),
      suggestedView: "market",
    };
  }

  return {
    ...base,
    answer: `현재 조치가 필요한 선적은 ${buildDashboardSummary().actionDue}건입니다. 선적번호, 견적 비교, KCCI 비교 가능 여부, 환율 또는 뉴스 중 하나를 물어보면 근거와 제외 항목까지 설명하겠습니다.`,
    facts: [topDecisionSummary(), `데이터 기준 ${DEMO_AS_OF}`],
    exclusions: ["미래 운임·ETA·선복을 보장하지 않음", "부킹 승인이나 데이터 수정은 수행하지 않음"],
    suggestedView: "dashboard",
  };
}
