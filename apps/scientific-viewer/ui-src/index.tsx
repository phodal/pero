import React, { useEffect, useState } from 'react';
import { useAppChat, openPaperApp } from '@pero/app-sdk';
import { assetFrom, inspect, parseTable, spectrum, type Asset } from './files';
import { files, saveFile, removeFile } from './store';
import { examples } from './examples';
import { Molecules, Structure } from './molecular';
import { Literature } from './literature';
import './styles.css';
function TablePreview({ asset }: { asset: Asset }) {
  const [mode, setMode] = useState('table');
  const table = parseTable(new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes));
  const points = table.headers.length >= 2 ? spectrum(table) : [], valid = points.filter(point => point !== null);
  let path = '', connected = false;
  if (valid.length) {
    const xs = valid.map(p => p.x), ys = valid.map(p => p.y), xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    for (const point of points) { if (!point) { connected = false; continue; } path += `${connected ? 'L' : 'M'}${30 + (point.x - xmin) / (xmax - xmin || 1) * 640},${250 - (point.y - ymin) / (ymax - ymin || 1) * 220} `; connected = true; }
  }
  return <section><nav aria-label="Preview mode"><button onClick={() => setMode('table')} aria-pressed={mode === 'table'}>Table</button><button disabled={table.headers.length < 2} onClick={() => setMode('spectrum')} aria-pressed={mode === 'spectrum'}>Spectrum</button></nav>
    <p>{table.rows.length} rows · Missing values {table.missing}</p>
    {mode === 'table' ? <div className="table-scroll"><table><thead><tr>{table.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{table.rows.slice(0, 200).map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value || '—'}</td>)}</tr>)}</tbody></table><p>Showing up to 200 rows</p></div> : <><p>{table.headers[0]} / {table.headers[1]}</p>{valid.length ? <svg role="img" aria-label="Spectrum from first two columns" viewBox="0 0 700 280"><path d={path} fill="none" stroke="currentColor" strokeWidth="2" /></svg> : <p role="alert">No finite numeric pairs</p>}{points.some(p => !p) && <p role="alert">{points.filter(p => !p).length} missing or nonnumeric pairs; gaps are not interpolated.</p>}</>}
  </section>;
}
class PreviewBoundary extends React.Component<{children: React.ReactNode}, {error: string}> {
  state = { error: '' }; static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <p role="alert">Preview unavailable: {this.state.error}</p> : this.props.children; }
}
function Preview({ asset }: { asset: Asset }) {
  switch (inspect(asset.name)) {
    case 'table': return <TablePreview asset={asset} />;
    case 'structure': return <Structure asset={asset} />;
    case 'molecule': return <Molecules asset={asset} />;
    case 'pdf': return <Literature file={asset} />;
    case 'json': return <pre>{JSON.stringify(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes)), null, 2)}</pre>;
    default: return <p>Metadata only. This format is not previewed; model files are never executed.</p>;
  }
}
export default function ScientificViewer() {
  const [assets, setAssets] = useState<Asset[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState('');
  const chat = useAppChat(); const asset = assets.find(item => item.id === selected);
  const refresh = async () => setAssets(await files());
  useEffect(() => { void refresh().catch(error => setError(String(error))); }, []);
  async function importFile(file: File, synthetic = false) {
    setError('');
    try { const item = await assetFrom(file, synthetic ? { synthetic: true, source: 'Pero independently authored synthetic example', license: 'CC0-1.0' } : {}); await saveFile(item); await refresh(); setSelected(item.id); }
    catch (error) { setError(String(error)); }
  }
  return <main className="scientific-viewer"><header><h1>Scientific Viewer</h1><button onClick={() => void openPaperApp().catch(error => setError(String(error)))}>Open Paper App</button><label className="import">Import file<input aria-label="Import file" type="file" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} /></label>
    <select aria-label="Example" value="" onChange={event => { const example = examples.find(item => item.name === event.target.value); if (example) void importFile(new File([example.text], example.name), true); }}><option value="">Examples</option>{examples.map(item => <option key={item.name}>{item.name}</option>)}</select></header>
    <p className="muted">Local files · 10 MiB per file · Stored in this App profile · Unverified</p>{error && <p role="alert">{error}</p>}
    <div className="layout"><aside aria-label="Files">{assets.map(item => <button key={item.id} aria-current={item.id === selected} onClick={() => setSelected(item.id)}>{item.name}</button>)}{!assets.length && <p>Import a file or choose an example.</p>}</aside>
      <article>{asset && <><h2>{asset.name}</h2><dl><dt>Size</dt><dd>{asset.size} bytes</dd><dt>Source</dt><dd>{asset.source}</dd><dt>License</dt><dd>{asset.license}</dd><dt>SHA-256</dt><dd className="hash">{asset.sha256}</dd><dt>Status</dt><dd>{asset.synthetic ? 'Synthetic example · ' : ''}Unverified</dd></dl>
        <button onClick={() => void chat.compose(`Inspect metadata for ${asset.name}. SHA-256 ${asset.sha256}; source: ${asset.source}; license: ${asset.license}. Unverified. File contents have not been shared.`).catch(error => setError(String(error)))}>Discuss metadata</button>
        <button onClick={() => void removeFile(asset.id).then(() => { setSelected(''); return refresh(); }).catch(error => setError(String(error)))}>Remove local copy</button>
        <PreviewBoundary key={asset.id}><Preview asset={asset} /></PreviewBoundary></>}</article></div>
  </main>;
}
