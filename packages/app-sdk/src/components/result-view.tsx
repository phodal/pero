// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React from 'react';
import { validateStructuredResult } from '../structured-result.mjs';
import { ensureUiStyles } from './ui-styles';

/** Copy shown by ResultView. Apps pass translated strings; English is the fallback. */
export type ResultViewLabels = {
  loading: string; empty: string; invalid: string; truncatedRows: (n: number) => string; truncatedPoints: (n: number) => string; truncatedSeries: (n: number) => string;
  source: string; data: string; provenance: Record<'user-provided' | 'calculated' | 'sourced' | 'illustrative', string>;
};
const EN: ResultViewLabels = {
  loading: 'Loading result…', empty: 'No rows to display.', invalid: 'This result could not be shown because it does not match the structured-result contract.',
  truncatedRows: n => `${n} more rows were omitted.`, truncatedPoints: n => `${n} more points were omitted.`, truncatedSeries: n => `${n} more series were omitted.`,
  source: 'Source', data: 'Data',
  provenance: { 'user-provided': 'User provided', calculated: 'Calculated', sourced: 'Sourced', illustrative: 'Illustrative' },
};

export type ResultViewProps = {
  result?: unknown;
  loading?: boolean;
  error?: React.ReactNode;
  labels?: Partial<ResultViewLabels>;
  formatNumber?: (value: number) => string;
  /** Open an Artifact / Evidence / Run reference; the link renders only when given (url refs open natively). */
  onOpenRef?: (ref: { type: string; id: string; revision?: string; digest?: string }) => void;
  className?: string;
  /** id of a heading the host already shows; the result's own title is then visually hidden and the section is named by that heading. */
  labelledBy?: string;
};

const fmt = (v: unknown, f: (n: number) => string) => v == null ? '—' : typeof v === 'number' ? f(v) : String(v);
const styled = (node: HTMLElement | null) => { if (node) ensureUiStyles(node.ownerDocument); };

/** Native, bounded Table/Chart renderer for pero.structured-result v1. Never executes content. */
export function ResultView({ result, loading, error, labels, formatNumber = n => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 }).format(n), onOpenRef, className, labelledBy }: ResultViewProps) {
  const l = { ...EN, ...labels, provenance: { ...EN.provenance, ...labels?.provenance } };
  const cls = ['pero-ui-result', className].filter(Boolean).join(' ');
  if (loading) return <div ref={styled} className={cls} role="status" aria-live="polite" aria-busy="true" data-state="loading"><div className="pero-ui-result-skeleton" aria-hidden="true"/><span>{l.loading}</span></div>;
  if (error) return <div ref={styled} className={cls} role="alert" data-state="error">{error}</div>;
  const legacy = result as { version?: number; columns?: string[]; rows?: unknown[][]; provenance?: { label?: string; kind?: string } } | undefined;
  const input = legacy && legacy.version === undefined && Array.isArray(legacy.columns) && Array.isArray(legacy.rows)
    ? { ...legacy, version: 1, kind: 'table', provenance: { kind: 'calculated', ...legacy.provenance } }
    : result;
  const checked = validateStructuredResult(input);
  if (!checked.ok) return <div ref={styled} className={cls} role="alert" data-state="invalid" title={checked.errors.join('\n')}>{l.invalid}</div>;
  const r = checked.value as any;
  const p = r.provenance;
  const ref = p.ref;
  const refText = ref && `${ref.type}:${ref.id}${ref.revision ? `@${ref.revision}` : ''}`;
  const source = <p className="pero-ui-result-source" data-provenance={p.kind}>
    <span className="pero-ui-result-badge">{l.provenance[p.kind as keyof ResultViewLabels['provenance']]}</span>
    <span>{l.source}: {p.label}</span>
    {ref && (ref.type === 'url' ? <a href={ref.id} target="_blank" rel="noopener noreferrer">{refText}</a>
      : onOpenRef ? <button type="button" className="pero-ui-result-ref" onClick={() => onOpenRef(ref)}>{refText}</button>
      : <code>{refText}</code>)}
  </p>;
  const notices = [r.truncated?.rows && l.truncatedRows(r.truncated.rows), r.truncated?.series && l.truncatedSeries(r.truncated.series), r.truncated?.points && l.truncatedPoints(r.truncated.points)].filter(Boolean);
  const notice = notices.length > 0 && <p className="pero-ui-result-notice" role="note">{notices.join(' ')}</p>;
  const name = labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': r.title };
  if (r.kind === 'table') return <section ref={styled} className={cls} {...name} data-kind="table">
    <ScrollArea name={name}>
      <table {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}><caption className={labelledBy ? 'pero-ui-visually-hidden' : undefined}>{r.title}</caption>
        <thead><tr>{r.columns.map((c: string, i: number) => <th key={i} scope="col">{c}</th>)}</tr></thead>
        <tbody>{r.rows.map((row: unknown[], i: number) => <tr key={i}>{row.map((cell, j) => <td key={j} data-numeric={typeof cell === 'number' || undefined}>{fmt(cell, formatNumber)}</td>)}</tr>)}</tbody>
      </table>
      {r.rows.length === 0 && <p className="pero-ui-result-empty">{l.empty}</p>}
    </ScrollArea>{notice}{source}
  </section>;
  return <section ref={styled} className={cls} {...name} data-kind="chart" data-chart={r.chart}>
    {!labelledBy && <h3 className="pero-ui-result-title">{r.title}</h3>}
    <ChartSvg r={r} formatNumber={formatNumber}/>
    <details className="pero-ui-result-data"><summary>{l.data}</summary><ScrollArea name={name}>
      <table><thead><tr><th scope="col">{r.xLabel || 'x'}</th>{r.series.map((s: any, i: number) => <th key={i} scope="col">{s.name}{r.unit ? ` (${r.unit})` : ''}</th>)}</tr></thead>
        <tbody>{xs(r).map((x, i) => <tr key={i}><th scope="row">{fmt(x, formatNumber)}</th>{r.series.map((s: any, j: number) => <td key={j} data-numeric>{fmt(s.points.find((p: any) => p[0] === x)?.[1], formatNumber)}</td>)}</tr>)}</tbody></table>
    </ScrollArea></details>{notice}{source}
  </section>;
}

