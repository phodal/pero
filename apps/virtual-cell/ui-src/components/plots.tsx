import React, { useId } from 'react';
import { Button, Card, CardHeader, Icon, IconButton } from '@pero/app-sdk/ui';
import { seriesStyle } from '@pero/app-sdk/chart';

// Older Web hosts provide the shared palette but not the chart CSS tokens.
// Keep token-based theming, with the host SDK's actual colours as fallback.
const seriesColor = (i: number) => `var(--pero-chart-${i + 1}, ${seriesStyle(i).stroke})`;
export const color = (i: number) => i < 6 ? seriesColor(i) : `color-mix(in srgb, ${seriesColor(i % 6)} 55%, ${seriesColor(5)})`;
export const num = (n: number) => Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—';
export function Pane({ title, children, actions, className = '', note }: { title: string; children: React.ReactNode; actions?: React.ReactNode; className?: string; note?: React.ReactNode }) {
  const id = useId();
  return <Card asChild className={`vc-pane ${className}`}><section aria-labelledby={id}><CardHeader actions={actions}><h3 id={id}>{title}</h3></CardHeader><div className="vc-pane-body">{children}</div>{note && <footer className="vc-pane-note">{note}</footer>}</section></Card>;
}
export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return <div className="vc-legend">{items.map((s, i) => <span key={i}><i style={{ background: s.color }}/>{s.name}</span>)}</div>;
}
export function Heatmap({ columns, rows, selected, onSelect, label, diverging = false }: { columns: string[]; rows: { id: string; values: number[] }[]; selected?: string; onSelect?(id: string): void; label: string; diverging?: boolean }) {
  const width = 720, left = 125, top = 16, cellH = Math.max(13, Math.min(27, 330 / Math.max(1, rows.length))), height = rows.length * cellH + 82;
  const values = rows.flatMap(r => r.values), max = Math.max(...values.map(Math.abs), .001), cellW = (width - left - 12) / Math.max(1, columns.length), signed = diverging || values.some(v => v < 0);
  return <div className="vc-heatmap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}><title>{label}</title>
    {rows.map((r, y) => <g key={r.id}><text x={left - 10} y={top + y * cellH + cellH * .7} textAnchor="end" className={r.id === selected ? 'vc-axis-selected' : 'vc-axis'}>{r.id.length > 20 ? `${r.id.slice(0, 19)}…` : r.id}</text>{r.values.map((v, x) => <rect key={x} x={left + x * cellW} y={top + y * cellH} width={cellW - .5} height={cellH - .5} fill={`color-mix(in srgb, ${color(signed && v < 0 ? 5 : 1)} ${Math.abs(v) / max * 100}%, var(--pero-surface))`} stroke={r.id === selected ? 'var(--pero-text)' : 'none'} strokeWidth={.6} onClick={() => onSelect?.(r.id)}><title>{`${r.id} · ${columns[x]}: ${num(v)}`}</title></rect>)}</g>)}
    {columns.map((g, x) => <text key={g} className="vc-axis" transform={`translate(${left + (x + .5) * cellW},${top + rows.length * cellH + 10}) rotate(-45)`} textAnchor="end">{g}</text>)}
  </svg><div className="vc-color-scale"><span>{signed ? num(-max) : '0'}</span><i style={{ background: signed ? `linear-gradient(90deg, ${color(5)}, var(--pero-surface), ${color(1)})` : `linear-gradient(90deg, var(--pero-surface), ${color(1)})` }}/><span>{num(max)}</span></div></div>;
}
export function Bars({ rows, label, selected, onSelect }: { rows: { id: string; value: number; color?: string }[]; label: string; selected?: string; onSelect?(id: string): void }) {
  const max = Math.max(...rows.map(r => Math.abs(r.value)), .001);
  return <div className="vc-bars" aria-label={label}>{rows.map((r, i) => {
    const content = <><span title={r.id}>{r.id}</span><span className="vc-bar-track"><i style={{ width: `${Math.abs(r.value) / max * 100}%`, background: r.color ?? color(i) }}/></span><output>{num(r.value)}</output></>;
    return onSelect
      ? <Button key={r.id} variant="ghost" className="vc-bar-row" aria-pressed={selected === undefined ? undefined : selected === r.id} onClick={() => onSelect(r.id)}>{content}</Button>
      : <div key={r.id} className="vc-bar-row vc-bar-readout">{content}</div>;
  })}</div>;
}
export function Lines({ series, xLabel, yLabel, label }: { series: { name: string; points: [number, number][] }[]; xLabel: string; yLabel: string; label: string }) {
  const all = series.flatMap(s => s.points), xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const xmin = Math.min(0, ...xs), xmax = Math.max(...xs, 1), ymin = Math.min(0, ...ys), ymax = Math.max(...ys, .01);
  const px = (x: number) => 58 + (x - xmin) / (xmax - xmin || 1) * 600, py = (y: number) => 220 - (y - ymin) / (ymax - ymin || 1) * 195;
  return <><svg className="vc-line-plot" viewBox="0 0 700 270" role="img" aria-label={label}><title>{label}</title>
    {[0, .25, .5, .75, 1].map(f => <g key={f}><line x1="58" x2="658" y1={py(ymin + (ymax - ymin) * f)} y2={py(ymin + (ymax - ymin) * f)} className="vc-grid-line"/><text x="48" y={py(ymin + (ymax - ymin) * f) + 4} textAnchor="end" className="vc-axis">{num(ymin + (ymax - ymin) * f)}</text><text x={px(xmin + (xmax - xmin) * f)} y="240" textAnchor="middle" className="vc-axis">{num(xmin + (xmax - xmin) * f)}</text></g>)}
    {series.map((s, i) => <polyline key={s.name} points={s.points.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')} fill="none" stroke={color(i)} strokeWidth="2.5" strokeDasharray={i % 3 === 1 ? '7 3' : i % 3 === 2 ? '2 3' : undefined}/>)}
    <text x="355" y="266" textAnchor="middle" className="vc-axis">{xLabel}</text><text transform="translate(14,125) rotate(-90)" textAnchor="middle" className="vc-axis">{yLabel}</text>
  </svg><Legend items={series.map((s, i) => ({ name: s.name, color: color(i) }))}/></>;
}
export function ZoomTools({ zoom, onZoom, t }: { zoom: number; onZoom(n: number): void; t: (s: any) => string }) {
  return <div className="vc-zoom"><IconButton variant="secondary" label={t('zoomOut')} disabled={zoom <= 1} onClick={() => onZoom(Math.max(1, zoom - .5))}><Icon name="minus"/></IconButton><IconButton variant="secondary" label={t('resetView')} onClick={() => onZoom(1)}><Icon name="fit"/></IconButton><IconButton variant="secondary" label={t('zoomIn')} disabled={zoom >= 4} onClick={() => onZoom(Math.min(4, zoom + .5))}><Icon name="plus"/></IconButton></div>;
}
