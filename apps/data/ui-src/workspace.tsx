import { useEffect, useState } from 'react';
import { Button, Checkbox, EmptyState, Feedback, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, Toolbar } from '@pero/app-sdk/ui';
import { ChartPanel } from './chart-panel';
import { DataForm, SubmitButton } from './submit-button';
import { availabilityLabel, formatBytes, formatInt, type Asset, type ChartDataset, type Dataset, type Inspection, type OkInspection, type SavedView, type ViewSpec } from './model';

const operators = [
  { value: 'contains', label: 'Contains' }, { value: 'eq', label: 'Equals' },
  { value: 'gte', label: 'At least' }, { value: 'lte', label: 'At most' },
  { value: 'missing', label: 'Missing field' }, { value: 'null', label: 'Null value' },
];

type Props = {
  dataset: Dataset; asset: Asset; assets: Asset[]; views: SavedView[];
  result: Inspection | null; fields: OkInspection | null; loading: boolean; busy: boolean;
  view: ViewSpec; tab: string; maxColumns: number;
  onTab(value: string): void; onVersion(id: string): void; onView(value: ViewSpec): void; onPage(offset: number): void;
  onAddVersion(): void; onEdit(value: { name: string; projectRef: string; archived: boolean }): void;
  onSave(name: string): void; onOpen(view: SavedView): void; onExport(view: SavedView): void;
  onRecord(row: number): void;
};

