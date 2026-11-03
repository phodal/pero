import React, { useEffect, useRef, useState } from 'react';
import { useAppChat, openPaperApp } from '@pero/app-sdk';
import { Icon } from '@pero/app-sdk/ui';
import { assetFrom, inspect, type Asset } from './files';
import { files, saveFile, removeFile } from './store';
import { examples } from './examples';
import { Molecules, Structure } from './molecular';
import { Literature } from './literature';
import { MolecularExplorer } from './explorer';
import { TablePreview } from './table-preview';
import './styles.css';
class PreviewBoundary extends React.Component<{children: React.ReactNode}, {error: string}> {
  state = { error: '' }; static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <section className="preview-empty"><h2>Preview unavailable</h2><p role="alert">{this.state.error}</p><button onClick={() => document.getElementById('viewer-file')?.focus()}>Choose another file</button></section> : this.props.children; }
}
function Preview({ asset }: { asset: Asset }) {
  switch (inspect(asset.name)) {
    case 'table': return <TablePreview asset={asset} />;
    case 'structure': return <Structure asset={asset} />;
    case 'molecule': return <Molecules asset={asset} />;
    case 'pdf': return <Literature file={asset} />;
    case 'json': return <section className="metadata-preview" aria-label="JSON preview"><h2>Metadata</h2><pre>{JSON.stringify(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes)), null, 2)}</pre></section>;
    default: return <section className="preview-empty"><h2>Metadata only</h2><p className="muted">This format has no preview. Open Source details to inspect the file.</p></section>;
  }
}
export default function ScientificViewer() {
  const [assets, setAssets] = useState<Asset[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null), [removing, setRemoving] = useState(false);
  const [loading, setLoading] = useState(true), [importing, setImporting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const input = useRef<HTMLInputElement>(null), removeButton = useRef<HTMLButtonElement>(null);
  const t = { molecules: 'Molecular illustrations', paper: 'Open Paper App', import: 'Import file', importing: 'Importing…', examples: 'Examples', file: 'Current file', source: 'Source details', unverified: 'Unverified', synthetic: 'Synthetic example, unverified', size: 'Size', origin: 'Source', license: 'License', discuss: 'Discuss metadata', remove: 'Remove local copy', removing: 'Removing…', cancel: 'Cancel', confirm: 'Confirm removal', loading: 'Loading files…', retry: 'Retry', limit: 'Up to 10 MiB per file', removal: (name: string) => `Remove “${name}” from this App? The original file is unchanged.` };
  const chat = useAppChat(); const asset = assets.find(item => item.id === selected);
  const refresh = async () => setAssets(await files());
  async function loadFiles() {
    setLoading(true); setLoadError('');
    try { await refresh(); } catch (error) { setLoadError(String(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadFiles(); }, []);
  async function importFile(file: File, synthetic = false) {
    setError(''); setImporting(true);
    try { const item = await assetFrom(file, synthetic ? { synthetic: true, source: 'Pero independently authored synthetic example', license: 'CC0-1.0' } : {}); await saveFile(item); await refresh(); setPendingRemoval(null); setSelected(item.id); }
    catch (error) { setError(String(error)); }
    finally { setImporting(false); }
  }
  async function confirmRemoval() {
    if (!pendingRemoval || removing) return;
    const { id } = pendingRemoval;
    setRemoving(true); setError('');
    try {
      await removeFile(id);
      setSelected(current => current === id ? '' : current);
      setPendingRemoval(null);
      await refresh();
    } catch (error) { setError(String(error)); }
    finally { setRemoving(false); }
  }
  return <main className="scientific-viewer"><h1 className="sr-only">Scientific Viewer</h1>
    <header className="viewer-toolbar">
      <select id="viewer-file" className="file-select" aria-label={t.file} value={selected} disabled={loading || importing} onChange={event => { setPendingRemoval(null); setSelected(event.target.value); }}>
        <option value="">{t.molecules}</option>{assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {asset && <details className="source-details" key={asset.id}>
        <summary aria-label={t.source} aria-describedby="source-status"><span id="source-status">{asset.synthetic ? t.synthetic : t.unverified}</span></summary><div className="source-panel">
          <h2>{t.source}</h2><dl><dt>{t.size}</dt><dd>{asset.size.toLocaleString('en-US')} bytes</dd><dt>{t.origin}</dt><dd>{asset.source}</dd><dt>{t.license}</dt><dd>{asset.license}</dd><dt>SHA-256</dt><dd className="hash">{asset.sha256}</dd></dl>
          <div className="source-actions"><button onClick={() => void chat.compose(`Inspect metadata for ${asset.name}. SHA-256 ${asset.sha256}; source: ${asset.source}; license: ${asset.license}. Unverified. File contents have not been shared.`).catch(error => setError(String(error)))}>{t.discuss}</button>
            <button ref={removeButton} disabled={removing} onClick={() => setPendingRemoval({ id: asset.id, name: asset.name })}>{t.remove}</button></div>
          {pendingRemoval && <div className="removal-confirmation" role="group" aria-label="Confirm local copy removal" onKeyDown={event => { if (event.key === 'Escape' && !removing) { event.preventDefault(); setPendingRemoval(null); removeButton.current?.focus(); } }}>
            <p>{t.removal(pendingRemoval.name)}</p><div className="source-actions"><button autoFocus disabled={removing} onClick={() => { setPendingRemoval(null); removeButton.current?.focus(); }}>{t.cancel}</button>
              <button className="button-danger" disabled={removing} onClick={() => void confirmRemoval()}>{removing ? t.removing : t.confirm}</button></div>
          </div>}
        </div></details>}
      <div className="viewer-actions"><select aria-label="Example" value="" disabled={importing} onChange={event => { const example = examples.find(item => item.name === event.target.value); if (example) void importFile(new File([example.text], example.name), true); }}><option value="">{t.examples}</option>{examples.map(item => <option key={item.name}>{item.name}</option>)}</select>
        <button onClick={() => void openPaperApp().catch(error => setError(String(error)))}>{t.paper}</button>
        <button className="button-primary" title={t.limit} disabled={importing} onClick={() => input.current?.click()}><Icon name="upload" size={14} />{importing ? t.importing : t.import}</button>
        <input ref={input} aria-label={t.import} type="file" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} />
      </div>
    </header>
    {loading && <p role="status">{t.loading}</p>}
    {loadError && <div className="viewer-error"><p role="alert">{loadError}</p><button disabled={loading} onClick={() => void loadFiles()}>{t.retry}</button></div>}
    {error && <div className="viewer-error"><p role="alert">{error}</p><button onClick={() => setError('')}>Dismiss</button></div>}
    <article className="viewer-content">{!loading && !loadError && (asset ? <PreviewBoundary key={asset.id}><Preview asset={asset} /></PreviewBoundary> : <MolecularExplorer />)}</article>
  </main>;
}
