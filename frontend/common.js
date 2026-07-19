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
function logout() { clearSession(); location.href = "login.html"; }

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
  { href: "index.html", key: "home", icon: "🏠", label: "홈" },
  { href: "recommendation.html", key: "reco", icon: "🚢", label: "AI 선적 추천" },
  { href: "market.html", key: "market", icon: "📈", label: "시황" },
  { href: "schedule.html", key: "schedule", icon: "🗓️", label: "실시간 스케줄" },
  { href: "shipments.html", key: "shipments", icon: "📦", label: "선적 의사결정" },
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
    <a class="sb-brand" href="index.html">
      <span class="dot"></span>
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
// 홈/시황 페이지 공용 부트: heroMountId(shipping 카테고리) + gridMountId(그 외) 렌더.
async function loadMarketSeries(heroMountId, gridMountId) {
  const heroMount = document.getElementById(heroMountId);
  const gridMount = document.getElementById(gridMountId);
  try {
    const list = await (await fetch(`${API_URL}/series`)).json();
    for (const meta of list) {
      if (meta.category === "shipping") { if (heroMount) heroMount.appendChild(makeSeriesCard(meta, true)); }
      else if (gridMount) gridMount.appendChild(makeSeriesCard(meta, false));
    }
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
    box.innerHTML = `<span class="ai-tag">AI 참고 의견 · Bedrock</span>\n${data.advice}`;
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
        <a href="${it.link}" target="_blank" rel="noopener">${it.title}</a>
        <span class="src">${it.source} · ${it.pubDate.slice(5, 16)}</span>
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
function chatAppend(role, text) {
  const body = document.getElementById("chatBody");
  const div = document.createElement("div");
  div.className = `chat-msg ${role === "user" ? "user" : "bot"}`;
  div.textContent = text;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}
function toggleChat(open) {
  const panel = document.getElementById("chatPanel");
  panel.classList.toggle("open", open);
  if (open && !chatOpened) {
    chatOpened = true;
    chatAppend("bot", "안녕하세요! 오늘 시장 상황이나 선적 현황에 대해 물어보세요.\n(참고: 아직 회사 실제 문서·계약서는 연결되어 있지 않아요 — 지금은 대시보드에 보이는 데이터로만 답해요.)");
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
      chatAppend("bot", data.reply);
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
async function refreshConnectStatus() {
  const excelIcon = document.getElementById("excelIcon");
  const excelLabel = document.getElementById("excelLabel");
  const curIcon = document.getElementById("curIcon");
  const curLabel = document.getElementById("curLabel");
  const curSub = document.getElementById("curSub");
  if (!excelIcon) return null;
  try {
    const status = await (await authedFetch(`${API_URL}/company/status`, { signal: AbortSignal.timeout(8000) })).json();
    if (status.excel) {
      excelIcon.classList.replace("empty", "ok"); excelIcon.textContent = "✅";
      excelLabel.textContent = `엑셀 업로드됨 · ${new Date(status.excel.lastModified).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}`;
    } else {
      excelIcon.classList.replace("ok", "empty"); excelIcon.textContent = "📄";
      excelLabel.textContent = "엑셀 미업로드 (데모 데이터로 대체 중)";
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
  refreshConnectStatus();
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

// Bedrock 건별(stance/headline/why/action) + 결정론적 집계(납기/컨테이너/실현총액/예산대비)를 id로 병합.
function mergeShipments(reco, portfolio) {
  const byId = Object.fromEntries((portfolio.shipments || []).map((s) => [s.id, s]));
  return (reco.shipments || []).map((rs) => ({ ...(byId[rs.id] || {}), ...rs }));
}

function shipCardHtml(s) {
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
        <span class="pf-headline">${esc(s.headline || "")}</span>
        <span class="pf-id">${esc(s.id || "")}</span>
      </div>
      <div class="pf-meta">${meta.join(" · ")}</div>
      <div class="pf-sail"><span class="pfl">권장 항차</span>${sailTxt}</div>
      ${s.why ? `<div class="pf-why">${esc(s.why)}</div>` : ""}
      ${s.action ? `<div class="pf-action"><span class="pfl">오늘 할 일</span>${esc(s.action)}</div>` : ""}
    </div>`;
}

function renderPortfolio(mountId, data, compact) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  const r = data.recommendation, p = data.portfolio || {};
  const ships = mergeShipments(r, p).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
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
      <div class="reco-eyebrow"><span class="en">AI SHIPPING RECOMMENDATION</span><span class="ko">포트폴리오 종합 판정${data.asOf ? ` · ${esc(data.asOf)} 기준` : ""}</span></div>
      <div class="verdict">${esc(r.verdict || "")}</div>
      <div class="pf-kpis">${kpiHtml}</div>
      ${compact ? `<a class="more-link" href="recommendation.html">전체 포트폴리오 분석 →</a>` : ""}
    </div>`;

  if (compact) {
    const top = ships.slice(0, 2).map(shipCardHtml).join("");
    mount.innerHTML = `<div class="reco ${pfStance}">${heroHtml}<div class="pf-ships compact">${top}</div></div>`;
    return;
  }

  const narrHtml = esc(r.summaryNarrative || "").replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  const keys = (r.portfolioKeyNumbers || []).map((k) => `
    <div class="reco-key"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.value)}</div><div class="kn">${esc(k.note || "")}</div></div>`).join("");
  const actionsHtml = (r.actions || []).map((x) => `<li>${esc(x)}</li>`).join("");
  const src = p.dataSources || {};

  mount.innerHTML = `
    <div class="reco ${pfStance}">
      ${heroHtml}
      <div class="reco-body">
        <div class="reco-keys">${keys}</div>
        <div class="reco-narr"><p>${narrHtml}</p></div>
        ${actionsHtml ? `<div class="reco-col act"><h4>포트폴리오 차원 오늘 할 일</h4><ul>${actionsHtml}</ul></div>` : ""}
        <div class="section-title" style="margin-top:18px;">선적별 판단 <span class="sub">· 우선순위 순</span></div>
        <div class="pf-ships">${ships.map(shipCardHtml).join("")}</div>
        <div class="reco-foot">
          <span class="ai-badge">AI 생성 · Bedrock</span>
          <span>기준일 ${esc(data.asOf || "-")}</span>
          <span>· 데이터: KCCI ${esc(src.kcci || "-")} / 회사 ${esc(src.company || "-")} / 스케줄 실측 매칭 / 뉴스 ${src.news ?? 0}건</span>
          <button class="reco-refresh" id="recoRefresh">다시 분석</button>
        </div>
      </div>
    </div>`;
  const btn = document.getElementById("recoRefresh");
  if (btn) btn.addEventListener("click", () => refreshRecommendation(mountId, compact));
}

// 저장된 최신 포트폴리오를 즉시 렌더. 없으면 "분석 실행" 안내.
async function loadRecommendation(mountId = "recoMount", compact = false) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  try {
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
        <span class="opname">${c.operator}</span>
        <span class="direct-chip ${c.direct ? "" : "ts"}">${c.direct ? "직항" : "환적"}</span>
      </div>
      <div class="sched-leg">
        <span class="dot orig"></span>
        <div class="ltext">
          <div class="port">${ccFlag("KR")} ${c.originName}</div>
          <div class="date">${mdShort(c.etd)} (ETD)</div>
        </div>
      </div>
      <div class="sched-leg">
        <span class="dot"></span>
        <div class="ltext">
          <div class="port">${ccFlag(c.destCC)} ${c.destName}</div>
          <div class="date">${mdShort(c.eta)} (ETA)</div>
        </div>
      </div>
      <div class="sched-vessel">${c.vessel}</div>
      <div class="sched-price-row">
        <span class="ptype">40ft 참고운임</span>
        <span class="pval">$${c.priceUSD.toLocaleString("en-US")}<span class="pmark">~</span></span>
      </div>
    </div>`;
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
