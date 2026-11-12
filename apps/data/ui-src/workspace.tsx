import { useEffect, useState } from 'react';
import { Table, Button, Checkbox, EmptyState, EmptyIllustration, Feedback, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, Toolbar } from '@pero/app-sdk/ui';
import { InterpretationPreview } from './interpretation';
import { SemanticPanel } from './semantic-panel';
import { ChartPanel } from './chart-panel';
import { DatasetDetails } from './dataset-details';
import { DataForm, SubmitButton } from './submit-button';
import { applyInterpretation, availabilityLabel, canInspect, custodyDetail, emptyView, formatBytes, formatInt, versionLabel, type Asset, type ChartDataset, type Dataset, type InspectionOutcome, type OkInspection, type SavedView, type ViewIssue, type ViewSpec } from './model';

const operators = [
  { value: 'contains', label: 'Contains' }, { value: 'eq', label: 'Equals' },
  { value: 'gte', label: 'At least' }, { value: 'lte', label: 'At most' },
  { value: 'missing', label: 'Missing field' }, { value: 'null', label: 'Null value' },
];

type Props = {
  dataset: Dataset; asset: Asset; assets: Asset[]; views: SavedView[];
  result: InspectionOutcome | null; retained: { result: OkInspection; view: ViewSpec } | null; error: string; fields: OkInspection | null; loading: boolean; busy: boolean;
  view: ViewSpec; parserVersion: string; tab: string; maxColumns: number;
  recoveryLabel: string;
  onTab(value: string): void; onVersion(id: string): void; onView(value: ViewSpec): void; onPage(offset: number): void;
  onRetryInspection(): void; onRecoverView(): void;
  onAddVersion(): void; onEdit(value: { name: string; projectRef: string; archived: boolean }): Promise<boolean>;
  onSave(name: string): void; onOpen(view: SavedView): void; onExport(view: SavedView): void;
  onRecord(row: number): void;
};

