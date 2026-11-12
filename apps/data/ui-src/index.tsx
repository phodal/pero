import { useCallback, useEffect, useRef, useState } from 'react';
import { AppApiError, AppConversation, downloadFile, openDocument, requestAppShell, useAppApi, useAppChat, useAppContext, useAppDataChanged, useAppI18n, useAppObject } from '@pero/app-sdk';
import { AppFrame, Button, Checkbox, ContentPane, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, EmptyIllustration, Feedback, Icon, IconButton, LibraryHeader, ListRow, LoadingSkeleton, SkeletonBlock, SkeletonText, Progress, SearchField, Select, Split, SplitPane, contentLayout } from '@pero/app-sdk/ui';
import { availabilityLabel, canInspect, emptyView, encodeBytes, fieldRule, formatBytes, formatDay, querySchema, retainSelection, sampleRows, summary, visibleDatasets,
  type CatalogState, type Dataset, type Inspection, type InspectionOutcome, type OkInspection, type SavedView, type Selection, type ViewSpec } from './model';
import { ImportDialog, type ImportDetails } from './import';
import { Workspace } from './workspace';
import { messages } from './i18n';
import './styles.css';

type InspectionSnapshot = { scope: string; attempt: number; view: ViewSpec; offset: number; result: InspectionOutcome };
type Focus = { selection: Selection | null; view: ViewSpec; offset: number; parserVersion: string };
type SourceBody = { datasetId: string; assetId: string; sha256: string; name: string; format: string; content: string };
const focused = (selection: Selection | null, parserVersion: string): Focus => ({ selection, view: emptyView(), offset: 0, parserVersion });

function sourceKind(format: string) {
  if (format === 'json') return 'json' as const;
  if (format === 'json_lines' || format === 'jsonl' || format === 'ndjson') return 'json_lines' as const;
  return 'text' as const;
}


