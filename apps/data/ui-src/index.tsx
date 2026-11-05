import { useCallback, useEffect, useRef, useState } from 'react';
import { AppConversation, downloadFile, openDocument, useAppApi, useAppChat, useAppContext, useAppDataChanged, useAppObject } from '@pero/app-sdk';
import { AppFrame, Button, EmptyState, Feedback, SearchField, Select, Split, SplitPane } from '@pero/app-sdk/ui';
import { availabilityLabel, emptyView, encodeBytes, fieldRule, formatBytes, querySchema, retainSelection, summary, visibleDatasets,
  type CatalogState, type Dataset, type Inspection, type OkInspection, type SavedView, type Selection, type ViewSpec } from './model';
import { ImportDialog, type ImportDetails } from './import';
import { Workspace } from './workspace';
import './styles.css';

type InspectionSnapshot = { scope: string; view: ViewSpec; offset: number; result: Inspection };
type Focus = { selection: Selection | null; view: ViewSpec; offset: number; parserVersion: string };
type SourceBody = { datasetId: string; assetId: string; sha256: string; name: string; format: string; content: string };
const focused = (selection: Selection | null, parserVersion: string): Focus => ({ selection, view: emptyView(), offset: 0, parserVersion });

function sourceKind(format: string) {
  if (format === 'json') return 'json' as const;
  if (format === 'json_lines' || format === 'jsonl' || format === 'ndjson') return 'json_lines' as const;
  return 'text' as const;
}

function sampleRows(value: OkInspection) {
  return value.rows.slice(0, 10).map(row => ({
    ordinal: row.row - 1, pointer: row.pointer, line: row.line,
    cells: Object.fromEntries(value.columns.map((name, index) => [name, {
      kind: row.cells[index]?.kind ?? 'missing', exact: row.cells[index]?.exact, conversionError: row.cells[index]?.conversionError, display: (row.cells[index]?.text ?? '').slice(0, 240),
      truncated: (row.cells[index]?.text.length ?? 0) > 240,
    }])),
  }));
}

