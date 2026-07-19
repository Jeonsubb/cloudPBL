// PortPulse 공통 JS — 모든 페이지가 <script src="common.js"></script>로 로드.
// 각 페이지는 이 파일의 함수들을 자기 마운트 지점·limit/compact 옵션으로 호출한다.
const API_URL = window.location.search.includes("api=")
  ? new URLSearchParams(window.location.search).get("api")
  : "https://t7ggohc5tb.execute-api.ap-northeast-2.amazonaws.com";

/* ---------- 인증(Cognito) — 회사별 로그인 ----------
   정적 프론트라 SDK 없이 Cognito IDP API를 fetch로 직접 호출한다.
   IdToken(회사 sub·name 포함)을 localStorage에 보관하고, 보호 API 호출에 Authorization으로 붙인다. */
const COGNITO = {
  region: "ap-northeast-2",
  userPoolId: "ap-northeast-2_rDBGCCBDr",
  clientId: "7j7pmgejoq07qdppeb6htt8n6p",
};
const COGNITO_IDP = `https://cognito-idp.${COGNITO.region}.amazonaws.com/`;

function getSession() { try { return JSON.parse(localStorage.getItem("pp_session") || "null"); } catch { return null; } }
function setSession(s) { localStorage.setItem("pp_session", JSON.stringify(s)); }
function clearSession() { localStorage.removeItem("pp_session"); }
function idToken() {
  const s = getSession();
  if (!s?.idToken) return null;
  if (s.exp && Date.now() / 1000 > s.exp) { clearSession(); return null; } // 만료 토큰 폐기
  return s.idToken;
}
function companyName() { return getSession()?.companyName || "회사"; }
function authHeaders() { const t = idToken(); return t ? { Authorization: `Bearer ${t}` } : {}; }
function requireAuth() { if (!idToken()) { location.href = "login.html"; return false; } return true; }
function logout() { clearSession(); location.href = "index.html"; }

// 보호 API 호출용 — Authorization 자동 첨부 + 401이면 세션 만료로 보고 로그인으로.
async function authedFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...authHeaders() } });
  if (res.status === 401) { clearSession(); location.href = "login.html"; throw new Error("세션이 만료되었습니다. 다시 로그인하세요."); }
  return res;
}

