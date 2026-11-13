import { useEffect, useRef, useState } from 'react';
import { useAppI18n, useNavigate } from '@pero/app-sdk';
import type { ReactNode } from 'react';
import { Badge, Button, Checkbox, ContentPane, ContentSection, EmptyState, EmptyIllustration, Feedback, Icon, Input, InspectorHeader, ListRow, MetadataList, Select, Split, SplitPane, Table, Tabs, TabsContent, TabsList, TabsTrigger, Toolbar, contentLayout, type MetadataItem } from '@pero/app-sdk/ui';
import { InterpretationPreview } from './interpretation';
import { SemanticPanel } from './semantic-panel';
import { ChartPanel } from './chart-panel';
import { DatasetDetails } from './dataset-details';
import { DataForm, SubmitButton } from './submit-button';
import { messages } from './i18n';
import { applyInterpretation, availabilityLabel, canInspect, catalogAvailability, custodyDetail, datasetBadges, emptyView, formatBytes, formatDay, formatInt, sourceHost, versionLabel, type Asset, type ChartDataset, type Dataset, type InspectionOutcome, type OkInspection, type SavedView, type ViewIssue, type ViewSpec } from './model';

type Props = {
  dataset: Dataset; asset: Asset; assets: Asset[]; views: SavedView[];
  result: InspectionOutcome | null; retained: { result: OkInspection; view: ViewSpec } | null; error: string; fields: OkInspection | null; loading: boolean; busy: boolean;
  view: ViewSpec; parserVersion: string; tab: string; maxColumns: number;
  recoveryLabel: string;
  onTab(value: string): void; onVersion(id: string): void; onView(value: ViewSpec): void; onPage(offset: number): void;
  onRetryInspection(): void; onRecoverView(): void;
  onAddVersion(): void; onEdit(value: { name: string; projectRef: string; archived: boolean }): Promise<boolean>;
  onAsk(): void; canAsk: boolean;
  command?: 'edit' | 'archive' | null; onCommandDone?(): void; focusMore?(): void;
  onSave(name: string): void; onOpen(view: SavedView): void; onExport(view: SavedView): void;
  onRecord(row: number): void;
  objectActions?: ReactNode;
  onOpenNotebook(): void;
  onDismiss(): void;
};

