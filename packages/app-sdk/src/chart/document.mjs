/*
 * App-panel delivery of the declarative chart document (@pero/data-chart).
 *
 * Canvas / inline answers keep the Recharts `Chart` component. App panels need
 * the same document contract without pulling that runtime into the Workbench
 * host, so this module projects with `projectChartDocument` and draws a bounded
 * SVG subset (bar, horizontalBar, line, area, histogram). Unsupported families
 * are refused — never silently substituted.
 */
import {
  ChartDocumentError,
  projectChartDocument,
} from "./chart-document.mjs";

/** Families this App renderer draws today. The document schema still accepts all CHART_TYPES. */
export const APP_DOCUMENT_CHART_TYPES = Object.freeze([
  "bar",
  "horizontalBar",
  "line",
  "area",
  "histogram",
]);

const DOCUMENT_STYLE_ID = "pero-app-document-chart-styles";
const DOCUMENT_CSS = `
[data-pero-document-chart]{color:var(--pero-text,#24354b);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
[data-pero-document-chart] .pero-doc-chart__title{margin:0 0 var(--pero-space-3,6px);font-size:var(--pero-font-size-sm,12px);font-weight:var(--pero-font-weight-semibold,600)}
[data-pero-document-chart] .pero-doc-chart__plot{width:100%}
[data-pero-document-chart] .pero-doc-chart__svg{width:100%;height:auto;aspect-ratio:8/3;display:block}
[data-pero-document-chart][data-type=horizontalBar] .pero-doc-chart__svg{aspect-ratio:4/3}
[data-pero-document-chart] .pero-doc-chart__grid{stroke:var(--pero-border-subtle,#e4e7ec);stroke-width:1}
[data-pero-document-chart] .pero-doc-chart__axis{stroke:var(--pero-border-subtle,#e4e7ec);stroke-width:1}
[data-pero-document-chart] .pero-doc-chart__tick{fill:var(--pero-text-secondary,#5f6e80);font-size:12px}
[data-pero-document-chart] .pero-doc-chart__bar{fill:var(--pero-chart-2,#239886)}
[data-pero-document-chart] .pero-doc-chart__bar[data-series="0"]{fill:var(--pero-chart-1,#24354b)}
[data-pero-document-chart] .pero-doc-chart__bar[data-series="1"]{fill:var(--pero-chart-2,#239886)}
[data-pero-document-chart] .pero-doc-chart__bar[data-series="2"]{fill:var(--pero-chart-3,#d85c64)}
[data-pero-document-chart] .pero-doc-chart__bar[data-series="3"]{fill:var(--pero-chart-4,#c4682e)}
[data-pero-document-chart] .pero-doc-chart__bar[data-series="4"]{fill:var(--pero-chart-5,#b7831e)}
[data-pero-document-chart] .pero-doc-chart__bar[data-series="5"]{fill:var(--pero-chart-6,#9a82d8)}
[data-pero-document-chart] .pero-doc-chart__line{fill:none;stroke:var(--pero-chart-1,#24354b);stroke-width:2;vector-effect:non-scaling-stroke}
[data-pero-document-chart] .pero-doc-chart__area{fill:color-mix(in srgb,var(--pero-chart-1,#24354b) 22%,transparent);stroke:var(--pero-chart-1,#24354b);stroke-width:2;vector-effect:non-scaling-stroke}
[data-pero-document-chart] .pero-doc-chart__xticks{display:grid;gap:0;margin:2px 0 0;padding:0;list-style:none;font-size:12px;color:var(--pero-text-secondary,#5f6e80)}
[data-pero-document-chart] .pero-doc-chart__xticks li{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
[data-pero-document-chart] .pero-doc-chart__legend{display:flex;flex-wrap:wrap;gap:8px 12px;margin:6px 0 0;padding:0;list-style:none;font-size:12px;color:var(--pero-text-secondary,#5f6e80)}
[data-pero-document-chart] .pero-doc-chart__legend li{display:inline-flex;align-items:center;gap:6px}
[data-pero-document-chart] .pero-doc-chart__swatch{width:12px;height:10px;border-radius:2px;background:var(--pero-chart-1,#24354b)}
[data-pero-document-chart] .pero-doc-chart__empty,[data-pero-document-chart] .pero-doc-chart__error{margin:0;color:var(--pero-text-secondary,#5f6e80);font-size:var(--pero-font-size-sm,12px)}
[data-pero-document-chart] .pero-doc-chart__error{color:var(--pero-danger,#a62f41)}
[data-pero-document-chart] .pero-ui-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

export function ensureDocumentChartStyles(doc = globalThis.document) {
  if (!doc || doc.getElementById(DOCUMENT_STYLE_ID)) return;
  const element = doc.createElement("style");
  element.id = DOCUMENT_STYLE_ID;
  element.textContent = DOCUMENT_CSS;
  (doc.head ?? doc.documentElement).appendChild(element);
}

/**
 * Project a chart document for an App panel. Refuses families this renderer
 * does not draw; the message never echoes raw input.
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
export function projectAppChartDocument(document) {
  try {
    const data = projectChartDocument(document);
    if (!APP_DOCUMENT_CHART_TYPES.includes(data.type)) {
      return { ok: false, error: `App panels do not render chart type "${data.type}" yet; use Canvas or a supported type (${APP_DOCUMENT_CHART_TYPES.join(", ")})` };
    }
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof ChartDocumentError
      ? error.message
      : "This chart document could not be shown";
    return { ok: false, error: message };
  }
}

function compact(value) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/** Bin raw histogram observations the same way Canvas derives them. */
export function appHistogramBins(rows, bins) {
  const values = rows.filter((row) => row.y !== null).map((row) => row.y);
  if (!values.length) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const count = bins > 0 ? bins : Math.min(30, Math.max(5, Math.ceil(Math.log2(values.length)) + 1));
  const width = max === min ? 1 : (max - min) / count;
  const out = Array.from({ length: max === min ? 1 : count }, (_, index) => {
    const start = min + index * width;
    const end = index === (max === min ? 1 : count) - 1 ? max : start + width;
    return { x: `${compact(start)}–${compact(max === min ? start + width : end)}`, y: 0, series: "" };
  });
  for (const row of rows) {
    if (row.y === null) continue;
    const index = max === min ? 0 : Math.min(out.length - 1, Math.floor((row.y - min) / width));
    out[index].y += 1;
  }
  return out;
}

/**
 * Build a draw model from a projected App chart. Categories stay in row order;
 * null measures stay missing (bars omitted, lines broken).
 */
export function buildDocumentPlot(data) {
  const seriesNames = data.seriesNames.length ? [...data.seriesNames] : [""];
  let rows = data.rows;
  let type = data.type;
  if (type === "histogram") {
    rows = appHistogramBins(data.rows, data.bins ?? 0);
    type = "bar";
  }
  const categories = [];
  const seen = new Set();
  for (const row of rows) {
    const key = row.x;
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(key);
  }
  const series = seriesNames.map((name, index) => ({
    name: name || data.yLabel || data.y || "value",
    index,
    points: categories.map((x) => {
      const row = rows.find((r) => r.x === x && (r.series || "") === name);
      return { x, y: row ? row.y : null };
    }),
  }));
  const values = series.flatMap((s) => s.points.map((p) => p.y).filter((v) => v != null));
  const lo = values.length ? Math.min(0, ...values) : 0;
  const hi = values.length ? Math.max(0, ...values) : 1;
  return {
    type,
    title: data.title,
    ariaLabel: data.ariaLabel,
    summary: data.summary,
    xLabel: data.xLabel,
    yLabel: data.yLabel,
    categories,
    series,
    lo,
    hi,
    span: hi - lo || 1,
    empty: !categories.length || !values.length,
  };
}

export { ChartDocumentError, projectChartDocument, compact as formatChartTick };