export default function Data() {
  const api = useAppApi(), chat = useAppChat(), { active } = useAppContext();
  const { t } = useAppI18n(messages);
  const [state, setState] = useState<CatalogState | null>(null);
  const [focus, setFocus] = useState<Focus>(focused(null, ''));
  const [query, setQuery] = useState(''), [project, setProject] = useState(''), [kind, setKind] = useState(''), [archived, setArchived] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<InspectionSnapshot | null>(null), [inspecting, setInspecting] = useState(false);
  const [fieldSnapshot, setFieldSnapshot] = useState<InspectionSnapshot | null>(null);
  const [inspectionEpoch, setInspectionEpoch] = useState(0);
  const [importTarget, setImportTarget] = useState<Dataset | null | undefined>(undefined);
  const [hiddenDownloadId, setHiddenDownloadId] = useState<string | null>(null);
  const seenDownload = useRef('');
  const [showChat, setShowChat] = useState(false), [tab, setTab] = useState('table');
  const [command, setCommand] = useState<'edit' | 'archive' | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const libraryTitle = useRef<HTMLButtonElement>(null);
  const pending = useRef(false), requests = useRef(0), home = useRef(false);
  const visible = state ? visibleDatasets(state, query, project, archived, kind) : [];
  const dataset = visible.find(item => item.id === focus.selection?.datasetId) ?? null;
  const asset = dataset ? state?.assets.find(item => item.id === focus.selection?.assetId) ?? null : null;
  const selectedId = dataset?.id, assetId = asset?.id;
  const inspectionScope = JSON.stringify([selectedId, assetId, asset?.sha256, asset?.availability, focus.parserVersion]);
  const sameInput = snapshot?.scope === inspectionScope ? snapshot : null;
  const result = sameInput?.attempt === inspectionEpoch && sameInput.view === focus.view && sameInput.offset === focus.offset ? sameInput.result : null;
  const fields = fieldSnapshot?.scope === inspectionScope && fieldSnapshot.result.status === 'ok' ? fieldSnapshot.result : null;
  const ready = result?.status === 'ok' ? result : null;
  const retained = fields && fieldSnapshot ? { result: fields, view: fieldSnapshot.view } : null;
  const canClearFilter = focus.parserVersion === state?.parserVersion && focus.view.filter !== null;
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  const adopt = useCallback((next: CatalogState) => {
    setState(next);
    setFocus(previous => {
      if (next.selectedDatasetId && next.selectedAssetId) {
        home.current = false;
        return previous.selection?.datasetId === next.selectedDatasetId && previous.selection.assetId === next.selectedAssetId && previous.parserVersion === next.parserVersion
          ? previous : focused({ datasetId: next.selectedDatasetId, assetId: next.selectedAssetId }, next.parserVersion);
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
    } catch (cause) {
      if (generation === requests.current) {
        fail(cause);
        if (cause instanceof AppApiError && [401, 403].includes(cause.status)) {
          setState(null); setSnapshot(null); setFieldSnapshot(null);
        }
      }
    }
    finally { if (generation === requests.current) setLoading(false); }
  }, [api, adopt]);

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  useAppDataChanged(() => refresh());
  const downloadStatus = state?.download ? `${state.download.id}:${state.download.status}` : '';
  useEffect(() => {
    const previous = seenDownload.current;
    seenDownload.current = downloadStatus;
    if (downloadStatus.endsWith(':completed') && previous.endsWith(':running') && previous.slice(0, previous.lastIndexOf(':')) === downloadStatus.slice(0, downloadStatus.lastIndexOf(':')))
      setNotice(t('saved'));
  }, [downloadStatus, t]);

  useEffect(() => {
    if (!active || state?.download?.status !== 'running') return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(() => void poll(), 1000); };
    timer = setTimeout(() => void poll(), 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, state?.download?.status, refresh]);

  useEffect(() => {
    if (!active) { setInspecting(false); return; }
    if (!selectedId || !assetId || !asset || !canInspect(asset)) { setSnapshot(null); setFieldSnapshot(null); setInspecting(false); return; }
    let current = true;
    setInspecting(true);
    void api.post<Inspection>('/api/inspect', { datasetId: selectedId, assetId, view: focus.view,
      offset: focus.offset, limit: 50, parserVersion: focus.parserVersion }).then(value => {
      if (current) {
        const next = { scope: inspectionScope, attempt: inspectionEpoch, view: focus.view, offset: focus.offset, result: value };
        setSnapshot(next);
        if (value.status === 'ok') setFieldSnapshot(next);
        else if (value.status !== 'invalid') setFieldSnapshot(null);
      }
    }).catch(cause => {
      if (!current) return;
      let message = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof AppApiError) {
        try {
          const body = JSON.parse(cause.body);
          if (typeof body?.detail === 'string') message = body.detail;
        } catch { /* The proxy may return a non-JSON response. */ }
      }
      setSnapshot({ scope: inspectionScope, attempt: inspectionEpoch, view: focus.view, offset: focus.offset,
        result: { status: cause instanceof AppApiError && [401, 403].includes(cause.status) ? 'forbidden'
          : cause instanceof AppApiError && cause.status === 400 ? 'rejected' : 'unavailable', message } });
      if (cause instanceof AppApiError && [401, 403, 404, 409].includes(cause.status)) setFieldSnapshot(null);
    }).finally(() => { if (current) setInspecting(false); });
    return () => { current = false; };
  }, [active, selectedId, assetId, focus.view, focus.offset, focus.parserVersion, inspectionScope, inspectionEpoch, api]);

  async function perform(work: () => Promise<unknown>) {
    if (pending.current) return false;
    pending.current = true; requests.current += 1; setBusy(true); setError(''); setNotice('');
    try { await work(); return true; } catch (cause) { fail(cause); return false; }
    finally { pending.current = false; setBusy(false); }
  }

  function choose(value: Dataset, version = value.versions[value.versions.length - 1]) {
    home.current = false;
    if (value.id !== focus.selection?.datasetId) setTab('overview');
    setFocus(focused({ datasetId: value.id, assetId: version }, state!.parserVersion));
    setNotice('');
  }

  function importFile(file: File, details: ImportDetails) {
    void perform(async () => {
      const next = await api.post<CatalogState>('/api/import', { name: file.name, ...details,
        content: encodeBytes(await file.arrayBuffer()), ...(importTarget ? { datasetId: importTarget.id } : {}) });
      adopt(next); setQuery(''); setProject(''); setKind(''); setArchived(false); setImportTarget(undefined); setNotice(t('saved'));
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
    setSnapshot({ scope: inspectionScope, attempt: inspectionEpoch, view: next, offset, result: value });
    if (value.status !== 'ok') throw new Error(value.message);
    setFieldSnapshot({ scope: inspectionScope, attempt: inspectionEpoch, view: next, offset, result: value });
    return value;
  }

  useAppObject({ id: 'dataset-view', kind: 'dataset-view', label: 'Data', state: { phase: ready ? 'ready' : 'empty',
    ...(ready && dataset && asset ? { dataset: dataset.id, datasetId: dataset.id, assetId: asset.id, sha256: asset.sha256,
      viewId: ready.viewId ?? '', name: asset.name, sourceFormat: asset.format, bytes: asset.size,
      recordCount: ready.report.rowCount, fieldCount: ready.report.fields.length,
      fieldKindsScope: 'original input; interpretation is explicit in each field profile', fields: ready.report.fields.slice(0, 32), query: focus.view, matching: ready.matched, selected: ready.selected ?? focus.view.selection.length,
      sampleScope: 'Up to 10 rows and 8 fields within 8 KiB; omitted exact values remain available through source and export.',
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
  const job = state?.download;
  const download = job && job.status !== 'completed' && !(job.status !== 'running' && job.id === hiddenDownloadId) ? job : null;
  const retrySource = download?.sourceId && state?.sources.some(source => source.id === download.sourceId) ? download.sourceId : '';
  const versionFor = (item: Dataset) => {
    const id = item.id === dataset?.id && asset ? asset.id : item.versions[item.versions.length - 1];
    return state?.assets.find(entry => entry.id === id);
  };
  const openImport = () => { setError(''); setImportTarget(null); };
  const shareReference = () => {
    if (!dataset || !asset) return;
    const body = JSON.stringify({ type: 'pero-dataset', datasetId: dataset.id, assetId: asset.id, name: dataset.name, sha256: asset.sha256, source: asset.source, revision: asset.revision }, null, 2);
    void navigator.clipboard?.writeText(body).then(() => setNotice(t('shareCopied'))).catch(() => setNotice(''));
  };
  const openNotebook = () => { if (window.parent !== window) void requestAppShell('navigate', { path: '/apps/notebook/main' }); };
  const clearSelection = () => {
    home.current = true;
    setFocus(previous => ({ ...previous, selection: null }));
    setShowChat(false);
    libraryTitle.current?.focus();
  };
  const objectActions = dataset && asset ? <>
    <DropdownMenu>
      <DropdownMenuTrigger ref={moreRef} aria-label={t('more')} className="pero-ui-icon-button"><Icon name="dots" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={busy} onSelect={shareReference}>{t('share')}</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => setCommand('edit')}>Edit details</DropdownMenuItem>
        <DropdownMenuItem disabled={busy || dataset.archived} onSelect={() => { setError(''); setImportTarget(dataset); }}>Add version</DropdownMenuItem>
        {canInspect(asset) ? <DropdownMenuItem disabled={busy} onSelect={() => setTab('table')}>Explore data</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        {dataset.archived
          ? <DropdownMenuItem disabled={busy} onSelect={() => void perform(async () => { adopt(await api.post<CatalogState>('/api/datasets/update', { datasetId: dataset.id, name: dataset.name, projectRef: dataset.projectRef, archived: false })); setNotice('Saved.'); })}>Restore dataset</DropdownMenuItem>
          : <DropdownMenuItem disabled={busy} onSelect={() => setCommand('archive')}>Archive dataset</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
    {state?.datasets.length && (ready || retained) ? <>
      <Button variant="ghost" disabled={busy || !ready} onClick={() => void perform(() => loadSource())}>Source</Button>
      <Button variant="ghost" disabled={busy || !ready} onClick={() => void perform(() => exportRows())}>Export records</Button>
      {window.parent !== window ? <Button variant="ghost" aria-label={showChat ? 'Close chat' : 'Open chat'} aria-expanded={showChat} onClick={() => setShowChat(value => !value)}>{showChat ? 'Close chat' : 'Open chat'}</Button> : null}
    </> : null}
  </> : null;
  return <AppFrame className="data-page" label="Data" aria-busy={busy}
    utilities={state ? <IconButton label={t('refresh')} disabled={busy} onClick={() => void refresh(true)}><Icon name="refresh" /></IconButton> : undefined}
    primary={state ? <Button variant="primary" disabled={busy} onClick={openImport}>{t('addData')}</Button> : undefined}>
    {error && state && state.datasets.length > 0 && importTarget === undefined ? <Feedback kind="error">{error} <Button disabled={busy} onClick={() => void refresh(true)}>{t('retry')}</Button></Feedback> : null}
    {notice ? <p className="data-notice" role="status">{notice}</p> : null}
    {download ? <div className="data-download" role="status">
      <span>{t('download')}: {messages[download.status] ? t(download.status) : download.status} / {formatBytes(download.received)} / {formatBytes(download.total)}</span>
      {download.status === 'running' ? <><Progress label={t('downloadProgress')} value={download.total > 0 ? download.received : undefined} max={download.total || 1} />
        <Button disabled={busy} onClick={() => void perform(async () => { adopt(await api.post<CatalogState>('/api/cancel', {})); setNotice(t('cancelRequested')); })}>{t('cancelDownload')}</Button></>
        : <>{retrySource ? <Button disabled={busy} onClick={() => void perform(async () => { adopt(await api.post<CatalogState>('/api/download', { sourceId: retrySource })); setHiddenDownloadId(null); setNotice(t('downloadStarted')); })}>{t('retry')}</Button> : null}
          <Button disabled={busy} onClick={() => setHiddenDownloadId(download.id)}>{t('close')}</Button></>}
      {download.error ? <span>{download.error}</span> : null}
    </div> : null}
    {loading ? <LoadingSkeleton label={t('loading')}><SkeletonBlock shape="title" width="40%" /><SkeletonText /></LoadingSkeleton> : !state ? <Feedback kind="error" variant="block">{error || t('unavailable')} <Button onClick={() => void refresh(true)}>{t('retry')}</Button></Feedback>
      : !state.datasets.length ? <EmptyState className="data-first-use" icon={<EmptyIllustration kind="data" />} heading={<h2>{t('emptyHeading')}</h2>} description={t('emptyDescription')} />
      : <Split storageKey="pero.data.catalog-width" collapseBelow={contentLayout.collapseBelow}>
      <SplitPane as="section" id="data-datasets" aria-label={t('datasets')} className="data-list" size={contentLayout.listSize} min={contentLayout.listMin} resizeLabel={t('resizeDatasets')}>
        <ContentPane id="data-catalog" label={t('datasets')} as="div" surface="list" inset="none" scroll="pane"
          header={<LibraryHeader density="compact" title={<button ref={libraryTitle} type="button" className="data-library-title" aria-current={dataset ? undefined : 'page'} disabled={busy} onClick={clearSelection}>{t('datasets')}</button>}
          subtitle={t(visible.length === 1 ? 'datasetCount' : 'datasetCountPlural', { count: String(visible.length) })} />}
          toolbar={<div className="data-tools">
          <SearchField aria-label={t('search')} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
          <div className="data-actions">
            <Select label={t('projectFilter')} value={project} onChange={setProject}
              options={[{ value: '', label: t('allProjects') }, ...projectRefs.map(ref => ({ value: ref, label: ref }))]} />
            <Select label={t('kindFilter')} value={kind} onChange={setKind}
              options={[{ value: '', label: t('allKinds') }, { value: 'dataset', label: t('dataset') }, { value: 'model', label: t('model') }]} />
            <label className="data-checkbox"><Checkbox checked={archived} onCheckedChange={value => setArchived(value === true)} /> {t('archived')}</label>
          </div>
        </div>}
        >
          {visible.length ? <ul className="data-catalog" aria-label={t('library')}>{visible.map(item => {
            const current = versionFor(item);
            const health = current ? availabilityLabel(current, item.id === dataset?.id ? result : null) : 'Missing';
            const attention = Boolean(current) && (health === 'Missing' || health === 'Changed');
            const versionNo = current ? item.versions.indexOf(current.id) + 1 : item.versions.length;
            return <li key={item.id}><ListRow title={item.name} current={item.id === dataset?.id} onOpen={() => choose(item)}
              icon={<span className="data-row-icon" aria-hidden="true"><Icon name="database" size={16} /></span>}
              meta={<>{(current?.format || item.kind).toUpperCase()} · {current ? formatBytes(current.size) : 'Missing'} · v{Math.max(1, versionNo)}
                {attention ? <> · {health}</> : null}</>}
              time={current ? formatDay(current.createdAt) : undefined} /></li>;
          })}</ul> : <EmptyState icon={<EmptyIllustration kind={query || project || kind ? 'search' : 'data'} size="compact" />} heading={t(query || project || kind ? 'noMatches' : archived ? 'noArchived' : 'noActive')} description={t(query || project || kind ? 'filterHelp' : archived ? 'archivedHelp' : 'activeHelp')} />}
        </ContentPane>
      </SplitPane>
      <SplitPane as="section" id="data-preview" aria-label={t('preview')} className="data-preview" min={contentLayout.mainMin}>
        <Split className="data-content" data-chat={showChat || undefined} storageKey="pero.data.chat-width" collapseBelow={820}>
          <SplitPane id="data-workspace" min={contentLayout.mainMin} className="data-workspace">
            {dataset && asset && state ? <Workspace key={`${dataset.id}:${asset.id}:${asset.sha256}:${asset.availability}:${focus.parserVersion}`} dataset={dataset} asset={asset} assets={state.assets}
              views={state.views.filter(view => view.datasetId === dataset.id)} result={result} retained={retained} error={error} fields={fields} loading={inspecting} busy={busy}
              view={focus.view} parserVersion={focus.parserVersion} tab={tab} maxColumns={state.limits.columns} onTab={setTab}
              recoveryLabel={canClearFilter ? 'Clear filter' : 'Reset view'}
              onVersion={id => choose(dataset, id)} onView={next => { setError(''); setFocus(previous => ({ ...previous, view: next, offset: 0 })); }}
              onRetryInspection={() => setInspectionEpoch(value => value + 1)}
              onRecoverView={() => {
                if (canClearFilter) setFocus(previous => ({ ...previous, view: { ...previous.view, selection: [], filter: null }, offset: 0 }));
                else choose(dataset, asset.id);
              }}
              onPage={offset => setFocus(previous => ({ ...previous, offset }))}
              command={command} onCommandDone={() => setCommand(null)} focusMore={() => moreRef.current?.focus()}
              onAddVersion={() => { setError(''); setImportTarget(dataset); }}
              onAsk={() => {
                if (!dataset || !asset || window.parent === window) return;
                const prompt = ready
                  ? 'Analyze this dataset view. Check missingness and provenance, and support conclusions with record references.'
                  : 'This dataset is an original file without a table. Use the catalog identity, source, and checksum. Do not invent records or a scientific summary.';
                void perform(() => chat.compose(prompt, { attachments: [chat.objectReference('dataset-view', {
                  datasetId: dataset.id, assetId: asset.id, sha256: asset.sha256, viewId: ready?.viewId ?? '', selectedCount: focus.view.selection.length,
                })] }));
              }}
              canAsk={window.parent !== window}
              onEdit={value => perform(async () => { adopt(await api.post<CatalogState>('/api/datasets/update', { datasetId: dataset.id, ...value })); setNotice(value.archived ? 'Archived. Original files remain stored.' : 'Saved.'); })}
              onSave={name => { void perform(async () => { adopt(await api.post<CatalogState>('/api/views', { name, preview: { datasetId: dataset.id, assetId: asset.id, view: focus.view, parserVersion: focus.parserVersion } })); setNotice('View and checks saved against this exact version.'); }); }}
              onOpen={(saved: SavedView) => { home.current = false; setFocus({ selection: { datasetId: saved.datasetId, assetId: saved.assetId }, view: saved.view, offset: 0, parserVersion: saved.report.parserVersion }); setNotice('Opened the saved version and view. Current bytes are checked again.'); }}
              onExport={saved => { const source = state.assets.find(item => item.id === saved.assetId)!; downloadFile(`${saved.name.replace(/[^a-z0-9_-]+/gi, '-') || 'dataset'}-reference.json`, JSON.stringify({ schemaVersion: 1, type: 'pero-dataset-view', ...saved, source: { name: source.name, kind: source.kind, size: source.size, source: source.source, revision: source.revision, license: source.license, sha256: source.sha256, bundleId: source.bundleId, sourceId: source.sourceId } }, null, 2), 'application/json'); }}
              onRecord={row => void perform(() => loadSource(row))}
              objectActions={objectActions} onOpenNotebook={openNotebook} onDismiss={clearSelection} />
              : visible.length ? <EmptyState heading={t('noSelection')} description={t('selectionHelp')} /> : null}
          </SplitPane>
          <SplitPane id="data-conversation" min={280} size={360} resizeLabel="Resize chat" className="data-chat" hidden={!showChat}>
            {showChat ? <AppConversation fallback={<p role="status">Chat is unavailable here. Close and reopen it to retry.</p>} /> : null}
          </SplitPane>
        </Split>
      </SplitPane>
    </Split>}
    {importTarget !== undefined && state ? <ImportDialog state={state} target={importTarget} busy={busy} error={error}
      onClose={() => { if (!pending.current) setImportTarget(undefined); }} onImport={importFile}
      onDownload={sourceId => void perform(async () => { adopt(await api.post<CatalogState>('/api/download', { sourceId })); setImportTarget(undefined); setNotice(t('downloadStarted')); })} /> : null}
  </AppFrame>;
}