export function Workspace(props: Props) {
  const { dataset, asset, result, fields, view, loading, busy } = props;
  const { t } = useAppI18n(messages);
  const operators = [
    { value: 'contains', label: t('opContains') }, { value: 'eq', label: t('opEquals') },
    { value: 'gte', label: t('opAtLeast') }, { value: 'lte', label: t('opAtMost') },
    { value: 'missing', label: t('opMissing') }, { value: 'null', label: t('opNull') },
  ];
  const navigate = useNavigate();
  const bridge = (window as Window & { ipc?: { postMessage?: unknown } }).ipc;
  const hostPresent = window.parent !== window || typeof bridge?.postMessage === 'function';
  const [typeDraft, setTypeDraft] = useState<{ field: string; numeric: boolean } | null>(null);
  const [priorAnalysis, setPriorAnalysis] = useState<ViewSpec | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false), [editing, setEditing] = useState(false);
  const returnMore = useRef(false);
  useEffect(() => { if (!editing && returnMore.current) { returnMore.current = false; props.focusMore?.(); } }, [editing, props.focusMore]);
  useEffect(() => {
    if (props.command === 'edit') { returnMore.current = true; setEditing(true); props.onCommandDone?.(); }
    else if (props.command === 'archive') { setConfirmArchive(true); props.onCommandDone?.(); }
  }, [props.command]);
  const [filterField, setFilterField] = useState(view.filter?.field ?? '');
  const [operator, setOperator] = useState(view.filter?.operator ?? 'contains');
  const [filterValue, setFilterValue] = useState(view.filter?.value ?? '');
  const [fieldSearch, setFieldSearch] = useState('');
  useEffect(() => {
    setFilterField(view.filter?.field ?? '');
    setOperator(view.filter?.operator ?? 'contains');
    setFilterValue(view.filter?.value ?? '');
  }, [view.filter?.field, view.filter?.operator, view.filter?.value]);
  const currentInspection = result?.status === 'ok' && result.assetId === asset.id ? result : null;
  const inspected = currentInspection ?? props.retained?.result ?? null;
  const stale = Boolean(inspected && !currentInspection);
  const displayedView = currentInspection ? view : props.retained?.view ?? view;
  const analysis = canInspect(asset);
  const available = analysis
    ? ['overview', 'table', 'fields', 'chart', 'queries', 'checks', 'versions', 'files', 'citations']
    : ['overview', 'versions', 'files', 'citations'];
  const tab = available.includes(props.tab) ? props.tab : props.tab === 'history' ? 'versions' : 'overview';
  const failure = !loading && result && result.status !== 'ok' ? result : null;
  const columns = view.columns.length ? view.columns : fields?.columns ?? [];
  const versions = dataset.versions.map(id => props.assets.find(item => item.id === id)!).filter(Boolean);
  const versionIndex = Math.max(0, versions.findIndex(item => item.id === asset.id));
  const metadata = { name: dataset.name, projectRef: dataset.projectRef, archived: dataset.archived };
  const fieldOptions = (fields?.report.fields ?? []).map(field => ({ value: field.name, label: field.name }));
  const showIssue = (issue: ViewIssue) => {
    if (!view.issue) setPriorAnalysis(view);
    const issueColumns = issue.field && !columns.includes(issue.field)
      ? [...columns.slice(0, props.maxColumns - 1), issue.field] : view.columns;
    props.onView({ ...view, columns: issueColumns, issue, filter: null, selection: [] }); props.onTab('table');
  };
  const selected = new Set(displayedView.selection);
  const applyFilter = () => props.onView({ ...view, selection: [], filter: filterField
    ? { field: filterField, operator, value: operator === 'missing' || operator === 'null' ? '' : filterValue } : null });
  const chartData: ChartDataset | null = currentInspection ? {
    datasetId: dataset.id, assetId: asset.id, sha256: asset.sha256, name: asset.name, parserVersion: props.parserVersion, view, viewId: currentInspection.viewId ?? '',
    fields: currentInspection.report.fields.map(field => ({ name: field.name, kinds: view.interpretations?.[field.name] ? ['number', ...(field.conversionFailures ? ['string'] : [])] : field.kinds })),
  } : null;
  const format = asset.format.toUpperCase();
  const visibleFields = (fields?.report.fields ?? []).filter(field => field.name.toLowerCase().includes(fieldSearch.toLowerCase()));
  const bytesMatched = Boolean(currentInspection);
  const present = catalogAvailability(asset, result) === 'present' || bytesMatched;
  const needsAttention = !bytesMatched && catalogAvailability(asset, result) !== 'present';
  const recordedSha = asset.checksums.find(item => item.algorithm === 'sha256' && item.value === asset.sha256);
  const otherChecksums = asset.checksums.filter(item => item !== recordedSha);
  const updated = formatDay(asset.createdAt);
  const badges = datasetBadges(asset).map(badge => badge === 'Single cell' ? t('singleCell') : badge === 'Perturbation' ? t('perturbation') : badge);
  const description = fields
    ? t('recordFieldCount', { records: formatInt(fields.report.rowCount), fields: formatInt(fields.report.fields.length) })
    : dataset.kind === 'model' ? t('modelKept')
      : asset.revision.length > 12 ? t('revisionUnindexed', { revision: asset.revision })
        : t('originalUnindexed');
  const availability = t(catalogAvailability(asset, result) === 'present' ? 'stored' : catalogAvailability(asset, result) === 'missing' ? 'missingFile' : 'changedFile');
  const metadataItems: MetadataItem[] = [
    { id: 'type', label: t('type'), value: dataset.kind === 'model' ? t('model') : t('dataset') },
    { id: 'format', label: t('metaFormat'), value: format },
    { id: 'size', label: t('metaSize'), value: formatBytes(asset.size) },
    { id: 'version', label: t('metaVersion'), value: asset.revision || `v${versionIndex + 1}` },
    { id: 'sha256', label: 'SHA-256', value: asset.sha256, format: 'code', action: <CopyDigest label="SHA-256" value={asset.sha256} /> },
    ...otherChecksums.map(item => ({ id: `${item.algorithm}:${item.value}`, label: item.algorithm.toUpperCase(), value: item.value, format: 'code' as const, action: <CopyDigest label={item.algorithm.toUpperCase()} value={item.value} /> })),
    { id: 'added', label: t('metaAdded'), value: asset.createdAt || t('unknownLicense') },
    { id: 'updated', label: t('metaUpdated'), value: updated || t('unknownLicense') },
    { id: 'license', label: t('license'), value: asset.license || t('unknownLicense') },
    { id: 'source', label: t('source'), value: /^https:\/\//.test(asset.source) ? <a href={asset.source}>{sourceHost(asset.source)}</a> : (asset.source || t('unknownLicense')) },
    { id: 'project', label: t('metaProject'), value: dataset.projectRef || t('unassigned'), action: dataset.projectRef ? undefined : <Button variant="ghost" disabled={busy} onClick={() => setEditing(true)}>{t('assignProject')}</Button> },
    ...(asset.bundleId ? [{ id: 'bundle', label: t('paperBundle'), value: asset.bundleId, format: 'code' as const }] : []),
    ...(fields ? [
      { id: 'records', label: t('metaRecords'), value: formatInt(fields.report.rowCount) },
      { id: 'fields', label: t('metaFields'), value: formatInt(fields.report.fields.length) },
    ] : []),
  ];
  return <>
    {editing ? <DatasetDetails dataset={dataset} busy={busy} error={props.error} onSave={props.onEdit} onClose={() => { returnMore.current = true; setEditing(false); }} /> : null}
    <Split storageKey="pero.data.object-panes" className="data-object-split">
      <SplitPane id="data-main-preview" min={contentLayout.mainMin}>
        <Tabs value={tab} onValueChange={props.onTab}>
          <ContentPane id={`data-preview-${dataset.id}`} label={t('preview')} as="div" surface="workspace" inset="none" scroll="pane"
            toolbar={<TabsList aria-label={t('datasetViews')}>
        <TabsTrigger value="overview">{t('overview')}</TabsTrigger>
        <TabsTrigger value="versions">{t('versions')} ({versions.length})</TabsTrigger>
        <TabsTrigger value="files">{t('files')}</TabsTrigger>
        <TabsTrigger value="citations">{t('citations')} (0)</TabsTrigger>
        {analysis ? <><TabsTrigger value="table">{t('viewTable')}</TabsTrigger><TabsTrigger value="fields">{t('viewFields')}</TabsTrigger>
        <TabsTrigger value="chart">{t('viewChart')}</TabsTrigger><TabsTrigger value="queries">{t('viewQueries')}</TabsTrigger><TabsTrigger value="checks">{t('viewChecks')}</TabsTrigger></> : null}
            </TabsList>}
            feedback={<>
              {stale ? <p className="data-retained" role="status">{loading ? 'Updating.' : 'Update failed.'} Showing the last successful result: {displayedView.filter ? `${displayedView.filter.field} ${displayedView.filter.operator} ${displayedView.filter.value}` : 'all records'}{displayedView.sort ? `, ${displayedView.sort.field} ${displayedView.sort.descending ? 'descending' : 'ascending'}` : ''}{displayedView.issue ? `, ${displayedView.issue.kind} issues` : ''}{displayedView.selection.length ? `, ${displayedView.selection.length} selected` : ''}.</p> : null}
              {needsAttention ? <p className="data-note" role="status">{custodyText(custodyDetail(asset, result, false), formatBytes(asset.size), t)}</p> : null}
              {failure ? <div className="data-actions">
                <Feedback kind={failure.status === 'unsupported' ? 'status' : 'error'}>{failure.message}</Feedback>
                {failure.status === 'rejected' && !fields ? <Button disabled={busy} onClick={props.onRecoverView}>{props.recoveryLabel}</Button> : null}
                {failure.status === 'unavailable' || failure.status === 'forbidden' ? <Button disabled={busy} onClick={props.onRetryInspection}>{t('retryInspection')}</Button> : null}
              </div> : null}
            </>}
            footer={<footer className="data-workspace-footer">
              <div className="data-statusbar">
                {fields ? <div className="data-counts">
                  <span>{inspected ? `${inspected.rows.length ? inspected.offset + 1 : 0}–${inspected.offset + inspected.rows.length} / ${formatInt(inspected.matched)} ${t('recordsWord')}` : t('recordsCount', { count: formatInt(fields.report.rowCount) })}</span>
                  <span>{t('fieldsCount', { count: fields.report.fields.length })}</span>
                  {displayedView.filter && inspected ? <span>{t('matchingCount', { count: formatInt(inspected.matched) })}</span> : null}
                  {displayedView.selection.length > 0 ? <span>{t('selectedCount', { count: displayedView.selection.length })}</span> : null}
                </div> : null}
                {tab === 'table' && inspected ? <div className="data-pagination">
                  {view.selection.length > 0 ? <Button variant="ghost" disabled={busy} onClick={() => props.onView({ ...view, selection: [] })}>{t('clearSelection')}</Button> : null}
                  <Button variant="ghost" disabled={busy || loading || stale || inspected.offset === 0} onClick={() => props.onPage(Math.max(0, inspected.offset - 50))}>{t('previous')}</Button>
                  <Button variant="ghost" disabled={busy || loading || stale || inspected.nextOffset == null} onClick={() => props.onPage(inspected.nextOffset!)}>{t('next')}</Button>
                </div> : null}
              </div>
            </footer>}
          >
      <TabsContent value="queries" forceMount><SemanticPanel key={asset.id} datasetId={dataset.id} assetId={asset.id} fields={fields?.columns ?? []} /></TabsContent>
      <TabsContent value="overview">
        <div className="data-overview data-overview-grid">
          {fields ? <div className="data-panel data-overview-span">
            <ContentSection id="data-columns" title={t('columns')} actions={<Button disabled={busy} onClick={() => props.onTab('fields')}>{t('openFields')}</Button>}>
            <p className="data-note">{t('columnsNote')}</p>
            <Table label={t('columnSummary')} density="compact" className="data-rows-scroll" tableClassName="data-rows">
              <thead><tr><th scope="col">{t('fieldColumn')}</th><th scope="col">{t('typeColumn')}</th><th scope="col">{t('missingColumn')}</th></tr></thead>
              <tbody>{fields.report.fields.map(field => <tr key={field.name}>
                <th scope="row">{field.name}</th>
                <td>{view.interpretations?.[field.name] ? 'Decimal number (explicit)' : (field.kinds.join(', ') || '—')}</td>
                <td>{field.missing ? <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'missing', field: field.name })}>{field.missing}</Button> : '0'}</td>
              </tr>)}</tbody>
            </Table>
            </ContentSection>
            <ContentSection id="data-quality" title={t('quality')} actions={<Button disabled={busy} onClick={() => props.onTab('checks')}>{t('openChecks')}</Button>}>
            <dl className="data-facts">
              <dt>{t('missingFields')}</dt><dd>{formatInt(fields.report.missing)} {fields.report.missing > 0 ? <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'missing' })}>{t('showMissingRows')}</Button> : null}</dd>
              <dt>{t('explicitNulls')}</dt><dd>{formatInt(fields.report.nulls)} {fields.report.nulls > 0 ? <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'null' })}>{t('showNullRows')}</Button> : null}</dd>
              <dt>{t('emptyStrings')}</dt><dd>{formatInt(fields.report.empty)} {fields.report.empty > 0 ? <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'empty' })}>{t('showEmptyRows')}</Button> : null}</dd>
              <dt>{t('duplicateRows')}</dt><dd>{formatInt(fields.report.duplicateRows)} {fields.report.duplicateRows > 0 ? <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'duplicate' })}>{t('showDuplicateRows')}</Button> : null}</dd>
              <dt>{t('conversionFailures')}</dt><dd>{formatInt(fields.report.conversionFailures ?? 0)} {!!fields.report.conversionFailures && <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'conversion' })}>{t('showConversionFailures')}</Button>}</dd>
            </dl>
            </ContentSection>
          </div> : null}
          {props.views.length ? <div className="data-panel data-overview-span"><ContentSection id="data-saved-views" title={t('savedViews')}>
          {props.views.map(saved => <section className="data-saved-view" key={saved.id}>
            <ListRow title={saved.name} onOpen={busy ? undefined : () => { setPriorAnalysis(null); setTypeDraft(null); props.onOpen(saved); props.onTab('table'); }} trailing={<Button onClick={() => props.onExport(saved)}>{t('exportReference')}</Button>} />
            <p className="data-note">v{dataset.versions.indexOf(saved.assetId) + 1} / {saved.report.parserVersion} / {saved.report.rowCount} records / {saved.report.duplicateRows} duplicate rows</p>
            <p className="data-note">Saved report, not a claim about current file availability.</p>
          </section>)}</ContentSection></div> : null}
          <p className="data-note data-overview-span">{t('projectReferenceNote')}</p>
        </div>
      </TabsContent>
      {analysis ? <><TabsContent value="table">
        {loading && !inspected ? <p role="status">Reading this version…</p> : null}
        {!loading && (!fields || failure?.status === 'rejected' || failure?.status === 'invalid') && (view.filter || view.issue || Object.keys(view.interpretations ?? {}).length > 0) ? <Button disabled={busy} onClick={() => props.onView(emptyView())}>Reset view</Button> : null}
        {fields ? <>
          {view.issue ? <div className="data-issue-scope"><p>{stale ? 'Requested issue rows: ' : 'Issue rows: '}{view.issue.kind}{view.issue.field ? ` in ${view.issue.field}` : ''}. {view.filter ? 'Full-input checks; showing issue rows within the current filter.' : 'Full-input issue rows.'} {priorAnalysis ? 'Previous filter and selection paused; Return restores the prior analysis.' : 'Saved issue view; Return removes the issue condition.'}</p><Button disabled={busy} onClick={() => { props.onView(priorAnalysis ?? { ...view, issue: null, selection: [] }); setPriorAnalysis(null); }}>Return to analysis</Button></div> : null}
          <Toolbar className="data-controls" aria-label={t('filterAndSort')}>
            <div className="data-filter-controls">
              <Select panelClassName="data-select-panel" className="data-filter-field" label={t('filterField')} value={filterField} disabled={busy}
                options={[{ value: '', label: t('noFilter') }, ...fieldOptions]} onChange={setFilterField} />
              <Select panelClassName="data-select-panel" className="data-filter-condition" label={t('condition')} value={operator} disabled={busy}
                options={operators} onChange={setOperator} />
              <Input className="data-filter-value" aria-label={t('filterValue')} placeholder={t('filterValue')} value={filterValue}
                disabled={busy || operator === 'missing' || operator === 'null'} maxLength={4096}
                onChange={event => setFilterValue(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !busy) applyFilter(); }} />
              <Button disabled={busy || loading} onClick={applyFilter}>{t('apply')}</Button>
              {view.filter ? <Button disabled={busy} onClick={props.onRecoverView}>{t('clearFilter')}</Button> : null}
            </div>
            <div className="data-sort-controls">
              <Select panelClassName="data-select-panel" label={t('sortField')} value={view.sort?.field ?? ''} disabled={busy}
                options={[{ value: '', label: t('sortField') }, ...fieldOptions]}
                onChange={field => props.onView({ ...view, sort: field ? { field, descending: view.sort?.descending ?? false } : null })} />
              <Button disabled={busy || !view.sort} onClick={() => props.onView({ ...view, sort: { field: view.sort!.field, descending: !view.sort!.descending } })}>
                {view.sort?.descending ? t('descending') : t('ascending')}
              </Button>
            </div>
          </Toolbar>
          {filterField && ['gte', 'lte'].includes(operator) && !view.interpretations?.[filterField] && fields.report.fields.find(field => field.name === filterField)?.kinds.includes('string') ? <p className="data-note">Numeric comparison requires explicit number interpretation. <Button onClick={() => { props.onTab('fields'); setTypeDraft({ field: filterField, numeric: true }); }}>Preview number type</Button></p> : null}
          {inspected ? <>
          <p className="data-note">Inspected the whole file. This page shows {formatInt(inspected.matched)} matching records. Source row numbers stay unchanged.</p>
          <Table label="Data records" density="compact" className="data-grid" tableClassName="data-rows">
              <thead><tr><th scope="col">#</th>{inspected.columns.map(key => <th key={key} scope="col" aria-sort={displayedView.sort?.field === key ? (displayedView.sort.descending ? 'descending' : 'ascending') : 'none'}>
                <Button variant="ghost" disabled={busy} onClick={() => props.onView({ ...view, sort: { field: key, descending: view.sort?.field === key ? !view.sort.descending : false } })}>
                  {key}{displayedView.units[key] ? ` (${displayedView.units[key]})` : ''}
                </Button>
              </th>)}<th scope="col">Source</th></tr></thead>
              <tbody>{inspected.rows.map(row => <tr key={row.row} aria-selected={selected.has(row.row - 1)}>
                <th scope="row"><label><Checkbox aria-label={`Select record ${row.row}`} checked={selected.has(row.row - 1)}
                  disabled={busy || stale || (!selected.has(row.row - 1) && selected.size === 1000)}
                  onCheckedChange={checked => props.onView({ ...view, selection: checked ? [...view.selection, row.row - 1] : view.selection.filter(index => index !== row.row - 1) })} />{row.row}</label></th>
                {row.cells.map((cell, index) => <td key={inspected.columns[index]} data-kind={cell.kind}>{cell.kind === 'missing' || cell.kind === 'null' || cell.text === ''
                  ? <span className="data-missing">{cell.kind === 'missing' ? 'missing' : cell.kind === 'null' ? 'null' : 'empty'}</span> : cell.text}{cell.conversionError ? <span className="data-conversion-error">Conversion failed</span> : null}</td>)}
                <td><Button variant="ghost" disabled={busy || stale} aria-label={`Show record source ${row.row}`} onClick={() => props.onRecord(row.row - 1)}>Source</Button></td>
              </tr>)}</tbody>
            </Table>
          {!inspected.rows.length ? <EmptyState icon={<EmptyIllustration kind="search" size="compact" />} heading="No matching records" description="Change the filter or open another version." /> : null}
          <DataForm className="data-filter" onSubmit={event => { event.preventDefault(); props.onSave(String(new FormData(event.currentTarget).get('viewName'))); }}>
            <Input aria-label="View name" name="viewName" placeholder="View name" required maxLength={120} disabled={busy} />
            <SubmitButton disabled={busy || loading || stale || dataset.archived}>Save view</SubmitButton>
          </DataForm>
          </> : null}
        </> : null}
      </TabsContent>
      <TabsContent value="fields">
        {fields ? <>
          <p className="data-note">Full input / {formatInt(fields.report.rowCount)} records, independent of the table filter. Select up to {props.maxColumns} fields. Units are labels; values are not converted. Issue links open full-input rows and pause the table filter until you return.</p>
          {typeDraft ? <InterpretationPreview key={`${typeDraft.field}:${typeDraft.numeric}`} {...typeDraft} datasetId={dataset.id} assetId={asset.id} parserVersion={props.parserVersion} view={view} busy={busy} onCancel={() => setTypeDraft(null)} onApply={next => {
            setPriorAnalysis(previous => next.issue && previous ? applyInterpretation(previous, typeDraft.field, typeDraft.numeric) : null);
            props.onView(next); setTypeDraft(null);
          }} /> : null}
          <Toolbar className="data-field-controls"><Input type="search" aria-label="Find fields" placeholder="Find fields" value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} /><p>{columns.length} / {props.maxColumns} displayed</p></Toolbar>
          <Table label="Field profile" density="compact" className="data-rows-scroll" tableClassName="data-rows">
            <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Unit</th><th scope="col">Missing</th><th scope="col">Null</th><th scope="col">Empty</th></tr></thead>
            <tbody>{visibleFields.map(field => <tr key={field.name}>
              <th scope="row"><label><Checkbox aria-label={`Show ${field.name}`} checked={columns.includes(field.name)}
                disabled={busy || (columns.includes(field.name) ? columns.length === 1 : columns.length >= props.maxColumns)}
                onCheckedChange={checked => props.onView({ ...view, columns: checked === true ? [...columns, field.name] : columns.filter(item => item !== field.name) })} /> {field.name}</label></th>
              <td>{view.interpretations?.[field.name] ? 'Decimal number (explicit)' : field.kinds.join(', ')}{['csv', 'tsv'].includes(asset.format.toLowerCase()) && (!field.kinds.length || field.kinds.includes('string') || view.interpretations?.[field.name]) ? <Button disabled={busy} onClick={() => setTypeDraft({ field: field.name, numeric: !view.interpretations?.[field.name] })}>{view.interpretations?.[field.name] ? 'Revert to text' : 'Preview number'}</Button> : null}{!!field.conversionFailures && <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'conversion', field: field.name })}>{field.conversionFailures} conversion failures</Button>}</td>
              <td><FieldUnit key={`${asset.id}:${field.name}`} field={field.name} unit={view.units[field.name] || ''} disabled={busy}
                onCommit={unit => props.onView({ ...view, units: { ...view.units, [field.name]: unit } })} /></td>
              {(['missing', 'null', 'empty'] as const).map(kind => { const count = kind === 'null' ? field.nulls : field[kind]; return <td key={kind}>{count ? <Button disabled={busy || loading} onClick={() => showIssue({ kind, field: field.name })}>{count}</Button> : '0'}</td>; })}
            </tr>)}</tbody>
          </Table>
        </> : <p className="data-note">Fields are available after a successful inspection.</p>}
      </TabsContent>
      <TabsContent value="chart" forceMount className="data-chart">
        {!currentInspection && !props.retained ? <p className="data-note">{loading ? 'Inspecting this version…' : 'Chart requires a successful current inspection. Open Table to review or clear an invalid filter.'}</p> : null}
        <ChartPanel key={failure && ['changed', 'missing', 'unsupported', 'forbidden'].includes(failure.status) ? failure.status : 'available'} data={chartData} inspectionPending={loading} busy={busy || loading} onActivate={() => props.onTab('chart')} aggregationControls={<>
          <label className="data-chart-field"><span>Group by</span><Select panelClassName="data-select-panel" label="Group by" value={view.chart?.category ?? ''} disabled={busy}
            options={[{ value: '', label: 'Group by' }, ...fieldOptions]}
            onChange={category => props.onView({ ...view, chart: category ? { category, measure: view.chart?.measure || fieldOptions[0]?.value || '', aggregation: view.chart?.aggregation || 'count' } : null })} /></label>
          {view.chart ? <>
            <label className="data-chart-field"><span>Measure</span><Select panelClassName="data-select-panel" label="Measure" value={view.chart.measure} options={fieldOptions} disabled={busy}
              onChange={measure => props.onView({ ...view, chart: { ...view.chart!, measure } })} /></label>
            <label className="data-chart-field"><span>Aggregate</span><Select panelClassName="data-select-panel" label="Aggregate" value={view.chart.aggregation} disabled={busy}
              options={[{ value: 'sum', label: 'Sum' }, { value: 'count', label: 'Count' }]}
              onChange={aggregation => props.onView({ ...view, chart: { ...view.chart!, aggregation } })} /></label>
          </> : null}
        </>} />
      </TabsContent>
      <TabsContent value="checks">
        {inspected ? <>
          <dl className="data-facts">
            <dt>Scope</dt><dd>Full input / {formatInt(inspected.report.rowCount)} records</dd>
            <dt>Missing fields</dt><dd>{formatInt(inspected.report.missing)} {inspected.report.missing > 0 ? <Button disabled={busy || stale} onClick={() => showIssue({ kind: 'missing' })}>Show missing rows</Button> : null}</dd>
            <dt>Explicit nulls</dt><dd>{formatInt(inspected.report.nulls)} {inspected.report.nulls > 0 ? <Button disabled={busy || stale} onClick={() => showIssue({ kind: 'null' })}>Show null rows</Button> : null}</dd>
            <dt>Empty strings</dt><dd>{formatInt(inspected.report.empty)} {inspected.report.empty > 0 ? <Button disabled={busy || stale} onClick={() => showIssue({ kind: 'empty' })}>Show empty rows</Button> : null}</dd>
            <dt>Duplicate rows</dt><dd>{formatInt(inspected.report.duplicateRows)} {inspected.report.duplicateRows > 0 ? <Button disabled={busy || stale} onClick={() => showIssue({ kind: 'duplicate' })}>Show duplicate rows</Button> : null}</dd>
            <dt>Conversion failures</dt><dd>{formatInt(inspected.report.conversionFailures ?? 0)} {!!inspected.report.conversionFailures && <Button disabled={busy || stale} onClick={() => showIssue({ kind: 'conversion' })}>Show conversion failures</Button>}</dd>
            <dt>Skipped blank lines</dt><dd>{formatInt(inspected.report.blankLines)}</dd>
            <dt>Parser</dt><dd>{inspected.report.parserVersion}</dd>
          </dl>
          <p className="data-note">Checks describe the full input; missing, null, empty and conversion counts are cells, while duplicate counts are rows. Show issues opens full-input rows and pauses the table filter until you return. Checks do not establish scientific validity. Duplicate rows have identical fields and exact value tokens.</p>
          {inspected.report.duplicates.length ? <Table label="Duplicate records" density="compact" className="data-rows-scroll" tableClassName="data-rows">
            <thead><tr><th scope="col">Row</th><th scope="col">Duplicate of</th><th scope="col">Source line</th></tr></thead>
            <tbody>{inspected.report.duplicates.map(item => <tr key={item.row}><td>{item.row}</td><td>{item.duplicateOf}</td><td>{item.sourceLine ?? '—'} <Button disabled={busy || stale} onClick={() => props.onRecord(item.row - 1)}>Source row {item.row}</Button></td></tr>)}</tbody>
          </Table> : null}
        </> : <p className="data-note">{t('noCurrentChecks')}</p>}
      </TabsContent>
      </> : null}
      <TabsContent value="versions">
        <div className="data-history">{versions.map((version, index) => <ListRow key={version.id} title={versionLabel(version, index)} current={version.id === asset.id} meta={<><span>{availabilityText(availabilityLabel(version, result), t)} · {version.sha256.slice(0, 12)}</span><code title={version.sha256}>{version.sha256}</code></>} onOpen={busy ? undefined : () => props.onVersion(version.id)} />)}</div>
        <p className="data-note">{t('versionsNote')}</p>
      </TabsContent>
      <TabsContent value="files">
        <ContentSection id="data-file" title={asset.name}>
          <table className="data-facts" aria-label={t('files')}>
            <tbody>
              <tr><th scope="row">{t('metaFormat')}</th><td>{format}</td></tr>
              <tr><th scope="row">{t('metaSize')}</th><td>{formatBytes(asset.size)}</td></tr>
              <tr><th scope="row">{t('availability')}</th><td>{availabilityText(availabilityLabel(asset, result), t)}</td></tr>
              <tr><th scope="row">SHA-256</th><td><DigestValue label="SHA-256" value={asset.sha256} /></td></tr>
            </tbody>
          </table>
        </ContentSection>
      </TabsContent>
      <TabsContent value="citations">
        <EmptyState icon={<EmptyIllustration kind="search" size="compact" />} heading={t('citations')} description={t('noCitations')} />
      </TabsContent>
          </ContentPane>
        </Tabs>
      </SplitPane>
      <SplitPane id="data-inspector" as="aside" aria-label={dataset.name} size={contentLayout.inspectorWidth} min={contentLayout.inspectorMin}>
        <ContentPane id={`data-inspector-${dataset.id}`} label={dataset.name} as="div" surface="reading" inset="compact" scroll="pane"
          header={<InspectorHeader
            title={dataset.name}
            identity={<div className="data-badges">{badges.map((badge, index) => <Badge key={badge} tone={index === 0 ? 'blue' : 'neutral'}>{badge}</Badge>)}</div>}
            subtitle={description}
            status={<span>{availability}</span>}
            actions={<>
              {props.objectActions}
              <Button variant="primary" disabled={busy || !hostPresent} onClick={props.onOpenNotebook}>{t('openNotebook')}</Button>
            </>}
            dismiss={{ label: t('close'), onDismiss: props.onDismiss }}
          />}
          footer={<Button variant="ghost" disabled={busy || !props.canAsk} onClick={props.onAsk}>{t('askAgent')}</Button>}
        >
          <ContentSection id={`data-properties-${dataset.id}`} title={t('basicInfo')}>
            <MetadataList items={metadataItems} />
          </ContentSection>
          <ContentSection id={`data-status-${dataset.id}`} title={t('statusTitle')}>
            <ul className="data-status-list">
              <li data-ok={present || undefined}><Icon name={present ? 'check' : 'info'} size={14} />{availability}</li>
              <li data-ok={present || undefined}><Icon name={present ? 'check' : 'info'} size={14} />{present ? t('filePresent') : custodyText(custodyDetail(asset, result, false), formatBytes(asset.size), t)}</li>
              <li data-ok={analysis || undefined}><Icon name={analysis ? 'check' : 'info'} size={14} />{analysis ? t('tableReady') : t('notIndexed')}</li>
              {recordedSha?.provenance ? <li><Icon name="info" size={14} />{recordedSha.provenance}</li>
                : <li><Icon name="info" size={14} />{t('digestRecorded')}</li>}
            </ul>
          </ContentSection>
          <ContentSection id={`data-relations-${dataset.id}`} title={t('quickActions')}>
            {versions.length > 1 ? <Select label={t('metaVersion')} value={asset.id} onChange={props.onVersion} disabled={busy}
              options={versions.map((version, index) => ({ value: version.id, label: versionLabel(version, index) }))} /> : null}
            {confirmArchive ? <div className="data-actions">
              <p>{t('archivePrompt')}</p>
              <Button disabled={busy} onClick={() => { props.onEdit({ ...metadata, archived: true }); setConfirmArchive(false); }}>{t('confirmArchive')}</Button>
              <Button onClick={() => setConfirmArchive(false)}>{t('cancel')}</Button>
            </div> : null}
            <div className="data-quick-actions">
              <ListRow title={t('analyzeNotebook')} onOpen={busy || !hostPresent ? undefined : () => void navigate('/apps/notebook/main')} />
              <ListRow title={t('useControlLab')} onOpen={busy || !hostPresent ? undefined : () => void navigate('/apps/control-lab/main')} />
              <ListRow title={t('openCompute')} onOpen={busy || !hostPresent ? undefined : () => void navigate('/apps/compute/main')} />
            </div>
          </ContentSection>
        </ContentPane>
      </SplitPane>
    </Split>
  </>;
}