export function Workspace(props: Props) {
  const { dataset, asset, result, fields, view, loading, busy } = props;
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [filterField, setFilterField] = useState(view.filter?.field ?? '');
  const [operator, setOperator] = useState(view.filter?.operator ?? 'contains');
  const [filterValue, setFilterValue] = useState(view.filter?.value ?? '');
  const [fieldSearch, setFieldSearch] = useState('');
  useEffect(() => {
    setFilterField(view.filter?.field ?? '');
    setOperator(view.filter?.operator ?? 'contains');
    setFilterValue(view.filter?.value ?? '');
  }, [view.filter?.field, view.filter?.operator, view.filter?.value]);
  const inspected = result?.status === 'ok' && result.assetId === asset.id ? result : null;
  const columns = view.columns.length ? view.columns : fields?.columns ?? [];
  const versions = dataset.versions.map(id => props.assets.find(item => item.id === id)!).filter(Boolean);
  const metadata = { name: dataset.name, projectRef: dataset.projectRef, archived: dataset.archived };
  const fieldOptions = (fields?.report.fields ?? []).map(field => ({ value: field.name, label: field.name }));
  const selected = new Set(view.selection);
  const applyFilter = () => props.onView({ ...view, selection: [], filter: filterField
    ? { field: filterField, operator, value: operator === 'missing' || operator === 'null' ? '' : filterValue } : null });
  const chartData: ChartDataset | null = inspected ? {
    datasetId: dataset.id, assetId: asset.id, sha256: asset.sha256, name: asset.name, view, viewId: inspected.viewId ?? '',
    fields: inspected.report.fields.map(field => ({ name: field.name, kinds: field.kinds })),
  } : null;
  const format = asset.format.toUpperCase();
  const visibleFields = (fields?.report.fields ?? []).filter(field => field.name.toLowerCase().includes(fieldSearch.toLowerCase()));
  return <>
    <header className="data-preview-head">
      <div className="data-document-heading"><h2 title={asset.name}>{asset.name}</h2><span className="data-format">{format}</span></div>
      <div className="data-actions">
        <Select label="Version" value={asset.id} onChange={props.onVersion} disabled={busy}
          options={versions.map((version, index) => ({ value: version.id, label: `v${index + 1} — ${version.name}` }))} />
        <Button onClick={props.onAddVersion} disabled={busy || dataset.archived}>Add version</Button>
      </div>
      <p className="data-note">{formatBytes(asset.size)} / {format} / {inspected ? 'Bytes matched' : result?.status === 'changed' ? 'Changed' : availabilityLabel(asset)}</p>
      <details>
        <summary>Source and details</summary>
        <dl className="data-facts">
          <dt>Source</dt><dd>{asset.source || 'Unknown'}</dd>
          <dt>License</dt><dd>{asset.license || 'Unknown'}</dd>
          <dt>Revision</dt><dd>{asset.revision || 'Local import'}</dd>
          <dt>SHA-256</dt><dd><code>{asset.sha256}</code></dd>
          <dt>Added</dt><dd>{asset.createdAt}</dd>
          {asset.bundleId ? <><dt>Paper bundle</dt><dd>{asset.bundleId}</dd></> : null}
        </dl>
        <DataForm className="data-form" key={`${dataset.id}:${dataset.name}:${dataset.projectRef}`} onSubmit={event => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          props.onEdit({ ...metadata, name: String(values.get('name')), projectRef: String(values.get('projectRef')) });
        }}>
          <label>Name<Input name="name" defaultValue={dataset.name} maxLength={200} required disabled={busy} /></label>
          <label>Project reference<Input name="projectRef" defaultValue={dataset.projectRef} maxLength={200} disabled={busy} /></label>
          <p className="data-note">A reference only, not a project permission boundary.</p>
          <SubmitButton disabled={busy}>Save details</SubmitButton>
        </DataForm>
      </details>
    </header>
    <Tabs value={props.tab} onValueChange={props.onTab}>
      <TabsList aria-label="Dataset views">
        <TabsTrigger value="table">Table</TabsTrigger><TabsTrigger value="fields">Fields</TabsTrigger>
        <TabsTrigger value="chart">Chart</TabsTrigger><TabsTrigger value="checks">Checks</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="table">
        {loading && !inspected ? <p role="status">Reading this version…</p> : null}
        {!loading && result && result.assetId === asset.id && result.status !== 'ok' ? <Feedback kind="error">{result.message}</Feedback> : null}
        {dataset.kind === 'model' ? <p className="data-note">Model files stay stored. They are not parsed, charted, or sent to the agent as rows.</p> : null}
        {inspected ? <>
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
              {view.filter ? <Button disabled={busy} onClick={() => props.onView({ ...view, selection: [], filter: null })}>Clear filter</Button> : null}
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
          <div className="data-grid" tabIndex={0} role="region" aria-label="Data records">
            <table className="data-rows">
              <thead><tr><th scope="col">#</th>{inspected.columns.map(key => <th key={key} scope="col" aria-sort={view.sort?.field === key ? (view.sort.descending ? 'descending' : 'ascending') : 'none'}>
                <button type="button" disabled={busy} onClick={() => props.onView({ ...view, sort: { field: key, descending: view.sort?.field === key ? !view.sort.descending : false } })}>
                  {key}{view.units[key] ? ` (${view.units[key]})` : ''}
                </button>
              </th>)}<th scope="col">Source</th></tr></thead>
              <tbody>{inspected.rows.map(row => <tr key={row.row} aria-selected={selected.has(row.row - 1)}>
                <th scope="row"><label><Checkbox aria-label={`Select record ${row.row}`} checked={selected.has(row.row - 1)}
                  disabled={busy || (!selected.has(row.row - 1) && selected.size === 1000)}
                  onCheckedChange={checked => props.onView({ ...view, selection: checked ? [...view.selection, row.row - 1] : view.selection.filter(index => index !== row.row - 1) })} />{row.row}</label></th>
                {row.cells.map((cell, index) => <td key={inspected.columns[index]} data-kind={cell.kind}>{cell.kind === 'missing' || cell.kind === 'null' || cell.text === ''
                  ? <span className="data-missing">{cell.kind === 'missing' ? 'missing' : cell.kind === 'null' ? 'null' : 'empty'}</span> : cell.text}</td>)}
                <td><Button variant="ghost" disabled={busy} aria-label={`Show record source ${row.row}`} onClick={() => props.onRecord(row.row - 1)}>Source</Button></td>
              </tr>)}</tbody>
            </table>
          </div>
          {!inspected.rows.length ? <EmptyState heading="No matching records" description="Change the filter or open another version." /> : null}
          <DataForm className="data-filter" onSubmit={event => { event.preventDefault(); props.onSave(String(new FormData(event.currentTarget).get('viewName'))); }}>
            <Input aria-label="View name" name="viewName" placeholder="View name" required maxLength={120} disabled={busy} />
            <SubmitButton disabled={busy || loading || dataset.archived}>Save view</SubmitButton>
          </DataForm>
        </> : null}
      </TabsContent>
      <TabsContent value="fields">
        {fields ? <>
          {loading ? <p role="status">Updating inspection… Field statistics are from the last successful inspection of this version.</p> : null}
          <p className="data-note">Select up to {props.maxColumns} fields. Units are labels; values are not converted.</p>
          <Toolbar className="data-field-controls"><Input type="search" aria-label="Find fields" placeholder="Find fields" value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} /><p>{columns.length} / {props.maxColumns} displayed</p></Toolbar>
          <div className="data-rows-scroll" tabIndex={0}><table className="data-rows">
            <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Unit</th><th scope="col">Missing</th><th scope="col">Null</th><th scope="col">Empty</th></tr></thead>
            <tbody>{visibleFields.map(field => <tr key={field.name}>
              <th scope="row"><label><input type="checkbox" aria-label={`Show ${field.name}`} checked={columns.includes(field.name)}
                disabled={busy || (columns.includes(field.name) ? columns.length === 1 : columns.length >= props.maxColumns)}
                onChange={event => props.onView({ ...view, columns: event.target.checked ? [...columns, field.name] : columns.filter(item => item !== field.name) })} /> {field.name}</label></th>
              <td>{field.kinds.join(', ')}</td>
              <td><FieldUnit key={`${asset.id}:${field.name}`} field={field.name} unit={view.units[field.name] || ''} disabled={busy}
                onCommit={unit => props.onView({ ...view, units: { ...view.units, [field.name]: unit } })} /></td>
              <td>{field.missing}</td><td>{field.nulls}</td><td>{field.empty}</td>
            </tr>)}</tbody>
          </table></div>
        </> : <p className="data-note">Fields are available after a successful inspection.</p>}
      </TabsContent>
      <TabsContent value="chart" forceMount className="data-chart">
        {dataset.kind === 'model' || (result && result.status !== 'ok') ? <p className="data-note">This file is not a table. Nothing is charted or sent to the agent as rows.</p> : null}
        <ChartPanel data={chartData} busy={busy || loading} onActivate={() => props.onTab('chart')} aggregationControls={<>
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
            <dt>Missing fields</dt><dd>{formatInt(inspected.report.missing)}</dd>
            <dt>Explicit nulls</dt><dd>{formatInt(inspected.report.nulls)}</dd>
            <dt>Empty strings</dt><dd>{formatInt(inspected.report.empty)}</dd>
            <dt>Duplicate rows</dt><dd>{formatInt(inspected.report.duplicateRows)}</dd>
            <dt>Skipped blank lines</dt><dd>{formatInt(inspected.report.blankLines)}</dd>
            <dt>Parser</dt><dd>{inspected.report.parserVersion}</dd>
          </dl>
          <p className="data-note">Checks describe the input; they do not establish scientific validity. Duplicate rows have identical fields and exact value tokens.</p>
          {inspected.report.duplicates.length ? <div className="data-rows-scroll"><table className="data-rows">
            <thead><tr><th scope="col">Row</th><th scope="col">Duplicate of</th><th scope="col">Source line</th></tr></thead>
            <tbody>{inspected.report.duplicates.map(item => <tr key={item.row}><td>{item.row}</td><td>{item.duplicateOf}</td><td>{item.sourceLine ?? '—'}</td></tr>)}</tbody>
          </table></div> : null}
        </> : <p className="data-note">No current checks. Open Table for the file status.</p>}
      </TabsContent>
      <TabsContent value="history">
        <div className="data-history">{versions.map((version, index) => <section key={version.id}>
          <Button aria-pressed={version.id === asset.id} disabled={busy} onClick={() => props.onVersion(version.id)}>v{index + 1} / {version.name}</Button>
          <p className="data-note">{version.createdAt} / {availabilityLabel(version)}</p><code>{version.sha256}</code>
        </section>)}</div>
        <h3>Saved views</h3>
        {props.views.length ? props.views.map(saved => <section className="data-saved-view" key={saved.id}>
          <div className="data-actions"><Button disabled={busy} onClick={() => { props.onOpen(saved); props.onTab('table'); }}>{saved.name}</Button><Button onClick={() => props.onExport(saved)}>Export reference</Button></div>
          <p className="data-note">v{dataset.versions.indexOf(saved.assetId) + 1} / {saved.report.parserVersion} / {saved.report.rowCount} records / {saved.report.duplicateRows} duplicate rows</p>
          <p className="data-note">Saved report, not a claim about current file availability.</p>
        </section>) : <p className="data-note">No saved views.</p>}
        <div className="data-archive">
          {dataset.archived ? <Button disabled={busy} onClick={() => props.onEdit({ ...metadata, archived: false })}>Restore dataset</Button>
            : confirmArchive ? <><p>Hide this dataset? Original files and saved views remain; no disk space is freed.</p>
              <div className="data-actions"><Button disabled={busy} onClick={() => { props.onEdit({ ...metadata, archived: true }); setConfirmArchive(false); }}>Confirm archive</Button><Button onClick={() => setConfirmArchive(false)}>Cancel</Button></div></>
              : <Button disabled={busy} onClick={() => setConfirmArchive(true)}>Archive dataset</Button>}
        </div>
      </TabsContent>
    </Tabs>
    <footer className="data-workspace-footer">
      <div className="data-statusbar">
        <div className="data-counts">
          <span>{inspected ? `${inspected.rows.length ? inspected.offset + 1 : 0}–${inspected.offset + inspected.rows.length} / ${formatInt(inspected.matched)}` : formatInt(fields?.report.rowCount ?? 0)} records</span>
          <span>{fields?.report.fields.length ?? 0} fields</span>
          {view.filter && inspected ? <span>{formatInt(inspected.matched)} matching</span> : null}
          {view.selection.length > 0 ? <span>{view.selection.length} selected</span> : null}
        </div>
        {props.tab === 'table' && inspected ? <div className="data-pagination">
          {view.selection.length > 0 ? <Button variant="ghost" disabled={busy} onClick={() => props.onView({ ...view, selection: [] })}>Clear selection</Button> : null}
          <Button variant="ghost" disabled={busy || loading || inspected.offset === 0} onClick={() => props.onPage(Math.max(0, inspected.offset - 50))}>Previous</Button>
          <Button variant="ghost" disabled={busy || loading || inspected.nextOffset == null} onClick={() => props.onPage(inspected.nextOffset!)}>Next</Button>
        </div> : null}
      </div>
      <details className="data-provenance"><summary>Source details</summary>
        <p>Immutable source digest: <code>{asset.sha256}</code></p>
        <p>{formatInt(asset.size)} bytes</p>
        <p>Exports include all fields.</p>
      </details>
    </footer>
  </>;
}

function FieldUnit({ field, unit, disabled, onCommit }: { field: string; unit: string; disabled: boolean; onCommit(unit: string): void }) {
  const [draft, setDraft] = useState(unit);
  useEffect(() => { setDraft(unit); }, [unit]);
  return <Input aria-label={`Unit for ${field}`} value={draft} maxLength={60} disabled={disabled}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => { const next = draft.trim(); setDraft(next); if (next !== unit) onCommit(next); }} />;
}
