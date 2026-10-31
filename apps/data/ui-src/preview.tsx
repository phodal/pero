import { useAppContext } from '@pero/app-sdk';
import { appChartTheme, seriesStyle } from '@pero/app-sdk/chart';
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import { chartEligible, chartSeries, fields, formatInt, formatNum, missingCount, type Asset, type Cell, type PreviewMode } from './model';

function cellText(value: Cell | undefined) {
  if (value == null || value === '') return <span className="data-missing">missing</span>;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function Rows({ asset }: { asset: Asset }) {
  const keys = fields(asset);
  return <div className="data-rows-scroll" tabIndex={0}>
    <table className="data-rows">
      <thead><tr><th scope="col">#</th>{keys.map(key => <th scope="col" key={key}>{key}{asset.units[key] ? <span className="data-unit"> {asset.units[key]}</span> : null}</th>)}</tr></thead>
      <tbody>{asset.rows.map((row, index) => <tr key={index}><td>{index + 1}</td>{keys.map(key => <td key={key}>{cellText(row[key])}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

export function Chart({ asset }: { asset: Asset }) {
  const { dark } = useAppContext();
  const theme = appChartTheme(dark);
  if (!chartEligible(asset)) return <p className="data-note">No numeric series to plot.</p>;
  const { x, ys } = chartSeries(asset);
  if (!ys.length) return <p className="data-note">No numeric series to plot.</p>;
  const width = 560;
  const height = 220;
  const left = 48, right = 12, top = 12, bottom = 28;
  const values: number[] = [];
  for (const row of asset.rows) for (const key of ys) if (row[key] != null && Number.isFinite(Number(row[key]))) values.push(Number(row[key]));
  if (!values.length) return <p className="data-note">No numeric series to plot.</p>;
  const xVals = asset.rows.map((row, index) => x === null || row[x] == null ? index : Number(row[x]));
  const minX = Math.min(...xVals);
  const maxX = Math.max(...xVals);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo || 1) * .12;
  lo -= pad; hi += pad;
  const px = (value: number) => left + (value - minX) / (maxX - minX || 1) * (width - left - right);
  const py = (value: number) => top + (hi - value) / (hi - lo) * (height - top - bottom);
  const horizontals = Array.from({ length: 5 }, (_, i) => {
    const value = lo + (hi - lo) * i / 4;
    return { value, y: py(value) };
  });
  const verticals = Array.from({ length: 5 }, (_, i) => {
    const value = minX + (maxX - minX) * i / 4;
    return { value, x: px(value) };
  });
  const paths = ys.map(key => {
    let d = '';
    let drawing = false;
    for (let j = 0; j < asset.rows.length; j++) {
      const value = asset.rows[j][key];
      if (value == null || !Number.isFinite(Number(value))) { drawing = false; continue; }
      d += `${drawing ? 'L' : 'M'}${px(xVals[j]).toFixed(2)},${py(Number(value)).toFixed(2)} `;
      drawing = true;
    }
    return d;
  });
  return <figure className="data-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={x ? `Plot of ${ys.join(', ')} against ${x}` : `Plot of ${ys.join(', ')}`}>
      <rect x="0" y="0" width={width} height={height} fill={theme.bg.elevated} />
      {horizontals.map(line => <g key={`h${line.y}`}><line x1={left} y1={line.y} x2={width - right} y2={line.y} stroke={theme.stroke.secondary} /><text x={left - 8} y={line.y + 4} fontSize="12" fill={theme.text.secondary} textAnchor="end">{formatNum(line.value)}</text></g>)}
      {verticals.map(line => <g key={`v${line.x}`}><line x1={line.x} y1={top} x2={line.x} y2={height - bottom} stroke={theme.stroke.secondary} /><text x={line.x} y={height - 8} fontSize="12" fill={theme.text.secondary} textAnchor="middle">{formatNum(line.value)}</text></g>)}
      {paths.map((d, index) => <path key={ys[index]} d={d} fill="none" stroke={seriesStyle(index, dark).stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={index === 1 ? '4 3' : undefined} />)}
    </svg>
    <figcaption className="data-legend">{ys.map((key, index) => <span key={key}><svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke={seriesStyle(index, dark).stroke} strokeWidth="2" strokeDasharray={index === 1 ? '4 3' : undefined} /></svg>{key}{asset.units[key] ? ` (${asset.units[key]})` : ''}</span>)}</figcaption>
  </figure>;
}

export function Preview({ asset, mode, onMode }: { asset: Asset | null; mode: PreviewMode; onMode(mode: PreviewMode): void }) {
  if (!asset) return <aside className="data-preview" aria-label="Preview"><EmptyState heading="No dataset selected" description="Choose a row to see its chart or records." /></aside>;
  const keys = fields(asset);
  const missing = missingCount(asset);
  return <aside className="data-preview" aria-label="Preview">
    <div className="data-preview-head">
      <h2>{asset.name}</h2>
      {asset.description ? <p>{asset.description}</p> : null}
      <dl className="data-facts">
        <dt>Records</dt><dd>{formatInt(asset.rows.length)}</dd>
        <dt>Fields</dt><dd>{keys.length ? keys.join(', ') : 'None'}</dd>
        {missing > 0 ? <><dt>Missing</dt><dd>{formatInt(missing)}</dd></> : null}
        <dt>Source</dt><dd>{asset.source}</dd>
        <dt>Format</dt><dd>{asset.format}</dd>
      </dl>
    </div>
    <Tabs value={mode} onValueChange={value => onMode(value === 'rows' ? 'rows' : 'chart')}>
      <TabsList aria-label="View">
        <TabsTrigger value="chart">Chart</TabsTrigger>
        <TabsTrigger value="rows">Rows</TabsTrigger>
      </TabsList>
      <TabsContent value="chart"><Chart asset={asset} /></TabsContent>
      <TabsContent value="rows"><Rows asset={asset} /></TabsContent>
    </Tabs>
  </aside>;
}
