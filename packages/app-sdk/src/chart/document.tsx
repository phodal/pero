/*
 * `DocumentChart`: render a declarative chart document inside an App panel.
 *
 * Same `@pero/data-chart` document as Canvas / inline answers; App panels draw
 * a bounded SVG subset (see APP_DOCUMENT_CHART_TYPES) with Point tokens. Does
 * not execute content, fetch, or substitute an unsupported family.
 */
import React, { useMemo } from "react";
import {
  APP_DOCUMENT_CHART_TYPES,
  buildDocumentPlot,
  ensureDocumentChartStyles,
  formatChartTick,
  projectAppChartDocument,
} from "./document.mjs";

export { APP_DOCUMENT_CHART_TYPES, ensureDocumentChartStyles, projectAppChartDocument };

export type DocumentChartProps = {
  /** Declarative chart document (schemaVersion 1), same contract as Canvas. */
  document: unknown;
  className?: string;
  /** id of a heading the host already shows; the chart title is then visually hidden. */
  labelledBy?: string;
  /** Copy for the refused / empty states; English is the fallback. */
  labels?: Partial<{ invalid: string; empty: string }>;
};

const EN = {
  invalid: "This chart could not be shown.",
  empty: "No values to display.",
};

const W = 640;
const H = 220;
const PAD = { l: 44, r: 12, t: 12, b: 8 };

/**
 * Project and draw one chart document. Invalid documents and unsupported
 * families render an explicit error; they never fall back to another type.
 */
export function DocumentChart({ document: input, className, labelledBy, labels }: DocumentChartProps) {
  const l = { ...EN, ...labels };
  const projected = useMemo(() => projectAppChartDocument(input), [input]);
  const plot = useMemo(() => (projected.ok ? buildDocumentPlot(projected.data) : null), [projected]);
  const styled = (node: HTMLElement | null) => { if (node) ensureDocumentChartStyles(node.ownerDocument); };
  const cls = ["pero-doc-chart", className].filter(Boolean).join(" ");

  if (!projected.ok) {
    return <div ref={styled} className={cls} data-pero-document-chart="" data-state="invalid" role="alert">
      <p className="pero-doc-chart__error" title={projected.error}>{l.invalid}</p>
    </div>;
  }
  if (!plot || plot.empty) {
    return <div ref={styled} className={cls} data-pero-document-chart="" data-type={projected.data.type} data-state="empty" role="status">
      {!labelledBy && <h3 className="pero-doc-chart__title">{projected.data.title}</h3>}
      <p className="pero-doc-chart__empty">{l.empty}</p>
    </div>;
  }

  const name = labelledBy ? { "aria-labelledby": labelledBy } : { "aria-label": plot.ariaLabel };
  const horizontal = plot.type === "horizontalBar";
  const desc = `${plot.type} chart, ${plot.series.length} series, ${plot.categories.length} categories, range ${formatChartTick(plot.lo)} to ${formatChartTick(plot.hi)}`;

  return <div ref={styled} className={cls} data-pero-document-chart="" data-type={plot.type} data-state="ready" {...name}>
    <h3 className={labelledBy ? "pero-ui-visually-hidden" : "pero-doc-chart__title"}>{plot.title}</h3>
    <div className="pero-doc-chart__plot">
      <svg className="pero-doc-chart__svg" viewBox={`0 0 ${W} ${horizontal ? Math.max(H, 40 + plot.categories.length * 28) : H}`} role="img" aria-label={`${plot.title}: ${desc}`} preserveAspectRatio="none">
        {horizontal ? <HorizontalBars plot={plot} /> : <VerticalPlot plot={plot} />}
      </svg>
      {!horizontal && plot.categories.length <= 24 && (
        <ol className="pero-doc-chart__xticks" aria-hidden="true" style={{ paddingLeft: `${PAD.l / W * 100}%`, paddingRight: `${PAD.r / W * 100}%`, gridTemplateColumns: `repeat(${plot.categories.length}, minmax(0, 1fr))` }}>
          {plot.categories.map((x) => <li key={x} title={x}>{x}</li>)}
        </ol>
      )}
      {plot.series.length > 1 && (
        <ul className="pero-doc-chart__legend">
          {plot.series.map((s) => <li key={s.name}><span className="pero-doc-chart__swatch" data-series={s.index} style={{ background: `var(--pero-chart-${(s.index % 6) + 1})` }} aria-hidden="true" />{s.name}</li>)}
        </ul>
      )}
    </div>
  </div>;
}