export function Workspace(props: Props) {
  const { dataset, asset, result, fields, view, loading, busy } = props;
  const [typeDraft, setTypeDraft] = useState<{ field: string; numeric: boolean } | null>(null);
  const [priorAnalysis, setPriorAnalysis] = useState<ViewSpec | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false), [editing, setEditing] = useState(false);
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
  const available = analysis ? ['overview', 'table', 'fields', 'chart', 'queries', 'checks', 'history'] : ['overview', 'history'];
  const tab = available.includes(props.tab) ? props.tab : 'overview';
  const failure = !loading && result && result.status !== 'ok' ? result : null;
  const columns = view.columns.length ? view.columns : fields?.columns ?? [];
  const versions = dataset.versions.map(id => props.assets.find(item => item.id === id)!).filter(Boolean);
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
  const availability = bytesMatched ? 'Bytes matched' : availabilityLabel(asset, result);
  const recordedSha = asset.checksums.find(item => item.algorithm === 'sha256' && item.value === asset.sha256);
  const otherChecksums = asset.checksums.filter(item => item !== recordedSha);
  return <>
    <header className="data-preview-head">
      <div className="data-document-heading"><h2 title={asset.name}>{asset.name}</h2><span className="data-format">{format}</span></div>
      <div className="data-actions">
        <Select label="Version" value={asset.id} onChange={props.onVersion} disabled={busy}
          options={versions.map((version, index) => ({ value: version.id, label: versionLabel(version, index) }))} />
        <Button onClick={props.onAddVersion} disabled={busy || dataset.archived}>Add version</Button>
      </div>
      <p className="data-note">Add version appends an immutable file. Importing the same filename with Add data creates a separate dataset.</p>
      <p className="data-note" role="status">{custodyDetail(asset, result, bytesMatched)}</p>
      <table className="data-facts" aria-label="Availability">
        <tbody><tr><th scope="row">Availability</th><td>{availability}</td></tr></tbody>
      </table>
      {failure ? <div className="data-actions">
        <Feedback kind={failure.status === 'unsupported' ? 'status' : 'error'}>{failure.message}</Feedback>
        {failure.status === 'rejected' && !fields ? <Button disabled={busy} onClick={props.onRecoverView}>{props.recoveryLabel}</Button> : null}
        {failure.status === 'unavailable' || failure.status === 'forbidden' ? <Button disabled={busy} onClick={props.onRetryInspection}>Retry inspection</Button> : null}
      </div> : null}
      <div className="data-actions">
        <Button variant="ghost" disabled={busy} onClick={() => setEditing(true)}>Edit details</Button>
        {dataset.archived ? <Button disabled={busy} onClick={() => props.onEdit({ ...metadata, archived: false })}>Restore dataset</Button>
          : confirmArchive ? <>
            <Button disabled={busy} onClick={() => { props.onEdit({ ...metadata, archived: true }); setConfirmArchive(false); }}>Confirm archive</Button>
            <Button onClick={() => setConfirmArchive(false)}>Cancel</Button>
          </> : <Button disabled={busy} onClick={() => setConfirmArchive(true)}>Archive dataset</Button>}
      </div>
      {confirmArchive ? <p>Hide this dataset? Original files and saved views remain; no disk space is freed.</p>
        : dataset.archived ? <p className="data-note">Hidden from the active list. Original files and saved views remain stored.</p>
          : <p className="data-note">Archive hides this dataset from the active list. Original files and saved views remain; no disk space is freed.</p>}
    </header>
    {editing ? <DatasetDetails dataset={dataset} busy={busy} error={props.error} onSave={props.onEdit} onClose={() => setEditing(false)} /> : null}
    {stale ? <p className="data-retained" role="status">{loading ? 'Updating.' : 'Update failed.'} Showing the last successful result: {displayedView.filter ? `${displayedView.filter.field} ${displayedView.filter.operator} ${displayedView.filter.value}` : 'all records'}{displayedView.sort ? `, ${displayedView.sort.field} ${displayedView.sort.descending ? 'descending' : 'ascending'}` : ''}{displayedView.issue ? `, ${displayedView.issue.kind} issues` : ''}{displayedView.selection.length ? `, ${displayedView.selection.length} selected` : ''}.</p> : null}
    <Tabs value={tab} onValueChange={props.onTab}>
      <TabsList aria-label="Dataset views">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        {analysis ? <><TabsTrigger value="table">Table</TabsTrigger><TabsTrigger value="fields">Fields</TabsTrigger>
        <TabsTrigger value="chart">Chart</TabsTrigger><TabsTrigger value="queries">Queries</TabsTrigger><TabsTrigger value="checks">Checks</TabsTrigger></> : null}
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="queries" forceMount><SemanticPanel key={asset.id} datasetId={dataset.id} assetId={asset.id} fields={fields?.columns ?? []} /></TabsContent>
      <TabsContent value="overview">
        <div className="data-overview">
          <table className="data-facts" aria-label="Admission receipt">
            <tbody>
              <tr><th scope="row">Kind</th><td>{dataset.kind === 'model' ? 'Model' : 'Dataset'}</td></tr>
              <tr><th scope="row">Format</th><td>{format}</td></tr>
              <tr><th scope="row">Size</th><td>{formatBytes(asset.size)}</td></tr>
              <tr><th scope="row">Source</th><td>{/^https:\/\//.test(asset.source) ? <a href={asset.source}>{asset.source}</a> : (asset.source || 'Unknown source')}</td></tr>
              <tr><th scope="row">License</th><td>{asset.license || 'Unknown license'}</td></tr>
              <tr><th scope="row">Revision</th><td>{asset.revision || 'Local import'}</td></tr>
              <tr><th scope="row">SHA-256</th><td><DigestValue label="SHA-256" value={asset.sha256} />{recordedSha?.provenance ? <p className="data-note">{recordedSha.provenance}</p> : <p className="data-note">Recorded when this version was admitted.</p>}</td></tr>
              {otherChecksums.map(item => <tr key={`${item.algorithm}:${item.value}`}><th scope="row">{item.algorithm.toUpperCase()}</th><td><DigestValue label={item.algorithm.toUpperCase()} value={item.value} />{item.provenance ? <p className="data-note">{item.provenance}</p> : null}</td></tr>)}
              <tr><th scope="row">Added</th><td>{asset.createdAt}</td></tr>
              <tr><th scope="row">Project reference</th><td>{dataset.projectRef || 'Unassigned'}{dataset.projectRef ? null : <Button variant="ghost" disabled={busy} onClick={() => setEditing(true)}>Assign project reference</Button>}</td></tr>
              {asset.bundleId ? <tr><th scope="row">Paper bundle</th><td>{asset.bundleId}</td></tr> : null}
              {fields ? <><tr><th scope="row">Records</th><td>{formatInt(fields.report.rowCount)} inspected</td></tr><tr><th scope="row">Fields</th><td>{formatInt(fields.report.fields.length)}</td></tr></> : null}
            </tbody>
          </table>
          <p className="data-note">A project reference groups datasets. It is not a permission boundary. Original bytes remain immutable.</p>
          {fields ? <>
            <h3>Columns</h3>
            <p className="data-note">Observed on the full input. Open Fields to choose displayed columns, units, or a number interpretation.</p>
            <div className="data-actions"><Button disabled={busy} onClick={() => props.onTab('fields')}>Open fields</Button></div>
            <Table label="Column summary" density="compact" className="data-rows-scroll" tableClassName="data-rows">
              <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Missing</th></tr></thead>
              <tbody>{fields.report.fields.map(field => <tr key={field.name}>
                <th scope="row">{field.name}</th>
                <td>{view.interpretations?.[field.name] ? 'Decimal number (explicit)' : (field.kinds.join(', ') || '—')}</td>
                <td>{field.missing ? <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'missing', field: field.name })}>{field.missing}</Button> : '0'}</td>
              </tr>)}</tbody>
            </Table>
            <h3>Quality</h3>
            <dl className="data-facts">
              <dt>Missing fields</dt><dd>{formatInt(fields.report.missing)} {fields.report.missing > 0 ? <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'missing' })}>Show missing rows</Button> : null}</dd>
              <dt>Explicit nulls</dt><dd>{formatInt(fields.report.nulls)} {fields.report.nulls > 0 ? <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'null' })}>Show null rows</Button> : null}</dd>
              <dt>Empty strings</dt><dd>{formatInt(fields.report.empty)} {fields.report.empty > 0 ? <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'empty' })}>Show empty rows</Button> : null}</dd>
              <dt>Duplicate rows</dt><dd>{formatInt(fields.report.duplicateRows)} {fields.report.duplicateRows > 0 ? <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'duplicate' })}>Show duplicate rows</Button> : null}</dd>
              <dt>Conversion failures</dt><dd>{formatInt(fields.report.conversionFailures ?? 0)} {!!fields.report.conversionFailures && <Button disabled={busy || loading} onClick={() => showIssue({ kind: 'conversion' })}>Show conversion failures</Button>}</dd>
            </dl>
            <Button disabled={busy} onClick={() => props.onTab('checks')}>Open checks</Button>
          </> : null}
          {props.views.length ? <><h3>Saved views</h3>
          {props.views.map(saved => <section className="data-saved-view" key={saved.id}>
            <div className="data-actions"><Button disabled={busy} onClick={() => { setPriorAnalysis(null); setTypeDraft(null); props.onOpen(saved); props.onTab('table'); }}>{saved.name}</Button><Button onClick={() => props.onExport(saved)}>Export reference</Button></div>
            <p className="data-note">v{dataset.versions.indexOf(saved.assetId) + 1} / {saved.report.parserVersion} / {saved.report.rowCount} records / {saved.report.duplicateRows} duplicate rows</p>
            <p className="data-note">Saved report, not a claim about current file availability.</p>
          </section>)}</> : null}
        </div>
      </TabsContent>
      {analysis ? <><TabsContent value="table">
        {loading && !inspected ? <p role="status">Reading this version…</p> : null}
        {!loading && (!fields || failure?.status === 'rejected' || failure?.status === 'invalid') && (view.filter || view.issue || Object.keys(view.interpretations ?? {}).length > 0) ? <Button disabled={busy} onClick={() => props.onView(emptyView())}>Reset view</Button> : null}
        {fields ? <>
          {view.issue ? <div className="data-issue-scope"><p>{stale ? 'Requested issue rows: ' : 'Issue rows: '}{view.issue.kind}{view.issue.field ? ` in ${view.issue.field}` : ''}. {view.filter ? 'Full-input checks; showing issue rows within the current filter.' : 'Full-input issue rows.'} {priorAnalysis ? 'Previous filter and selection paused; Return restores the prior analysis.' : 'Saved issue view; Return removes the issue condition.'}</p><Button disabled={busy} onClick={() => { props.onView(priorAnalysis ?? { ...view, issue: null, selection: [] }); setPriorAnalysis(null); }}>Return to analysis</Button></div> : null}
          <Toolbar className="data-controls" aria-label="Filter and sort">
            <div className="data-filter-controls">
              <Select panelClassName="data-select-panel" className="data-filter-field" label="Filter field" value={filterField} disabled={busy}
                options={[{ value: '', label: 'No filter' }, ...fieldOptions]} onChange={setFilterField} />
              <Select panelClassName="data-select-panel" className="data-filter-condition" label="Condition" value={operator} disabled={busy}
                options={operators} onChange={setOperator} />
              <Input className="data-filter-value" aria-label="Filter value" placeholder="Filter value" value={filterValue}
                disabled={busy || operator === 'missing' || operator === 'null'} maxLength={4096}
                onChange={event => setFilterValue(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !busy) applyFilter(); }} />
              <Button disabled={busy || loading} onClick={applyFilter}>Apply</Button>
              {view.filter ? <Button disabled={busy} onClick={props.onRecoverView}>Clear filter</Button> : null}
            </div>
            <div className="data-sort-controls">
              <Select panelClassName="data-select-panel" label="Sort field" value={view.sort?.field ?? ''} disabled={busy}
                options={[{ value: '', label: 'Sort field' }, ...fieldOptions]}
                onChange={field => props.onView({ ...view, sort: field ? { field, descending: view.sort?.descending ?? false } : null })} />
              <Button disabled={busy || !view.sort} onClick={() => props.onView({ ...view, sort: { field: view.sort!.field, descending: !view.sort!.descending } })}>
                {view.sort?.descending ? 'Descending' : 'Ascending'}
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
        </> : <p className="data-note">No current checks.</p>}
      </TabsContent>
      </> : null}
      <TabsContent value="history">
        <div className="data-history">{versions.map((version, index) => <section key={version.id}>
          <Button aria-pressed={version.id === asset.id} disabled={busy} onClick={() => props.onVersion(version.id)}>{versionLabel(version, index)}</Button>
          <p className="data-note">{availabilityLabel(version, result)} · {version.sha256.slice(0, 12)}</p>
          <code title={version.sha256}>{version.sha256}</code>
        </section>)}</div>
        <p className="data-note">Each version is an immutable file. Saved views stay on Overview and remain pinned to the version they were saved from.</p>
      </TabsContent>
    </Tabs>
    <footer className="data-workspace-footer">
      <div className="data-statusbar">
        {fields ? <div className="data-counts">
          <span>{inspected ? `${inspected.rows.length ? inspected.offset + 1 : 0}–${inspected.offset + inspected.rows.length} / ${formatInt(inspected.matched)}` : formatInt(fields.report.rowCount)} records</span>
          <span>{fields.report.fields.length} fields</span>
          {displayedView.filter && inspected ? <span>{formatInt(inspected.matched)} matching</span> : null}
          {displayedView.selection.length > 0 ? <span>{displayedView.selection.length} selected</span> : null}
        </div> : null}
        {tab === 'table' && inspected ? <div className="data-pagination">
          {view.selection.length > 0 ? <Button variant="ghost" disabled={busy} onClick={() => props.onView({ ...view, selection: [] })}>Clear selection</Button> : null}
          <Button variant="ghost" disabled={busy || loading || stale || inspected.offset === 0} onClick={() => props.onPage(Math.max(0, inspected.offset - 50))}>Previous</Button>
          <Button variant="ghost" disabled={busy || loading || stale || inspected.nextOffset == null} onClick={() => props.onPage(inspected.nextOffset!)}>Next</Button>
        </div> : null}
      </div>

    </footer>
  </>;
}

function DigestValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <span className="data-actions"><code>{value}</code><Button variant="ghost" onClick={() => {
    void navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => setCopied(false));
  }}>{copied ? 'Copied' : `Copy ${label}`}</Button></span>;
}

function FieldUnit({ field, unit, disabled, onCommit }: { field: string; unit: string; disabled: boolean; onCommit(unit: string): void }) {
  const [draft, setDraft] = useState(unit);
  useEffect(() => { setDraft(unit); }, [unit]);
  return <Input aria-label={`Unit for ${field}`} value={draft} maxLength={60} disabled={disabled}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => { const next = draft.trim(); setDraft(next); if (next !== unit) onCommit(next); }} />;
}