function xs(r: any): Array<string | number> {
  const seen: Array<string | number> = [];
  for (const s of r.series) for (const [x] of s.points) if (!seen.includes(x)) seen.push(x);
  return seen;
}

function ChartSvg({ r, formatNumber }: { r: any; formatNumber: (n: number) => string }) {
  const W = 640, H = 220, pad = { l: 48, r: 12, t: 12, b: 8 };
  const keys = xs(r);
  const values = r.series.flatMap((s: any) => s.points.map((p: any) => p[1]).filter((v: any) => v != null)) as number[];
  if (!keys.length || !values.length) return <p className="pero-ui-result-empty">—</p>;
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values), span = hi - lo || 1;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / span);
  const band = (W - pad.l - pad.r) / keys.length;
  const x = (k: string | number) => pad.l + band * (keys.indexOf(k) + 0.5);
  const desc = `${r.chart} chart, ${r.series.length} series, ${keys.length} x values, range ${formatNumber(lo)} to ${formatNumber(hi)}${r.unit ? ` ${r.unit}` : ''}`;
  const tick = (k: string | number) => typeof k === 'number' ? formatNumber(k) : String(k);
  return <div className="pero-ui-result-plot"><svg className="pero-ui-result-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${r.title}: ${desc}`} preserveAspectRatio="none">
    <line className="pero-ui-result-axis" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)}/>
    <text className="pero-ui-result-tick" x={pad.l - 6} y={y(hi) + 4} textAnchor="end">{formatNumber(hi)}</text>
    <text className="pero-ui-result-tick" x={pad.l - 6} y={y(lo) + 4} textAnchor="end">{formatNumber(lo)}</text>
    {r.series.map((s: any, i: number) => r.chart === 'bar'
      ? s.points.filter((p: any) => p[1] != null).map((p: any) => { const w = band * 0.8 / r.series.length; const x0 = x(p[0]) - band * 0.4 + w * i; return <rect key={`${i}-${p[0]}`} data-series={i} x={x0} width={Math.max(1, w - 1)} y={Math.min(y(p[1]), y(0))} height={Math.abs(y(p[1]) - y(0))}><title>{`${s.name} · ${p[0]}: ${formatNumber(p[1])}`}</title></rect>; })
      : <path key={i} data-series={i} fill="none" d={s.points.map((p: any, j: number) => p[1] == null ? '' : `${j && s.points[j - 1]?.[1] != null ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')}/>)}
  </svg>
  {r.series.length > 1 && <ul className="pero-ui-result-legend">{r.series.map((s: any, i: number) => <li key={i} data-series={i}><svg width="22" height="10" aria-hidden="true">{r.chart === 'bar' ? <rect x="5" y="0" width="12" height="10"/> : <line x1="0" x2="22" y1="5" y2="5"/>}</svg>{s.name}</li>)}</ul>}
  {keys.length <= 24 && <ol className="pero-ui-result-xticks" aria-hidden="true" style={{ paddingLeft: `${pad.l / W * 100}%`, paddingRight: `${pad.r / W * 100}%`, gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}>
    {keys.map(k => <li key={String(k)} title={tick(k)}>{tick(k)}</li>)}
  </ol>}</div>;
}

/** Scroll container that is a named, focusable group (not a second region) only while it actually scrolls (WCAG 2.1.1 without a stray tab stop). */
function ScrollArea({ children, name }: { children: React.ReactNode; name: React.AriaAttributes }) {
  const node = React.useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = node.current; if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
    check();
    const view = el.ownerDocument.defaultView as any;
    const ro = view?.ResizeObserver ? new view.ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  });
  return <div ref={node} className="pero-ui-result-scroll" data-scrollable={scrolls || undefined} {...(scrolls ? { tabIndex: 0, role: 'group', ...name } : {})}>{children}</div>;
}
