import { useState } from 'react';
import { Button, EmptyState, Feedback, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import { availabilityLabel, formatBytes, formatInt, type Asset, type Dataset, type Inspection, type SavedView, type ViewSpec } from './model';

type Props = {
  dataset: Dataset; asset: Asset; assets: Asset[]; views: SavedView[]; result: Inspection | null;
  loading: boolean; busy: boolean; view: ViewSpec; maxColumns: number;
  onVersion(id: string): void; onView(value: ViewSpec): void; onPage(offset: number): void;
  onAddVersion(): void; onEdit(value: { name: string; projectRef: string; archived: boolean }): void;
  onSave(name: string): void; onOpen(view: SavedView): void; onExport(view: SavedView): void;
};

export function Preview(props: Props) {
  const { dataset, asset, result, view, loading, busy } = props;
  const [tab, setTab] = useState('preview');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const inspected = result?.status === 'ok' && result.assetId === asset.id ? result : null;
  const versions = dataset.versions.map(id => props.assets.find(a => a.id === id)!).filter(Boolean);
  const metadata = { name: dataset.name, projectRef: dataset.projectRef, archived: dataset.archived };
  return <>
    <header className="data-preview-head">
      <h2>{dataset.name}</h2>
      <div className="data-actions">
        <Select label="Version" value={asset.id} onChange={props.onVersion} disabled={busy}
          options={versions.map((version, index) => ({ value: version.id, label: `v${index + 1} — ${version.name}` }))} />
        <Button onClick={props.onAddVersion} disabled={busy || dataset.archived}>Add version</Button>
      </div>
      <p className="data-note">{formatBytes(asset.size)} / {asset.format.toUpperCase()} / {inspected ? 'Bytes matched' : result?.status === 'changed' ? 'Changed' : availabilityLabel(asset)}</p>
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
        <form className="data-form" key={`${dataset.id}:${dataset.name}:${dataset.projectRef}`} onSubmit={event => {
          event.preventDefault(); const values = new FormData(event.currentTarget);
          props.onEdit({ ...metadata, name: String(values.get('name')), projectRef: String(values.get('projectRef')) });
        }}>
          <label>Name<Input name="name" defaultValue={dataset.name} maxLength={200} required disabled={busy} /></label>
          <label>Project reference<Input name="projectRef" defaultValue={dataset.projectRef} maxLength={200} disabled={busy} /></label>
          <p className="data-note">A reference only, not a project permission boundary.</p>
          <Button type="submit" disabled={busy}>Save details</Button>
        </form>
      </details>
    </header>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label="Dataset details">
        <TabsTrigger value="preview">Preview</TabsTrigger><TabsTrigger value="fields">Fields</TabsTrigger>
        <TabsTrigger value="checks">Checks</TabsTrigger><TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="preview">
        {loading ? <p role="status">Reading this version…</p> : null}
        {!loading && result && result.assetId === asset.id && result.status !== 'ok' ? <Feedback kind="error">{result.message}</Feedback> : null}
        {inspected ? <>
          <form className="data-filter" key={`${asset.id}:${view.filterField}:${view.contains}`} onSubmit={event => {
            event.preventDefault(); const values = new FormData(event.currentTarget);
            const filterField = String(values.get('field'));
            props.onView({ ...view, filterField, contains: filterField ? String(values.get('contains')) : '' });
          }}>
            <Select name="field" label="Filter field" defaultValue={view.filterField} disabled={busy} onChange={() => {}}
              options={[{ value: '', label: 'No filter' }, ...inspected.report.fields.map(field => ({ value: field.name, label: field.name }))]} />
            <Input name="contains" aria-label="Contains" placeholder="Contains" defaultValue={view.contains} maxLength={300} disabled={busy} />
            <Button type="submit" disabled={busy || loading}>Apply</Button>
            {view.filterField ? <Button disabled={busy} onClick={() => props.onView({ ...view, filterField: '', contains: '' })}>Clear filter</Button> : null}
          </form>
          <p className="data-note">{formatInt(inspected.matched)} matching / {formatInt(inspected.report.rowCount)} records / {inspected.columns.length} / {inspected.report.fields.length} fields</p>
          <div className="data-rows-scroll" tabIndex={0} aria-label="Data records">
            <table className="data-rows">
              <thead><tr><th scope="col">Row</th>{inspected.columns.map(key => <th scope="col" key={key}>{key}{view.units[key] ? ` (${view.units[key]})` : ''}</th>)}</tr></thead>
              <tbody>{inspected.rows.map(row => <tr key={row.row}><th scope="row" title={row.line ? `Source line ${row.line}` : `JSON pointer ${row.pointer}`}>{row.row}</th>
                {row.cells.map((cell, index) => <td key={inspected.columns[index]}>{cell.kind === 'missing' || cell.kind === 'null' || cell.text === ''
                  ? <span className="data-missing">{cell.kind === 'missing' ? 'missing' : cell.kind === 'null' ? 'null' : 'empty'}</span>
                  : cell.text}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {!inspected.rows.length ? <EmptyState heading="No matching records" description="Change the filter or open another version." /> : null}
          <div className="data-actions">
            <Button onClick={() => props.onPage(Math.max(0, inspected.offset - 50))} disabled={busy || loading || inspected.offset === 0}>Previous</Button>
            <span>{inspected.rows.length ? `${inspected.offset + 1}–${inspected.offset + inspected.rows.length}` : '0'}</span>
            <Button onClick={() => props.onPage(inspected.nextOffset!)} disabled={busy || loading || inspected.nextOffset === null}>Next</Button>
          </div>
          <form className="data-filter" onSubmit={event => { event.preventDefault(); props.onSave(String(new FormData(event.currentTarget).get('viewName'))); }}>
            <Input aria-label="View name" name="viewName" placeholder="View name" required maxLength={120} disabled={busy} />
            <Button type="submit" disabled={busy || loading || dataset.archived}>Save view</Button>
          </form>
        </> : null}
      </TabsContent>
      <TabsContent value="fields">
        {inspected ? <>
          <p className="data-note">Select up to {props.maxColumns} fields. Units are labels; values are not converted.</p>
          <div className="data-rows-scroll" tabIndex={0}><table className="data-rows">
            <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Unit</th><th scope="col">Missing</th><th scope="col">Null</th><th scope="col">Empty</th></tr></thead>
            <tbody>{inspected.report.fields.map(field => <tr key={field.name}>
              <th scope="row"><label><input type="checkbox" aria-label={`Show ${field.name}`} checked={inspected.columns.includes(field.name)}
                disabled={busy || loading || (inspected.columns.includes(field.name) ? inspected.columns.length === 1 : inspected.columns.length >= props.maxColumns)}
                onChange={event => props.onView({ ...view, columns: event.target.checked ? [...inspected.columns, field.name] : inspected.columns.filter(c => c !== field.name) })} /> {field.name}</label></th>
              <td>{field.kinds.join(', ')}</td>
              <td><Input aria-label={`Unit for ${field.name}`} key={`${asset.id}:${field.name}:${view.units[field.name] || ''}`} defaultValue={view.units[field.name] || ''} maxLength={60} disabled={busy || loading}
                onBlur={event => { const unit = event.target.value.trim(); if (unit !== (view.units[field.name] || '')) props.onView({ ...view, units: { ...view.units, [field.name]: unit } }); }} /></td>
              <td>{field.missing}</td><td>{field.nulls}</td><td>{field.empty}</td>
            </tr>)}</tbody>
          </table></div>
        </> : <p className="data-note">Fields are available after a successful inspection.</p>}
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
          </table><p className="data-note">First {inspected.report.duplicates.length} duplicate examples. Row numbers refer to the original input.</p></div> : null}
        </> : <p className="data-note">No current checks. Open Preview for the file status.</p>}
      </TabsContent>
      <TabsContent value="history">
        <div className="data-history">{versions.map((version, index) => <section key={version.id}>
          <Button aria-pressed={version.id === asset.id} disabled={busy} onClick={() => props.onVersion(version.id)}>v{index + 1} / {version.name}</Button>
          <p className="data-note">{version.createdAt} / {availabilityLabel(version)}</p><code>{version.sha256}</code>
        </section>)}</div>
        <h3>Saved views</h3>
        {props.views.length ? props.views.map(saved => <section className="data-saved-view" key={saved.id}>
          <div className="data-actions"><Button disabled={busy} onClick={() => { props.onOpen(saved); setTab('preview'); }}>{saved.name}</Button><Button onClick={() => props.onExport(saved)}>Export reference</Button></div>
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
  </>;
}