function VerticalPlot({ plot }: { plot: ReturnType<typeof buildDocumentPlot> }) {
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - plot.lo) / plot.span);
  const band = (W - PAD.l - PAD.r) / Math.max(1, plot.categories.length);
  const xAt = (category: string) => PAD.l + band * (plot.categories.indexOf(category) + 0.5);
  const gridYs = [plot.lo, plot.hi];
  return <>
    {gridYs.map((v) => <line key={v} className="pero-doc-chart__grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />)}
    <line className="pero-doc-chart__axis" x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} />
    <text className="pero-doc-chart__tick" x={PAD.l - 6} y={y(plot.hi) + 4} textAnchor="end">{formatChartTick(plot.hi)}</text>
    <text className="pero-doc-chart__tick" x={PAD.l - 6} y={y(plot.lo) + 4} textAnchor="end">{formatChartTick(plot.lo)}</text>
    {plot.type === "bar"
      ? plot.series.map((s) => s.points.filter((p) => p.y != null).map((p) => {
        const w = band * 0.8 / plot.series.length;
        const x0 = xAt(p.x) - band * 0.4 + w * s.index;
        const y1 = y(p.y as number);
        const y0 = y(0);
        return <rect key={`${s.index}-${p.x}`} className="pero-doc-chart__bar" data-series={s.index} x={x0} width={Math.max(1, w - 1)} y={Math.min(y1, y0)} height={Math.abs(y1 - y0)}>
          <title>{`${s.name} · ${p.x}: ${formatChartTick(p.y as number)}`}</title>
        </rect>;
      }))
      : plot.series.map((s) => {
        const parts: string[] = [];
        let drawing = false;
        for (const p of s.points) {
          if (p.y == null) { drawing = false; continue; }
          const cmd = drawing ? "L" : "M";
          parts.push(`${cmd}${xAt(p.x).toFixed(1)},${y(p.y).toFixed(1)}`);
          drawing = true;
        }
        if (plot.type === "area" && parts.length) {
          const first = s.points.find((p) => p.y != null);
          const last = [...s.points].reverse().find((p) => p.y != null);
          if (first && last) {
            parts.push(`L${xAt(last.x).toFixed(1)},${y(0).toFixed(1)}`, `L${xAt(first.x).toFixed(1)},${y(0).toFixed(1)}`, "Z");
          }
          return <path key={s.index} className="pero-doc-chart__area" data-series={s.index} d={parts.join("")} style={{ fill: `color-mix(in srgb, var(--pero-chart-${(s.index % 6) + 1}) 22%, transparent)`, stroke: `var(--pero-chart-${(s.index % 6) + 1})` }} />;
        }
        return <path key={s.index} className="pero-doc-chart__line" data-series={s.index} d={parts.join("")} style={{ stroke: `var(--pero-chart-${(s.index % 6) + 1})` }} />;
      })}
  </>;
}

function HorizontalBars({ plot }: { plot: ReturnType<typeof buildDocumentPlot> }) {
  const height = Math.max(H, 40 + plot.categories.length * 28);
  const pad = { l: 72, r: 16, t: 12, b: 12 };
  const band = (height - pad.t - pad.b) / Math.max(1, plot.categories.length);
  const x = (v: number) => pad.l + (W - pad.l - pad.r) * ((v - plot.lo) / plot.span);
  return <>
    <line className="pero-doc-chart__axis" x1={x(0)} x2={x(0)} y1={pad.t} y2={height - pad.b} />
    {plot.categories.map((category, i) => {
      const s = plot.series[0];
      const point = s?.points.find((p) => p.x === category);
      if (point?.y == null) return null;
      const y0 = pad.t + band * i + band * 0.15;
      const barH = band * 0.7;
      return <g key={category}>
        <text className="pero-doc-chart__tick" x={pad.l - 6} y={y0 + barH * 0.7} textAnchor="end">{category}</text>
        <rect className="pero-doc-chart__bar" data-series={0} x={Math.min(x(point.y), x(0))} y={y0} width={Math.abs(x(point.y) - x(0))} height={Math.max(1, barH)}>
          <title>{`${category}: ${formatChartTick(point.y)}`}</title>
        </rect>
      </g>;
    })}
  </>;
}
