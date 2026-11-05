import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { defaultNumericColumns, numericSeries, parseTable, type Asset, type NumericPoint } from './files';
import { Button, Select, Tabs, TabsList, TabsTrigger, TabsContent } from '@pero/app-sdk/ui';
import './table-preview.css';

const PAGE_SIZE = 100;
const numberFormat = new Intl.NumberFormat('en', { maximumSignificantDigits: 5 });

function formatTick(value: number): string {
  const magnitude = Math.abs(value);
  return magnitude !== 0 && (magnitude < 0.001 || magnitude >= 1_000_000) ? value.toExponential(2) : numberFormat.format(value);
}

function NumericChart({ points, xLabel, yLabel }: { points: Array<NumericPoint | null>; xLabel: string; yLabel: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640), [active, setActive] = useState<number | null>(null);
  const valid = useMemo(() => points.filter((point): point is NumericPoint => point !== null), [points]);
  const descriptionId = useId();
  useEffect(() => {
    if (!container.current) return;
    const element = container.current;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setActive(null), [points]);
  const height = 360, left = 76, right = 24, top = 24, bottom = 70;
  const plotWidth = Math.max(1, width - left - right), plotHeight = height - top - bottom;
  const geometry = useMemo(() => {
    if (!valid.length) return null;
    let xmin = valid[0].x, xmax = xmin, ymin = valid[0].y, ymax = ymin;
    for (const point of valid) {
      xmin = Math.min(xmin, point.x); xmax = Math.max(xmax, point.x);
      ymin = Math.min(ymin, point.y); ymax = Math.max(ymax, point.y);
    }
    // Normalize before subtracting so finite extreme values do not overflow the range.
    const xScale = Math.max(Math.abs(xmin), Math.abs(xmax)) || 1;
    const yScale = Math.max(Math.abs(ymin), Math.abs(ymax)) || 1;
    const x = (value: number) => left + (xmin === xmax ? 0.5 : (value / xScale - xmin / xScale) / (xmax / xScale - xmin / xScale)) * plotWidth;
    const y = (value: number) => top + (ymin === ymax ? 0.5 : 1 - (value / yScale - ymin / yScale) / (ymax / yScale - ymin / yScale)) * plotHeight;
    const ticks = (min: number, max: number) => min === max ? [min] : [0, 0.25, 0.5, 0.75, 1].map(fraction => min * (1 - fraction) + max * fraction);
    let connected = false, path = '';
    for (const point of points) {
      if (!point) { connected = false; continue; }
      path += `${connected ? 'L' : 'M'}${x(point.x)},${y(point.y)} `;
      connected = true;
    }
    return { x, y, path, xTicks: ticks(xmin, xmax), yTicks: ticks(ymin, ymax) };
  }, [points, valid, plotWidth, plotHeight]);
  const selected = active === null ? null : valid[active] ?? null;
  return <div className="numeric-chart" ref={container}>
    {geometry ? <>
      <svg width="100%" height={height} viewBox={`0 0 ${Math.max(width, 1)} ${height}`} role="img"
        aria-label={`Chart of ${yLabel} against ${xLabel}`} aria-describedby={descriptionId} tabIndex={0}
        onFocus={() => setActive(current => current ?? 0)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          setActive(current => event.key === 'Home' ? 0 : event.key === 'End' ? valid.length - 1
            : Math.max(0, Math.min(valid.length - 1, (current ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))));
        }}>
        <desc id={descriptionId}>Original row order. Missing and nonnumeric values break the line. Use Left and Right arrow keys to inspect points. All values are available in Table.</desc>
        {geometry.yTicks.map((tick, i) => <g key={`y-${i}`}>
          <line className="numeric-gridline" x1={left} x2={width - right} y1={geometry.y(tick)} y2={geometry.y(tick)} />
          <text className="numeric-tick" x={left - 10} y={geometry.y(tick)} textAnchor="end" dominantBaseline="middle">{formatTick(tick)}</text>
        </g>)}
        <line className="numeric-axis" x1={left} x2={left} y1={top} y2={height - bottom} />
        <line className="numeric-axis" x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
        {geometry.xTicks.map((tick, i) => <g key={`x-${i}`}>
          <line className="numeric-axis" x1={geometry.x(tick)} x2={geometry.x(tick)} y1={height - bottom} y2={height - bottom + 5} />
          <text className="numeric-tick" x={geometry.x(tick)} y={height - bottom + 22} textAnchor="middle">{formatTick(tick)}</text>
        </g>)}
        <path className="numeric-series" d={geometry.path} />
        {valid.map((point, i) => <circle className={`numeric-point${active === i ? ' is-active' : ''}`} key={point.row} data-row={point.row - 1}
          cx={geometry.x(point.x)} cy={geometry.y(point.y)} r={active === i ? 5 : valid.length > 500 ? 2 : 3.5}
          onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}>
          <title>{`Row ${point.row - 1}: ${xLabel} = ${point.x}, ${yLabel} = ${point.y}`}</title>
        </circle>)}
      </svg>
      <div className="numeric-chart-labels"><span className="numeric-y-label" title={yLabel}>{yLabel}</span><span className="numeric-x-label" title={xLabel}>{xLabel}</span></div>
      <div className="numeric-chart-caption">
        <span>{valid.length} of {points.length} numeric pairs</span>
        <output aria-live="polite">{selected ? `Row ${selected.row - 1}: ${xLabel} ${selected.x}, ${yLabel} ${selected.y}` : 'Select a point to inspect'}</output>
      </div>
    </> : <div className="numeric-empty" role="status"><h2>No numeric pairs</h2><p>Choose different columns or open Table to inspect the values.</p></div>}
    {valid.length < points.length && <p className="numeric-gap-warning" role="alert">{points.length - valid.length} missing or nonnumeric pairs; gaps are not interpolated.</p>}
  </div>;
}

