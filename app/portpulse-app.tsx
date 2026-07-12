"use client";

import {
  AlertTriangle,
  Anchor,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  Info,
  LayoutDashboard,
  Menu,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Ship,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  UploadCloud,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportResult } from "@/lib/import-workbook";
import { createDashboardFallback, type DashboardPayload, type MacroSeries } from "@/lib/dashboard-contract";
import type { MarketPayload } from "@/lib/market-providers";
import {
  DEMO_AS_OF,
  answerPortPulseQuestion,
  buildDecisionCard,
  mockExchangeRates,
  mockFreightIndices,
  mockNews,
  mockQuotes,
  mockShipments,
  quoteChargeTotal,
  quoteComparableTotal,
  type ChatAnswer,
  type DecisionCard,
  type FreightIndex,
  type Shipment,
} from "@/lib/portpulse";

type View = "dashboard" | "shipments" | "quotes" | "market" | "imports" | "reports" | "alerts" | "settings";
type AlertItem = {
  id: string;
  level: "urgent" | "action" | "data" | "market";
  title: string;
  detail: string;
  shipmentId?: string;
  read: boolean;
  snoozed: boolean;
};
type ChatMessage = { id: string; role: "user" | "assistant"; text: string; answer?: ChatAnswer };

const viewMeta: Record<View, { label: string; eyebrow: string }> = {
  dashboard: { label: "시장 대시보드", eyebrow: "오늘의 해양물류" },
  shipments: { label: "선적 관리", eyebrow: "계획·일정·상태" },
  quotes: { label: "견적 비교", eyebrow: "동일 범위로 정규화" },
  market: { label: "시장 인사이트", eyebrow: "운임·환율·뉴스" },
  imports: { label: "데이터 가져오기", eyebrow: "검증 후 사용자 승인" },
  reports: { label: "리포트", eyebrow: "결정과 근거의 기록" },
  alerts: { label: "알림", eyebrow: "마감·데이터·시장 변화" },
  settings: { label: "설정", eyebrow: "서비스와 데이터 기준" },
};

const navGroups: { label: string; items: { view: View; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    label: "WORKSPACE",
    items: [
      { view: "dashboard", label: "홈", icon: LayoutDashboard },
      { view: "shipments", label: "선적 관리", icon: Ship },
      { view: "quotes", label: "견적 비교", icon: FileSpreadsheet },
      { view: "market", label: "시장 인사이트", icon: BarChart3 },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      { view: "imports", label: "데이터 가져오기", icon: Database },
      { view: "reports", label: "리포트", icon: FileText },
      { view: "alerts", label: "알림", icon: Bell },
    ],
  },
];

const initialAlerts: AlertItem[] = [
  { id: "ALT-001", level: "urgent", title: "Q-0003-A 견적이 3일 뒤 만료됩니다", detail: "SHP-2026-0003 · 납기 버퍼 7일 · 예산 내", shipmentId: "SHP-2026-0003", read: false, snoozed: false },
  { id: "ALT-002", level: "action", title: "SHP-2026-0001 재견적 검토 필요", detail: "예산 +8.6% · 미서안 KCCI 비교 편차를 확인하세요.", shipmentId: "SHP-2026-0001", read: false, snoozed: false },
  { id: "ALT-003", level: "data", title: "KCCI 최신 발표 기준일 확인", detail: "마지막 정상 스냅샷은 2026-07-06입니다.", read: false, snoozed: false },
  { id: "ALT-004", level: "market", title: "중동향 총 운송비 벤치마크 상승", detail: "SHP-2026-0008과 관련 가능성이 있습니다. 개별 견적으로 재확인하세요.", shipmentId: "SHP-2026-0008", read: true, snoozed: false },
];

const fmtUsd = (value: number) => `USD ${Math.round(value).toLocaleString("ko-KR")}`;
const fmtPct = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const fmtDate = (value: string) => {
  const [, month = "", day = ""] = value.slice(0, 10).split("-");
  return `${Number(month)}월 ${Number(day)}일`;
};

function provenanceLabel(value: string) {
  if (value === "MARKET_OBSERVED") return "공식 관측";
  if (value === "COMPANY_INPUT") return "회사 입력";
  if (value === "SYNTHETIC") return "합성 목업";
  return "파생 계산";
}

function priorityLabel(priority: DecisionCard["priority"]) {
  return priority === "URGENT" ? "긴급" : priority === "ACTION" ? "조치 필요" : priority === "DATA" ? "데이터 확인" : "관찰";
}

function comparabilityLabel(value: DecisionCard["comparability"]) {
  return value === "DIRECT" ? "KCCI 직접 비교" : value === "NO_CONTROL" ? "부킹 통제 없음" : value === "NO_QUOTE" ? "견적 없음" : "비교 범위 밖";
}

