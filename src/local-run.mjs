// 로컬 수집 실행기: ECOS에서 최근 90일 시계열을 받아 data/*.json과 charts/*.svg로 저장한다.
// 사용법: ECOS_API_KEY=발급키 node src/local-run.mjs  (키 없으면 sample 키로 창 분할 수집)
import { mkdir, writeFile } from "node:fs/promises";
import { fetchSeries } from "../lambda/ecos.mjs";
import { renderLineChart } from "./chart.mjs";
import { SERIES } from "../lambda/series.mjs";

const DAYS = Number(process.env.DAYS ?? 90);
const apiKey = process.env.ECOS_API_KEY || "sample";
const toDate = new Date();
const fromDate = new Date(toDate.getTime() - DAYS * 86_400_000);

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await mkdir(new URL("../charts/", import.meta.url), { recursive: true });

for (const series of SERIES) {
  const points = await fetchSeries(apiKey, series, fromDate, toDate);
  if (points.length === 0) {
    console.warn(`[skip] ${series.id}: 관측치 없음`);
    continue;
  }
  const payload = {
    seriesId: series.id,
    label: series.label,
    unit: series.unit,
    source: `${series.statCode}/${series.itemCode}`,
    fetchedAt: new Date().toISOString(),
    points,
  };
  await writeFile(new URL(`../data/${series.id}.json`, import.meta.url), JSON.stringify(payload, null, 2));
  await writeFile(
    new URL(`../charts/${series.id}.svg`, import.meta.url),
    renderLineChart({ title: series.label, unit: series.unit, source: payload.source, points }),
  );
  const last = points.at(-1);
  console.log(`[ok] ${series.id}: ${points.length}건, 최신 ${last.date} = ${last.value} ${series.unit}`);
}