function decodeJwt(token) {
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return {}; }
}
async function cognitoCall(target, body) {
  const res = await fetch(COGNITO_IDP, {
    method: "POST",
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const t = (data.__type || "").split("#").pop(); throw new Error(data.message || t || "요청 실패"); }
  return data;
}
async function ppSignUp(email, password, company) {
  return cognitoCall("SignUp", {
    ClientId: COGNITO.clientId, Username: email, Password: password,
    UserAttributes: [{ Name: "name", Value: company }, { Name: "email", Value: email }],
  });
}
async function ppConfirmSignUp(email, code) {
  return cognitoCall("ConfirmSignUp", { ClientId: COGNITO.clientId, Username: email, ConfirmationCode: code });
}
async function ppLogin(email, password) {
  const data = await cognitoCall("InitiateAuth", {
    ClientId: COGNITO.clientId, AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  const r = data.AuthenticationResult;
  if (!r?.IdToken) throw new Error("로그인 응답에 토큰이 없습니다.");
  const claims = decodeJwt(r.IdToken);
  setSession({ idToken: r.IdToken, accessToken: r.AccessToken, companyName: claims.name || email, email, exp: claims.exp });
  return claims;
}

/* ---------- 상단 네비게이션 ---------- */
const NAV_PAGES = [
  { href: "dashboard.html", key: "home", icon: "🏠", label: "업무 홈" },
  { href: "recommendation.html", key: "reco", icon: "🚢", label: "AI 선적 추천" },
  { href: "market.html", key: "market", icon: "📈", label: "시황" },
  { href: "schedule.html", key: "schedule", icon: "🗓️", label: "실시간 스케줄" },
  { href: "news.html", key: "news", icon: "📰", label: "뉴스" },
];
// 좌측 고정 사이드바(브랜드 + 네비 + 회사칩/로그아웃)를 body에 1회 주입.
function renderNav(activeKey) {
  if (document.getElementById("ppSidebar")) {
    // 이미 있으면 active만 갱신
    document.querySelectorAll("#ppSidebar .sb-nav a").forEach((a) => a.classList.toggle("active", a.dataset.key === activeKey));
    return;
  }
  const aside = document.createElement("aside");
  aside.id = "ppSidebar";
  aside.className = "app-sidebar";
  aside.innerHTML = `
    <a class="sb-brand" href="dashboard.html">
      <span class="brand-ship" aria-hidden="true"></span>
      <div><h1>PortPulse</h1><div class="tag">해운 운임 · AI 선적추천</div></div>
    </a>
    <nav class="sb-nav">
      ${NAV_PAGES.map((p) => `<a href="${p.href}" data-key="${p.key}" class="${p.key === activeKey ? "active" : ""}"><span class="ic">${p.icon}</span><span>${p.label}</span></a>`).join("")}
    </nav>
    <div class="sb-foot">
      <div class="sb-user"><div class="co">${esc(companyName())}</div><div class="em">${esc(getSession()?.email || "")}</div></div>
      <button type="button" id="sbLogout">로그아웃</button>
    </div>`;
  document.body.prepend(aside);
  document.body.classList.add("has-sidebar");
  const lo = document.getElementById("sbLogout");
  if (lo) lo.addEventListener("click", logout);
}

// 모든 페이지가 가장 먼저 부른다 — 로그인 게이트 + 상단 슬림바(갱신시각 표시).
// login.html은 이 함수를 부르지 않으므로 리다이렉트 루프가 없다.
function renderBrandHeader(updatedId = "updated") {
  if (!requireAuth()) return;
  const mount = document.getElementById("headerMount");
  if (mount) {
    mount.innerHTML = `<div class="topbar"><div class="tb-updated" id="${updatedId}">불러오는 중…</div></div>`;
  }
}

/* ---------- 공용 유틸 ---------- */
const fmtNum = (v, d = 2) => v.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const mdShort = (iso) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : "");
const ccFlag = (cc) => Array.from(cc.toUpperCase()).map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join("");
const fmtPct = (v) => (v === null || v === undefined ? "N/A" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

/* ---------- 시계열 차트(KCCI/환율/금리 카드 공용) ---------- */
const RANGES = [
  { key: "1w", label: "1주", days: 7 },
  { key: "1m", label: "1개월", days: 30 },
  { key: "1y", label: "1년", days: 365 },
  { key: "3y", label: "3년", days: 1095 },
  { key: "max", label: "전체", days: 20000 },
];
const CARD_CONFIG = {
  KCCI:          { defaultRange: "1y",  decimals: 0 },
  FX_USD_KRW:    { defaultRange: "1y",  decimals: 2 },
  FX_JPY_KRW:    { defaultRange: "1y",  decimals: 2 },
  FX_EUR_KRW:    { defaultRange: "1y",  decimals: 2 },
  FX_CNY_KRW:    { defaultRange: "1y",  decimals: 2 },
  BOK_BASE_RATE: { defaultRange: "max", decimals: 2, ranges: ["1y", "3y", "max"], collapseFlat: true, stepped: true },
  OIL_WTI:       { defaultRange: "1y",  decimals: 2 },
  OIL_BRENT:     { defaultRange: "1y",  decimals: 2 },
};

const CHART_W = 460, CHART_H = 168, CHART_PAD = { top: 12, right: 14, bottom: 22, left: 52 };

function niceTicks(min, max, count = 4) {
  if (min === max) { const p = Math.abs(min) * 0.05 || 1; min -= p; max += p; }
  const span = max - min;
  const step = 10 ** Math.floor(Math.log10(span / count));
  const err = span / count / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const tick = step * mult;
  const lo = Math.floor(min / tick) * tick, hi = Math.ceil(max / tick) * tick;
  const ticks = [];
  for (let v = lo; v <= hi + tick / 2; v += tick) ticks.push(Number(v.toFixed(10)));
  return { ticks, lo, hi };
}
function fmtDate(dateStr, spanDays) {
  const [y, m, d] = dateStr.split("-");
  if (spanDays <= 45) return `${+m}/${+d}`;
  if (spanDays <= 400) return `${y.slice(2)}.${+m}`;
  return `'${y.slice(2)}`;
}
function collapseUnchanged(points) {
  if (points.length === 0) return points;
  const collapsed = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (points[i].value !== collapsed.at(-1).value) collapsed.push(points[i]);
  }
  const last = points.at(-1);
  if (collapsed.at(-1).date !== last.date) collapsed.push(last);
  return collapsed;
}
function renderChart(points, decimals, stepped) {
  const values = points.map((p) => p.value);
  const { ticks, lo, hi } = niceTicks(Math.min(...values), Math.max(...values));
  const plotW = CHART_W - CHART_PAD.left - CHART_PAD.right, plotH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const t0 = new Date(points[0].date).getTime(), t1 = new Date(points.at(-1).date).getTime();
  const spanDays = (t1 - t0) / 86400000 || 1;
  const x = (i) => CHART_PAD.left + (t1 === t0 ? plotW / 2 : ((new Date(points[i].date).getTime() - t0) / (t1 - t0)) * plotW);
  const y = (v) => CHART_PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const line = stepped
    ? points.map((p, i) => {
        if (i === 0) return `M${x(0).toFixed(1)},${y(p.value).toFixed(1)}`;
        return `L${x(i).toFixed(1)},${y(points[i - 1].value).toFixed(1)} L${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
      }).join(" ")
    : points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(CHART_PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(CHART_PAD.top + plotH).toFixed(1)} Z`;

  const grid = ticks.map((t) =>
    `<line x1="${CHART_PAD.left}" y1="${y(t).toFixed(1)}" x2="${CHART_W - CHART_PAD.right}" y2="${y(t).toFixed(1)}" stroke="#eef2f7"/>` +
    `<text x="${CHART_PAD.left - 9}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#94a3b8">${fmtNum(t, decimals)}</text>`
  ).join("");

  const xCount = Math.min(5, points.length);
  const xLabels = Array.from({ length: xCount }, (_, k) => {
    const i = Math.round((k / (xCount - 1 || 1)) * (points.length - 1));
    return `<text x="${x(i).toFixed(1)}" y="${CHART_H - 8}" text-anchor="middle" font-size="10.5" fill="#94a3b8">${fmtDate(points[i].date, spanDays)}</text>`;
  }).join("");

  const last = points.at(-1);
  const gid = "g" + Math.random().toString(36).slice(2, 8);
  return `<svg class="chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2563eb" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#2563eb" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}${xLabels}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="3.5" fill="#2563eb" stroke="#fff" stroke-width="1.5"/>
  </svg>`;
}
function changeInfo(points, rangeLabel, decimals) {
  const first = points[0], last = points.at(-1);
  const diff = last.value - first.value;
  const pct = first.value ? (diff / first.value) * 100 : 0;
  const cls = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "—";
  const sign = diff >= 0 ? "+" : "−";
  return {
    cls,
    chip: `${arrow} ${sign}${fmtNum(Math.abs(diff), decimals)} (${sign}${Math.abs(pct).toFixed(2)}%)`,
    caption: `${rangeLabel} · ${first.date} → ${last.date}`,
  };
}
function makeSeriesCard(meta, hero) {
  const card = document.createElement("div");
  card.className = "card" + (hero ? " hero" : "");
  const cfgForRanges = CARD_CONFIG[meta.id] ?? {};
  const availableRanges = cfgForRanges.ranges ? RANGES.filter((r) => cfgForRanges.ranges.includes(r.key)) : RANGES;
  const rangeBtns = availableRanges.map((r) => `<button type="button" data-range="${r.key}">${r.label}</button>`).join("");
  card.innerHTML = `
    <div class="card-head">
      <h2>${meta.label}</h2>
      <span class="src">${meta.source}</span>
    </div>
    <div class="rangebar">${rangeBtns}</div>
    <div class="body"><div class="loading">불러오는 중…</div></div>`;
  const cfg = CARD_CONFIG[meta.id] ?? { defaultRange: "1y", decimals: 2 };
  const load = (rangeKey) => loadSeriesCard(card, meta, rangeKey, cfg);
  card.querySelectorAll("[data-range]").forEach((btn) => btn.addEventListener("click", () => load(btn.dataset.range)));
  load(cfg.defaultRange);
  return card;
}
async function loadSeriesCard(card, meta, rangeKey, cfg) {
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[2];
  card.querySelectorAll("[data-range]").forEach((b) => b.classList.toggle("active", b.dataset.range === range.key));
  const body = card.querySelector(".body");
  body.innerHTML = `<div class="loading">불러오는 중…</div>`;
  try {
    const data = await (await fetch(`${API_URL}/series/${meta.id}?days=${range.days}`)).json();
    if (!data.points || data.points.length === 0) { body.innerHTML = `<div class="err">데이터 없음</div>`; return; }
    const points = cfg.collapseFlat ? collapseUnchanged(data.points) : data.points;
    const last = points.at(-1);
    const info = changeInfo(points, range.label, cfg.decimals);
    const countLabel = cfg.collapseFlat
      ? `변동 이력 ${points.length.toLocaleString("ko-KR")}건`
      : `관측치 ${points.length.toLocaleString("ko-KR")}건`;
    body.innerHTML = `
      <div class="value-row">
        <span class="value">${fmtNum(last.value, cfg.decimals)}<span class="unit">${meta.unit}</span></span>
        <span class="chip ${info.cls}">${info.chip}</span>
      </div>
      <div class="range-caption">${info.caption}</div>
      ${renderChart(points, cfg.decimals, cfg.stepped)}
      <div class="foot">최종 관측일 ${last.date} · ${countLabel} · ${meta.source}</div>`;
  } catch (e) {
    body.innerHTML = `<div class="err">조회 실패: ${e.message}</div>`;
  }
}
function marketSeriesGroup(meta) {
  if (meta.id.startsWith("FX_")) return "환율";
  if (meta.id.startsWith("OIL_")) return "유가";
  return "금리";
}

function renderMarketSeriesExplorer(filterMount, focusMount, seriesList) {
  const groupOrder = ["환율", "금리", "유가"];
  const grouped = Object.groupBy
    ? Object.groupBy(seriesList, marketSeriesGroup)
    : seriesList.reduce((acc, meta) => {
        const group = marketSeriesGroup(meta);
        (acc[group] ||= []).push(meta);
        return acc;
      }, {});
  filterMount.innerHTML = groupOrder.filter((group) => grouped[group]?.length).map((group) => `
    <div class="market-filter-line">
      <span class="market-filter-label">${group}</span>
      <div class="market-filter-chips">${grouped[group].map((meta) => `<button type="button" class="market-filter-chip" data-series-id="${esc(meta.id)}">${esc(meta.label)}</button>`).join("")}</div>
    </div>`).join("");

  const showSeries = (seriesId) => {
    const meta = seriesList.find((item) => item.id === seriesId) || seriesList[0];
    if (!meta) return;
    filterMount.querySelectorAll("[data-series-id]").forEach((button) => button.classList.toggle("active", button.dataset.seriesId === meta.id));
    focusMount.innerHTML = "";
    const card = makeSeriesCard(meta, true);
    card.classList.add("market-focus-card");
    focusMount.appendChild(card);
  };

  filterMount.querySelectorAll("[data-series-id]").forEach((button) => button.addEventListener("click", () => showSeries(button.dataset.seriesId)));
  showSeries(seriesList.some((meta) => meta.id === "FX_USD_KRW") ? "FX_USD_KRW" : seriesList[0]?.id);
}

// 홈/시황 페이지 공용 부트: heroMountId(shipping 카테고리) + gridMountId(그 외) 렌더.
// filterMountId가 있으면 시황 페이지에서 지표 토글 + 선택한 확대 그래프로 표시한다.
async function loadMarketSeries(heroMountId, gridMountId, filterMountId = null) {
  const heroMount = document.getElementById(heroMountId);
  const gridMount = document.getElementById(gridMountId);
  const filterMount = filterMountId ? document.getElementById(filterMountId) : null;
  try {
    const list = await (await fetch(`${API_URL}/series`)).json();
    const secondarySeries = [];
    for (const meta of list) {
      if (meta.category === "shipping") { if (heroMount) heroMount.appendChild(makeSeriesCard(meta, true)); }
      else secondarySeries.push(meta);
    }
    if (filterMount && gridMount) renderMarketSeriesExplorer(filterMount, gridMount, secondarySeries);
    else if (gridMount) secondarySeries.forEach((meta) => gridMount.appendChild(makeSeriesCard(meta, false)));
    return true;
  } catch (e) {
    if (heroMount) heroMount.innerHTML = `<div class="card"><div class="err">시장 데이터 조회 실패: ${e.message}</div></div>`;
    return false;
  }
}

/* ---------- 선적 의사결정 ---------- */
async function loadDecisions(wrapId, kpiId, limit) {
  const wrap = document.getElementById(wrapId);
  const kpi = kpiId ? document.getElementById(kpiId) : null;
  if (!wrap) return;
  try {
    const data = await (await fetch(`${API_URL}/shipments`)).json();
    const s = data.summary;
    if (kpi) {
      kpi.innerHTML = [
        ["긴급", s.urgent, "#e11d48"],
        ["조치 필요", s.actionDue, "#b45309"],
        ["직접 비교 가능", s.directComparable, "#2563eb"],
        ["데이터 검토", s.dataReview, "#64748b"],
        ["예산 초과 노출", `$${s.budgetExposureUsd.toLocaleString("en-US")}`, "#0f172a"],
      ].map(([label, val, color]) => `<div class="kpi"><div class="k-label">${label}</div><div class="k-val" style="color:${color}">${val}</div></div>`).join("");
    }
    const shipments = limit ? data.shipments.slice(0, limit) : data.shipments;
    wrap.className = "decisions";
    wrap.innerHTML = shipments.map((sh) => {
      const c = sh.card;
      const metaBits = [];
      if (c.budgetVariancePct !== null) metaBits.push(`예산 대비 <b>${fmtPct(c.budgetVariancePct)}</b>`);
      if (c.kcciVariancePct !== null) metaBits.push(`KCCI 대비 <b>${fmtPct(c.kcciVariancePct)}</b>`);
      if (c.deliveryBufferDays !== null) metaBits.push(`납기버퍼 <b>${c.deliveryBufferDays}일</b>`);
      if (c.quoteValidityDays !== null) metaBits.push(`견적유효 <b>${c.quoteValidityDays}일</b>`);
      const reasons = (c.reasons || []).concat(c.counterSignals || []);
      return `
        <div class="dcard ${c.priority}">
          <div class="dcard-head">
            <span class="route">${sh.route} · ${sh.equipment}</span>
            <span class="sid">${sh.id}</span>
          </div>
          <div class="dmeta">${sh.description} · 목표 $${sh.targetBudget.toLocaleString("en-US")}${sh.selectedQuoteTotal ? ` · 견적 $${sh.selectedQuoteTotal.toLocaleString("en-US")}` : ""}</div>
          <span class="badge ${c.priority}">${c.actionLabel} · ${c.deadline}까지</span>
          <div class="dmeta">${metaBits.join(" · ")} · 신뢰도 ${c.confidence} · 비교 ${c.comparability}</div>
          <ul class="dreasons">${reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
          <button class="advisor-btn" data-sid="${sh.id}">🤖 AI 어드바이저</button>
          <div class="advisor-box" style="display:none;"></div>
        </div>`;
    }).join("");
    wrap.querySelectorAll(".advisor-btn").forEach((btn) => btn.addEventListener("click", () => loadAdvisor(btn)));
  } catch (e) {
    wrap.innerHTML = `<div class="err">선적 데이터 조회 실패: ${e.message}</div>`;
  }
}
async function loadAdvisor(btn) {
  const box = btn.nextElementSibling;
  box.style.display = "block";
  box.innerHTML = `<div class="loading">AI 어드바이저 분석 중… (수 초 소요)</div>`;
  btn.disabled = true;
  try {
    const data = await (await fetch(`${API_URL}/shipments/${btn.dataset.sid}/advisor`)).json();
    box.innerHTML = `<span class="ai-tag">AI 참고 의견</span>\n${esc(data.advice || "")}`;
  } catch (e) {
    box.innerHTML = `<div class="err">어드바이저 호출 실패: ${e.message}</div>`;
  }
  btn.disabled = false;
}

/* ---------- 뉴스 ---------- */
const NEWS_PAGE_SIZE = 10;
const newsState = { date: null, limit: NEWS_PAGE_SIZE, shown: [], noMoreData: false, compact: false };
function shiftDate(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
async function fetchNewsPage(date, limit) {
  const url = new URL(`${API_URL}/news/top`);
  if (date) url.searchParams.set("date", date);
  url.searchParams.set("limit", limit);
  return (await fetch(url)).json();
}
function renderNews(listId, moreBtnId) {
  const list = document.getElementById(listId);
  const btn = moreBtnId ? document.getElementById(moreBtnId) : null;
  if (newsState.shown.length === 0) { list.innerHTML = `<li class="err">최근 수집된 뉴스가 없습니다</li>`; if (btn) btn.style.display = "none"; return; }
  const items = newsState.compact ? newsState.shown.slice(0, 5) : newsState.shown;
  list.innerHTML = items.map((it, i) => `
    <li>
      <span class="rank">${i + 1}</span>
      <div class="nbody">
        <a href="${safeSourceUrl(it.link) || "#"}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>
        <span class="src">${esc(it.source)} · ${esc(it.pubDate?.slice(5, 16) || "")}</span>
      </div>
    </li>`).join("");
  if (btn) btn.style.display = newsState.compact || newsState.noMoreData ? "none" : "block";
}
// compact=true면 상위 5건만 보여주고 더보기 없음(홈 요약용).
async function loadNews(listId, moreBtnId, compact = false) {
  newsState.compact = compact;
  try {
    let data = await fetchNewsPage(null, NEWS_PAGE_SIZE);
    let date = data.date;
    for (let back = 0; back < 7 && data.items.length === 0; back++) {
      date = shiftDate(date, -1);
      data = await fetchNewsPage(date, NEWS_PAGE_SIZE);
    }
    newsState.date = date; newsState.limit = NEWS_PAGE_SIZE; newsState.shown = data.items; newsState.noMoreData = false;
    renderNews(listId, moreBtnId);
  } catch (e) { document.getElementById(listId).innerHTML = `<li class="err">뉴스 조회 실패: ${e.message}</li>`; }
}
async function loadMoreNews(listId, moreBtnId) {
  const btn = document.getElementById(moreBtnId);
  btn.textContent = "불러오는 중…";
  try {
    const tried = newsState.limit + NEWS_PAGE_SIZE;
    const data = await fetchNewsPage(newsState.date, tried);
    if (data.items.length > newsState.shown.length) {
      newsState.limit = tried; newsState.shown = data.items;
    } else {
      const prev = shiftDate(newsState.date, -1);
      const prevData = await fetchNewsPage(prev, NEWS_PAGE_SIZE);
      if (prevData.items.length === 0) newsState.noMoreData = true;
      else { newsState.date = prev; newsState.limit = NEWS_PAGE_SIZE; newsState.shown = [...newsState.shown, ...prevData.items]; }
    }
  } catch (e) { /* keep list */ }
  btn.textContent = "더보기";
  renderNews(listId, moreBtnId);
}

/* ---------- 플로팅 챗봇(전 페이지 공통) ---------- */
// 대화 이력은 서버(Bedrock Agent 세션)가 보관 — 프론트는 sessionId만 들고 다닌다.
let chatSessionId = null;
let chatOpened = false;
function safeSourceUrl(url) {
  try {
    const parsed = new URL(String(url));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
}
function sourceLabel(source) {
  return [source.title, source.organization, source.publishedAt, source.pageNumber ? `p.${source.pageNumber}` : ""].filter(Boolean).join(" · ");
}
function appendCitationMarker(container, source) {
  const url = safeSourceUrl(source.url);
  const marker = document.createElement(url ? "a" : "span");
  marker.className = "chat-cite";
  marker.textContent = source.pageNumber ? `[${source.id} · p.${source.pageNumber}]` : `[${source.id}]`;
  marker.title = sourceLabel(source) || "참고 문서";
  marker.setAttribute("aria-label", marker.title);
  if (url) {
    marker.href = url;
    marker.target = "_blank";
    marker.rel = "noopener noreferrer";
    if (source.directDocument) marker.title += " · 문서 열기";
  }
  container.appendChild(marker);
}
function renderCitedReply(container, text, citations, sources) {
  const sourceById = new Map((sources || []).map((source) => [source.id, source]));
  const markersByEnd = new Map();
  for (const citation of citations || []) {
    const end = Math.max(0, Math.min(text.length, Number(citation.end) || 0));
    const ids = markersByEnd.get(end) || [];
    for (const id of citation.sourceIds || []) if (!ids.includes(id) && sourceById.has(id)) ids.push(id);
    markersByEnd.set(end, ids);
  }

  let cursor = 0;
  for (const [end, ids] of [...markersByEnd.entries()].sort((a, b) => a[0] - b[0])) {
    if (end < cursor) continue;
    container.appendChild(document.createTextNode(text.slice(cursor, end)));
    for (const id of ids) appendCitationMarker(container, sourceById.get(id));
    cursor = end;
  }
  container.appendChild(document.createTextNode(text.slice(cursor)));
}
function chatAppend(role, text, citations = [], sources = []) {
  const body = document.getElementById("chatBody");
  const div = document.createElement("div");
  div.className = `chat-msg ${role === "user" ? "user" : "bot"}`;
  if (role === "bot" && citations.length) renderCitedReply(div, text, citations, sources);
  else div.textContent = text;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}
function toggleChat(open) {
  const panel = document.getElementById("chatPanel");
  panel.classList.toggle("open", open);
  if (open && !chatOpened) {
    chatOpened = true;
    chatAppend("bot", "안녕하세요! 오늘 시장 상황, 선적 현황, KOBC 해운 보고서나 DCSA 표준에 대해 물어보세요.\n(회사 내부 계약서·사내 문서는 아직 연결되어 있지 않아요.)");
    document.getElementById("chatInput").focus();
  }
}
async function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSendBtn");
  const message = input.value.trim();
  if (!message) return;
  chatAppend("user", message);
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;
  const pending = chatAppend("bot", "생각 중…");
  pending.classList.add("pending");
  try {
    const data = await (await authedFetch(`${API_URL}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, sessionId: chatSessionId }),
    })).json();
    pending.remove();
    if (data.reply) {
      chatAppend("bot", data.reply, data.citations || [], data.sources || []);
      if (data.sessionId) chatSessionId = data.sessionId;
    } else {
      chatAppend("bot", `오류: ${data.error || "응답을 받지 못했습니다"}`);
    }
  } catch (e) {
    pending.remove();
    chatAppend("bot", `연결 실패: ${e.message}`);
  }
  input.disabled = false;
  sendBtn.disabled = false;
  input.focus();
}
function initChat() {
  document.getElementById("chatFab").addEventListener("click", () => toggleChat(!document.getElementById("chatPanel").classList.contains("open")));
  document.getElementById("chatCloseBtn").addEventListener("click", () => toggleChat(false));
  document.getElementById("chatSendBtn").addEventListener("click", sendChatMessage);
  document.getElementById("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChatMessage(); });
}

/* ---------- 회사 데이터 연결(엑셀 업로드 + 현재 선적 폼) ----------
   엑셀: presigned S3 URL 발급받아 브라우저에서 버킷에 직접 PUT(Lambda가 파일 바이너리를 안 거침).
   현재 선적 폼은 "견적/추천에 필요한 화물 정보"만 받는다 — 주문번호·선적ID·고객사명 같은 사내 참조번호는
   없다(엑셀 3시트에는 있지만, 견적을 받는 데 필요한 정보가 아니라서 이 폼에는 의도적으로 뺐다).
   /shipments/current POST가 저장, GET이 프리필. */
let companyStatusCache;
async function getCompanyStatus({ force = false } = {}) {
  if (!force && companyStatusCache !== undefined) return companyStatusCache;
  try {
    companyStatusCache = await (await authedFetch(`${API_URL}/company/status`, { signal: AbortSignal.timeout(8000) })).json();
    return companyStatusCache;
  } catch {
    return null;
  }
}
function hasRegisteredShipment(status) {
  return Boolean(status?.excel || status?.currentShipment);
}

async function refreshConnectStatus() {
  const excelIcon = document.getElementById("excelIcon");
  const excelLabel = document.getElementById("excelLabel");
  const curIcon = document.getElementById("curIcon");
  const curLabel = document.getElementById("curLabel");
  const curSub = document.getElementById("curSub");
  if (!excelIcon) return null;
  try {
    const status = await getCompanyStatus({ force: true });
    if (!status) throw new Error("회사 데이터 상태를 확인하지 못했습니다");
    if (status.excel) {
      excelIcon.classList.replace("empty", "ok"); excelIcon.textContent = "✅";
      excelLabel.textContent = `엑셀 업로드됨 · ${new Date(status.excel.lastModified).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}`;
    } else {
      excelIcon.classList.replace("ok", "empty"); excelIcon.textContent = "📄";
      excelLabel.textContent = "회사 양식이 아직 등록되지 않았습니다";
    }
    if (status.currentShipment) {
      curIcon.classList.replace("empty", "ok"); curIcon.textContent = "✅";
      curLabel.textContent = "현재 선적 입력됨(직접 입력)";
      curSub.textContent = `저장 ${new Date(status.currentShipment.lastModified).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}`;
    } else if (status.excel) {
      curIcon.classList.replace("empty", "ok"); curIcon.textContent = "📋";
      curLabel.textContent = "현재 선적: 엑셀 시트값 사용 중";
      curSub.textContent = "직접 입력하면 이 값을 덮어씁니다";
    } else {
      curIcon.classList.replace("ok", "empty"); curIcon.textContent = "🚢";
      curLabel.textContent = "현재 선적 미입력";
      curSub.textContent = "엑셀 없이 이번 선적 정보만 바로 입력할 수도 있어요";
    }
    return status;
  } catch (e) {
    const msg = document.getElementById("connectStatusMsg");
    if (msg) msg.textContent = `상태 조회 실패: ${e.message}`;
    return null;
  }
}
async function uploadExcelFile(file, onDone) {
  const msg = document.getElementById("connectStatusMsg");
  msg.className = "connect-status"; msg.textContent = "업로드 준비 중…";
  try {
    const { url } = await (await authedFetch(`${API_URL}/company/upload-url`)).json();
    if (!url) throw new Error("업로드 URL 발급 실패");
    msg.textContent = "업로드 중…";
    const put = await fetch(url, {
      method: "PUT", body: file,
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });
    if (!put.ok) throw new Error(`S3 업로드 실패(${put.status})`);
    msg.className = "connect-status ok"; msg.textContent = "업로드 완료 ✓ 추천 재계산 중…";
    await refreshConnectStatus();
    if (onDone) await onDone();
    msg.textContent = "업로드 완료 · 추천 갱신됨";
  } catch (e) {
    msg.className = "connect-status err"; msg.textContent = `업로드 실패: ${e.message}`;
  }
}
function toggleCurForm(open) {
  document.getElementById("curForm").classList.toggle("open", open);
}
async function prefillCurForm() {
  const form = document.getElementById("curForm");
  try {
    const { current } = await (await authedFetch(`${API_URL}/shipments/current`)).json();
    if (!current) return;
    for (const [k, v] of Object.entries(current)) {
      const el = form.elements.namedItem(k);
      if (el && v != null) el.value = v;
    }
  } catch (e) { /* 프리필 실패는 조용히 무시 — 빈 폼으로 새로 입력 가능 */ }
}
async function submitCurForm(ev, onDone) {
  ev.preventDefault();
  const form = ev.target;
  const msg = document.getElementById("cformMsg");
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  msg.className = "cform-msg"; msg.textContent = "저장 중…";
  try {
    const res = await authedFetch(`${API_URL}/shipments/current`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `저장 실패(${res.status})`);
    msg.className = "cform-msg ok"; msg.textContent = "저장 완료 ✓ 추천 재계산 중…";
    await refreshConnectStatus();
    if (onDone) await onDone();
    msg.textContent = "저장 완료 · 추천 갱신됨";
    setTimeout(() => toggleCurForm(false), 1200);
  } catch (e) {
    msg.className = "cform-msg err"; msg.textContent = e.message;
  }
}
// onDataChanged: 업로드/폼 저장 성공 시 호출할 콜백(보통 loadRecommendation(true)).
function initConnectPanel(onDataChanged) {
  const fileInput = document.getElementById("excelFileInput");
  if (!fileInput) return;
  document.getElementById("excelUploadBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) uploadExcelFile(fileInput.files[0], onDataChanged); fileInput.value = ""; });
  document.getElementById("curFormToggleBtn").addEventListener("click", async () => {
    const isOpen = document.getElementById("curForm").classList.contains("open");
    if (!isOpen) await prefillCurForm();
    toggleCurForm(!isOpen);
  });
  document.getElementById("curFormCancelBtn").addEventListener("click", () => toggleCurForm(false));
  document.getElementById("curForm").addEventListener("submit", (ev) => submitCurForm(ev, onDataChanged));
  return refreshConnectStatus();
}

/* ---------- AI 선적 추천 (포트폴리오) ----------
   GET /recommendations → 저장된 최신 포트폴리오(즉시). POST /recommendations/refresh → 백그라운드 재계산 후 폴링.
   compact=true면 홈 요약(종합 판정 + 최우선 1~2건 + 전체보기 링크). */
const STANCE_META = {
  BOOK_NOW: { label: "지금 예약", icon: "🚢" },
  BOOK_SOON: { label: "곧 예약", icon: "⏱️" },
  CONSIDER_WAIT: { label: "관망 검토", icon: "⏳" },
  DEADLINE_RISK: { label: "납기 위험", icon: "⚠️" },
  INSUFFICIENT: { label: "데이터 부족", icon: "❓" },
};
function stanceMeta(st) { return STANCE_META[st] ?? STANCE_META.BOOK_SOON; }

// 이미 저장된 AI 추천도 화면에서는 자연스러운 존댓말로 통일한다.
// 새 추천은 Bedrock 프롬프트에서도 같은 문체를 요구하지만, 기존 캐시 결과를 위해 렌더 단계에서도 보정한다.
function formalizeRecommendationText(text) {
  let value = String(text ?? "");
  const endings = [
    [/해야만 한다(?=\s|$|[.!?])/g, "해야만 합니다"],
    [/해야 한다(?=\s|$|[.!?])/g, "해야 합니다"],
    [/적절하다(?=\s|$|[.!?])/g, "적절합니다"],
    [/합리적이다(?=\s|$|[.!?])/g, "합리적입니다"],
    [/불가능하다(?=\s|$|[.!?])/g, "불가능합니다"],
    [/가능하다(?=\s|$|[.!?])/g, "가능합니다"],
    [/필요하다(?=\s|$|[.!?])/g, "필요합니다"],
    [/권장한다(?=\s|$|[.!?])/g, "권장합니다"],
    [/추천한다(?=\s|$|[.!?])/g, "추천합니다"],
    [/제안한다(?=\s|$|[.!?])/g, "제안합니다"],
    [/확정한다(?=\s|$|[.!?])/g, "확정합니다"],
    [/진행한다(?=\s|$|[.!?])/g, "진행합니다"],
    [/협의한다(?=\s|$|[.!?])/g, "협의합니다"],
    [/판단한다(?=\s|$|[.!?])/g, "판단합니다"],
    [/검토한다(?=\s|$|[.!?])/g, "검토합니다"],
    [/확인한다(?=\s|$|[.!?])/g, "확인합니다"],
    [/대응한다(?=\s|$|[.!?])/g, "대응합니다"],
    [/전환한다(?=\s|$|[.!?])/g, "전환합니다"],
    [/요청한다(?=\s|$|[.!?])/g, "요청합니다"],
    [/한다(?=\s|$|[.!?])/g, "합니다"],
    [/하다(?=\s|$|[.!?])/g, "합니다"],
    [/높다(?=\s|$|[.!?])/g, "높습니다"],
    [/낮다(?=\s|$|[.!?])/g, "낮습니다"],
    [/크다(?=\s|$|[.!?])/g, "큽니다"],
    [/작다(?=\s|$|[.!?])/g, "작습니다"],
    [/빠르다(?=\s|$|[.!?])/g, "빠릅니다"],
    [/느리다(?=\s|$|[.!?])/g, "느립니다"],
    [/어렵다(?=\s|$|[.!?])/g, "어렵습니다"],
    [/쉽다(?=\s|$|[.!?])/g, "쉽습니다"],
    [/진다(?=\s|$|[.!?])/g, "집니다"],
    [/아니다(?=\s|$|[.!?])/g, "아닙니다"],
    [/없다(?=\s|$|[.!?])/g, "없습니다"],
    [/있다(?=\s|$|[.!?])/g, "있습니다"],
    [/된다(?=\s|$|[.!?])/g, "됩니다"],
    [/이다(?=\s|$|[.!?])/g, "입니다"],
  ];
  endings.forEach(([pattern, replacement]) => { value = value.replace(pattern, replacement); });
  return value;
}

// Bedrock 건별(stance/headline/why/action) + 결정론적 집계(납기/컨테이너/실현총액/예산대비)를 id로 병합.
function mergeShipments(reco, portfolio) {
  const byId = Object.fromEntries((portfolio.shipments || []).map((s) => [s.id, s]));
  return (reco.shipments || []).map((rs) => ({ ...(byId[rs.id] || {}), ...rs }));
}

function scheduleOptionHtml(option, index) {
  const name = [option.operator, option.vessel].filter(Boolean).join(" · ");
  const fit = option.comfortable ? "납기 여유" : option.feasible ? "납기 충족" : "일정 확인 필요";
  const price = option.priceUSD ? `$${Number(option.priceUSD).toLocaleString("en-US")}/FEU` : "운임 확인 필요";
  return `<article class="match-option ${index === 0 ? "best" : ""}">
    <div class="match-rank">${index === 0 ? "추천" : `대안 ${index + 1}`}</div>
    <h5>${esc(name || "운항편")}</h5>
    <div class="match-dates"><b>${mdShort(option.etd)}</b><span>${option.transitDays ? `${option.transitDays}일` : ""} · ${option.direct ? "직항" : "환적"}</span><b>${mdShort(option.eta)}</b></div>
    <div class="match-bottom"><strong>${price}</strong><span>${fit}${option.deliveryBufferDays != null ? ` · 납기 여유 ${option.deliveryBufferDays}일` : ""}</span></div>
  </article>`;
}

function laneStops(lane = "") {
  const parts = String(lane).split(/\s*(?:→|->)\s*/).filter(Boolean);
  return { origin: parts[0] || "출발지", destination: parts[1] || "도착지" };
}

function collectRecommendedSchedules(ships) {
  const options = [];
  for (const shipment of ships) {
    const candidates = shipment.scheduleOptions?.length
      ? shipment.scheduleOptions
      : shipment.recommendedSailing?.vessel
        ? [{ ...shipment.recommendedSailing, priceUSD: shipment.recommendedSailing.priceUSDPerFeu }]
        : [];
    candidates.forEach((option, optionIndex) => options.push({
      ...option,
      shipmentId: shipment.id,
      lane: shipment.lane,
      routeCode: shipment.routeCode,
      routeLabel: shipment.routeLabel,
      containers: shipment.containers,
      shipmentPriority: shipment.priority ?? 99,
      optionIndex,
    }));
  }
  const seen = new Set();
  return options
    .sort((a, b) => (a.shipmentPriority - b.shipmentPriority) || (a.optionIndex - b.optionIndex))
    .filter((option) => {
      const key = [option.operator, option.vessel, option.etd, option.eta].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

const SHIPDA_ROUTE_POD_IDS = {
  KCI: 43, KSEI: 489, KAUI: 1566, KJI: 350, KMDI: 1639, KLWI: 965,
  KLEI: 915, KNEI: 1613, KUWI: 822, KUEI: 792, KMEI: 1934,
};

function shipdaScheduleUrl(option) {
  const direct = safeSourceUrl(option.sourceUrl);
  if (direct) return direct;
  const podId = SHIPDA_ROUTE_POD_IDS[option.routeCode];
  if (!podId) return "https://www.ship-da.com/forwarding/schedule";
  const query = new URLSearchParams({
    freightType: "FCL",
    polId: "1",
    podId: String(podId),
    etd: option.etd ? `${option.etd}T00:00:00.000Z` : new Date().toISOString(),
  });
  if (option.shipdaId) query.set("scheduleId", String(option.shipdaId));
  return `https://www.ship-da.com/forwarding/schedule?${query}`;
}

function recommendedScheduleCardHtml(option, index) {
  const { origin, destination } = laneStops(option.lane);
  const price = Number(option.priceUSD || option.priceUSDPerFeu || 0);
  const status = option.comfortable ? "납기 여유" : option.feasible === false ? "일정 확인 필요" : "납기 충족";
  const sourceUrl = shipdaScheduleUrl(option);
  return `<a class="recommended-schedule-card ${index === 0 ? "best" : ""}" href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(option.operator || "선사")} ${esc(option.vessel || "선박")} 일정을 쉽다에서 확인">
    <div class="rsc-head">
      <span class="rsc-rank">${index === 0 ? "1순위 추천" : `${index + 1}순위 대안`}</span>
      <span class="rsc-ref">${esc(option.shipmentId || "이번 선적")}</span>
    </div>
    <div class="rsc-carrier"><strong>${esc(option.operator || "운항사 확인")}</strong><span>${esc(option.vessel || "선박 확인")}</span></div>
    <div class="rsc-route">
      <div><small>출발</small><b>${esc(origin)}</b><span>${mdShort(option.etd)} ETD</span></div>
      <div class="rsc-line"><span>${option.transitDays ? `${option.transitDays}일` : "운항"}</span><i></i><em>${option.direct === false ? "환적" : "직항"}</em></div>
      <div><small>도착</small><b>${esc(destination)}</b><span>${mdShort(option.eta)} ETA</span></div>
    </div>
    <div class="rsc-bottom">
      <div><small>40ft 참고운임</small><strong>${price ? `$${price.toLocaleString("en-US")}` : "운임 확인"}<span>${price ? "/FEU" : ""}</span></strong></div>
      <div class="rsc-fit"><b>${status}</b><span>${option.deliveryBufferDays != null ? `납기 여유 ${option.deliveryBufferDays}일` : `${option.containers || 1}개 컨테이너`}</span></div>
    </div>
    <span class="rsc-source">쉽다에서 같은 항차 확인 <b>↗</b></span>
  </a>`;
}

function shipCardHtml(s, showOptions = true) {
  const sm = stanceMeta(s.stance);
  const rs = s.recommendedSailing || {};
  const priceTxt = rs.priceUSDPerFeu ? `$${Number(rs.priceUSDPerFeu).toLocaleString("en-US")}/FEU` : "—";
  const nm = rs.vessel && rs.operator && !rs.vessel.toUpperCase().startsWith(rs.operator.toUpperCase())
    ? `${rs.operator} ${rs.vessel}` : (rs.vessel || "");
  const sailTxt = rs.vessel
    ? `${esc(nm)} · ETD ${mdShort(rs.etd)} → ETA ${mdShort(rs.eta)} · ${priceTxt}`
    : `납기 충족 항차 없음`;
  const meta = [];
  if (s.containers) meta.push(`${esc(s.routeLabel || s.lane || "")} · ${s.containers}컨`);
  if (s.requiredDeliveryDate) meta.push(`납기 ${esc(s.requiredDeliveryDate)}`);
  if (s.feasibleCount != null) meta.push(`납기충족 ${s.feasibleCount}편`);
  if (s.vsBudgetPct != null) meta.push(`예산대비 ${fmtPct(s.vsBudgetPct)}`);
  return `
    <div class="pf-ship ${s.stance}">
      <div class="pf-ship-head">
        <span class="pf-pri">#${s.priority ?? "-"}</span>
        <span class="pf-stance ${s.stance}">${sm.label}</span>
        <span class="pf-headline">${esc(formalizeRecommendationText(s.headline || ""))}</span>
        <span class="pf-id">${esc(s.id || "")}</span>
      </div>
      <div class="pf-meta">${meta.join(" · ")}</div>
      <div class="pf-sail"><span class="pfl">권장 항차</span>${sailTxt}</div>
      ${s.why ? `<div class="pf-why"><strong>${esc(formalizeRecommendationText(s.why))}</strong></div>` : ""}
      ${s.action ? `<div class="pf-action"><span class="pfl">오늘 할 일</span><strong>${esc(formalizeRecommendationText(s.action))}</strong></div>` : ""}
      ${showOptions && s.scheduleOptions?.length ? `<div class="match-block"><div class="match-title">조건에 맞는 실제 운항 일정</div><div class="match-grid">${s.scheduleOptions.slice(0, 3).map(scheduleOptionHtml).join("")}</div><p>표시 운임은 비교용 참고값입니다. 예약 전 선사 또는 포워더 견적을 확인하세요.</p></div>` : ""}
    </div>`;
}

function renderPortfolio(mountId, data, compact) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  const r = data.recommendation, p = data.portfolio || {};
  const ships = mergeShipments(r, p).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const recommendedSchedules = collectRecommendedSchedules(ships);
  // 포트폴리오 종합 긴급도 → 히어로 색(기존 stance 그라디언트 재사용)
  const pfStance = (p.deadlineRiskCount ?? 0) > 0 ? "DEADLINE_RISK" : (p.bookNowCount ?? 0) > 0 ? "BOOK_NOW" : "BOOK_SOON";

  const kpis = [
    ["선적", `${p.shipmentCount ?? ships.length}건`],
    ["지금 예약", `${p.bookNowCount ?? 0}건`],
    ["납기 위험", `${p.deadlineRiskCount ?? 0}건`],
    ["실현 총비용", `$${Number(p.totalCheapestFeasibleUSD ?? 0).toLocaleString("en-US")}`],
    ["예산 초과 노출", `$${Number(p.budgetExposureUSD ?? 0).toLocaleString("en-US")}`],
  ];
  const kpiHtml = kpis.map(([l, v]) => `<div class="pf-kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join("");

  const heroHtml = `
    <div class="reco-hero">
      <div class="reco-eyebrow"><span class="en">AI SHIPPING RECOMMENDATION</span><span class="ko">포트폴리오 종합 판정${data.asOf ? ` · ${esc(data.asOf)} 기준` : ""}</span>${compact ? "" : `<button class="reco-refresh hero-refresh" id="recoRefresh">다시 분석</button>`}</div>
      <div class="verdict">${esc(formalizeRecommendationText(r.verdict || ""))}</div>
      <div class="pf-kpis">${kpiHtml}</div>
      ${compact ? `<a class="more-link" href="recommendation.html">전체 포트폴리오 분석 →</a>` : ""}
    </div>`;

  if (compact) {
    const top = ships.slice(0, 2).map((s) => shipCardHtml(s, false)).join("");
    mount.innerHTML = `<div class="reco ${pfStance}">${heroHtml}<div class="pf-ships compact">${top}</div></div>`;
    return;
  }

  // 숫자나 한두 단어만 굵게 만들지 않고, 문단마다 핵심 판단 문장 하나를 통째로 강조한다.
  // 소수점(예: 19.7%)은 문장 끝이 아니므로 마침표 뒤에 공백이 있거나 문장이 끝날 때만 경계로 본다.
  const emphasizeNarrative = (text) => {
    const safe = esc(formalizeRecommendationText(text));
    const sentences = [];
    let start = 0;
    for (let index = 0; index < safe.length; index += 1) {
      const char = safe[index];
      const next = safe[index + 1];
      if (".!?。！？".includes(char) && (next == null || /\s/.test(next))) {
        let end = index + 1;
        while (end < safe.length && /\s/.test(safe[end])) end += 1;
        sentences.push(safe.slice(start, end));
        start = end;
        index = end - 1;
      }
    }
    if (start < safe.length) sentences.push(safe.slice(start));
    if (!sentences.length) sentences.push(safe);
    const cue = /(오늘|지금|예약|납기|예산|운임|최저가|절감|위험|권장|추천|핵심|따라서)/;
    let emphasized = false;
    return sentences.map((sentence) => {
      const trailing = sentence.match(/\s+$/)?.[0] || "";
      const content = sentence.slice(0, sentence.length - trailing.length);
      if (!emphasized && cue.test(content)) {
        emphasized = true;
        return `<strong>${content}</strong>${trailing}`;
      }
      return sentence;
    }).join("");
  };
  const narrHtml = String(r.summaryNarrative || "")
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) => `<p>${emphasizeNarrative(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const keys = (r.portfolioKeyNumbers || []).slice(0, 3).map((k) => `
    <div class="reco-key"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.value)}</div><div class="kn">${esc(formalizeRecommendationText(k.note || ""))}</div></div>`).join("");
  const scheduleCards = recommendedSchedules.map(recommendedScheduleCardHtml).join("");

  mount.innerHTML = `
    <div class="reco ${pfStance}">
      ${heroHtml}
      <div class="reco-body">
        <section class="recommended-schedules">
          <div class="result-section-head"><div><span>LIVE SCHEDULE MATCH</span><h4>이번 선적에 맞는 추천 운항 일정</h4><p>실시간 스케줄 후보 중 납기, 운임, 직항 여부를 함께 비교한 상위 3개입니다.</p></div><a href="schedule.html">전체 스케줄 보기 →</a></div>
          ${scheduleCards ? `<div class="recommended-schedule-grid">${scheduleCards}</div>` : `<div class="schedule-empty">현재 조건에 맞는 운항 일정을 확인 중입니다.</div>`}
          <p class="schedule-note">운항 일정은 실시간 스케줄 데이터 기준이며, 표시 운임은 비교용 참고값입니다.</p>
        </section>
        <section class="decision-summary">
          <div class="result-section-head"><div><span>BUDGET &amp; SCHEDULE BASIS</span><h4>예산·일정 판단 근거</h4><p>총예산, 실행 가능한 최저가 합산과 예산 차이를 한눈에 비교합니다.</p></div></div>
          <div class="decision-grid">
            <div class="reco-keys">${keys}</div>
          </div>
          ${narrHtml ? `<details class="analysis-detail"><summary>AI 분석 근거 자세히 보기</summary><div class="reco-narr">${narrHtml}</div></details>` : ""}
        </section>
        <div class="section-title shipment-judgment-title">선적별 판단 <span class="sub">· 우선순위 순</span></div>
        <div class="pf-ships">${ships.map((s) => shipCardHtml(s, false)).join("")}</div>
        <div class="reco-foot">
          <span class="ai-badge">AI 분석 결과</span>
          <span>기준일 ${esc(data.asOf || "-")}</span>
          <span>시장·회사 선적·운항 일정·관련 뉴스 반영</span>
        </div>
      </div>
    </div>`;
  const btn = document.getElementById("recoRefresh");
  if (btn) btn.addEventListener("click", () => refreshRecommendation(mountId, compact));
}

function renderRecommendationOnboarding(mountId, compact) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  if (compact) {
    mount.innerHTML = `
      <section class="reco-onboarding compact" aria-labelledby="firstShipmentTitle">
        <div>
          <span class="onboard-kicker">FIRST SHIPPING ANALYSIS</span>
          <h3 id="firstShipmentTitle">첫 선적을 등록하고 AI 추천을 받아보세요.</h3>
          <p>선적 일정과 예산을 등록하면 실제 운항 일정에서 적합한 항차를 찾고, 지금 예약해야 하는 이유까지 정리해드립니다.</p>
          <div class="onboard-points"><span>실제 항차 비교</span><span>납기 위험 확인</span><span>예산 근거 제공</span></div>
        </div>
        <a class="onboard-primary" href="recommendation.html#connectPanel">선적 등록 시작 <span>→</span></a>
      </section>`;
    return;
  }

  mount.innerHTML = `
    <section class="reco-onboarding" aria-labelledby="emptyRecommendationTitle">
      <div class="onboard-icon" aria-hidden="true">🚢</div>
      <div>
        <span class="onboard-kicker">READY FOR YOUR FIRST PLAN</span>
        <h3 id="emptyRecommendationTitle">아직 분석할 선적이 없습니다.</h3>
        <p>위 등록 카드에서 회사 양식을 올리거나 이번 선적을 직접 입력해 주세요. 등록이 끝나면 AI가 실제 운항 일정·납기·예산을 함께 비교합니다.</p>
        <div class="onboard-steps">
          <span><b>1</b> 선적 정보 등록</span><span><b>2</b> 실제 스케줄 매칭</span><span><b>3</b> 추천 결과 확인</span>
        </div>
      </div>
      <div class="onboard-actions">
        <button type="button" class="onboard-primary" data-onboard-action="excel">엑셀로 여러 건 등록</button>
        <button type="button" class="onboard-secondary" data-onboard-action="current">이번 선적 직접 입력</button>
      </div>
    </section>`;

  mount.querySelector('[data-onboard-action="excel"]')?.addEventListener("click", () => {
    document.getElementById("connectPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("excelUploadBtn")?.click();
  });
  mount.querySelector('[data-onboard-action="current"]')?.addEventListener("click", () => {
    document.getElementById("connectPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("curFormToggleBtn")?.click();
  });
}

// 등록 데이터가 있으면 저장된 최신 포트폴리오를 렌더하고, 신규 사용자는 등록 안내만 보여준다.
async function loadRecommendation(mountId = "recoMount", compact = false, knownStatus = undefined) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  try {
    const status = knownStatus === undefined ? await getCompanyStatus() : knownStatus;
    if (status && !hasRegisteredShipment(status)) {
      renderRecommendationOnboarding(mountId, compact);
      return;
    }
    const data = await (await authedFetch(`${API_URL}/recommendations`, { signal: AbortSignal.timeout(10000) })).json();
    if (data.status === "ready" && data.recommendation) return renderPortfolio(mountId, data, compact);
    // 아직 계산된 적 없음 → 실행 유도
    mount.innerHTML = `
      <div class="reco"><div class="reco-empty">
        <div class="ttl">AI 포트폴리오 분석</div>
        <div class="dsc">예정 선적들을 실제 스케줄·시장운임과 매칭해 "어느 건을 언제·어떤 배·얼마에 보낼지" 종합 판단합니다.</div>
        <button class="auth-btn primary" id="recoRun" style="max-width:220px;">분석 실행 (수십 초)</button>
      </div></div>`;
    const run = document.getElementById("recoRun");
    if (run) run.addEventListener("click", () => refreshRecommendation(mountId, compact));
  } catch (e) {
    mount.innerHTML = `<div class="reco"><div class="reco-loading err">추천 조회 실패: ${esc(e.message)}</div></div>`;
  }
}

// 재계산 트리거(POST /refresh) 후 준비될 때까지 폴링.
async function refreshRecommendation(mountId = "recoMount", compact = false) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  mount.innerHTML = `<div class="reco"><div class="reco-loading">포트폴리오 분석 중… (스케줄 매칭 + AI 종합, 최대 1분)</div></div>`;
  try {
    await authedFetch(`${API_URL}/recommendations/refresh`, { method: "POST" });
  } catch (e) {
    mount.innerHTML = `<div class="reco"><div class="reco-loading err">분석 시작 실패: ${esc(e.message)}</div></div>`;
    return;
  }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const data = await (await authedFetch(`${API_URL}/recommendations`, { signal: AbortSignal.timeout(10000) })).json();
      if (data.status === "ready" && data.recommendation) return renderPortfolio(mountId, data, compact);
    } catch { /* keep polling */ }
  }
  mount.innerHTML = `<div class="reco"><div class="reco-loading err">분석이 예상보다 오래 걸립니다. 잠시 후 새로고침해 주세요.</div></div>`;
}

/* ---------- 실시간 스케줄 · 참고 운임 ----------
   스케줄(operator/vessel/etd/eta/direct)은 ShipDa 공개 스케줄 조회 API 실측값(/schedule, 매주 자동 재수집).
   priceUSD는 실거래가 아님 — 항로별 KCCI 지수 앵커가 × 시장비율 × 항차별 지터(±6%)를 적용한 참고 추정치. */
let scheduleCache = null;
async function fetchSchedule() {
  if (scheduleCache) return scheduleCache;
  const data = await (await fetch(`${API_URL}/schedule`)).json();
  scheduleCache = data.routes ?? [];
  return scheduleCache;
}
async function fetchFullRouteSchedule(routeCode) {
  const data = await (await fetch(`${API_URL}/schedule/${routeCode}`)).json();
  return data.route;
}
function schedCardHtml(c) {
  return `
    <div class="sched-card">
      <div class="sched-op">
        <span class="opname">${esc(c.operator)}</span>
        <span class="direct-chip ${c.direct ? "" : "ts"}">${c.direct ? "직항" : "환적"}</span>
      </div>
      <div class="sched-leg">
        <span class="dot orig"></span>
        <div class="ltext">
          <div class="port">${ccFlag("KR")} ${esc(c.originName)}</div>
          <div class="date">${mdShort(c.etd)} (ETD)</div>
        </div>
      </div>
      <div class="sched-leg">
        <span class="dot"></span>
        <div class="ltext">
          <div class="port">${ccFlag(c.destCC)} ${esc(c.destName)}</div>
          <div class="date">${mdShort(c.eta)} (ETA)</div>
        </div>
      </div>
      <div class="sched-vessel">${esc(c.vessel)}${c.transitDays ? ` · ${c.transitDays}일` : ""}</div>
      <div class="sched-price-row">
        <span class="ptype">40ft 참고운임</span>
        <span class="pval">$${c.priceUSD.toLocaleString("en-US")}<span class="pmark">~</span></span>
      </div>
    </div>`;
}

let scheduleExplorerState = { mountId: null, routes: [], routeCode: "all" };
function renderScheduleExplorerCards() {
  const { mountId, routes, routeCode } = scheduleExplorerState;
  const mount = document.getElementById(mountId);
  if (!mount) return;
  const selected = routeCode === "all" ? routes : routes.filter((route) => route.routeCode === routeCode);
  const cards = routeCode === "all"
    ? selected.flatMap((route) => route.sailings.slice(0, 1).map((s) => ({ ...route, ...s })))
    : selected.flatMap((route) => route.sailings.map((s) => ({ ...route, ...s })));
  const route = selected[0];
  mount.innerHTML = `
    <div class="schedule-results-head"><div><b>${routeCode === "all" ? "전체 목적지" : `${route.destName} 노선`}</b><span>${cards.length}개 일정 표시</span></div>${routeCode !== "all" && route?.total > route.sailings.length ? `<button type="button" class="sched-viewall" data-route="${route.routeCode}">전체 ${route.total}건 보기</button>` : ""}</div>
    <div class="sched-strip">${cards.map(schedCardHtml).join("")}</div>`;
  const more = mount.querySelector(".sched-viewall");
  if (more) more.addEventListener("click", async () => {
    more.disabled = true; more.textContent = "일정을 불러오는 중…";
    try {
      const full = await fetchFullRouteSchedule(more.dataset.route);
      mount.querySelector(".sched-strip").innerHTML = full.sailings.map((s) => schedCardHtml({ ...full, ...s })).join("");
      more.remove();
    } catch (e) { more.disabled = false; more.textContent = "다시 시도"; }
  });
}
async function renderScheduleExplorer(filterId, mountId) {
  const filters = document.getElementById(filterId);
  const mount = document.getElementById(mountId);
  if (!filters || !mount) return;
  mount.innerHTML = `<div class="loading">운항 일정을 불러오는 중…</div>`;
  try {
    const routes = await fetchSchedule();
    if (!routes.length) throw new Error("조회 가능한 일정이 없습니다");
    scheduleExplorerState = { mountId, routes, routeCode: "all" };
    filters.innerHTML = `
      <div class="filter-line"><span class="filter-label">출발지</span><button type="button" class="route-chip active" disabled>${ccFlag("KR")} Busan</button></div>
      <div class="filter-line"><span class="filter-label">목적지</span><div class="route-chips"><button type="button" class="route-chip active" data-route="all">전체</button>${routes.map((route) => `<button type="button" class="route-chip" data-route="${route.routeCode}">${ccFlag(route.destCC)} ${esc(route.destName)}</button>`).join("")}</div></div>`;
    filters.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => {
      scheduleExplorerState.routeCode = button.dataset.route;
      filters.querySelectorAll("[data-route]").forEach((item) => item.classList.toggle("active", item === button));
      renderScheduleExplorerCards();
    }));
    renderScheduleExplorerCards();
  } catch (e) {
    mount.innerHTML = `<div class="err">운항 일정을 불러오지 못했습니다: ${esc(e.message)}</div>`;
  }
}
// limit이 있으면 (전체 정렬된) 상위 N장만 홈 요약으로, 없으면 항로별로 그룹핑해 전체 렌더.
async function renderSchedCards(stripId, limit) {
  const strip = document.getElementById(stripId);
  if (!strip) return;
  strip.innerHTML = `<div class="loading">불러오는 중…</div>`;
  let routes;
  try { routes = await fetchSchedule(); }
  catch (e) { strip.innerHTML = `<div class="err">스케줄 조회 실패: ${e.message}</div>`; return; }
  if (routes.length === 0) { strip.innerHTML = `<div class="err">조회 가능한 스케줄이 없습니다</div>`; return; }

  if (limit) {
    const cards = routes.flatMap((route) => route.sailings.map((s) => ({ ...route, ...s })))
      .sort((a, b) => a.etd.localeCompare(b.etd)).slice(0, limit);
    strip.innerHTML = cards.map(schedCardHtml).join("");
    return;
  }
  strip.innerHTML = routes.map((route) => `
    <div class="sched-group-title">
      ${ccFlag("KR")} Busan → ${ccFlag(route.destCC)} ${route.destName}
      ${route.total > route.sailings.length ? `<button type="button" class="sched-viewall" data-route="${route.routeCode}">전체 ${route.total}건 보기 →</button>` : ""}
    </div>
    <div class="sched-strip" id="sched-strip-${route.routeCode}">${route.sailings.map((s) => schedCardHtml({ ...route, ...s })).join("")}</div>
  `).join("");
  strip.querySelectorAll(".sched-viewall").forEach((btn) => btn.addEventListener("click", () => loadFullRouteSchedule(btn)));
}
async function loadFullRouteSchedule(btn) {
  const routeCode = btn.dataset.route;
  const container = document.getElementById(`sched-strip-${routeCode}`);
  btn.disabled = true;
  btn.textContent = "불러오는 중…";
  try {
    const route = await fetchFullRouteSchedule(routeCode);
    container.innerHTML = route.sailings.map((s) => schedCardHtml({ ...route, ...s })).join("");
    btn.remove();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = `조회 실패(${e.message}) — 다시 시도`;
  }
}
