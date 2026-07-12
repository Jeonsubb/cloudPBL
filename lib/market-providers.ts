import {
  mockExchangeRates,
  mockFreightIndices,
  mockNews,
  type ExchangeRate,
  type FreightIndex,
  type NewsItem,
} from "./portpulse";

type FrankfurterRate = {
  date: string;
  base: string;
  quote: string;
  rate: number;
};

export type MarketPayload = {
  fetchedAt: string;
  freight: FreightIndex[];
  exchange: ExchangeRate[];
  news: NewsItem[];
  health: {
    exchange: "LIVE" | "FALLBACK";
    freight: "FIXED_OFFICIAL_SNAPSHOT";
    news: "CURATED_OFFICIAL";
  };
  notices: string[];
};

const FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rates";

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function pct(current: number, previous: number | undefined) {
  return previous ? ((current - previous) / previous) * 100 : null;
}

function findRate(rows: FrankfurterRate[], date: string, quote: string) {
  return rows.find((row) => row.date === date && row.quote === quote)?.rate;
}

export async function fetchExchangeRates(): Promise<ExchangeRate[]> {
  const now = new Date();
  const from = new Date(now.getTime() - 12 * 86_400_000);
  const url = `${FRANKFURTER_URL}?base=USD&quotes=KRW,EUR,CNY,JPY&providers=ECB&from=${toIsoDate(from)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "PortPulse-MVP/1.0" },
    signal: AbortSignal.timeout(5_500),
  });
  if (!response.ok) throw new Error(`exchange provider ${response.status}`);
  const rows = (await response.json()) as FrankfurterRate[];
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const latestDate = dates.at(-1);
  const previousDate = dates.at(-2);
  if (!latestDate) throw new Error("exchange provider returned no observations");

  const latestKrw = findRate(rows, latestDate, "KRW");
  const latestEur = findRate(rows, latestDate, "EUR");
  const latestCny = findRate(rows, latestDate, "CNY");
  const latestJpy = findRate(rows, latestDate, "JPY");
  if (!latestKrw || !latestEur || !latestCny || !latestJpy) {
    throw new Error("exchange provider response is incomplete");
  }

  const previousKrw = previousDate ? findRate(rows, previousDate, "KRW") : undefined;
  const previousEur = previousDate ? findRate(rows, previousDate, "EUR") : undefined;
  const previousCny = previousDate ? findRate(rows, previousDate, "CNY") : undefined;
  const previousJpy = previousDate ? findRate(rows, previousDate, "JPY") : undefined;

  const values: Array<{ pair: ExchangeRate["pair"]; value: number; previous?: number; label: string }> = [
    { pair: "USD/KRW", value: latestKrw, previous: previousKrw, label: "ECB via Frankfurter" },
    {
      pair: "EUR/KRW",
      value: latestKrw / latestEur,
      previous: previousKrw && previousEur ? previousKrw / previousEur : undefined,
      label: "ECB cross-rate via Frankfurter",
    },
    {
      pair: "CNY/KRW",
      value: latestKrw / latestCny,
      previous: previousKrw && previousCny ? previousKrw / previousCny : undefined,
      label: "ECB cross-rate via Frankfurter",
    },
    {
      pair: "JPY/KRW",
      value: latestKrw / latestJpy,
      previous: previousKrw && previousJpy ? previousKrw / previousJpy : undefined,
      label: "ECB cross-rate via Frankfurter (per JPY)",
    },
  ];

  return values.map((item) => ({
    pair: item.pair,
    value: Number(item.value.toFixed(item.pair === "JPY/KRW" ? 2 : 2)),
    changePct: item.previous ? Number(pct(item.value, item.previous)!.toFixed(2)) : null,
    observedAt: latestDate,
    source: item.label,
    sourceUrl: "https://frankfurter.dev/",
    provenance: "MARKET_OBSERVED",
    freshness: "LIVE",
  }));
}

export async function getMarketPayload(): Promise<MarketPayload> {
  let exchange = mockExchangeRates;
  let exchangeHealth: MarketPayload["health"]["exchange"] = "FALLBACK";
  const notices = [
    "KCCI는 2026-07-06 공식 발표 스냅샷입니다. 자동 수집·재배포 조건 확인 전에는 고정값으로 제공합니다.",
    "뉴스는 공식기관 원문을 큐레이션한 항목이며 개별 선적과의 인과관계를 뜻하지 않습니다.",
  ];
  try {
    exchange = await fetchExchangeRates();
    exchangeHealth = "LIVE";
  } catch {
    notices.push("환율 제공자 연결에 실패해 마지막 정상 스냅샷을 표시합니다.");
  }

  return {
    fetchedAt: new Date().toISOString(),
    freight: mockFreightIndices,
    exchange,
    news: mockNews,
    health: {
      exchange: exchangeHealth,
      freight: "FIXED_OFFICIAL_SNAPSHOT",
      news: "CURATED_OFFICIAL",
    },
    notices,
  };
}