export function TablePreview({ asset }: { asset: Asset }) {
  const table = useMemo(() => parseTable(new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes)), [asset.bytes]);
  const initialColumns = useMemo(() => defaultNumericColumns(table), [table]);
  const [mode, setMode] = useState<'chart' | 'table'>(initialColumns ? 'chart' : 'table');
  const [xColumn, setXColumn] = useState(initialColumns?.[0] ?? 0), [yColumn, setYColumn] = useState(initialColumns?.[1] ?? Math.min(1, table.headers.length - 1));
  const [page, setPage] = useState(0);
  const fieldId = useId();
  const points = useMemo(() => table.headers.length >= 2 ? numericSeries(table, xColumn, yColumn) : [], [table, xColumn, yColumn]);
  const pageCount = Math.max(1, Math.ceil(table.rows.length / PAGE_SIZE)), start = page * PAGE_SIZE;
  const header = (index: number) => table.headers[index] || `Column ${index + 1}`;
  return <Tabs value={mode} onValueChange={value => setMode(value as 'chart' | 'table')}><section className="numeric-preview" aria-label="Data preview">
    <div className="numeric-toolbar">
      <TabsList aria-label="Preview mode"><TabsTrigger value="chart" disabled={table.headers.length < 2}>Chart</TabsTrigger><TabsTrigger value="table">Table</TabsTrigger></TabsList>
      <p className="numeric-metadata"><span>{table.rows.length} {table.rows.length === 1 ? 'row' : 'rows'}</span><span>{table.headers.length} {table.headers.length === 1 ? 'column' : 'columns'}</span>
        {table.missing > 0 && <span className="numeric-warning">{table.missing} missing {table.missing === 1 ? 'value' : 'values'}</span>}</p>
    </div>
    <TabsContent value="chart">
      <div className="numeric-fields">
        <label htmlFor={`${fieldId}-x`}>X axis<Select id={`${fieldId}-x`} label="X axis" value={String(xColumn)} onChange={value => setXColumn(Number(value))} options={table.headers.map((_, index) => ({value:String(index), label:header(index)}))}/></label>
        <label htmlFor={`${fieldId}-y`}>Y axis<Select id={`${fieldId}-y`} label="Y axis" value={String(yColumn)} onChange={value => setYColumn(Number(value))} options={table.headers.map((_, index) => ({value:String(index), label:header(index)}))}/></label>
      </div>
      <NumericChart points={points} xLabel={header(xColumn)} yLabel={header(yColumn)} />
    </TabsContent><TabsContent value="table">
      <div className="numeric-table-scroll" tabIndex={0} role="region" aria-label="Scrollable data table">
        <table className="numeric-table" aria-label={`${asset.name} data`}>
          <thead><tr><th scope="col" className="numeric-row-number">Row</th>{table.headers.map((_, index) => <th scope="col" key={index}>{header(index)}</th>)}</tr></thead>
          <tbody>{table.rows.slice(start, start + PAGE_SIZE).map((row, index) => <tr key={start + index}>
            <th scope="row" className="numeric-row-number">{start + index + 1}</th>
            {row.map((value, column) => <td key={column}>{value.trim() ? value : <span className="numeric-missing">Missing</span>}</td>)}
          </tr>)}</tbody>
        </table>
        {!table.rows.length && <p className="numeric-no-rows">This file has column headers but no data rows.</p>}
      </div>
      <footer className="numeric-pagination">
        <span>{table.rows.length ? `Rows ${start + 1}–${Math.min(start + PAGE_SIZE, table.rows.length)} of ${table.rows.length}` : '0 rows'}</span>
        {pageCount > 1 && <nav aria-label="Table pages"><Button aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span aria-live="polite">Page {page + 1} of {pageCount}</span><Button aria-label="Next page" disabled={page + 1 === pageCount} onClick={() => setPage(page + 1)}>Next</Button></nav>}
      </footer>
    </TabsContent>
  </section></Tabs>;
}