export function PortPulseApp() {
  const [view, setView] = useState<View>("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState("");
  const [shipments, setShipments] = useState<Shipment[]>(mockShipments);
  const [market, setMarket] = useState<MarketPayload>({
    fetchedAt: DEMO_AS_OF,
    freight: mockFreightIndices,
    exchange: mockExchangeRates,
    news: mockNews,
    health: { exchange: "FALLBACK", freight: "FIXED_OFFICIAL_SNAPSHOT", news: "CURATED_OFFICIAL" },
    notices: ["환율 연결 전 마지막 정상값을 표시합니다."],
  });
  const [marketLoading, setMarketLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardPayload>(() => createDashboardFallback(new Date(DEMO_AS_OF)));
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [selectedShipment, setSelectedShipment] = useState<string | null>(null);
  const [newShipmentOpen, setNewShipmentOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/market")
      .then((response) => {
        if (!response.ok) throw new Error("market api unavailable");
        return response.json() as Promise<MarketPayload>;
      })
      .then((payload) => { if (active) setMarket(payload); })
      .catch(() => undefined)
      .finally(() => { if (active) setMarketLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard")
      .then((response) => {
        if (!response.ok) throw new Error("dashboard api unavailable");
        return response.json() as Promise<DashboardPayload>;
      })
      .then((payload) => { if (active) setDashboardData(payload); })
      .catch(() => undefined)
      .finally(() => { if (active) setDashboardLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const decisions = useMemo(
    () => shipments.map((shipment) => buildDecisionCard(shipment, mockQuotes.filter((quote) => quote.shipmentId === shipment.id), market.freight)),
    [shipments, market.freight],
  );
  const selected = selectedShipment ? shipments.find((shipment) => shipment.id === selectedShipment) ?? null : null;
  const selectedDecision = selectedShipment ? decisions.find((decision) => decision.shipmentId === selectedShipment) ?? null : null;

  const changeView = (next: View) => {
    setView(next);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const showShipment = (id: string) => {
    setSelectedShipment(id);
    setAlerts((items) => items.map((item) => item.shipmentId === id ? { ...item, read: true } : item));
  };

  const addShipment = (shipment: Shipment) => {
    setShipments((items) => [shipment, ...items]);
    setNewShipmentOpen(false);
    setToast(`${shipment.id}이 임시 등록되었습니다. 견적을 추가하면 판단을 다시 계산합니다.`);
    setView("shipments");
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">본문으로 바로가기</a>
      <Sidebar view={view} onChange={changeView} data={dashboardData} mobileOpen={mobileNav} onClose={() => setMobileNav(false)} />
      <div className="app-stage">
        <Topbar
          view={view}
          asOf={dashboardData.fetchedAt}
          search={search}
          setSearch={setSearch}
          unread={alerts.filter((item) => !item.read && !item.snoozed).length}
          onMenu={() => setMobileNav(true)}
          onNew={() => setNewShipmentOpen(true)}
          onAlerts={() => changeView("alerts")}
        />
        <main id="main-content" className="main-content">
          {view === "dashboard" && (
            <DashboardView
              data={dashboardData}
              loading={dashboardLoading}
              onView={changeView}
              onChat={() => setChatOpen(true)}
              onRefresh={async () => {
                setDashboardLoading(true);
                try {
                  const response = await fetch(`/api/dashboard?refresh=${Date.now()}`, { cache: "no-store" });
                  if (!response.ok) throw new Error("dashboard api unavailable");
                  setDashboardData(await response.json() as DashboardPayload);
                  setToast("시장 데이터를 다시 확인했습니다.");
                } catch {
                  setToast("새로고침이 지연되어 마지막 정상값을 유지합니다.");
                } finally {
                  setDashboardLoading(false);
                }
              }}
            />
          )}
          {view === "shipments" && <ShipmentsView shipments={shipments} decisions={decisions} query={search} onShipment={showShipment} onNew={() => setNewShipmentOpen(true)} />}
          {view === "quotes" && <QuotesView shipments={shipments} decisions={decisions} onShipment={showShipment} />}
          {view === "market" && <MarketView market={market} loading={marketLoading} shipments={shipments} onRefresh={() => window.location.reload()} />}
          {view === "imports" && <ImportsView onToast={setToast} />}
          {view === "reports" && <ReportsView decisions={decisions} shipments={shipments} />}
          {view === "alerts" && <AlertsView alerts={alerts} setAlerts={setAlerts} onShipment={showShipment} />}
          {view === "settings" && <SettingsView market={market} />}
        </main>
      </div>

      <button className="chat-fab" type="button" onClick={() => setChatOpen(true)} aria-label="PortPulse 어시스턴트 열기">
        <MessageCircle size={22} aria-hidden="true" />
        <span>근거형 챗봇</span>
      </button>
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} onNavigate={(next) => { changeView(next); setChatOpen(false); }} />
      {selected && selectedDecision && <ShipmentDrawer shipment={selected} decision={selectedDecision} onClose={() => setSelectedShipment(null)} onViewQuotes={() => { setSelectedShipment(null); changeView("quotes"); }} />}
      {newShipmentOpen && <NewShipmentModal onClose={() => setNewShipmentOpen(false)} onCreate={addShipment} />}
      {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}</div>}

      <MobileTabs view={view} onChange={changeView} onNew={() => setNewShipmentOpen(true)} onChat={() => setChatOpen(true)} />
    </div>
  );
}

function Sidebar({ view, onChange, data, mobileOpen, onClose }: { view: View; onChange: (view: View) => void; data: DashboardPayload; mobileOpen: boolean; onClose: () => void }) {
  const kcciDate = data.freight.kcci.find((item) => item.code === "KCCI")?.observedAt ?? "확인 중";
  const usableSources = data.sources.filter((source) => source.status === "NORMAL").length;
  return (
    <>
      {mobileOpen && <button className="mobile-scrim" aria-label="메뉴 닫기" onClick={onClose} />}
      <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`} aria-label="주 메뉴">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><Waves size={22} /></div>
          <div><strong>PortPulse</strong><span>Export Decision OS</span></div>
          <button className="icon-button sidebar-close" type="button" onClick={onClose} aria-label="메뉴 닫기"><X size={19} /></button>
        </div>
        <div className="company-switcher">
          <div className="company-avatar">PP</div>
          <div><span>현재 워크스페이스</span><strong>포트펄스 데모기업</strong></div>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.view} type="button" className={view === item.view ? "active" : ""} onClick={() => onChange(item.view)} aria-current={view === item.view ? "page" : undefined}>
                    <Icon size={18} aria-hidden="true" /><span>{item.label}</span>
                    {item.view === "alerts" && <span className="nav-count">3</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button type="button" className={view === "settings" ? "side-settings active" : "side-settings"} onClick={() => onChange("settings")}><Settings size={18} /><span>설정</span></button>
          <div className="data-status">
            <div className="data-status-head"><span className={`status-dot ${usableSources >= 3 ? "live" : "warn"}`} /><strong>시장 소스 {usableSources}개 정상</strong></div>
            <span>KCCI 관측 {kcciDate}</span>
            <span className="demo-pill">USER DATA · SYNTHETIC</span>
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ view, asOf, search, setSearch, unread, onMenu, onNew, onAlerts }: { view: View; asOf: string; search: string; setSearch: (value: string) => void; unread: number; onMenu: () => void; onNew: () => void; onAlerts: () => void }) {
  const fetched = new Date(asOf);
  const fetchedLabel = Number.isNaN(fetched.getTime()) ? "확인 중" : fetched.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
  return (
    <header className="topbar">
      <button className="icon-button menu-button" type="button" onClick={onMenu} aria-label="메뉴 열기"><Menu size={20} /></button>
      <div className="page-title"><span>{viewMeta[view].eyebrow}</span><h1>{viewMeta[view].label}</h1></div>
      <label className="global-search">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">전역 검색</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="선적번호, 항로, 포워더 검색" />
        <kbd>⌘ K</kbd>
      </label>
      <div className="top-actions">
        <button className="asof-button" type="button" title="수집시각과 데이터 관측일은 다를 수 있습니다"><span className="status-dot live" />최근 확인<span>{fetchedLabel}</span></button>
        <button className="icon-button notification-button" type="button" onClick={onAlerts} aria-label={`읽지 않은 알림 ${unread}개`}><Bell size={19} />{unread > 0 && <span>{unread}</span>}</button>
        <button className="primary-button" type="button" onClick={onNew}><Plus size={18} />새 선적</button>
        <div className="user-avatar" title="김무역 담당자">김</div>
      </div>
    </header>
  );
}

function DashboardView({ data, loading, onView, onChat, onRefresh }: {
  data: DashboardPayload;
  loading: boolean;
  onView: (view: View) => void;
  onChat: () => void;
  onRefresh: () => Promise<void>;
}) {
  const todayCount = data.news.filter((item) => item.isToday).length;
  const composite = data.freight.kcci.find((item) => item.code === "KCCI") ?? data.freight.kcci[0];
  const fetchedDate = new Date(data.fetchedAt);
  const todayLabel = fetchedDate.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const connected = data.sources.filter((source) => source.status === "NORMAL").length;
  const limited = data.sources.filter((source) => source.status === "LIMITED" || source.status === "STALE").length;
  return (
    <div className="content-stack market-dashboard">
      <section className="market-hero">
        <div className="market-hero-copy">
          <span className="market-hero-kicker"><span className="status-dot live" />TODAY&apos;S MARITIME PULSE · {todayLabel}</span>
          <h2>수출 담당자가 봐야 할 <strong>해양물류 시장</strong>을 한 화면에.</h2>
          <p>{todayCount > 0 ? `오늘 발행된 공식 소식 ${todayCount}건을 포함해` : "오늘 신규 공식 보도자료는 아직 없어 최근 발행분을 기준으로"} 환율·금리·부산발 운임과 글로벌 지수 상태를 함께 확인합니다.</p>
          <div className="market-hero-actions">
            <button className="hero-primary" type="button" onClick={onChat}><Bot size={17} />시장 브리핑 질문</button>
            <button className="hero-secondary" type="button" onClick={() => void onRefresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />{loading ? "확인 중" : "데이터 새로고침"}</button>
          </div>
        </div>
        <div className="market-hero-status">
          <span>DATA CONNECTION</span>
          <strong>{connected}<small> / {data.sources.length}</small></strong>
          <p>자동 연결·최신성 정상 소스</p>
          <div>{data.sources.map((source) => <i className={`source-light ${source.status.toLowerCase()}`} title={`${source.label}: ${source.statusLabel}`} key={source.id} />)}</div>
          <small>제한 {limited} · 관측일과 확인시각을 분리 표시</small>
        </div>
      </section>

      <section className="market-kpi-grid" aria-label="시장 핵심 지표">
        <MarketKpiCard tone="blue" label="원/미국달러" value={data.macro.usdKrw.latest.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} unit="KRW" change={formatMacroChange(data.macro.usdKrw)} observedAt={data.macro.usdKrw.observedAt} badge={data.macro.usdKrw.mode === "SAMPLE" ? "ECOS SAMPLE" : data.macro.usdKrw.mode} sourceUrl={data.macro.usdKrw.sourceUrl} />
        <MarketKpiCard tone="teal" label="한국은행 기준금리" value={data.macro.baseRate.latest.toFixed(2)} unit="%" change={formatMacroChange(data.macro.baseRate)} observedAt={data.macro.baseRate.observedAt} badge={data.macro.baseRate.mode === "SAMPLE" ? "ECOS SAMPLE" : data.macro.baseRate.mode} sourceUrl={data.macro.baseRate.sourceUrl} />
        <MarketKpiCard tone="amber" label="국고채 3년" value={data.macro.bond3y.latest.toFixed(3)} unit="%" change={formatMacroChange(data.macro.bond3y)} observedAt={data.macro.bond3y.observedAt} badge={data.macro.bond3y.mode === "SAMPLE" ? "ECOS SAMPLE" : data.macro.bond3y.mode} sourceUrl={data.macro.bond3y.sourceUrl} />
        <MarketKpiCard tone="coral" label="KCCI 종합지수" value={composite.value.toLocaleString("ko-KR")} unit="PT" change={`전주 대비 ${signedPercent(composite.weeklyChangePct)}`} observedAt={composite.observedAt} badge={data.freight.kcciMode === "LIVE" ? "KOBC 최신" : "SNAPSHOT"} sourceUrl={composite.sourceUrl} />
      </section>

      <div className="market-news-layout">
        <MarketNewsDesk news={data.news} mode={data.newsMode} />
        <SourceStatusRail data={data} />
      </div>

      <div className="macro-dashboard-grid">
        <section className="panel macro-chart-card">
          <PanelHeading eyebrow="ECOS · EXCHANGE" title="USD/KRW 최근 흐름" count={`${data.macro.usdKrw.points.length}개 관측`} />
          <div className="macro-chart-summary">
            <div><span>최신 관측</span><strong>{data.macro.usdKrw.latest.toLocaleString("ko-KR", { minimumFractionDigits: 1 })}<small> KRW</small></strong></div>
            <div><span>직전 관측 대비</span><strong className={(data.macro.usdKrw.change ?? 0) <= 0 ? "down" : "up"}>{formatMacroChange(data.macro.usdKrw, true)}</strong></div>
            <div><span>관측 기준일</span><strong>{formatObserved(data.macro.usdKrw.observedAt)}</strong></div>
          </div>
          <LineChart series={data.macro.usdKrw} />
          <p className="data-footnote"><Info size={14} />ECOS의 관측일과 화면 수집시각은 다를 수 있습니다. 운영 인증키 연결 전에는 공식 sample 최근 10건만 표시합니다.</p>
        </section>
        <RateMonitor baseRate={data.macro.baseRate} bond3y={data.macro.bond3y} />
      </div>

      <div className="freight-dashboard-grid">
        <KcciDashboard freight={data.freight.kcci} onView={() => onView("market")} />
        <GlobalFreightPanel global={data.freight.global} />
      </div>

      <AiReadiness onImport={() => onView("imports")} onChat={onChat} />

      <section className="dashboard-notices" aria-label="데이터 안내">
        <Info size={16} />
        <div>{data.notices.map((notice) => <p key={notice}>{notice}</p>)}</div>
      </section>
    </div>
  );
}

function formatObserved(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00+09:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric" });
}

function formatMacroChange(series: MacroSeries, compact = false) {
  if (series.change === null) return "직전 관측 없음";
  const digits = series.unit === "KRW" ? 1 : 3;
  const sign = series.change > 0 ? "+" : "";
  const suffix = series.unit === "KRW" ? "원" : "%p";
  return compact ? `${sign}${series.change.toFixed(digits)}${suffix}` : `직전 관측 대비 ${sign}${series.change.toFixed(digits)}${suffix}`;
}

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function MarketKpiCard({ tone, label, value, unit, change, observedAt, badge, sourceUrl }: { tone: string; label: string; value: string; unit: string; change: string; observedAt: string; badge: string; sourceUrl: string }) {
  return (
    <article className={`market-kpi-card ${tone}`}>
      <div className="market-kpi-top"><span>{label}</span><em>{badge}</em></div>
      <strong>{value}<small>{unit}</small></strong>
      <p>{change}</p>
      <div><time>{formatObserved(observedAt)} 관측</time><a href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`${label} 출처 열기`}><ExternalLink size={13} /></a></div>
    </article>
  );
}

function PanelHeading({ eyebrow, title, count, action, onAction }: { eyebrow: string; title: string; count?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="panel-heading">
      <div><span>{eyebrow}</span><h3>{title}{count && <em>{count}</em>}</h3></div>
      {action && <button className="text-button" type="button" onClick={onAction}>{action}<ChevronRight size={15} /></button>}
    </div>
  );
}

function relativePublished(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hours = Math.max(0, (Date.now() - date.getTime()) / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(hours * 60))}분 전`;
  if (hours < 24) return `${Math.floor(hours)}시간 전`;
  return date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function MarketNewsDesk({ news, mode }: { news: DashboardPayload["news"]; mode: DashboardPayload["newsMode"] }) {
  const [filter, setFilter] = useState("전체");
  const filters = ["전체", "물류", "운임", "항만", "통상", "환율"];
  const filtered = news.filter((item) => filter === "전체" || item.category === filter);
  const featured = filtered[0];
  return (
    <section className="panel market-news-desk">
      <div className="news-desk-heading">
        <div><span>OFFICIAL NEWS DESK</span><h3>최근 해양·물류 주요뉴스 <em>{news.filter((item) => item.isToday).length} TODAY</em></h3><p>해양수산부·관세청 공식 RSS의 메타데이터만 최신순으로 집계합니다.</p></div>
        <span className={mode === "FRESH" ? "live-chip" : "fallback-chip"}>{mode === "FRESH" ? "FRESH RSS" : mode === "STALE" ? "RSS · 새 발행 없음" : "BUNDLED DEMO"}</span>
      </div>
      <div className="news-filter-tabs" role="group" aria-label="뉴스 분류">{filters.map((item) => <button aria-pressed={filter === item} className={filter === item ? "active" : ""} type="button" onClick={() => setFilter(item)} key={item}>{item}</button>)}</div>
      {featured ? <>
        <article className="featured-news">
          <div className="featured-news-number">01</div>
          <div>
            <div className="featured-news-meta">{featured.isToday && <strong>오늘</strong>}<span>{featured.category}</span><span>{featured.source}</span><time>{relativePublished(featured.publishedAt)}</time></div>
            <h4>{featured.title}</h4>
            <p>{featured.summary}</p>
            <a href={featured.url} target="_blank" rel="noreferrer">공식 원문 확인 <ExternalLink size={13} /></a>
          </div>
        </article>
        <div className="news-desk-list">{filtered.slice(1, 6).map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" key={item.id}>
          <span>{String(index + 2).padStart(2, "0")}</span>
          <div><p><em>{item.category}</em>{item.source}<time>{relativePublished(item.publishedAt)}</time></p><strong>{item.title}</strong></div>
          <ExternalLink size={14} />
        </a>)}</div>
        <div className="news-source-links"><span>추가 공식 정보원 · 링크 전용</span><a href="https://www.kobc.or.kr/ebz/kor/bbs/list.do?mId=0202000000&ptIdx=251" target="_blank" rel="noreferrer">해양진흥공사<ExternalLink size={11} /></a><a href="https://www.busanpa.com/board/list.do?boardId=BBS_0000031&menuCd=DOM_000000105002001000" target="_blank" rel="noreferrer">부산항만공사<ExternalLink size={11} /></a><a href="https://www.kmi.re.kr/web/board/list.do?rbsIdx=164" target="_blank" rel="noreferrer">KMI<ExternalLink size={11} /></a></div>
      </> : <EmptyState icon={FileText} title="해당 분류의 최근 소식이 없습니다" body="다른 분류를 선택하거나 다음 공식 발행을 기다려 주세요." />}
    </section>
  );
}

function SourceStatusRail({ data }: { data: DashboardPayload }) {
  const statusClass = (status: DashboardPayload["sources"][number]["status"]) => status === "NORMAL" ? "normal" : status === "ACTION_REQUIRED" ? "action" : status === "FALLBACK" ? "fallback" : status === "STALE" ? "stale" : "limited";
  return (
    <aside className="panel source-status-rail">
      <PanelHeading eyebrow="SOURCE HEALTH" title="데이터 연결 상태" />
      <div className="source-status-list">{data.sources.map((source) => <a href={source.sourceUrl} target="_blank" rel="noreferrer" key={source.id}>
        <span className={`source-status-icon ${statusClass(source.status)}`}><Database size={15} /></span>
        <div><p>{source.label}<em className={statusClass(source.status)}>{source.statusLabel}</em></p><strong>{source.detail}</strong><small>관측 {source.observedAt ? formatObserved(source.observedAt) : "미제공"} · 확인 {new Date(source.fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>
        <ExternalLink size={13} />
      </a>)}</div>
      <div className="source-rail-note"><ShieldCheck size={16} /><p><strong>숫자보다 출처 상태를 먼저</strong><span>폴백·샘플·라이선스 필요 상태를 정상 데이터처럼 숨기지 않습니다.</span></p></div>
    </aside>
  );
}

function chartGeometry(points: MacroSeries["points"], width: number, height: number, padding: number) {
  const values = points.map((point) => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const spread = max - min;
  min -= spread * .12;
  max += spread * .12;
  const coords = points.map((point, index) => ({
    x: padding + (points.length === 1 ? 0 : index / (points.length - 1)) * (width - padding * 2),
    y: height - padding - ((point.value - min) / (max - min)) * (height - padding * 2),
    ...point,
  }));
  return { min, max, coords, path: coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ") };
}

function LineChart({ series }: { series: MacroSeries }) {
  const width = 720; const height = 252; const padding = 38;
  const geometry = chartGeometry(series.points, width, height, padding);
  const last = geometry.coords.at(-1);
  return (
    <div className="line-chart-wrap" role="img" aria-label={`${series.label} ${series.points.length}개 관측값 선 그래프`}>
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <defs><linearGradient id={`area-${series.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1f66e5" stopOpacity=".22" /><stop offset="1" stopColor="#1f66e5" stopOpacity="0" /></linearGradient></defs>
        {[0, 1, 2, 3].map((index) => { const y = padding + index * (height - padding * 2) / 3; const value = geometry.max - index * (geometry.max - geometry.min) / 3; return <g key={index}><line x1={padding} x2={width - padding} y1={y} y2={y} className="chart-grid-line" /><text x="2" y={y + 4}>{value.toFixed(1)}</text></g>; })}
        <path d={`${geometry.path} L${last?.x ?? padding},${height - padding} L${padding},${height - padding} Z`} fill={`url(#area-${series.id})`} />
        <path d={geometry.path} className="chart-line" />
        {last && <><circle cx={last.x} cy={last.y} r="6" className="chart-last-halo" /><circle cx={last.x} cy={last.y} r="3" className="chart-last-dot" /></>}
        {[geometry.coords[0], geometry.coords[Math.floor(geometry.coords.length / 2)], geometry.coords.at(-1)].filter(Boolean).map((point, index) => <text className="chart-x-label" x={point!.x} y={height - 7} textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"} key={`${point!.date}-${index}`}>{formatObserved(point!.date)}</text>)}
      </svg>
    </div>
  );
}

function MiniSparkline({ series, tone }: { series: MacroSeries; tone: string }) {
  const geometry = chartGeometry(series.points, 210, 58, 5);
  return <svg className={`mini-sparkline ${tone}`} viewBox="0 0 210 58" aria-hidden="true"><path d={geometry.path} /></svg>;
}

function RateMonitor({ baseRate, bond3y }: { baseRate: MacroSeries; bond3y: MacroSeries }) {
  return <section className="panel rate-monitor"><PanelHeading eyebrow="ECOS · INTEREST RATE" title="금리 모니터" /><div className="rate-monitor-list">
    <article><div><span>한국은행 기준금리</span><em>{baseRate.mode === "SAMPLE" ? "SAMPLE" : baseRate.mode}</em></div><strong>{baseRate.latest.toFixed(2)}<small>%</small></strong><p>{formatMacroChange(baseRate)} · {formatObserved(baseRate.observedAt)}</p><MiniSparkline series={baseRate} tone="teal" /></article>
    <article><div><span>국고채 3년</span><em>{bond3y.mode === "SAMPLE" ? "SAMPLE" : bond3y.mode}</em></div><strong>{bond3y.latest.toFixed(3)}<small>%</small></strong><p>{formatMacroChange(bond3y)} · {formatObserved(bond3y.observedAt)}</p><MiniSparkline series={bond3y} tone="amber" /></article>
  </div><div className="rate-spread"><span>국고채 3년 − 기준금리</span><strong>{(bond3y.latest - baseRate.latest).toFixed(3)}%p</strong><small>금리 수준 비교이며 인과 판단이 아닙니다.</small></div></section>;
}

function KcciDashboard({ freight, onView }: { freight: FreightIndex[]; onView: () => void }) {
  const composite = freight.find((item) => item.code === "KCCI")!;
  const selectedCodes = ["KUWI", "KUEI", "KNEI", "KMEI", "KSEI", "KJI"];
  const routes = selectedCodes.map((code) => freight.find((item) => item.code === code)).filter((item): item is FreightIndex => Boolean(item));
  const max = Math.max(...routes.map((item) => item.value));
  return <section className="panel kcci-dashboard"><PanelHeading eyebrow="KOBC · BUSAN EXPORT" title="부산발 KCCI 항로 운임" action="전체 항로" onAction={onView} /><div className="kcci-composite"><div><Anchor size={20} /><span>종합지수<strong>{composite.value.toLocaleString("ko-KR")} <small>PT</small></strong></span></div><p><em>{signedPercent(composite.weeklyChangePct)}</em><span>전주 대비</span></p><time>{formatObserved(composite.observedAt)} 발표</time></div><div className="kcci-route-list">{routes.map((item) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.code}><div><strong>{item.name}</strong><span>{item.code}</span></div><div className="kcci-track"><i style={{ width: `${Math.max(4, item.value / max * 100)}%` }} /></div><strong>{item.value.toLocaleString("ko-KR")}</strong><em>{signedPercent(item.weeklyChangePct)}</em></a>)}</div><p className="data-footnote"><Info size={14} />부산발 40ft Dry Spot · 항로는 USD/FEU, 종합은 PT입니다. THC·DOC·내륙운송 등 Local Charge는 제외됩니다.</p></section>;
}

function GlobalFreightPanel({ global }: { global: DashboardPayload["freight"]["global"] }) {
  return <section className="panel global-freight-panel"><PanelHeading eyebrow="GLOBAL BENCHMARK" title="글로벌 운임지수" /><div className="global-index-list">{global.map((item) => <article className={item.status === "LICENSE_REQUIRED" ? "license" : "public"} key={item.id}><div className="global-index-top"><span>{item.id === "FBX_GLOBAL" ? "GLOBAL" : "SHANGHAI"}</span><em>{item.statusLabel}</em></div><h4>{item.name}</h4>{item.value === null ? <strong className="index-locked">숫자 비표시 <ShieldCheck size={17} /></strong> : <strong>{item.value.toLocaleString("ko-KR", { minimumFractionDigits: 2 })}<small>{item.unit}</small></strong>}<p>{item.description}</p><div>{item.observedAt && <time>{formatObserved(item.observedAt)} 관측</time>}{item.verifiedAt && <time>{formatObserved(item.verifiedAt)} 수동 확인</time>}<a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.source} 원문 <ExternalLink size={12} /></a>{item.id === "FBX_GLOBAL" && <a href={item.attributionUrl} target="_blank" rel="noreferrer">Freightos Terminal</a>}<a href={item.termsUrl} target="_blank" rel="noreferrer">이용조건</a></div></article>)}</div><div className="global-index-note"><Info size={15} /><p><strong>많이 쓰는 상하이 지수는 SCFI입니다.</strong><span>싱가포르 단일 대표지수와 혼동하지 않습니다. SCFI는 서면 재배포 허가 전 링크만 제공합니다.</span></p></div></section>;
}

function AiReadiness({ onImport, onChat }: { onImport: () => void; onChat: () => void }) {
  return <section className="ai-readiness"><div><span>DATA → DECISION → AI</span><h3>AWS로 갈아끼우는 구조가 아니라, 지금부터 같은 경계로 만듭니다.</h3><p>수치 계산은 결정 규칙이 맡고 Bedrock은 근거를 설명합니다. 원문 기사와 사용 제한 지수는 AI 입력에서 제외합니다.</p></div><div className="ai-flow"><article><Database size={18} /><span>현재 연결</span><strong>ECOS · KCCI · 공식 RSS</strong><small>Next 서버 어댑터</small></article><ArrowRight size={18} /><article><FileSpreadsheet size={18} /><span>사용자 데이터</span><strong>선적 · 견적 · 일정</strong><small>검증 후 승인</small></article><ArrowRight size={18} /><article><SlidersHorizontal size={18} /><span>결정 엔진</span><strong>비교범위 · 예산 · 마감</strong><small>결정론적 계산</small></article><ArrowRight size={18} /><article><Bot size={18} /><span>AWS 전환</span><strong>Lambda · DB · Bedrock</strong><small>같은 API 계약</small></article></div><div className="ai-readiness-actions"><button className="secondary-button" type="button" onClick={onImport}>사용자 데이터 가져오기</button><button className="primary-button" type="button" onClick={onChat}>근거형 챗봇 열기</button></div></section>;
}

function ShipmentsView({ shipments, decisions, query, onShipment, onNew }: { shipments: Shipment[]; decisions: DecisionCard[]; query: string; onShipment: (id: string) => void; onNew: () => void }) {
  const [filter, setFilter] = useState("전체");
  const normalized = query.toLowerCase();
  const rows = shipments.filter((shipment) => {
    const decision = decisions.find((item) => item.shipmentId === shipment.id)!;
    const matchesQuery = !normalized || [shipment.id, shipment.destinationLabel, shipment.routeCode ?? "", shipment.description].join(" ").toLowerCase().includes(normalized);
    const matchesFilter = filter === "전체" || (filter === "조치 필요" && ["URGENT", "ACTION"].includes(decision.priority)) || (filter === "직접 비교" && decision.comparability === "DIRECT") || (filter === "비교 제외" && decision.comparability !== "DIRECT");
    return matchesQuery && matchesFilter;
  });
  return (
    <div className="content-stack">
      <PageIntro title="열린 선적을 한 기준으로 관리합니다" description="계획·견적·부킹·실적을 선적번호로 연결하고, 다음 행동과 근거를 매번 다시 계산합니다." actions={<button className="primary-button" type="button" onClick={onNew}><Plus size={17} />새 선적 등록</button>} />
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="filter-tabs" role="tablist" aria-label="선적 필터">{["전체", "조치 필요", "직접 비교", "비교 제외"].map((item) => <button role="tab" aria-selected={filter === item} className={filter === item ? "active" : ""} type="button" key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
          <div className="toolbar-actions"><button className="secondary-button compact" type="button"><Filter size={16} />필터</button><button className="secondary-button compact" type="button"><Download size={16} />CSV</button></div>
        </div>
        <div className="responsive-table">
          <table>
            <thead><tr><th>선적번호</th><th>항로</th><th>화물·장비</th><th>ETD 구간</th><th>예산</th><th>다음 행동</th><th>KCCI 비교</th><th>상태</th></tr></thead>
            <tbody>{rows.map((shipment) => {
              const decision = decisions.find((item) => item.shipmentId === shipment.id)!;
              return <tr key={shipment.id} onClick={() => onShipment(shipment.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onShipment(shipment.id); }}>
                <td><button className="table-id" type="button">{shipment.id}</button><small>{provenanceLabel(shipment.provenance)}</small></td>
                <td><strong>{shipment.originLabel} → {shipment.destinationLabel}</strong><small>{shipment.pol} / {shipment.pod}</small></td>
                <td><strong>{shipment.equipment} × {shipment.containerCount || 1}</strong><small>{shipment.cargoProfile} · {shipment.loadType}</small></td>
                <td><strong>{fmtDate(shipment.etdWindowStart)}–{fmtDate(shipment.etdWindowEnd)}</strong><small>Ready {fmtDate(shipment.cargoReadyDate)}</small></td>
                <td><strong>{fmtUsd(shipment.targetBudget)}</strong><small>{shipment.costScope}</small></td>
                <td><span className={`status-badge ${decision.priority.toLowerCase()}`}>{decision.actionLabel}</span><small>{fmtDate(decision.deadline)}까지</small></td>
                <td><strong>{comparabilityLabel(decision.comparability)}</strong><small>{decision.kcciVariancePct === null ? "절대금액 미사용" : fmtPct(decision.kcciVariancePct)}</small></td>
                <td><span className="state-dot"><i />{shipment.status === "DECISION_REQUIRED" ? "결정 필요" : shipment.status === "QUOTING" ? "견적 수집" : "계획"}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="table-footer"><span>{rows.length}개 선적</span><span>최근 계산 2026. 7. 12. 09:10 KST</span></div>
      </section>
    </div>
  );
}

function QuotesView({ shipments, decisions, onShipment }: { shipments: Shipment[]; decisions: DecisionCard[]; onShipment: (id: string) => void }) {
  const [shipmentId, setShipmentId] = useState("SHP-2026-0001");
  const shipment = shipments.find((item) => item.id === shipmentId) ?? shipments[0];
  const quotes = mockQuotes.filter((quote) => quote.shipmentId === shipment.id);
  const decision = decisions.find((item) => item.shipmentId === shipment.id)!;
  const lowest = Math.min(...quotes.map((quote) => quote.total));
  return (
    <div className="content-stack">
      <PageIntro title="총액이 아니라 같은 비용 범위로 비교합니다" description="Ocean/Fuel과 Local·Inland 비용을 분리하고, KCCI에 포함되는 항목만 항로 기준과 대사합니다." actions={<button className="secondary-button" type="button" onClick={() => onShipment(shipment.id)}>선적 상세</button>} />
      <section className="panel quote-context">
        <label><span>비교할 선적</span><select value={shipment.id} onChange={(event) => setShipmentId(event.target.value)}>{shipments.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.originLabel} → {item.destinationLabel}</option>)}</select></label>
        <div><span>장비</span><strong>{shipment.equipment} × {shipment.containerCount || 1}</strong></div><div><span>회사 예산</span><strong>{fmtUsd(shipment.targetBudget)}</strong></div><div><span>KCCI</span><strong>{comparabilityLabel(decision.comparability)}</strong></div>
      </section>
      {quotes.length > 0 ? <div className="quote-grid">{quotes.map((quote) => {
        const isBest = quote.total === lowest;
        return <article className={`panel quote-card ${isBest ? "best" : ""}`} key={quote.id}>
          {isBest && <span className="best-ribbon">현재 최저 총액</span>}
          <div className="quote-card-head"><div><span>{quote.id}</span><h3>{quote.forwarder}</h3><p>{quote.carrier} · {quote.direct ? "직항" : `환적 ${quote.transshipments}회`}</p></div><div className="quote-price"><strong>{fmtUsd(quote.total)}</strong><span>유효 {fmtDate(quote.validUntil)}까지</span></div></div>
          <div className="quote-highlights"><div><span>KCCI 비교 가능 비용</span><strong>{fmtUsd(quoteComparableTotal(quote))}</strong></div><div><span>Local·기타 비용</span><strong>{fmtUsd(quote.total - quoteComparableTotal(quote))}</strong></div><div><span>ETA</span><strong>{fmtDate(quote.plannedEta)}</strong></div><div><span>Free Time</span><strong>{quote.freeTimeDays}일</strong></div></div>
          <div className="charge-list"><div className="charge-head"><span>비용 항목</span><span>기준</span><span>금액</span><span>KCCI</span></div>{quote.charges.map((line) => <div key={`${quote.id}-${line.code}`}><span><strong>{line.code}</strong>{line.name}</span><span>{line.basis}</span><span>{fmtUsd(line.amount * line.quantity)}</span><span className={line.kcciComparable ? "yes" : "no"}>{line.kcciComparable ? "포함" : "제외"}</span></div>)}</div>
          <div className="quote-total-check"><CheckCircle2 size={16} /><span>Header {fmtUsd(quote.total)} = Charge Line {fmtUsd(quoteChargeTotal(quote))}</span><strong>대사 완료</strong></div>
        </article>;
      })}</div> : <EmptyState icon={FileSpreadsheet} title="등록된 견적이 없습니다" body="표준 견적 Header와 Charge Line을 업로드하거나 직접 입력하세요." />}
      <div className="scope-banner"><ShieldCheck size={20} /><div><strong>비교 범위 보호가 적용됩니다</strong><p>20ft·LCL·Reefer·DG·OOG 또는 바이어 부킹 거래에는 KCCI 절대금액 우열을 표시하지 않습니다.</p></div></div>
    </div>
  );
}

function MarketView({ market, loading, shipments, onRefresh }: { market: MarketPayload; loading: boolean; shipments: Shipment[]; onRefresh: () => void }) {
  const [newsFilter, setNewsFilter] = useState("전체");
  const freight = market.freight.filter((item) => item.unit === "USD/FEU").sort((a, b) => b.weeklyChangePct - a.weeklyChangePct);
  const news = market.news.filter((item) => newsFilter === "전체" || item.category === newsFilter);
  return (
    <div className="content-stack">
      <PageIntro title="시장 변화는 판단의 근거로만 사용합니다" description="KCCI·환율·공식기관 뉴스를 선적별 납기와 견적에 연결하되, 미래 운임이나 선복을 보장하지 않습니다." actions={<button className="secondary-button" type="button" onClick={onRefresh}><RefreshCw size={16} />새로 확인</button>} />
      <div className="freshness-strip"><div><span className="status-dot live" /><strong>환율</strong><span>{loading ? "확인 중" : market.health.exchange === "LIVE" ? "ECB 최신 관측" : "마지막 정상값"}</span></div><div><span className="status-dot warn" /><strong>KCCI</strong><span>고정 공식 스냅샷 · 2026-07-06</span></div><div><span className="status-dot neutral" /><strong>뉴스</strong><span>공식기관 큐레이션</span></div></div>
      <section className="panel market-table-panel">
        <PanelHeading eyebrow="KOBC KCCI" title="부산발 항로 운임" count={`${freight.length}개 항로`} />
        <div className="market-summary-cards">{freight.slice(0, 4).map((item) => <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="market-summary" key={item.code}><span>{item.name}<ExternalLink size={12} /></span><strong>{item.value.toLocaleString("ko-KR")} <small>{item.unit}</small></strong><em className={item.weeklyChangePct >= 0 ? "positive" : "negative"}>{item.weeklyChangePct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}전주 {signedPercent(item.weeklyChangePct)}</em><small>열린 선적 {shipments.filter((shipment) => shipment.routeCode === item.code).length}건</small></a>)}</div>
        <div className="responsive-table compact-table"><table><thead><tr><th>항로</th><th>코드</th><th>최신값</th><th>주간 변화</th><th>기준일</th><th>열린 선적</th><th>출처</th></tr></thead><tbody>{freight.map((item) => <tr key={item.code}><td><strong>{item.name}</strong></td><td>{item.code}</td><td><strong>{item.value.toLocaleString("ko-KR")}</strong> {item.unit}</td><td className={item.weeklyChangePct >= 0 ? "positive" : "negative"}>{signedPercent(item.weeklyChangePct)}</td><td>{item.observedAt}</td><td>{shipments.filter((shipment) => shipment.routeCode === item.code).length}건</td><td><a href={item.sourceUrl} target="_blank" rel="noreferrer">KOBC<ExternalLink size={12} /></a></td></tr>)}</tbody></table></div>
        <p className="chart-caption"><Info size={14} />종합지수는 PT, 항로별 운임은 USD/FEU입니다. 이 화면은 단위가 다른 값을 한 축에 섞지 않습니다.</p>
      </section>
      <section className="panel fx-panel">
        <PanelHeading eyebrow="EXCHANGE RATE" title="원화 비용 노출" count={market.health.exchange === "LIVE" ? "최신 연결" : "폴백"} />
        <div className="fx-grid">{market.exchange.map((item) => <article key={item.pair}><div><span>{item.pair}</span><em className={item.freshness === "LIVE" ? "live-chip" : "fallback-chip"}>{item.freshness === "LIVE" ? "LIVE SOURCE" : "FALLBACK"}</em></div><strong>{item.value.toLocaleString("ko-KR")}</strong><p className={(item.changePct ?? 0) >= 0 ? "positive" : "negative"}>{(item.changePct ?? 0) >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{fmtPct(item.changePct)} · {item.observedAt}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.source}<ExternalLink size={12} /></a></article>)}</div>
        <div className="scope-note wide"><Info size={15} /><span>시장 환율은 참고용입니다. 포워더 청구환율 또는 회사 적용환율이 입력된 경우 그 값을 우선합니다. USD/KRW 상승은 원화 비용 부담 증가 가능성을 뜻합니다.</span></div>
      </section>
      <section className="panel all-news-panel">
        <div className="panel-heading with-filter"><div><span>OFFICIAL SOURCES</span><h3>주요뉴스</h3></div><div className="filter-tabs">{["전체", "물류", "운임", "통상"].map((item) => <button key={item} type="button" className={newsFilter === item ? "active" : ""} onClick={() => setNewsFilter(item)}>{item}</button>)}</div></div>
        <div className="news-grid">{news.map((item) => <article key={item.id}><div className="news-meta"><span>{item.category}</span><span>{item.source}</span><time>{item.publishedAt}</time></div><h4>{item.title}</h4><p>{item.summary}</p><div className="tag-row">{item.regions.map((region) => <span key={region}>#{region}</span>)}{item.relatedShipmentIds.length > 0 && <strong>관련 가능 {item.relatedShipmentIds.length}건</strong>}</div><a href={item.url} target="_blank" rel="noreferrer">공식 원문 확인<ExternalLink size={14} /></a></article>)}</div>
      </section>
    </div>
  );
}

function ImportsView({ onToast }: { onToast: (message: string) => void }) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [approved, setApproved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const parse = async (file: File) => {
    setParsing(true); setApproved(false);
    try {
      const { parsePortPulseFile } = await import("@/lib/import-workbook");
      setResult(await parsePortPulseFile(file));
    }
    catch (error) { onToast(error instanceof Error ? error.message : "파일을 읽지 못했습니다."); }
    finally { setParsing(false); }
  };
  return (
    <div className="content-stack">
      <PageIntro title="원본을 바로 반영하지 않고 먼저 검증합니다" description="표준 Excel/CSV를 브라우저에서 읽어 필수값·날짜·견적합계를 확인한 뒤 사용자가 승인합니다." actions={<a className="secondary-button" href="/portpulse-import-template.xlsx" download><Download size={16} />표준 템플릿</a>} />
      <section className="panel import-panel">
        <div className="import-steps">{["파일 선택", "파싱", "검증", "매핑 확인", "사용자 승인"].map((step, index) => <div className={(result && index < 4) || approved ? "done" : index === (result ? 3 : parsing ? 1 : 0) ? "active" : ""} key={step}><span>{index + 1}</span><strong>{step}</strong></div>)}</div>
        {!result ? <button className={`dropzone ${parsing ? "busy" : ""}`} type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void parse(file); }}>
          {parsing ? <RefreshCw className="spin" size={32} /> : <UploadCloud size={34} />}
          <strong>{parsing ? "워크북을 읽고 있습니다" : "Excel 또는 CSV 파일을 놓으세요"}</strong>
          <span>선적계획·견적헤더·견적비용 시트를 확인합니다</span><em>파일 선택</em>
        </button> : <ImportResultView result={result} approved={approved} onReset={() => setResult(null)} onApprove={() => { setApproved(true); onToast(`${result.counts.shipments}건의 선적을 승인 대기 상태로 기록했습니다.`); }} />}
        <input ref={inputRef} className="sr-only" type="file" accept=".xlsx,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void parse(file); }} />
      </section>
      <div className="security-grid"><div><ShieldCheck size={20} /><strong>운영 업로드</strong><span>S3 Quarantine → 악성코드 검사 → Staging 검증 → 사용자 확정</span></div><div><Database size={20} /><strong>이 로컬 MVP</strong><span>브라우저 내부 파싱만 수행하며 원본은 서버로 전송하지 않습니다.</span></div><div><SlidersHorizontal size={20} /><strong>오류 수준</strong><span>BLOCKING은 승인 차단, WARNING은 범위 제한, INFO는 안내입니다.</span></div></div>
    </div>
  );
}

function ImportResultView({ result, approved, onReset, onApprove }: { result: ImportResult; approved: boolean; onReset: () => void; onApprove: () => void }) {
  return <div className="import-result">
    <div className="file-summary"><div className="file-icon"><FileSpreadsheet size={25} /></div><div><strong>{result.fileName}</strong><span>{result.fileType} · 선적 {result.counts.shipments} · 견적 {result.counts.quotes} · 비용라인 {result.counts.charges}</span></div><button className="icon-button" type="button" onClick={onReset} aria-label="다른 파일 선택"><X size={18} /></button></div>
    <div className="validation-summary"><div className={result.blocking ? "danger" : "success"}><strong>{result.blocking}</strong><span>차단 오류</span></div><div className="warning"><strong>{result.warnings}</strong><span>확인 필요</span></div><div><strong>{result.issues.filter((issue) => issue.level === "INFO").length}</strong><span>안내</span></div><div className="approval-state">{result.canApprove ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}<strong>{result.canApprove ? "구조 검증 통과" : "수정 후 다시 확인"}</strong></div></div>
    <div className="issue-list">{result.issues.slice(0, 8).map((issue, index) => <div key={`${issue.level}-${index}`} className={issue.level.toLowerCase()}>{issue.level === "BLOCKING" ? <CircleAlert size={16} /> : issue.level === "WARNING" ? <AlertTriangle size={16} /> : <Info size={16} />}<span><strong>{issue.sheet}{issue.row ? ` · ${issue.row}행` : ""}</strong>{issue.message}</span></div>)}</div>
    {result.preview.length > 0 && <div className="preview-table"><h4>선적계획 매핑 미리보기</h4><div className="responsive-table compact-table"><table><thead><tr>{Object.keys(result.preview[0]).slice(0, 7).map((key) => <th key={key}>{key}</th>)}</tr></thead><tbody>{result.preview.slice(0, 3).map((row, index) => <tr key={index}>{Object.keys(result.preview[0]).slice(0, 7).map((key) => <td key={key}>{String(row[key] ?? "")}</td>)}</tr>)}</tbody></table></div></div>}
    <div className="import-actions"><button className="secondary-button" type="button" onClick={onReset}>다른 파일</button><button className="primary-button" type="button" disabled={!result.canApprove || approved} onClick={onApprove}>{approved ? <><Check size={17} />승인 기록 완료</> : "이 매핑 승인"}</button></div>
  </div>;
}

function ReportsView({ decisions, shipments }: { decisions: DecisionCard[]; shipments: Shipment[] }) {
  const exportCsv = () => {
    const headers = ["shipment_id", "action", "deadline", "priority", "confidence", "budget_variance_pct", "kcci_variance_pct", "rule_version"];
    const rows = decisions.map((item) => [item.shipmentId, item.action, item.deadline, item.priority, item.confidence, item.budgetVariancePct ?? "", item.kcciVariancePct ?? "", item.ruleVersion]);
    const blob = new Blob(["\uFEFF" + [headers, ...rows].map((row) => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "portpulse-decision-log.csv"; anchor.click(); URL.revokeObjectURL(url);
  };
  return <div className="content-stack">
    <PageIntro title="결정과 근거를 다시 확인할 수 있게 남깁니다" description="숫자·비교 제외 항목·시장 기준일·규칙 버전을 함께 저장해 담당자와 승인자가 같은 맥락을 봅니다." actions={<><button className="secondary-button" type="button" onClick={() => window.print()}><FileText size={16} />인쇄</button><button className="primary-button" type="button" onClick={exportCsv}><Download size={16} />결정 로그 CSV</button></>} />
    <section className="briefing-hero"><div><span>WEEKLY BRIEFING · 2026-07-12</span><h2>이번 주에는 <strong>{decisions.filter((item) => ["URGENT", "ACTION"].includes(item.priority)).length}건</strong>을 먼저 결정하세요.</h2><p>견적 만료가 임박한 건은 빠르게 확정하고, 예산·KCCI 편차가 큰 건은 짧은 재견적으로 범위를 좁혀야 합니다.</p></div><div className="briefing-number"><span>열린 선적</span><strong>{shipments.length}</strong><small>직접 비교 {decisions.filter((item) => item.comparability === "DIRECT").length}건</small></div></section>
    <div className="report-grid"><section className="panel"><PanelHeading eyebrow="PRIORITY" title="우선 조치" />{decisions.filter((item) => ["URGENT", "ACTION"].includes(item.priority)).slice(0, 5).map((item) => <div className="report-row" key={item.shipmentId}><span className={`status-badge ${item.priority.toLowerCase()}`}>{priorityLabel(item.priority)}</span><div><strong>{item.shipmentId} · {item.actionLabel}</strong><p>{item.reasons[0]}</p></div><time>{item.deadline}</time></div>)}</section><section className="panel"><PanelHeading eyebrow="LIMITATIONS" title="이번 주 확인할 제한" /><ul className="limitation-list"><li><AlertTriangle size={16} /><span>KCCI는 2026-07-06 스냅샷이며 실시간 선복·ETA를 제공하지 않습니다.</span></li><li><AlertTriangle size={16} /><span>20ft·LCL·Reefer·Buyer Booking은 절대금액 직접 비교에서 제외했습니다.</span></li><li><Info size={16} /><span>환율은 시장 참고값이며 회사 적용환율을 대체하지 않습니다.</span></li></ul></section></div>
    <section className="panel table-panel"><PanelHeading eyebrow="AUDIT TRAIL" title="결정 로그" count={`rule ${decisions[0]?.ruleVersion}`} /><div className="responsive-table compact-table"><table><thead><tr><th>선적</th><th>행동</th><th>기한</th><th>신뢰도</th><th>예산 편차</th><th>KCCI 편차</th><th>Evidence</th></tr></thead><tbody>{decisions.map((item) => <tr key={item.shipmentId}><td><strong>{item.shipmentId}</strong></td><td>{item.actionLabel}</td><td>{item.deadline}</td><td>{item.confidence}</td><td>{fmtPct(item.budgetVariancePct)}</td><td>{fmtPct(item.kcciVariancePct)}</td><td>{item.evidenceIds.join(" · ")}</td></tr>)}</tbody></table></div></section>
  </div>;
}

function AlertsView({ alerts, setAlerts, onShipment }: { alerts: AlertItem[]; setAlerts: React.Dispatch<React.SetStateAction<AlertItem[]>>; onShipment: (id: string) => void }) {
  const visible = alerts.filter((item) => !item.snoozed);
  return <div className="content-stack"><PageIntro title="같은 사건은 한 번만, 필요한 행동과 함께 알립니다" description="긴급·조치 필요·데이터 확인·시장 참고 순으로 정렬하고 읽음·미루기·완료를 기록합니다." actions={<button className="secondary-button" type="button" onClick={() => setAlerts((items) => items.map((item) => ({ ...item, read: true })))}><Check size={16} />모두 읽음</button>} />
    <section className="panel alerts-panel"><div className="alert-tabs"><button className="active" type="button">받은 알림 <span>{visible.length}</span></button><button type="button">미룬 알림 <span>{alerts.filter((item) => item.snoozed).length}</span></button></div>{visible.map((item) => <article className={`${item.read ? "read" : ""} alert-${item.level}`} key={item.id}><div className="alert-icon">{item.level === "urgent" ? <CircleAlert /> : item.level === "action" ? <Clock3 /> : item.level === "data" ? <Database /> : <TrendingUp />}</div><div><div><span>{item.level === "urgent" ? "긴급" : item.level === "action" ? "조치 필요" : item.level === "data" ? "데이터 확인" : "시장 참고"}</span><time>오늘 09:10</time></div><h3>{item.title}</h3><p>{item.detail}</p><div className="alert-actions">{item.shipmentId && <button type="button" onClick={() => onShipment(item.shipmentId!)}>선적 열기</button>}<button type="button" onClick={() => setAlerts((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, snoozed: true } : candidate))}>내일까지 미루기</button><button type="button" onClick={() => setAlerts((items) => items.filter((candidate) => candidate.id !== item.id))}>조치 완료</button></div></div>{!item.read && <span className="unread-dot" />}</article>)}</section>
  </div>;
}

function SettingsView({ market }: { market: MarketPayload }) {
  return <div className="content-stack"><PageIntro title="추천보다 데이터 경계가 먼저입니다" description="비교 범위·알림·데이터 출처를 회사 정책에 맞춰 관리합니다." />
    <div className="settings-grid"><section className="panel settings-card"><div className="settings-title"><div><Database size={19} /></div><div><h3>데이터 소스</h3><p>현재 MVP 연결 상태</p></div></div><div className="settings-list"><div><span>KCCI</span><strong>고정 공식 스냅샷</strong><em className="fallback-chip">2026-07-06</em></div><div><span>환율</span><strong>ECB via Frankfurter</strong><em className={market.health.exchange === "LIVE" ? "live-chip" : "fallback-chip"}>{market.health.exchange}</em></div><div><span>주요뉴스</span><strong>공식기관 큐레이션</strong><em className="neutral-chip">원문 링크</em></div></div></section><section className="panel settings-card"><div className="settings-title"><div><SlidersHorizontal size={19} /></div><div><h3>의사결정 정책</h3><p>decision-v1.0.0</p></div></div><div className="settings-list"><div><span>예산 경고</span><strong>+5% 초과</strong><button type="button">변경</button></div><div><span>KCCI 직접 비교</span><strong>부산발 40ft Dry FCL</strong><button type="button">고정</button></div><div><span>LLM 역할</span><strong>설명·조회만 허용</strong><button type="button">고정</button></div></div></section><section className="panel settings-card"><div className="settings-title"><div><Bell size={19} /></div><div><h3>알림 채널</h3><p>MVP 기본 설정</p></div></div><div className="settings-list"><div><span>이메일</span><strong>운영 기본</strong><em className="live-chip">ON</em></div><div><span>Telegram</span><strong>데모 옵션</strong><em className="neutral-chip">OFF</em></div><div><span>Kakao</span><strong>사업자·템플릿 승인 후</strong><em className="fallback-chip">PHASE 2</em></div></div></section></div>
    <section className="panel source-contract"><PanelHeading eyebrow="SOURCE CONTRACT" title="신선도와 실패 시 동작" /><div className="responsive-table compact-table"><table><thead><tr><th>데이터</th><th>정상 경로</th><th>실패 시</th><th>사용자 표시</th></tr></thead><tbody><tr><td>KCCI</td><td>허가된 공식 다운로드</td><td>마지막 정상 스냅샷</td><td>stale 배지·금액 권고 억제</td></tr><tr><td>환율</td><td>Frankfurter ECB</td><td>마지막 정상값</td><td>FALLBACK과 기준일 표시</td></tr><tr><td>뉴스</td><td>공식기관 RSS/API</td><td>관리자 큐레이션</td><td>관련 가능성만 표시</td></tr></tbody></table></div></section>
  </div>;
}

function PageIntro({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return <section className="page-intro"><div><h2>{title}</h2><p>{description}</p></div>{actions && <div className="page-intro-actions">{actions}</div>}</section>;
}

function ChatPanel({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (view: View) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: "hello", role: "assistant", text: "등록된 선적·견적과 승인된 시장 근거를 바탕으로 설명합니다. 부킹을 실행하거나 미래 운임을 보장하지 않습니다." }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);
  const submit = async (value = input) => {
    const question = value.trim(); if (!question || sending) return;
    setInput(""); setSending(true);
    setMessages((items) => [...items, { id: `u-${Date.now()}`, role: "user", text: question }]);
    let answer: ChatAnswer;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: question }) });
      if (!response.ok) throw new Error("chat api unavailable");
      answer = await response.json() as ChatAnswer;
    } catch { answer = answerPortPulseQuestion(question); }
    setMessages((items) => [...items, { id: `a-${Date.now()}`, role: "assistant", text: answer.answer, answer }]);
    setSending(false);
  };
  const prompts = ["7일 안에 결정할 선적은?", "SHP-2026-0001이 왜 재견적 대상이야?", "KCCI 직접 비교 제외 기준은?", "환율이 원화 예산에 미치는 영향은?"];
  if (!open) return null;
  return <><button className="drawer-scrim" type="button" aria-label="챗봇 닫기" onClick={onClose} /><aside className="chat-panel open" role="dialog" aria-modal="true" aria-label="PortPulse 어시스턴트">
    <div className="chat-head"><div className="assistant-mark"><Bot size={20} /></div><div><strong>PortPulse 어시스턴트</strong><span><i />근거형 조회 모드</span></div><button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="챗봇 닫기"><X size={19} /></button></div>
    <div className="chat-scope"><ShieldCheck size={15} /><span>조회·설명만 수행합니다. 숫자 계산은 규칙엔진 결과를 사용합니다.</span></div>
    <div className="chat-body">{messages.map((message) => <div className={`chat-message ${message.role}`} key={message.id}>{message.role === "assistant" && <div className="message-avatar">P</div>}<div className="message-bubble"><p>{message.text}</p>{message.answer && <div className="answer-detail"><div><strong>사용한 숫자</strong><ul>{message.answer.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul></div><div><strong>비교 제외·한계</strong><ul>{message.answer.exclusions.map((fact) => <li key={fact}>{fact}</li>)}</ul></div><div className="answer-sources"><span>기준 {new Date(message.answer.asOf).toLocaleString("ko-KR")}</span>{message.answer.sources.map((source, index) => source.url ? <a key={`${source.label}-${index}`} href={source.url} target="_blank" rel="noreferrer">{source.label}<ExternalLink size={11} /></a> : <span key={`${source.label}-${index}`}>{source.label}</span>)}</div><button type="button" onClick={() => onNavigate(message.answer!.suggestedView)}>관련 화면 열기<ArrowRight size={14} /></button></div>}</div></div>)}{sending && <div className="chat-message assistant"><div className="message-avatar">P</div><div className="typing"><i /><i /><i /></div></div>}<div ref={endRef} /></div>
    {messages.length <= 1 && <div className="quick-prompts"><span>추천 질문</span>{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => void submit(prompt)}>{prompt}<ChevronRight size={14} /></button>)}</div>}
    <form className="chat-input" onSubmit={(event) => { event.preventDefault(); void submit(); }}><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="선적·견적·시장 근거를 질문하세요" rows={2} maxLength={500} /><button type="submit" disabled={!input.trim() || sending} aria-label="질문 보내기"><Send size={17} /></button><span>{input.length}/500</span></form>
  </aside></>;
}

function ShipmentDrawer({ shipment, decision, onClose, onViewQuotes }: { shipment: Shipment; decision: DecisionCard; onClose: () => void; onViewQuotes: () => void }) {
  const quote = mockQuotes.find((item) => item.id === decision.quoteId);
  return <><button className="drawer-scrim" type="button" aria-label="선적 상세 닫기" onClick={onClose} /><aside className="detail-drawer" aria-label={`${shipment.id} 상세`}>
    <div className="detail-head"><div><span>{shipment.id}</span><h2>{shipment.originLabel} → {shipment.destinationLabel}</h2><p>{shipment.description} · {shipment.equipment} × {shipment.containerCount || 1}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="닫기"><X size={20} /></button></div>
    <div className={`detail-decision ${decision.priority.toLowerCase()}`}><div><span className={`status-badge ${decision.priority.toLowerCase()}`}>{priorityLabel(decision.priority)}</span><strong>{fmtDate(decision.deadline)}까지 {decision.actionLabel}</strong></div><p>{decision.reasons.join(" ")}</p>{decision.counterSignals[0] && <div><AlertTriangle size={15} /><span>반대 신호: {decision.counterSignals[0]}</span></div>}</div>
    <div className="drawer-tabs"><button className="active" type="button">개요</button><button type="button">일정·마감</button><button type="button">판정 근거</button></div>
    <div className="drawer-section"><h3>핵심 지표</h3><div className="detail-metrics"><div><span>선택 견적</span><strong>{quote ? fmtUsd(quote.total) : "미등록"}</strong></div><div><span>예산 편차</span><strong>{fmtPct(decision.budgetVariancePct)}</strong></div><div><span>KCCI 편차</span><strong>{fmtPct(decision.kcciVariancePct)}</strong></div><div><span>납기 버퍼</span><strong>{decision.deliveryBufferDays ?? "—"}일</strong></div></div></div>
    <div className="drawer-section"><h3>일정</h3><div className="timeline"><div className="done"><i /><span>Cargo Ready<strong>{shipment.cargoReadyDate}</strong></span></div><div className="current"><i /><span>ETD 가능 구간<strong>{shipment.etdWindowStart} – {shipment.etdWindowEnd}</strong></span></div><div><i /><span>요구 납기<strong>{shipment.requiredDeliveryDate}</strong></span></div></div></div>
    <div className="drawer-section"><h3>판정 근거</h3><ul className="evidence-list">{decision.evidenceIds.map((id) => <li key={id}><CheckCircle2 size={15} /><span>{id}</span></li>)}</ul><div className="rule-meta"><span>Rule</span><strong>{decision.ruleVersion}</strong><span>Coverage</span><strong>{decision.dataCoveragePct}% · {decision.confidence}</strong></div></div>
    <div className="detail-actions"><button className="secondary-button" type="button" onClick={onClose}>닫기</button><button className="primary-button" type="button" onClick={onViewQuotes}>견적 비교 열기</button></div>
  </aside></>;
}

function NewShipmentModal({ onClose, onCreate }: { onClose: () => void; onCreate: (shipment: Shipment) => void }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ destination: "USLGB", cargoReady: "2026-07-20", etdStart: "2026-07-27", etdEnd: "2026-07-31", delivery: "2026-08-25", loadType: "FCL", equipment: "40HC", count: "1", profile: "DRY", description: "", incoterm: "CFR", place: "LONG BEACH PORT", booking: "SELLER", budget: "6500" });
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const routes: Record<string, { label: string; code: string }> = { USLGB: { label: "롱비치", code: "KUWI" }, NLRTM: { label: "로테르담", code: "KNEI" }, SGSIN: { label: "싱가포르", code: "KSEI" }, AEAUH: { label: "아부다비", code: "KMEI" }, JPTYO: { label: "도쿄", code: "KJI" } };
  const submit = () => {
    const route = routes[form.destination]; const id = `SHP-2026-${String(9000 + Math.floor(Math.random() * 900)).padStart(4, "0")}`;
    onCreate({ id, provenance: "COMPANY_INPUT", cargoReadyDate: form.cargoReady, etdWindowStart: form.etdStart, etdWindowEnd: form.etdEnd, requiredDeliveryDate: form.delivery, pol: "KRPUS", pod: form.destination, originLabel: "부산", destinationLabel: route.label, routeCode: route.code, loadType: form.loadType as Shipment["loadType"], equipment: form.equipment, containerCount: Number(form.count), grossWeightKg: 10000, cargoProfile: form.profile as Shipment["cargoProfile"], hsCode: "미입력", description: form.description || "신규 수출 화물", incoterm: form.incoterm, incotermPlace: form.place, bookingController: form.booking as Shipment["bookingController"], mainCarriagePayer: form.booking === "BUYER" ? "BUYER" : "SELLER", targetBudget: Number(form.budget), currency: "USD", costScope: form.incoterm === "DAP" ? "DOOR_TO_DOOR" : "ORIGIN_ALL_IN", hardDeadline: true, maxShiftDays: 3, status: "PLANNED" });
  };
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="새 선적 등록"><button className="modal-scrim" aria-label="닫기" onClick={onClose} /><div className="modal-card"><div className="modal-head"><div><span>NEW SHIPMENT</span><h2>새 선적 등록</h2><p>필수 정보만 입력해도 견적 요청 준비 상태로 저장됩니다.</p></div><button className="icon-button" type="button" onClick={onClose}><X size={20} /></button></div><div className="wizard-progress">{["항로·일정", "화물·장비", "거래조건·예산", "검토"].map((label, index) => <div key={label} className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""}><span>{step > index + 1 ? <Check size={14} /> : index + 1}</span><strong>{label}</strong></div>)}</div>
    <div className="modal-body">{step === 1 && <div className="form-grid"><label><span>출발항</span><input value="KRPUS · 부산" disabled /></label><label><span>도착항</span><select value={form.destination} onChange={(event) => update("destination", event.target.value)}>{Object.entries(routes).map(([code, route]) => <option key={code} value={code}>{code} · {route.label}</option>)}</select></label><label><span>Cargo Ready</span><input type="date" value={form.cargoReady} onChange={(event) => update("cargoReady", event.target.value)} /></label><label><span>ETD 시작</span><input type="date" value={form.etdStart} onChange={(event) => update("etdStart", event.target.value)} /></label><label><span>ETD 종료</span><input type="date" value={form.etdEnd} onChange={(event) => update("etdEnd", event.target.value)} /></label><label><span>요구 납기</span><input type="date" value={form.delivery} onChange={(event) => update("delivery", event.target.value)} /></label></div>}{step === 2 && <div className="form-grid"><label><span>적재 방식</span><select value={form.loadType} onChange={(event) => update("loadType", event.target.value)}><option>FCL</option><option>LCL</option></select></label><label><span>장비 규격</span><select value={form.equipment} onChange={(event) => update("equipment", event.target.value)}><option>40HC</option><option>40GP</option><option>20GP</option><option>40RF</option><option>LCL</option></select></label><label><span>컨테이너 수</span><input type="number" min="0" value={form.count} onChange={(event) => update("count", event.target.value)} /></label><label><span>화물 프로필</span><select value={form.profile} onChange={(event) => update("profile", event.target.value)}><option>DRY</option><option>REEFER</option><option>DG</option><option>OOG</option></select></label><label className="full"><span>품명</span><input value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="예: 자동차 브레이크 부품" /></label></div>}{step === 3 && <div className="form-grid"><label><span>Incoterms 2020</span><select value={form.incoterm} onChange={(event) => update("incoterm", event.target.value)}><option>CFR</option><option>CIF</option><option>CPT</option><option>CIP</option><option>DAP</option><option>FOB</option></select></label><label><span>Named Place</span><input value={form.place} onChange={(event) => update("place", event.target.value)} /></label><label><span>부킹 주체</span><select value={form.booking} onChange={(event) => update("booking", event.target.value)}><option>SELLER</option><option>BUYER</option><option>FORWARDER</option></select></label><label><span>목표 예산 (USD)</span><input type="number" min="0" value={form.budget} onChange={(event) => update("budget", event.target.value)} /></label><div className="form-help full"><Info size={16} /><span>Incoterms만으로 부킹 통제자를 단정하지 않습니다. 실제 국제운송비 부담자와 Booking Controller를 확인하세요.</span></div></div>}{step === 4 && <div className="review-grid"><div><span>항로</span><strong>부산 → {routes[form.destination].label}</strong><small>KRPUS / {form.destination}</small></div><div><span>일정</span><strong>{form.etdStart} – {form.etdEnd}</strong><small>납기 {form.delivery}</small></div><div><span>화물</span><strong>{form.equipment} × {form.count} · {form.profile}</strong><small>{form.description || "품명 미입력"}</small></div><div><span>거래</span><strong>{form.incoterm} {form.place}</strong><small>부킹 {form.booking}</small></div><div><span>목표 예산</span><strong>{fmtUsd(Number(form.budget))}</strong><small>견적 등록 후 비교 시작</small></div><div className="review-status"><CheckCircle2 size={20} /><strong>임시등록 가능</strong><span>견적이 없어 첫 행동은 ‘견적 요청’으로 생성됩니다.</span></div></div>}</div>
    <div className="modal-actions"><button className="secondary-button" type="button" onClick={step === 1 ? onClose : () => setStep((value) => value - 1)}>{step === 1 ? "취소" : "이전"}</button><button className="primary-button" type="button" onClick={step === 4 ? submit : () => setStep((value) => value + 1)}>{step === 4 ? "임시등록" : "다음"}<ArrowRight size={16} /></button></div></div></div>;
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof FileSpreadsheet; title: string; body: string }) {
  return <div className="empty-state"><Icon size={28} /><h3>{title}</h3><p>{body}</p></div>;
}

function MobileTabs({ view, onChange, onNew, onChat }: { view: View; onChange: (view: View) => void; onNew: () => void; onChat: () => void }) {
  return <nav className="mobile-tabs" aria-label="모바일 메뉴"><button className={view === "dashboard" ? "active" : ""} type="button" onClick={() => onChange("dashboard")}><LayoutDashboard size={20} /><span>홈</span></button><button className={view === "shipments" ? "active" : ""} type="button" onClick={() => onChange("shipments")}><Ship size={20} /><span>선적</span></button><button className="mobile-add" type="button" onClick={onNew}><Plus size={22} /><span>등록</span></button><button className={view === "alerts" ? "active" : ""} type="button" onClick={() => onChange("alerts")}><Bell size={20} /><span>알림</span></button><button type="button" onClick={onChat}><Bot size={20} /><span>챗봇</span></button></nav>;
}