function availabilityText(label: string, t: (key: string) => string) {
  if (label === 'Stored') return t('stored');
  if (label === 'Missing') return t('missingFile');
  if (label === 'Changed') return t('changedFile');
  return label;
}

function custodyText(detail: string, size: string, t: (key: string, vars?: Record<string, string | number>) => string) {
  if (detail === 'Inspected bytes match the admitted SHA-256.') return t('bytesMatched');
  if (detail === 'Original file is missing.') return t('fileMissing');
  if (detail === 'File size no longer matches the admitted size.') return t('sizeChanged');
  if (detail === 'Admitted SHA-256 does not match the current file.') return t('digestMismatch');
  return t('filePresentDetail', { size });
}

function CopyDigest({ value, label }: { value: string; label: string }) {
  const { t } = useAppI18n(messages);
  const [copied, setCopied] = useState(false);
  return <Button variant="ghost" onClick={() => {
    void navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => setCopied(false));
  }}>{copied ? t('copied') : t('copyValue', { label })}</Button>;
}

function DigestValue({ value, label }: { value: string; label: string }) {
  const { t } = useAppI18n(messages);
  const [copied, setCopied] = useState(false);
  return <span className="data-actions"><code>{value}</code><Button variant="ghost" onClick={() => {
    void navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => setCopied(false));
  }}>{copied ? t('copied') : t('copyValue', { label })}</Button></span>;
}

function FieldUnit({ field, unit, disabled, onCommit }: { field: string; unit: string; disabled: boolean; onCommit(unit: string): void }) {
  const [draft, setDraft] = useState(unit);
  useEffect(() => { setDraft(unit); }, [unit]);
  return <Input aria-label={`Unit for ${field}`} value={draft} maxLength={60} disabled={disabled}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => { const next = draft.trim(); setDraft(next); if (next !== unit) onCommit(next); }} />;
}
