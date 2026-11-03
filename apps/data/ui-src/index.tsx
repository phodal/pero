import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadFile, useAppApi, useAppContext, useAppDataChanged } from '@pero/app-sdk';
import { AppFrame, Button, EmptyState, Feedback, SearchField, Select, Split, SplitPane } from '@pero/app-sdk/ui';
import { availabilityLabel, emptyView, encodeBytes, formatBytes, retainSelection, visibleDatasets,
  type CatalogState, type Dataset, type Inspection, type SavedView, type Selection, type ViewSpec } from './model';
import { ImportDialog, type ImportDetails } from './import';
import { Preview } from './preview';
import './styles.css';

// A completed inspection belongs to one input revision and one requested view.
type InspectionSnapshot = { scope: string; view: ViewSpec; offset: number; result: Inspection };
type Focus = { selection: Selection | null; view: ViewSpec; offset: number; parserVersion: string };
const focused = (selection: Selection | null, parserVersion: string): Focus => ({ selection, view: emptyView(), offset: 0, parserVersion });

export default function Data() {
  const api = useAppApi(), { active } = useAppContext();
  const [state, setState] = useState<CatalogState | null>(null);
  const [focus, setFocus] = useState<Focus>(focused(null, ''));
  const [query, setQuery] = useState(''), [project, setProject] = useState(''), [archived, setArchived] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<InspectionSnapshot | null>(null), [inspecting, setInspecting] = useState(false);
  const [inspectionEpoch, setInspectionEpoch] = useState(0);
  const [importTarget, setImportTarget] = useState<Dataset | null | undefined>(undefined);
  const pending = useRef(false), requests = useRef(0);
  const visible = state ? visibleDatasets(state, query, project, archived) : [];
  const dataset = visible.find(item => item.id === focus.selection?.datasetId) ?? null;
  const asset = dataset ? state?.assets.find(item => item.id === focus.selection?.assetId) ?? null : null;
  const selectedId = dataset?.id, assetId = asset?.id;
  const inspectionScope = JSON.stringify([selectedId, assetId, asset?.sha256, asset?.availability,
    focus.parserVersion, inspectionEpoch]);
  const sameInput = active && snapshot?.scope === inspectionScope ? snapshot : null;
  const result = sameInput?.view === focus.view && sameInput.offset === focus.offset ? sameInput.result : null;
  const fields = sameInput?.result.status === 'ok' ? sameInput.result : null;
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  const adopt = useCallback((next: CatalogState) => {
    setState(next);
    setFocus(previous => {
      if (next.selectedDatasetId && next.selectedAssetId)
        return focused({ datasetId: next.selectedDatasetId, assetId: next.selectedAssetId }, next.parserVersion);
      const selection = retainSelection(next, previous.selection);
      return selection === previous.selection ? previous : focused(selection, next.parserVersion);
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
      if (current) setSnapshot({ scope: inspectionScope, view: focus.view, offset: focus.offset, result: value });
    }).catch(cause => { if (current) { setSnapshot(null); fail(cause); } }).finally(() => { if (current) setInspecting(false); });
    return () => { current = false; };
  }, [active, selectedId, assetId, focus.view, focus.offset, focus.parserVersion, inspectionScope, api]);

  async function perform(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; requests.current += 1; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { fail(cause); }
    finally { pending.current = false; setBusy(false); }
  }

  function choose(value: Dataset, version = value.versions[value.versions.length - 1]) {
    setFocus(focused({ datasetId: value.id, assetId: version }, state!.parserVersion)); setNotice('');
  }

  function importFile(file: File, details: ImportDetails) {
    void perform(async () => {
      const next = await api.post<CatalogState>('/api/import', { name: file.name, ...details,
        content: encodeBytes(await file.arrayBuffer()), ...(importTarget ? { datasetId: importTarget.id } : {}) });
      adopt(next); setQuery(''); setProject(''); setArchived(false); setImportTarget(undefined); setNotice('Saved to Data.');
    });
  }

  function edit(value: { name: string; projectRef: string; archived: boolean }) {
    if (!dataset) return;
    void perform(async () => {
      adopt(await api.post<CatalogState>('/api/datasets/update', { datasetId: dataset.id, ...value }));
      setNotice(value.archived ? 'Archived. Original files remain stored.' : 'Saved.');
    });
  }

  function saveView(name: string) {
    if (!focus.selection) return;
    void perform(async () => {
      const next = await api.post<CatalogState>('/api/views', { name, preview: { ...focus.selection,
        view: focus.view, parserVersion: focus.parserVersion } });
      adopt(next); setNotice('View and checks saved against this exact version.');
    });
  }

  function openView(saved: SavedView) {
    setFocus({ selection: { datasetId: saved.datasetId, assetId: saved.assetId }, view: saved.view,
      offset: 0, parserVersion: saved.report.parserVersion });
    setNotice('Opened the saved version and view. Current bytes are checked again.');
  }

  function exportView(saved: SavedView) {
    const source = state!.assets.find(a => a.id === saved.assetId)!;
    downloadFile(`${saved.name.replace(/[^a-z0-9_-]+/gi, '-') || 'dataset'}-reference.json`, JSON.stringify({
      schemaVersion: 1, type: 'pero-dataset-view', ...saved,
      source: { name: source.name, kind: source.kind, size: source.size, source: source.source,
        revision: source.revision, license: source.license, sha256: source.sha256,
        bundleId: source.bundleId, sourceId: source.sourceId },
    }, null, 2), 'application/json');
  }

  const projectRefs = [...new Set(state?.datasets.map(d => d.projectRef).filter(Boolean) ?? [])].sort();
  const download = state?.download;
  return <AppFrame className="data-page" label="Data" actions={<Button variant="primary" disabled={!state || busy} onClick={() => { setError(''); setImportTarget(null); }}>Add data</Button>}>
    {error && importTarget === undefined ? <Feedback kind="error">{error} <Button disabled={busy} onClick={() => void refresh(true)}>Retry</Button></Feedback> : null}
    {notice ? <p className="data-notice" role="status">{notice}</p> : null}
    {download ? <div className="data-download" role="status">
      <span>Download: {download.status} / {formatBytes(download.received)} / {formatBytes(download.total)}</span>
      {download.status === 'running' ? <><progress aria-label="Download progress" value={download.received} max={download.total} />
        <Button disabled={busy} onClick={() => void perform(async () => { adopt(await api.post<CatalogState>('/api/cancel', {})); setNotice('Cancellation requested.'); })}>Cancel download</Button></> : null}
      {download.error ? <span>{download.error}</span> : null}
    </div> : null}
    <Split storageKey="pero.data.preview-width" collapseBelow={860}>
      <SplitPane as="section" id="data-datasets" aria-label="Datasets" className="data-list" min={320}>
        <div className="data-tools">
          <SearchField aria-label="Search data" placeholder="Search data" value={query} onChange={event => setQuery(event.target.value)} />
          <div className="data-actions"><Select label="Project filter" value={project} onChange={setProject}
            options={[{ value: '', label: 'All project references' }, ...projectRefs.map(ref => ({ value: ref, label: ref }))]} /><label className="data-checkbox"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /> Archived</label>
            <Button disabled={busy} onClick={() => void refresh(true)}>Refresh</Button></div>
        </div>
        <div className="data-table-scroll">
          {loading ? <p role="status">Loading data…</p> : !state ? <EmptyState heading="Data is unavailable" description="Retry the connection to your Data backend." /> : visible.length ? <table className="data-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Versions</th><th scope="col">Project</th><th scope="col">State</th></tr></thead>
            <tbody>{visible.map(item => {
              const latest = state.assets.find(a => a.id === item.versions[item.versions.length - 1]);
              return <tr key={item.id} aria-selected={item.id === dataset?.id} onClick={() => choose(item)}>
                <td><button type="button" aria-pressed={item.id === dataset?.id} onClick={event => { event.stopPropagation(); choose(item); }}>{item.name}</button></td>
                <td>{item.kind === 'model' ? 'Model' : 'Dataset'}</td><td>{item.versions.length}</td><td>{item.projectRef || '—'}</td>
                <td>{latest ? availabilityLabel(latest) : 'Missing'}</td>
              </tr>;
            })}</tbody>
          </table> : <EmptyState heading={query || project ? 'No matches' : archived ? 'No archived datasets' : 'No data yet'} description={query || project ? 'Change the search or project filter.' : archived ? 'Archived datasets appear here.' : 'Add a file to start your data library.'} />}
        </div>
      </SplitPane>
      <SplitPane as="aside" id="data-preview" aria-label="Preview" className="data-preview" size={520} min={320} resizeLabel="Resize preview">
        {dataset && asset && state ? <Preview key={dataset.id} dataset={dataset} asset={asset} assets={state.assets}
          views={state.views.filter(v => v.datasetId === dataset.id)} result={result} fields={fields} loading={inspecting} busy={busy}
          view={focus.view} maxColumns={state.limits.columns} onVersion={id => choose(dataset, id)}
          onView={view => setFocus(previous => ({ ...previous, view, offset: 0 }))}
          onPage={offset => setFocus(previous => ({ ...previous, offset }))}
          onAddVersion={() => { setError(''); setImportTarget(dataset); }} onEdit={edit} onSave={saveView} onOpen={openView} onExport={exportView} />
          : <EmptyState heading="No dataset selected" description="Select a dataset to inspect its files and versions." />}
      </SplitPane>
    </Split>
    {importTarget !== undefined && state ? <ImportDialog state={state} target={importTarget} busy={busy} error={error}
      onClose={() => { if (!pending.current) setImportTarget(undefined); }} onImport={importFile}
      onDownload={sourceId => void perform(async () => {
        adopt(await api.post<CatalogState>('/api/download', { sourceId })); setImportTarget(undefined); setNotice('Download started.');
      })} /> : null}
  </AppFrame>;
}
