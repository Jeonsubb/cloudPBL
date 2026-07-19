// PortPulse 공통 JS — 모든 페이지가 <script src="common.js"></script>로 로드.
// 각 페이지는 이 파일의 함수들을 자기 마운트 지점·limit/compact 옵션으로 호출한다.
const API_URL = window.location.search.includes("api=")
  ? new URLSearchParams(window.location.search).get("api")
  : "https://t7ggohc5tb.execute-api.ap-northeast-2.amazonaws.com";

/* ---------- 상단 네비게이션 ---------- */
const NAV_PAGES = [
  { href: "index.html", key: "home", icon: "🏠", label: "홈" },
  { href: "recommendation.html", key: "reco", icon: "🚢", label: "AI 선적 추천" },
  { href: "market.html", key: "market", icon: "📈", label: "시황" },
  { href: "schedule.html", key: "schedule", icon: "🗓️", label: "실시간 스케줄" },
  { href: "shipments.html", key: "shipments", icon: "📦", label: "선적 의사결정" },
  { href: "news.html", key: "news", icon: "📰", label: "뉴스" },
];
function renderNav(activeKey) {
  const mount = document.getElementById("navMount");
  if (!mount) return;
  mount.innerHTML = `<nav class="pnav">${NAV_PAGES.map((p) =>
    `<a href="${p.href}" class="${p.key === activeKey ? "active" : ""}">${p.icon} ${p.label}</a>`
  ).join("")}</nav>`;
}
function renderBrandHeader(updatedId = "updated") {
  const mount = document.getElementById("headerMount");
  if (mount) {
    mount.innerHTML = `
      <header class="top">
        <a class="brand-link" href="index.html">
          <span class="dot"></span>
          <div>
            <h1>PortPulse</h1>
            <div class="tag">수출입 기업을 위한 해운 운임·환율·시황 대시보드</div>
          </div>
        </a>
        <div class="updated" id="${updatedId}">불러오는 중…</div>
      </header>`;
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
const chatHistory = [];
let chatOpened = false;
function chatAppend(role, text, citations = []) {
  const body = document.getElementById("chatBody");
  const div = document.createElement("div");
  div.className = `chat-msg ${role === "user" ? "user" : "bot"}`;
  const messageText = document.createElement("div");
  messageText.textContent = text;
  div.appendChild(messageText);
  if (role !== "user" && citations.length) {
    const sources = document.createElement("div");
    sources.className = "chat-sources";
    citations.forEach((citation, index) => {
      const source = citation.url ? document.createElement("a") : document.createElement("span");
      source.className = "chat-source";
      source.textContent = `${citation.organization || citation.title}${citation.page ? ` p.${citation.page}` : ""}`;
      source.title = citation.excerpt || citation.title;
      if (citation.url) {
        source.href = citation.url;
        source.target = "_blank";
        source.rel = "noopener noreferrer";
      }
      sources.appendChild(source);
      if (index === 1 && citations.length > 2) {
        const more = document.createElement("span");
        more.className = "chat-source more";
        more.textContent = `+${citations.length - 2}`;
        sources.appendChild(more);
      }
    });
    div.appendChild(sources);
  }
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}
function toggleChat(open) {
  const panel = document.getElementById("chatPanel");
  panel.classList.toggle("open", open);
  if (open && !chatOpened) {
    chatOpened = true;
    chatAppend("bot", "안녕하세요! 오늘 시장 상황, 선적 현황, 해운 도메인 문서에 대해 물어보세요.");
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
    const data = await (await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, history: chatHistory }),
    })).json();
    pending.remove();
    if (data.reply) {
      chatAppend("bot", data.reply, Array.isArray(data.citations) ? data.citations : []);
      chatHistory.push({ role: "user", text: message }, { role: "assistant", text: data.reply });
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
    const status = await (await fetch(`${API_URL}/company/status`, { signal: AbortSignal.timeout(8000) })).json();
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
    const { url } = await (await fetch(`${API_URL}/company/upload-url`)).json();
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
    const { current } = await (await fetch(`${API_URL}/shipments/current`)).json();
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
    const res = await fetch(`${API_URL}/shipments/current`, {
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

/* ---------- AI 선적 추천 ----------
   라이브 API(/recommendations)가 있으면 그걸, 없으면 recommendation-demo.json 폴백. 동일 스키마.
   compact=true면 히어로(요약)만 렌더하고 "전체 분석 보기" 링크를 붙인다(홈 요약용). */
const STANCE_META = {
  BOOK_NOW: { label: "지금 예약", icon: "🚢" },
  BOOK_SOON: { label: "곧 예약", icon: "⏱️" },
  CONSIDER_WAIT: { label: "관망 검토", icon: "⏳" },
  DEADLINE_RISK: { label: "납기 위험", icon: "⚠️" },
};
function renderRecommendation(mountId, data, compact) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  const r = data.recommendation, b = data.brief;
  const sm = STANCE_META[r.stance] ?? STANCE_META.BOOK_SOON;
  const s = r.recommendedSailing ?? {};
  const src = b.dataSources || {};
  const sailName = esc((s.vessel || "").startsWith(s.operator || " ") ? s.vessel : `${s.operator || ""} ${s.vessel || ""}`.trim());

  const heroHtml = `
      <div class="reco-hero">
        <div>
          <span class="stance-badge">${sm.icon} ${sm.label}</span>
          <span class="conf">신뢰도 ${esc(r.confidence)}</span>
        </div>
        <div class="verdict">${esc(r.verdict)}</div>
        <div class="subline"><b>${esc(b.company)}</b> · ${esc(b.shipment.lane)} (${esc(b.shipment.routeLabel || "")}) · ${esc(b.shipment.equipment)}×${b.shipment.containers} · 납기 ${esc(b.shipment.requiredDeliveryDate)}</div>
        <div class="reco-sail">
          <span class="sv">${sailName}</span>
          <span class="leg">${esc(s.service || "")} · ETD ${mdShort(s.etd)} → ETA ${mdShort(s.eta)}</span>
          <span class="pz">$${Number(s.priceUSDPerFeu || 0).toLocaleString("en-US")}<span style="font-size:11px;font-weight:600;opacity:.8">/FEU</span></span>
          <span class="why">${esc(s.why || "")}</span>
        </div>
        ${compact ? `<a class="more-link" href="recommendation.html">전체 분석 보기 →</a>` : ""}
      </div>`;

  if (compact) {
    mount.innerHTML = `<div class="reco compact ${r.stance}">${heroHtml}</div>`;
    return;
  }

  const keys = (r.keyNumbers || []).map((k) => `
    <div class="reco-key"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.value)}</div><div class="kn">${esc(k.note || "")}</div></div>`).join("");
  const col = (cls, icon, title, items) => `
    <div class="reco-col ${cls}"><h4>${icon} ${title}</h4><ul>${(items || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  const narrHtml = esc(r.narrative).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");

  mount.innerHTML = `
    <div class="reco ${r.stance}">
      ${heroHtml}
      <div class="reco-body">
        <div class="reco-keys">${keys}</div>
        <div class="reco-narr"><p>${narrHtml}</p></div>
        <div class="reco-cols">
          ${col("act", "✅", "오늘 할 일", r.actions)}
          ${col("risk", "⚠️", "주의·리스크", r.risks)}
          ${col("watch", "🔁", "이러면 재검토", r.watchTriggers)}
        </div>
        <div class="reco-foot">
          <span class="ai-badge">AI 생성 · Bedrock</span>
          <span>다음 재검토 ${esc(r.nextReviewDate || "-")}</span>
          <span>· 데이터: KCCI ${esc(src.kcci || "-")} / 회사 ${esc(src.company || "-")} / 현재선적 ${esc(src.currentShipmentSource || "-")} / 뉴스 ${src.news ?? 0}건</span>
          <span>· 근거 항차 ${b.schedule.feasibleCount}/${b.schedule.boardable}편 납기충족</span>
          <button class="reco-refresh" id="recoRefresh">다시 분석</button>
        </div>
      </div>
    </div>`;
  const btn = document.getElementById("recoRefresh");
  if (btn) btn.addEventListener("click", () => loadRecommendation(mountId, false, true));
}
async function loadRecommendation(mountId = "recoMount", compact = false, force = false) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  if (force) mount.innerHTML = `<div class="reco"><div class="reco-loading">추천 재분석 중…</div></div>`;
  try {
    const res = await fetch(`${API_URL}/recommendations`, { signal: AbortSignal.timeout(force ? 30000 : 8000) });
    if (res.ok) { const data = await res.json(); if (data.recommendation) return renderRecommendation(mountId, data, compact); }
    throw new Error("no live reco");
  } catch (e) {
    try {
      const demo = await (await fetch("./recommendation-demo.json")).json();
      renderRecommendation(mountId, demo, compact);
    } catch (e2) {
      mount.innerHTML = `<div class="reco"><div class="reco-loading err">추천을 불러오지 못했습니다: ${e2.message}</div></div>`;
    }
  }
}

/* ---------- 실시간 스케줄 · 참고 운임 ----------
   스케줄(operator/vessel/etd/eta/direct)은 hmm21.com 공개 스케줄 조회 실측값(2026-07-16 관측).
   priceUSD는 실거래가 아님 — 항로별 앵커가(Freightos 스냅샷 또는 항로 특성 추정) ± 랜덤%를 적용한 참고 추정치. */
const SCHEDULE_CARDS = [
  { originName: "Busan", destName: "Long Beach", destCC: "US",
    sailings: [
      { vessel: "SM KWANGYANG", operator: "SML", etd: "2026-07-23", eta: "2026-08-03", direct: true, priceUSD: 6760 },
      { vessel: "HMM DAON", operator: "HMM", etd: "2026-07-30", eta: "2026-08-13", direct: true, priceUSD: 7420 },
      { vessel: "ONE FORTUNE", operator: "ONE", etd: "2026-08-06", eta: "2026-08-19", direct: true, priceUSD: 7850 },
    ] },
  { originName: "Busan", destName: "New York", destCC: "US",
    sailings: [
      { vessel: "HMM AMETHYST", operator: "HMM", etd: "2026-07-20", eta: "2026-08-28", direct: true, priceUSD: 8930 },
      { vessel: "YM TRANQUILITY", operator: "YML", etd: "2026-07-29", eta: "2026-08-24", direct: true, priceUSD: 9760 },
      { vessel: "HMM VICTORY", operator: "HMM", etd: "2026-07-29", eta: "2026-09-04", direct: true, priceUSD: 8460 },
    ] },
  { originName: "Busan", destName: "Rotterdam", destCC: "NL",
    sailings: [
      { vessel: "ONE TRIBUTE", operator: "ONE", etd: "2026-07-21", eta: "2026-08-23", direct: true, priceUSD: 5410 },
      { vessel: "HMM OSLO", operator: "HMM", etd: "2026-07-23", eta: "2026-09-29", direct: false, priceUSD: 4930 },
      { vessel: "ONE TRIUMPH", operator: "ONE", etd: "2026-07-26", eta: "2026-08-29", direct: true, priceUSD: 5720 },
    ] },
  { originName: "Busan", destName: "Singapore", destCC: "SG",
    sailings: [
      { vessel: "SEASPAN BRILLIANCE", operator: "HMM", etd: "2026-07-19", eta: "2026-08-03", direct: true, priceUSD: 900 },
      { vessel: "HMM OCEAN", operator: "HMM", etd: "2026-07-22", eta: "2026-08-07", direct: true, priceUSD: 1010 },
    ] },
  { originName: "Busan", destName: "Shanghai", destCC: "CN",
    sailings: [
      { vessel: "HMM JUNIPER", operator: "HMM", etd: "2026-07-21", eta: "2026-07-24", direct: true, priceUSD: 270 },
      { vessel: "HMM TURQUOISE", operator: "HMM", etd: "2026-07-23", eta: "2026-07-31", direct: true, priceUSD: 310 },
      { vessel: "SM JAKARTA", operator: "SML", etd: "2026-08-03", eta: "2026-08-05", direct: true, priceUSD: 255 },
    ] },
];
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
function renderSchedCards(stripId, limit) {
  const strip = document.getElementById(stripId);
  if (!strip) return;
  if (limit) {
    const cards = SCHEDULE_CARDS.flatMap((route) => route.sailings.map((s) => ({ ...route, ...s })))
      .sort((a, b) => a.etd.localeCompare(b.etd)).slice(0, limit);
    strip.innerHTML = cards.map(schedCardHtml).join("");
    return;
  }
  strip.innerHTML = SCHEDULE_CARDS.map((route) => `
    <div class="sched-group-title">${ccFlag("KR")} Busan → ${ccFlag(route.destCC)} ${route.destName}</div>
    <div class="sched-strip">${route.sailings.map((s) => schedCardHtml({ ...route, ...s })).join("")}</div>
  `).join("");
}
