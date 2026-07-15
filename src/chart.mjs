// 의존성 없는 SVG 라인차트 렌더러. 관측일·출처를 차트 안에 함께 표기한다(기획서 데이터 신뢰 원칙).
const W = 860;
const H = 420;
const PAD = { top: 64, right: 96, bottom: 56, left: 76 };

function niceTicks(min, max, count = 5) {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step = 10 ** Math.floor(Math.log10(span / count));
  const err = span / count / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const tick = step * mult;
  const lo = Math.floor(min / tick) * tick;
  const hi = Math.ceil(max / tick) * tick;
  const ticks = [];
  for (let v = lo; v <= hi + tick / 2; v += tick) ticks.push(Number(v.toFixed(10)));
  return { ticks, lo, hi };
}

function esc(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * @param {{title:string, unit:string, source:string, points:Array<{date:string,value:number}>}} input
 * @returns {string} svg
 */
export function renderLineChart({ title, unit, source, points }) {
  const values = points.map((p) => p.value);
  const { ticks, lo, hi } = niceTicks(Math.min(...values), Math.max(...values));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const gridLines = ticks
    .map(
      (t) =>
        `<line x1="${PAD.left}" y1="${y(t).toFixed(1)}" x2="${W - PAD.right}" y2="${y(t).toFixed(1)}" stroke="#e2e8f0"/>` +
        `<text x="${PAD.left - 10}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#64748b">${t.toLocaleString("en-US")}</text>`,
    )
    .join("\n");

  const xTickCount = Math.min(6, points.length);
  const xLabels = Array.from({ length: xTickCount }, (_, k) => {
    const i = Math.round((k / (xTickCount - 1 || 1)) * (points.length - 1));
    return `<text x="${x(i).toFixed(1)}" y="${H - PAD.bottom + 22}" text-anchor="middle" font-size="12" fill="#64748b">${points[i].date.slice(5)}</text>`;
  }).join("\n");

  const last = points.at(-1);
  const first = points[0];
  const change = last.value - first.value;
  const changePct = first.value ? ((change / first.value) * 100).toFixed(2) : "0.00";
  const changeColor = change >= 0 ? "#dc2626" : "#2563eb";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Pretendard, Apple SD Gothic Neo, sans-serif">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${PAD.left}" y="30" font-size="18" font-weight="700" fill="#0f172a">${esc(title)}</text>
  <text x="${PAD.left}" y="50" font-size="13" fill="#475569">${esc(unit)} · ${esc(first.date)} ~ ${esc(last.date)} · 기간 변화 ${change >= 0 ? "+" : ""}${change.toFixed(2)} (${changePct}%)</text>
  ${gridLines}
  ${xLabels}
  <path d="${path}" fill="none" stroke="#0ea5e9" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4" fill="${changeColor}"/>
  <text x="${(x(points.length - 1) + 8).toFixed(1)}" y="${(y(last.value) + 4).toFixed(1)}" font-size="13" font-weight="700" fill="${changeColor}">${last.value.toLocaleString("en-US")}</text>
  <text x="${PAD.left}" y="${H - 14}" font-size="11" fill="#94a3b8">출처: 한국은행 ECOS ${esc(source)} · 마지막 관측일 ${esc(last.date)}</text>
</svg>`;
}
