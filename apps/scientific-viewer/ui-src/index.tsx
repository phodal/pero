import React, { useEffect, useRef, useState } from 'react';
import { useAppChat, useAppContext, openPaperApp } from '@pero/app-sdk';
import { assetFrom, inspect, parseTable, spectrum, type Asset } from './files';
import { files, saveFile, removeFile } from './store';
import { examples } from './examples';
import { Molecules, Structure } from './molecular';
import { Literature } from './literature';
import { MolecularExplorer } from './explorer';
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
    <p>{table.rows.length} rows, {table.missing} missing</p>
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
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null), [removing, setRemoving] = useState(false);
  const [loading, setLoading] = useState(true), [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null), removeButton = useRef<HTMLButtonElement>(null), { locale } = useAppContext();
  const t = locale === 'zh-CN'
    ? { molecules: '分子示例', paper: '打开论文', import: '导入文件', importing: '正在导入…', examples: '其他示例', file: '当前文件', source: '来源详情', unverified: '未核验', synthetic: '合成示例，未核验', size: '大小', origin: '来源', license: '许可', discuss: '讨论来源', remove: '移除本地副本', removing: '正在移除…', cancel: '取消', confirm: '确认移除', loading: '正在读取文件…', retry: '重试', limit: '每个文件最大 10 MiB', removal: (name: string) => `移除“${name}”的 App 副本？原文件保留。` }
    : { molecules: 'Molecules', paper: 'Open Paper App', import: 'Import file', importing: 'Importing…', examples: 'Other examples', file: 'Current file', source: 'Source details', unverified: 'Unverified', synthetic: 'Synthetic example, unverified', size: 'Size', origin: 'Source', license: 'License', discuss: 'Discuss metadata', remove: 'Remove local copy', removing: 'Removing…', cancel: 'Cancel', confirm: 'Confirm removal', loading: 'Loading files…', retry: 'Retry', limit: 'Up to 10 MiB per file', removal: (name: string) => `Remove “${name}” from this App? The original file is unchanged.` };
  const chat = useAppChat(); const asset = assets.find(item => item.id === selected);
  const refresh = async () => setAssets(await files());
  useEffect(() => { void refresh().catch(error => setError(String(error))).finally(() => setLoading(false)); }, []);
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
      <select className="file-select" aria-label={t.file} value={selected} disabled={loading || importing} onChange={event => { setPendingRemoval(null); setSelected(event.target.value); }}>
        <option value="">{t.molecules}</option>{assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {asset && <details className="source-details" key={asset.id}>
        <summary aria-label={t.source} aria-describedby="source-status"><span id="source-status">{asset.synthetic ? t.synthetic : t.unverified}</span></summary><div className="source-panel">
          <dl><dt>{t.size}</dt><dd>{asset.size} bytes</dd><dt>{t.origin}</dt><dd>{asset.source}</dd><dt>{t.license}</dt><dd>{asset.license}</dd><dt>SHA-256</dt><dd className="hash">{asset.sha256}</dd></dl>
          <div className="source-actions"><button onClick={() => void chat.compose(`Inspect metadata for ${asset.name}. SHA-256 ${asset.sha256}; source: ${asset.source}; license: ${asset.license}. Unverified. File contents have not been shared.`).catch(error => setError(String(error)))}>{t.discuss}</button>
            <button ref={removeButton} disabled={removing} onClick={() => setPendingRemoval({ id: asset.id, name: asset.name })}>{t.remove}</button></div>
          {pendingRemoval && <div role="group" aria-label="Confirm local copy removal" onKeyDown={event => { if (event.key === 'Escape' && !removing) { event.preventDefault(); setPendingRemoval(null); removeButton.current?.focus(); } }}>
            <p>{t.removal(pendingRemoval.name)}</p><div className="source-actions"><button autoFocus disabled={removing} onClick={() => { setPendingRemoval(null); removeButton.current?.focus(); }}>{t.cancel}</button>
              <button disabled={removing} onClick={() => void confirmRemoval()}>{removing ? t.removing : t.confirm}</button></div>
          </div>}
        </div></details>}
      <div className="viewer-actions"><select aria-label="Example" value="" disabled={importing} onChange={event => { const example = examples.find(item => item.name === event.target.value); if (example) void importFile(new File([example.text], example.name), true); }}><option value="">{t.examples}</option>{examples.map(item => <option key={item.name}>{item.name}</option>)}</select>
        <button onClick={() => void openPaperApp().catch(error => setError(String(error)))}>{t.paper}</button>
        <button title={t.limit} disabled={importing} onClick={() => input.current?.click()}>{importing ? t.importing : t.import}</button>
        <input ref={input} aria-label={t.import} type="file" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} />
      </div>
    </header>
    {loading && <p role="status">{t.loading}</p>}
    {error && <div className="viewer-error"><p role="alert">{error}</p><button onClick={() => { setError(''); void refresh().catch(error => setError(String(error))); }}>{t.retry}</button></div>}
    <article className="viewer-content">{asset ? <PreviewBoundary key={asset.id}><Preview asset={asset} /></PreviewBoundary> : <MolecularExplorer />}</article>
  </main>;
}
