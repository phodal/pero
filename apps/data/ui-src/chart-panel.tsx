import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppApiError, downloadFile, openDocument, useAppApi, useAppContext, useAppObject } from '@pero/app-sdk';
import { Button, Dialog, Feedback, FilePicker, Select } from '@pero/app-sdk/ui';
import { mountChartSurface } from '../../../packages/app-sdk/src/chart-surface';
import type { ChartDataset, ViewSpec } from './model';

type ChartDocument = {
  id: string; title: string; description?: string;
  chart: { type: string; y?: string; xLabel?: string; yLabel?: string };
  rows: Record<string, unknown>[];
  source: {
    label: string; caveats?: string[]; dataset?: string; catalogDatasetId?: string; assetId?: string; sha256?: string;
    viewId?: string; view?: unknown; dataView?: ViewSpec; parserVersion?: string; aggregation?: unknown; sql?: string; executedAt?: string;
    records?: { ordinal: number; pointer: string; line: number | null }[];
    exactValues?: string[]; omittedGroups?: number; excludedValues?: number;
  };
};
type ChartResult = { document: ChartDocument; artifactId: string; content: string };
type SourceBody = { datasetId: string; assetId: string; sha256: string; name: string; format: string; content: string };
type Kind = 'line' | 'bar' | 'area' | 'pie' | 'radar' | 'candlestick' | 'sankey';
const kinds: Kind[] = ['line', 'bar', 'area', 'pie', 'radar', 'candlestick', 'sankey'];

function sourceFormat(format: string) {
  if (format === 'json') return 'json' as const;
  if (format === 'json_lines' || format === 'jsonl' || format === 'ndjson') return 'json_lines' as const;
  return 'text' as const;
}

function ChartSurface({ document }: { document: ChartDocument }) {
  const container = useRef<HTMLDivElement>(null), surface = useRef<ReturnType<typeof mountChartSurface>>(null);
  const context = useAppContext();
  useEffect(() => {
    const current = mountChartSurface(container.current!, { document, context, url: './_reader/reader.html' });
    surface.current = current;
    return () => { current.dispose(); surface.current = null; };
  }, []);
  useEffect(() => { surface.current?.document(document); }, [document]);
  useEffect(() => { surface.current?.context(context); }, [context]);
  return <div ref={container} className="data-chart-surface" />;
}

