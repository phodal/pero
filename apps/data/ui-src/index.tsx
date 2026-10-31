import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppApi } from '@pero/app-sdk';
import { fileContent, filterAssets, formatBytes, validateImport, type CatalogState, type Kind } from './catalog';
import './styles.css';

export default function Data() {
  const api = useAppApi();
  const [state, setState] = useState<CatalogState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [modal, setModal] = useState<'import' | 'sources' | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importKind, setImportKind] = useState<Kind>('dataset');
  const [importError, setImportError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const importForm = useRef<HTMLFormElement>(null);
  const importPending = useRef(false);
  const refresh = useCallback(async () => {
    try { setState(await api.get<CatalogState>('/api/state')); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load Data.'); }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (state?.download?.status !== 'running') return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!disposed) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [state?.download?.status, refresh]);
  useEffect(() => { if (modal) dialog.current?.showModal(); }, [modal]);
  const close = () => { dialog.current?.close(); setModal(null); setImportError(''); setFile(null); };
  async function action(path: string, body: unknown) {
    setBusy(true); setError('');
    try { setState(await api.post<CatalogState>(path, body)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); }
    finally { setBusy(false); }
  }
  async function importFile() {
    if (!file || busy || importPending.current || !importForm.current?.reportValidity()) return;
    importPending.current = true;
    setBusy(true); setImportError('');
    try {
      const next = await api.post<CatalogState>('/api/import', { name: file.name, kind: importKind, content: await fileContent(file) });
      setState(next); close();
    } catch (e) { setImportError(e instanceof Error ? e.message : 'Import failed.'); }
    finally { importPending.current = false; setBusy(false); }
  }
  const selected = state?.assets.find(asset => asset.id === selectedId);
  const assets = filterAssets(state?.assets ?? [], kind, query);
  const job = state?.download;
  const running = job?.status === 'running';
  return <main className="data-app">
    <header><h1>Data</h1><div className="actions"><button onClick={() => setModal('sources')}>Sources</button><button className="primary" onClick={() => setModal('import')}>Import</button></div></header>
    <section className="toolbar" aria-label="Catalog filters">
      <div className="filters" aria-label="Asset type">{(['all', 'dataset', 'model'] as const).map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'all' ? 'All' : value === 'dataset' ? 'Datasets' : 'Models'}</button>)}</div>
      <input type="search" aria-label="Search data and models" placeholder="Search data and models" value={query} onChange={event => setQuery(event.target.value)} />
    </section>
    {error && <div className="notice" role="alert">{error}<button onClick={() => void refresh()}>Retry</button></div>}
    {job && <div className="download" role="status"><span>{state?.sources.find(source => source.id === job.sourceId)?.name ?? 'Download'}: {job.status}</span>
      {running && <><progress value={job.received} max={job.total || 1} aria-label="Download progress" /><span>{formatBytes(job.received)} / {formatBytes(job.total)}</span><button disabled={busy} onClick={() => void action('/api/cancel', {})}>Cancel</button></>}
      {job.error && <span className="failure">{job.error}</span>}
    </div>}
    <div className={`workspace${selected ? ' with-detail' : ''}`}>
      <section className="catalog" aria-label="Data catalog">
        {!state ? <p className="empty" role="status">{error ? 'Catalog unavailable.' : 'Loading…'}</p> : assets.length === 0 ? <p className="empty">{state.assets.length ? 'No matches.' : 'No data yet. Import a file or browse Sources.'}</p> : <table><thead><tr><th>Name</th><th>Type</th><th>Source</th><th>Size</th><th>Status</th></tr></thead><tbody>{assets.map(asset => <tr key={asset.id} data-selected={selectedId === asset.id}><td><button className="name" aria-pressed={selectedId === asset.id} onClick={() => setSelectedId(asset.id)}>{asset.name}</button></td><td>{asset.kind === 'model' ? 'Model' : 'Dataset'}</td><td className="source-cell" title={asset.source}>{asset.source || 'Imported'}</td><td className="size">{formatBytes(asset.size)}</td><td>{asset.localAvailable ? 'Local' : 'Missing'}</td></tr>)}</tbody></table>}
      </section>
      {selected && <aside aria-label="Asset details"><div className="detail-heading"><h2>{selected.name}</h2><button aria-label="Close details" onClick={() => setSelectedId('')}>×</button></div><dl>
        {Object.entries({ Type: selected.kind === 'model' ? 'Model' : 'Dataset', Format: selected.format, Location: selected.location, Size: formatBytes(selected.size), Source: selected.source || 'Imported', Revision: selected.revision || 'Not specified', License: selected.license || 'Not specified', Added: selected.createdAt, Availability: selected.localAvailable ? 'Local' : 'Missing', SHA256: selected.sha256 }).map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}
      </dl>{selected.checksums.length > 0 && <details><summary>Source checksums</summary><dl>{selected.checksums.map((checksum, index) => <React.Fragment key={index}><dt>{checksum.algorithm}</dt><dd>{checksum.value}</dd><dd className="muted">{checksum.provenance}</dd></React.Fragment>)}</dl></details>}</aside>}
    </div>
    {modal && <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else close(); }} aria-labelledby="dialog-title"><div className="dialog-heading"><h2 id="dialog-title">{modal === 'import' ? 'Import file' : 'Sources'}</h2><button aria-label="Close" disabled={busy} onClick={close}>×</button></div>
      {modal === 'import' ? <form ref={importForm} onSubmit={event => event.preventDefault()}>
        <label>Type<select aria-label="Type" value={importKind} onChange={event => setImportKind(event.target.value as Kind)}><option value="dataset">Dataset</option><option value="model">Model</option></select></label>
        <label>File <span className="muted">Up to 10 MiB</span><input type="file" required onChange={event => { const candidate = event.target.files?.[0] ?? null; setFile(null); setImportError(''); if (candidate) { try { validateImport(candidate.size); setFile(candidate); } catch (e) { setImportError((e as Error).message); } } }} /></label>
        {importError && <p role="alert" className="failure">{importError}</p>}
        <div className="actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" type="button" onClick={() => void importFile()} disabled={!file || busy}>{busy ? 'Importing…' : 'Import'}</button></div>
      </form> : <><ul className="sources">{state?.sources.map(source => <li key={source.id}><div><h3>{source.name}</h3><p className="muted">{source.kind === 'model' ? 'Model' : 'Dataset'} / {formatBytes(source.size)} / {source.license || 'License not specified'}</p><a href={source.sourceUrl} target="_blank" rel="noreferrer">Source</a></div><button disabled={busy || running} onClick={async () => { close(); await action('/api/download', { sourceId: source.id }); }}>Download</button></li>)}</ul>{!state && <p>Sources unavailable. Close and retry loading the catalog.</p>}</>}
    </dialog>}
  </main>;
}