export default function Data() {
  const api = useAppApi(), chat = useAppChat(), { active } = useAppContext();
  const [state, setState] = useState<CatalogState | null>(null);
  const [focus, setFocus] = useState<Focus>(focused(null, ''));
  const [query, setQuery] = useState(''), [project, setProject] = useState(''), [archived, setArchived] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<InspectionSnapshot | null>(null), [inspecting, setInspecting] = useState(false);
  const [fieldSnapshot, setFieldSnapshot] = useState<InspectionSnapshot | null>(null);
  const [inspectionEpoch, setInspectionEpoch] = useState(0);
  const [importTarget, setImportTarget] = useState<Dataset | null | undefined>(undefined);
  const [showChat, setShowChat] = useState(false), [tab, setTab] = useState('table');
  const pending = useRef(false), requests = useRef(0), home = useRef(false);
  const visible = state ? visibleDatasets(state, query, project, archived) : [];
  const dataset = visible.find(item => item.id === focus.selection?.datasetId) ?? null;
  const asset = dataset ? state?.assets.find(item => item.id === focus.selection?.assetId) ?? null : null;
  const selectedId = dataset?.id, assetId = asset?.id;
  const inspectionScope = JSON.stringify([selectedId, assetId, asset?.sha256, asset?.availability, focus.parserVersion, inspectionEpoch]);
  const sameInput = active && snapshot?.scope === inspectionScope ? snapshot : null;
  const result = sameInput?.view === focus.view && sameInput.offset === focus.offset ? sameInput.result : null;
  const fields = active && fieldSnapshot?.scope === inspectionScope && fieldSnapshot.result.status === 'ok' ? fieldSnapshot.result : null;
  const ready = result?.status === 'ok' ? result : null;
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  const adopt = useCallback((next: CatalogState) => {
    setState(next);
    setFocus(previous => {
      if (next.selectedDatasetId && next.selectedAssetId) {
        home.current = false;
        return focused({ datasetId: next.selectedDatasetId, assetId: next.selectedAssetId }, next.parserVersion);
      }
      if (home.current) return { ...previous, selection: null, parserVersion: next.parserVersion };
      const selection = retainSelection(next, previous.selection);
      return selection === previous.selection ? { ...previous, parserVersion: next.parserVersion } : focused(selection, next.parserVersion);
    });
  }, []);

  const refresh = useCallback(async (recheck = false) => {
    if (pending.current) return;
    const generation = ++requests.current;
    try {
      const next = await api.get<CatalogState>('/api/state');
      if (generation === requests.current) { adopt(next); setError(''); if (recheck) setInspectionEpoch(value => value + 1); }
    } catch (cause) { if (generation === requests.current) fail(cause); }
    finally { if (generation === requests.current) setLoading(false); }
  }, [api, adopt]);

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  useAppDataChanged(() => refresh());
  useEffect(() => {
    if (!active || state?.download?.status !== 'running') return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(() => void poll(), 1000); };
    timer = setTimeout(() => void poll(), 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, state?.download?.status, refresh]);

  useEffect(() => {
    if (!active || !selectedId || !assetId) { setSnapshot(null); setInspecting(false); return; }
    let current = true;
    setInspecting(true);
    void api.post<Inspection>('/api/inspect', { datasetId: selectedId, assetId, view: focus.view,
      offset: focus.offset, limit: 50, parserVersion: focus.parserVersion }).then(value => {
      if (current) {
        const next = { scope: inspectionScope, view: focus.view, offset: focus.offset, result: value };
        setSnapshot(next);
        if (value.status === 'ok') setFieldSnapshot(next);
        else if (value.status !== 'invalid') setFieldSnapshot(null);
      }
    }).catch(cause => { if (current) { setSnapshot(null); setFieldSnapshot(null); fail(cause); } }).finally(() => { if (current) setInspecting(false); });
    return () => { current = false; };
  }, [active, selectedId, assetId, focus.view, focus.offset, focus.parserVersion, inspectionScope, api]);

  async function perform(work: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true; requests.current += 1; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { fail(cause); }
    finally { pending.current = false; setBusy(false); }
  }

  function choose(value: Dataset, version = value.versions[value.versions.length - 1]) {
    home.current = false;
    if (value.id !== focus.selection?.datasetId) setTab('table');
    setFocus(focused({ datasetId: value.id, assetId: version }, state!.parserVersion));
    setNotice('');
  }

  function importFile(file: File, details: ImportDetails) {
    void perform(async () => {
      const next = await api.post<CatalogState>('/api/import', { name: file.name, ...details,
        content: encodeBytes(await file.arrayBuffer()), ...(importTarget ? { datasetId: importTarget.id } : {}) });
      adopt(next); setQuery(''); setProject(''); setArchived(false); setImportTarget(undefined); setNotice('Saved to Data.');
    });
  }

  async function loadSource(record?: number) {
    if (!dataset || !asset || !ready) throw new Error('Open a dataset first');
    const opened = await api.post<SourceBody>('/api/source', { datasetId: dataset.id, assetId: asset.id, view: focus.view, parserVersion: focus.parserVersion });
    await openDocument({ id: opened.assetId, title: opened.name, text: opened.content, format: { kind: sourceKind(opened.format) },
      ...(record === undefined ? {} : { location: { record } }) });
    return { datasetId: opened.datasetId, assetId: opened.assetId, sha256: opened.sha256, ...(record === undefined ? {} : { record }) };
  }

  async function exportRows(open = false) {
    if (!dataset || !asset || !ready) throw new Error('Open a dataset first');
    const exported = await api.post<{ id: string; name: string; records: number; bytes: number; content: string }>(
      '/api/export', { datasetId: dataset.id, assetId: asset.id, view: focus.view, parserVersion: focus.parserVersion });
    if (open) await openDocument({ id: exported.id, title: exported.name, text: exported.content, format: { kind: 'json' } });
    else downloadFile(exported.name, exported.content, 'application/json');
    return { artifactId: exported.id, name: exported.name, records: exported.records, bytes: exported.bytes };
  }

  async function applyQuery(next: ViewSpec, offset = 0) {
    if (!dataset || !asset) throw new Error('Open a dataset first');
    setFocus(previous => ({ ...previous, view: next, offset }));
    const value = await api.post<Inspection>('/api/inspect', { datasetId: dataset.id, assetId: asset.id, view: next,
      offset, limit: 50, parserVersion: focus.parserVersion });
    setSnapshot({ scope: inspectionScope, view: next, offset, result: value });
    if (value.status !== 'ok') throw new Error(value.message);
    return value;
  }

  useAppObject({ id: 'dataset-view', kind: 'dataset-view', label: 'Data', state: { phase: ready ? 'ready' : 'empty',
    ...(ready && dataset && asset ? { dataset: dataset.id, datasetId: dataset.id, assetId: asset.id, sha256: asset.sha256,
      viewId: ready.viewId ?? '', name: asset.name, sourceFormat: asset.format, bytes: asset.size,
      recordCount: ready.report.rowCount, fieldCount: ready.report.fields.length,
      fieldKindsScope: 'original input; interpretation is explicit in each field profile', fields: ready.report.fields.slice(0, 32), query: focus.view, matching: ready.matched, selected: ready.selected ?? focus.view.selection.length,
      sample: sampleRows(ready) } : {}) },
  actions: {
    query: { description: 'Apply a typed filter, sort, displayed fields, or stable record selection on the open catalog version.', parameters: querySchema, run: async params => {
      if (!dataset || !asset) throw new Error('Open a dataset first');
      const next: ViewSpec = { ...focus.view, selection: (params.selection as number[] | undefined) ?? focus.view.selection,
        columns: (params.columns as string[] | undefined) ?? focus.view.columns };
      if (Object.hasOwn(params, 'filterField')) next.filter = params.filterField
        ? { field: String(params.filterField), operator: String(params.operator || 'contains'), value: String(params.value ?? '') } : null;
      if (Object.hasOwn(params, 'sortField')) next.sort = params.sortField
        ? { field: String(params.sortField), descending: Boolean(params.descending) } : null;
      return summary(await applyQuery(next));
    } },
    chart: { description: 'Aggregate the current matching or selected records. Exact values stay strings; missing values are excluded explicitly.', parameters: { type: 'object', properties: { category: fieldRule, measure: fieldRule, aggregation: { type: 'string', enum: ['sum', 'count'] } }, required: ['category', 'measure', 'aggregation'], additionalProperties: false }, run: async params => {
      if (!ready) throw new Error('Open a dataset first');
      setTab('chart');
      return summary(await applyQuery({ ...focus.view, chart: { category: String(params.category), measure: String(params.measure), aggregation: String(params.aggregation) } }));
    } },
    source: { description: 'Open the complete immutable source for this catalog version, optionally locating a record.', parameters: { type: 'object', properties: { record: { type: 'integer', minimum: 0 } }, additionalProperties: false }, run: params => loadSource(params.record as number | undefined) },
    read: { description: 'Read selected or matching records with exact numeric text and provenance.', parameters: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20 }, columns: { type: 'array', maxItems: 8, items: fieldRule } }, additionalProperties: false }, run: params => {
      if (!dataset || !asset) throw new Error('Open a dataset first');
      return api.post('/api/records', { datasetId: dataset.id, assetId: asset.id, view: focus.view, parserVersion: focus.parserVersion,
        columns: params.columns ?? focus.view.columns.slice(0, 8), offset: params.offset ?? 0, limit: params.limit ?? 10 });
    } },
    export: { description: 'Persist an exact JSON export with dataset, asset, SHA-256, query, selection, and record provenance.', parameters: { type: 'object', properties: {}, additionalProperties: false }, run: () => exportRows(true) },
  } });

  const projectRefs = [...new Set(state?.datasets.map(item => item.projectRef).filter(Boolean) ?? [])].sort();
  const download = state?.download;
  const versionFor = (item: Dataset) => {
    const id = item.id === dataset?.id && asset ? asset.id : item.versions[item.versions.length - 1];
    return state?.assets.find(entry => entry.id === id);
  };
  return <AppFrame className="data-page" label="Data" aria-busy={busy} actions={<>
    <Button variant="primary" disabled={!state || busy} onClick={() => { setError(''); setImportTarget(null); }}>Add data</Button>
    {ready ? <>
      <Button disabled={busy} onClick={() => void perform(() => loadSource())}>Source</Button>
      <Button disabled={busy} onClick={() => void perform(() => exportRows())}>Export records</Button>
      <Button variant="primary" disabled={busy || window.parent === window} onClick={() => void perform(() => chat.compose(
        'Analyze this dataset view. Check missingness and provenance, and support conclusions with record references.',
        { attachments: [chat.objectReference('dataset-view', { datasetId: dataset!.id, assetId: asset!.id, sha256: asset!.sha256, viewId: ready.viewId ?? '', selectedCount: focus.view.selection.length })] }))}>Ask Agent</Button>
      {window.parent !== window ? <Button variant="ghost" aria-label={showChat ? 'Close chat' : 'Open chat'} aria-expanded={showChat} onClick={() => setShowChat(value => !value)}>{showChat ? 'Close chat' : 'Open chat'}</Button> : null}
    </> : null}
  </>}>
    {error && importTarget === undefined ? <Feedback kind="error">{error} <Button disabled={busy} onClick={() => void refresh(true)}>Retry</Button></Feedback> : null}
    {notice ? <p className="data-notice" role="status">{notice}</p> : null}
    {download ? <div className="data-download" role="status">
      <span>Download: {download.status} / {formatBytes(download.received)} / {formatBytes(download.total)}</span>
      {download.status === 'running' ? <><progress aria-label="Download progress" value={download.received} max={download.total} />
        <Button disabled={busy} onClick={() => void perform(async () => { adopt(await api.post<CatalogState>('/api/cancel', {})); setNotice('Cancellation requested.'); })}>Cancel download</Button></> : null}
      {download.error ? <span>{download.error}</span> : null}
    </div> : null}
    <Split storageKey="pero.data.catalog-width" collapseBelow={860}>
      <SplitPane as="section" id="data-datasets" aria-label="Datasets" className="data-list" size={360} min={280} resizeLabel="Resize datasets">
        <Button variant="ghost" className="data-all" aria-current={dataset ? undefined : 'page'} disabled={busy} onClick={() => { home.current = true; setFocus(previous => ({ ...previous, selection: null })); setShowChat(false); }}>All data</Button>
        <div className="data-tools">
          <SearchField aria-label="Search data" placeholder="Search data" value={query} onChange={event => setQuery(event.target.value)} />
          <div className="data-actions"><Select label="Project filter" value={project} onChange={setProject}
            options={[{ value: '', label: 'All project references' }, ...projectRefs.map(ref => ({ value: ref, label: ref }))]} />
            <label className="data-checkbox"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /> Archived</label>
            <Button disabled={busy} onClick={() => void refresh(true)}>Refresh</Button></div>
        </div>
        <div className="data-table-scroll">
          {loading ? <p role="status">Loading data…</p> : !state ? <EmptyState heading="Data is unavailable" description="Retry the connection to your Data backend." /> : visible.length ? <table className="data-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Size</th><th scope="col">Versions</th><th scope="col">State</th></tr></thead>
            <tbody>{visible.map(item => {
              const current = versionFor(item);
              return <tr key={item.id} aria-selected={item.id === dataset?.id} onClick={() => choose(item)}>
                <td><button type="button" aria-pressed={item.id === dataset?.id} onClick={event => { event.stopPropagation(); choose(item); }}>{item.name}</button></td>
                <td>{item.kind === 'model' ? 'Model' : 'Dataset'}</td>
                <td>{current ? formatBytes(current.size) : '—'}</td>
                <td>{item.versions.length}</td>
                <td>{current ? availabilityLabel(current) : 'Missing'}</td>
              </tr>;
            })}</tbody>
          </table> : <EmptyState heading={query || project ? 'No matches' : archived ? 'No archived datasets' : 'No data yet'} description={query || project ? 'Change the search or project filter.' : archived ? 'Archived datasets appear here.' : 'Add a file to start your data library.'} />}
        </div>
      </SplitPane>
      <SplitPane as="aside" id="data-preview" aria-label="Preview" className="data-preview">
        <Split className="data-content" data-chat={showChat || undefined} storageKey="pero.data.chat-width" collapseBelow={820}>
          <SplitPane id="data-workspace" min={360} className="data-workspace">
            {dataset && asset && state ? <Workspace key={`${dataset.id}:${asset.id}`} dataset={dataset} asset={asset} assets={state.assets}
              views={state.views.filter(view => view.datasetId === dataset.id)} result={result} fields={fields} loading={inspecting} busy={busy}
              view={focus.view} parserVersion={focus.parserVersion} tab={tab} maxColumns={state.limits.columns} onTab={setTab}
              onVersion={id => choose(dataset, id)} onView={next => { setError(''); setFocus(previous => ({ ...previous, view: next, offset: 0 })); }}
              onPage={offset => setFocus(previous => ({ ...previous, offset }))}
              onAddVersion={() => { setError(''); setImportTarget(dataset); }}
              onEdit={value => { void perform(async () => { adopt(await api.post<CatalogState>('/api/datasets/update', { datasetId: dataset.id, ...value })); setNotice(value.archived ? 'Archived. Original files remain stored.' : 'Saved.'); }); }}
              onSave={name => { void perform(async () => { adopt(await api.post<CatalogState>('/api/views', { name, preview: { datasetId: dataset.id, assetId: asset.id, view: focus.view, parserVersion: focus.parserVersion } })); setNotice('View and checks saved against this exact version.'); }); }}
              onOpen={(saved: SavedView) => { home.current = false; setFocus({ selection: { datasetId: saved.datasetId, assetId: saved.assetId }, view: saved.view, offset: 0, parserVersion: saved.report.parserVersion }); setNotice('Opened the saved version and view. Current bytes are checked again.'); }}
              onExport={saved => { const source = state.assets.find(item => item.id === saved.assetId)!; downloadFile(`${saved.name.replace(/[^a-z0-9_-]+/gi, '-') || 'dataset'}-reference.json`, JSON.stringify({ schemaVersion: 1, type: 'pero-dataset-view', ...saved, source: { name: source.name, kind: source.kind, size: source.size, source: source.source, revision: source.revision, license: source.license, sha256: source.sha256, bundleId: source.bundleId, sourceId: source.sourceId } }, null, 2), 'application/json'); }}
              onRecord={row => void perform(() => loadSource(row))} />
              : <EmptyState heading="No dataset selected" description="Select a dataset to inspect its files and versions." />}
          </SplitPane>
          <SplitPane id="data-conversation" min={280} size={360} resizeLabel="Resize chat" className="data-chat" hidden={!showChat}>
            {showChat ? <AppConversation fallback={<p role="status">Chat is unavailable here. Close and reopen it to retry.</p>} /> : null}
          </SplitPane>
        </Split>
      </SplitPane>
    </Split>
    {importTarget !== undefined && state ? <ImportDialog state={state} target={importTarget} busy={busy} error={error}
      onClose={() => { if (!pending.current) setImportTarget(undefined); }} onImport={importFile}
      onDownload={sourceId => void perform(async () => { adopt(await api.post<CatalogState>('/api/download', { sourceId })); setImportTarget(undefined); setNotice('Download started.'); })} /> : null}
  </AppFrame>;
}