export function ChartPanel({ data, busy, inspectionPending, aggregationControls, onActivate }: {
  data: ChartDataset | null; busy: boolean; inspectionPending: boolean; aggregationControls?: ReactNode; onActivate?: () => void;
}) {
  const api = useAppApi();
  const [kind, setKind] = useState<Kind>('bar'), [mode, setMode] = useState<'aggregate' | 'records'>('aggregate');
  const [x, setX] = useState(''), [y, setY] = useState(''), [target, setTarget] = useState(''), [series, setSeries] = useState('');
  const [open, setOpen] = useState(''), [high, setHigh] = useState(''), [low, setLow] = useState(''), [close, setClose] = useState('');
  const [result, setResult] = useState<ChartResult | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [saved, setSaved] = useState<{ artifactId: string; title: string; type: string; source: string }[]>([]);
  const [savedOpen, setSavedOpen] = useState(!data), [savedLoading, setSavedLoading] = useState(false), [savedError, setSavedError] = useState('');
  const serial = useRef(0), retry = useRef<(() => Promise<unknown>) | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false), [resultScope, setResultScope] = useState<string | null>(null);
  const options = [{ value: '', label: 'Choose field' }, ...(data?.fields ?? []).map(field => ({ value: field.name, label: field.name }))];
  const chartView = JSON.stringify(data?.view);
  const configuration = JSON.stringify([chartView, kind, mode, x, y, target, series, open, high, low, close]);
  const retained = Boolean(result && (pending || inspectionPending || error || !data || (resultScope !== null && resultScope !== configuration)));
  function failed(reason: unknown) {
    setError(reason instanceof Error ? reason.message : String(reason));
    if (reason instanceof AppApiError && [401, 403, 404, 409].includes(reason.status)) setResult(null);
  }
  async function create(mapping?: Record<string, string>, useAggregation = mode === 'aggregate') {
    if (!data) throw new Error('Open a dataset first');
    const request = ++serial.current;
    setPending(true); setError('');
    retry.current = () => create(mapping, useAggregation);
    const chart = mapping ?? (mode === 'aggregate' ? { type: kind, x: 'label', y: 'value' }
      : kind === 'candlestick' ? { type: kind, x, open, high, low, close }
        : kind === 'sankey' ? { type: kind, x, y, target } : { type: kind, x, y, ...(kind === 'line' && series ? { series } : {}) });
    try {
      const value = await api.post<ChartResult>('/api/chart', {
        datasetId: data.datasetId, assetId: data.assetId, view: data.view, parserVersion: data.parserVersion,
        chartDocument: { title: data.name, chart }, ...(useAggregation && data.view.chart ? { aggregation: data.view.chart } : {}),
      });
      if (request === serial.current) { setResult(value); setResultScope(configuration); }
      return value;
    } catch (reason) { if (request === serial.current) failed(reason); throw reason; }
    finally { if (request === serial.current) setPending(false); }
  }
  useEffect(() => {
    ++serial.current; setPending(false);
    if (data) setError('');
    if (mode === 'aggregate' && data?.view.chart) void create().catch(() => {});
  }, [data?.datasetId, data?.assetId, data?.parserVersion, data?.viewId, chartView, kind, mode]);
  async function listSaved() {
    setSavedLoading(true); setSavedError('');
    try { setSaved((await api.get<{ charts: typeof saved }>('/api/charts')).charts); }
    catch (reason) { setSavedError(String(reason)); }
    finally { setSavedLoading(false); }
  }
  useEffect(() => { if (savedOpen) void listSaved(); }, [savedOpen, result?.artifactId]);
  async function acceptDocument(content: string) {
    const request = ++serial.current;
    setPending(true); setError('');
    retry.current = () => acceptDocument(content);
    try {
      const value = await api.post<ChartResult>('/api/chart/validate', { content });
      if (request === serial.current) { setResult(value); setResultScope(null); }
      return value;
    } catch (reason) { if (request === serial.current) failed(reason); throw reason; }
    finally { if (request === serial.current) setPending(false); }
  }
  async function openSaved(id: string) {
    const request = ++serial.current;
    setPending(true); setError('');
    retry.current = () => openSaved(id);
    try {
      const value = await api.get<ChartResult>(`/api/chart/${id}`);
      if (request === serial.current) { setResult(value); setResultScope(null); }
    } catch (reason) { if (request === serial.current) failed(reason); }
    finally { if (request === serial.current) setPending(false); }
  }
  async function showSource(record?: number) {
    const linked = result?.document.source;
    if (!linked?.catalogDatasetId || !linked.assetId) return;
    const value = await api.post<SourceBody>('/api/source', { datasetId: linked.catalogDatasetId, assetId: linked.assetId,
      ...(linked.dataView ? { view: linked.dataView } : {}), ...(linked.parserVersion ? { parserVersion: linked.parserVersion } : {}) });
    await openDocument({ id: value.assetId, title: value.name, text: value.content, format: { kind: sourceFormat(value.format) }, ...(record === undefined ? {} : { location: { record } }) });
    return { dataset: value.datasetId, assetId: value.assetId, sha256: value.sha256 };
  }
  useAppObject({ id: 'chart-document', kind: 'chart-document', label: 'Chart', state: { phase: result ? retained ? 'retained' : 'ready' : pending ? 'loading' : 'empty', updating: pending || inspectionPending,
    ...(result ? { artifactId: result.artifactId, title: result.document.title, type: result.document.chart.type, source: result.document.source.label,
      ...(result.document.source.catalogDatasetId ? { dataset: result.document.source.catalogDatasetId, datasetId: result.document.source.catalogDatasetId } : {}),
      ...(result.document.source.assetId ? { assetId: result.document.source.assetId } : {}),
      ...(result.document.source.sha256 ? { sha256: result.document.source.sha256 } : {}),
      ...(result.document.source.viewId ? { viewId: result.document.source.viewId } : {}) } : {}) },
  actions: {
    render: { description: 'Validate and display a chart document. Its source label is a declaration, not verified dataset provenance.', parameters: { type: 'object', properties: { document: { type: 'string', maxLength: 65536 } }, required: ['document'], additionalProperties: false }, run: async params => {
      onActivate?.();
      const value = await acceptDocument(String(params.document));
      return { artifactId: value.artifactId, title: value.document.title, type: value.document.chart.type, source: value.document.source.label };
    } },
    create: { description: 'Create a chart from the current matching records or selected records, retaining dataset, asset, and record provenance.', parameters: { type: 'object', properties: { type: { type: 'string', enum: kinds }, x: { type: 'string', maxLength: 160 }, y: { type: 'string', maxLength: 160 }, series: { type: 'string', maxLength: 160 }, target: { type: 'string', maxLength: 160 }, open: { type: 'string', maxLength: 160 }, high: { type: 'string', maxLength: 160 }, low: { type: 'string', maxLength: 160 }, close: { type: 'string', maxLength: 160 } }, required: ['type', 'x'], additionalProperties: false }, run: async params => {
      onActivate?.();
      const mapping = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]));
      const value = await create(mapping, false);
      const source = value.document.source;
      return { artifactId: value.artifactId, title: value.document.title, type: value.document.chart.type, dataset: source.catalogDatasetId, datasetId: source.catalogDatasetId, assetId: source.assetId, sha256: source.sha256, viewId: source.viewId, records: source.records?.length ?? 0 };
    } },
    source: { description: 'Open the chart dataset source when the chart was generated from the current Data catalog version.', parameters: { type: 'object', properties: { record: { type: 'integer', minimum: 0 } }, additionalProperties: false }, run: async params => {
      if (!result?.document.source.catalogDatasetId) throw new Error('This chart has no linked dataset');
      return showSource(params.record as number | undefined);
    } },
  } });
  const field = (label: string, value: string, change: (value: string) => void) => <label className="data-chart-field"><span>{label}</span><Select panelClassName="data-select-panel" label={label} value={value} options={options} disabled={busy || pending} onChange={change} /></label>;
  const columns = result ? [...new Set(result.document.rows.flatMap(row => Object.keys(row)))] : [];
  return <div className="data-chart-panel">
    {data && <div className="data-chart-controls">
      <label className="data-chart-field"><span>Chart type</span><Select panelClassName="data-select-panel" label="Chart type" value={kind} options={kinds.map(value => ({ value, label: value }))} disabled={busy || pending} onChange={value => { setKind(value as Kind); if (value === 'candlestick' || value === 'sankey') setMode('records'); }} /></label>
      <label className="data-chart-field"><span>Data</span><Select panelClassName="data-select-panel" label="Chart data" value={mode} options={[...(kind === 'candlestick' || kind === 'sankey' ? [] : [{ value: 'aggregate', label: 'Current aggregation' }]), { value: 'records', label: 'Record fields' }]} disabled={busy || pending} onChange={value => setMode(value as 'aggregate' | 'records')} /></label>
      {mode === 'aggregate' ? aggregationControls : <>
        {field(kind === 'sankey' ? 'Source' : 'X / category', x, setX)}
        {kind === 'line' && field('Series (optional)', series, setSeries)}
        {kind === 'candlestick' ? <>{field('Open', open, setOpen)}{field('High', high, setHigh)}{field('Low', low, setLow)}{field('Close', close, setClose)}</> : <>{kind === 'sankey' && field('Target', target, setTarget)}{field('Value', y, setY)}</>}
        <Button disabled={busy || pending} onClick={() => void create().catch(() => {})}>Create chart</Button>
      </>}
    </div>}
    {pending && <p role="status">Preparing chart…</p>}
    {error && <Feedback kind="error">{error} {retry.current ? <Button disabled={busy || pending || inspectionPending} onClick={() => void retry.current?.().catch(() => {})}>Retry chart</Button> : null}</Feedback>}
    {retained && <p className="data-retained" role="status">Showing the previous chart from {result!.document.source.label}. {pending || inspectionPending ? 'Updating; the current controls may differ.' : error ? 'The latest request failed; this chart has not been updated.' : 'Create a chart to apply the current controls.'}</p>}
    {data && !result && !pending && !error && <p className="data-muted">{mode === 'aggregate' ? 'Choose a grouping field.' : 'Choose chart fields.'}</p>}
    {result && <>
      <div className="data-chart-result-heading"><h3>{result.document.title}</h3><div className="data-chart-actions">
        <Button onClick={() => downloadFile(`${result.document.id || 'chart'}.json`, result.content, 'application/json')}>Export chart JSON</Button>
        {result.document.source.catalogDatasetId && <Button onClick={() => void showSource().catch(reason => setError(String(reason)))}>Open source</Button>}
      </div></div>
      {(result.document.chart.xLabel || result.document.chart.yLabel) && <p>{[result.document.chart.xLabel, result.document.chart.yLabel].filter(Boolean).join(' / ')}</p>}
      <ChartSurface document={result.document} />
      <div className="data-chart-notes">
        {!result.document.source.dataset && <p>Unverified source declaration: {result.document.source.label}</p>}
        {result.document.source.caveats?.map((item, index) => <p key={index}>{item}</p>)}
        {!!result.document.source.excludedValues && <p>Excluded values: {result.document.source.excludedValues}</p>}
        {!!result.document.source.omittedGroups && <p>Omitted groups: {result.document.source.omittedGroups}</p>}
      </div>
      <details><summary>Chart data ({result.document.rows.length})</summary><div className="data-chart-table"><table><thead><tr>{columns.map(key => <th key={key} scope="col">{key}</th>)}</tr></thead><tbody>{result.document.rows.map((row, index) => <tr key={index}>{columns.map(key => <td key={key}>{key === result.document.chart.y && result.document.source.exactValues?.[index] !== undefined ? result.document.source.exactValues[index] : row[key] == null ? '—' : String(row[key])}</td>)}</tr>)}</tbody></table></div></details>
      {result.document.source.records?.length ? <section className="data-chart-records" aria-label="Chart source records"><h4>Source records ({result.document.source.records.length})</h4>
        <ul>{result.document.source.records.map(record => <li key={record.ordinal}><Button variant="ghost" disabled={pending || inspectionPending} onClick={() => void showSource(record.ordinal).catch(failed)}>{record.pointer || `Record ${record.ordinal + 1}`}{record.line == null ? '' : ` (line ${record.line})`}</Button></li>)}</ul>
      </section> : null}
      <Button variant="ghost" onClick={() => setDetailsOpen(true)}>Chart details</Button>
      {detailsOpen ? <Dialog title="Chart source details" closeLabel="Close chart details" onClose={() => setDetailsOpen(false)}>
        <div className="data-chart-source">
          {result.document.description && <p>{result.document.description}</p>}
          <dl className="data-facts"><dt>Chart digest</dt><dd><code>{result.artifactId}</code></dd>
          {result.document.source.catalogDatasetId ? <><dt>Dataset</dt><dd><code>{result.document.source.catalogDatasetId}</code></dd>
            <dt>Asset</dt><dd><code>{result.document.source.assetId}</code></dd>
            <dt>Source digest</dt><dd><code>{result.document.source.sha256}</code></dd>
            <dt>View</dt><dd><code>{result.document.source.viewId}</code></dd></> : null}</dl>
          {result.document.source.executedAt && <p>{result.document.source.executedAt}</p>}
          <h3>Filter and selection</h3><pre>{JSON.stringify({ view: result.document.source.dataView ?? result.document.source.view, aggregation: result.document.source.aggregation }, null, 2)}</pre>
          {result.document.source.sql ? <><h3>SQL</h3><pre>{result.document.source.sql}</pre></> : null}
        </div>
      </Dialog> : null}
    </>}
    <section className="data-saved">
      <div className="data-saved-heading"><h2><Button variant="ghost" aria-expanded={savedOpen} aria-controls="data-saved-charts" onClick={() => setSavedOpen(value => !value)}>Saved charts</Button></h2>
        <FilePicker label="Open chart JSON" emptyLabel="Chart JSON, up to 2 MiB" accept=".json,application/json" disabled={busy || pending} busy={pending} onFile={file => void (async () => {
          try { if (file.size > 2 * 1024 * 1024) throw new Error('Chart JSON exceeds 2 MiB'); await acceptDocument(await file.text()); }
          catch (reason) { setError(String(reason)); }
        })()} /></div>
      {savedOpen && <div id="data-saved-charts">
        {savedError && <div className="data-chart-error" role="alert"><span>{savedError}</span><Button onClick={() => void listSaved()}>Retry</Button></div>}
        {savedLoading && !saved.length ? <p className="data-muted" role="status">Loading charts…</p> : saved.length ? <ul className="data-saved-list">{saved.map(item => <li key={item.artifactId}><Button variant="ghost" aria-label={`${item.title} (${item.type})`} disabled={busy || pending} onClick={() => void openSaved(item.artifactId)}><span><strong>{item.title}</strong>{item.source !== item.title && <small>{item.source}</small>}</span><span>{item.type}</span></Button></li>)}</ul> : !savedError && <p className="data-muted">No saved charts.</p>}
      </div>}
    </section>
  </div>;
}
