import React, { useEffect, useRef, useState } from 'react';
import { useAppChat, useAppContext, openPaperApp } from '@pero/app-sdk';
import { Disclosure, AppBar, Button, Feedback, FilePicker, Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@pero/app-sdk/ui';
import { assetFrom, inspect, type Asset } from './files';
import { files, saveFile, removeFile } from './store';
import { ResearchLab, researchLabAsset, type ResearchLabEntry } from './research-lab';
import { sequenceExamples } from './sequence-examples';
import { examples } from './examples';
import { Molecules, Structure } from './molecular';
import { PdfPreview } from './pdf-preview';
import { MolecularExplorer } from './explorer';
import { TablePreview } from './table-preview';
import { NotebookPreview } from './notebook-preview';
import { RichPreview } from './rich-preview';
import './styles.css';
class PreviewBoundary extends React.Component<{children: React.ReactNode}, {error: string}> {
  state = { error: '' }; static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <section className="preview-empty"><h2>Preview unavailable</h2><Feedback kind="error">{this.state.error}</Feedback><Button onClick={() => document.getElementById('viewer-file')?.focus()}>Choose another file</Button></section> : this.props.children; }
}
function Preview({ asset }: { asset: Asset }) {
  const { locale } = useAppContext();
  switch (inspect(asset.name, asset.mediaType)) {
    case 'table': return <TablePreview asset={asset} />;
    case 'structure': return <Structure asset={asset} />;
    case 'molecule': return <Molecules asset={asset} />;
    case 'pdf': return <PdfPreview source={asset} zh={locale === 'zh-CN'} readingOnly />;
    case 'notebook': return <NotebookPreview asset={asset} />;
    case 'json': return <section className="metadata-preview" aria-label="JSON preview"><h2>Metadata</h2><pre>{JSON.stringify(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes)), null, 2)}</pre></section>;
    case 'sequence': case 'mesh': case 'image': case 'code': case 'markdown': case 'html': case 'text': return <RichPreview source={{ ...asset, mediaType: asset.mediaType ?? '' }} provenance={asset.provenance} />;
    default: return <section className="preview-empty"><h2>Metadata only</h2><p className="muted">This format has no preview. Open Source details to inspect the file.</p></section>;
  }
}
export default function ScientificViewer() {
  const [assets, setAssets] = useState<Asset[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null), [removing, setRemoving] = useState(false);
  const [loading, setLoading] = useState(true), [importing, setImporting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const removeButton = useRef<HTMLElement>(null);
  const t = { molecules: 'Molecular illustrations', paper: 'Open Paper App', import: 'Import file', importing: 'Importing…', examples: 'Examples', file: 'Current file', source: 'Source details', unverified: 'Unverified', synthetic: 'Synthetic example, unverified', size: 'Size', origin: 'Source', license: 'License', discuss: 'Discuss metadata', remove: 'Remove local copy', removing: 'Removing…', cancel: 'Cancel', confirm: 'Confirm removal', loading: 'Loading files…', retry: 'Retry', limit: 'Up to 10 MiB per file', removal: (name: string) => `Remove “${name}” from this App? The original file is unchanged.` };
  const chat = useAppChat(); const asset = assets.find(item => item.id === selected);
  const refresh = async () => setAssets(await files());
  async function loadFiles() {
    setLoading(true); setLoadError('');
    try { await refresh(); } catch (error) { setLoadError(String(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadFiles(); }, []);
  async function importFile(file: File, metadata?: Parameters<typeof assetFrom>[1]) {
    setError(''); setImporting(true);
    try { const item = await assetFrom(file, metadata); await saveFile(item); await refresh(); setPendingRemoval(null); setSelected(item.id); }
    catch (error) { setError(String(error)); }
    finally { setImporting(false); }
  }
  async function openResearchModel(entry: ResearchLabEntry) {
    if (importing) return;
    setError(''); setImporting(true);
    try {
      const existing = assets.find(item => item.sha256 === entry.sha256 && item.provenance?.assetId === entry.id);
      const item = existing ?? await researchLabAsset(entry);
      if (!existing) { await saveFile(item); await refresh(); }
      setPendingRemoval(null); setSelected(item.id);
    } catch (error) { setError(String(error)); }
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
    <AppBar className="viewer-toolbar" aria-label="File actions" tools={<>
      <Select id="viewer-file" className="file-select" label={t.file} value={selected} disabled={loading || importing} onChange={value => { setPendingRemoval(null); setSelected(value); }} options={[{ value: '', label: t.molecules }, { value: 'research-lab', label: 'Research Lab' }, ...assets.map(item => ({ value: item.id, label: item.name }))]} />
      {asset && <Disclosure variant="inline" className="source-details" key={asset.id} summaryProps={{ 'aria-label': t.source, 'aria-describedby': 'source-status' }} summary={<><span id="source-status">{asset.synthetic ? t.synthetic : t.unverified}</span></>}>
        <div className="source-panel">
          <h2>{t.source}</h2><dl><dt>{t.size}</dt><dd>{asset.size.toLocaleString('en-US')} bytes</dd><dt>{t.origin}</dt><dd>{asset.source}</dd><dt>{t.license}</dt><dd>{asset.license}</dd><dt>SHA-256</dt><dd className="hash">{asset.sha256}</dd></dl>
          <div className="source-actions"><Button onClick={() => void chat.compose(`Inspect metadata for ${asset.name}. SHA-256 ${asset.sha256}; source: ${asset.source}; license: ${asset.license}. Unverified. File contents have not been shared.`).catch(error => setError(String(error)))}>{t.discuss}</Button>
            <Button ref={removeButton} disabled={removing} onClick={() => setPendingRemoval({ id: asset.id, name: asset.name })}>{t.remove}</Button></div>
          {pendingRemoval && <div className="removal-confirmation" role="group" aria-label="Confirm local copy removal" onKeyDown={event => { if (event.key === 'Escape' && !removing) { event.preventDefault(); setPendingRemoval(null); removeButton.current?.focus(); } }}>
            <p>{t.removal(pendingRemoval.name)}</p><div className="source-actions"><Button autoFocus disabled={removing} onClick={() => { setPendingRemoval(null); removeButton.current?.focus(); }}>{t.cancel}</Button>
              <Button variant="danger" disabled={removing} onClick={() => void confirmRemoval()}>{removing ? t.removing : t.confirm}</Button></div>
          </div>}
        </div></Disclosure>}
      </>} actions={<>
        <Button disabled={importing || loading} onClick={() => { setPendingRemoval(null); setSelected('research-lab'); }}>Research Lab</Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button disabled={importing}>{t.examples}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          {sequenceExamples.map(example => <DropdownMenuItem key={example.name} onSelect={() => void importFile(
            new File([example.text], example.name), { source: example.source, license: 'GenBank data usage policy' },
          )}>{example.name}</DropdownMenuItem>)}
          {examples.map(example => <DropdownMenuItem key={example.name} onSelect={() => void importFile(
            new File([example.text], example.name), { synthetic: true, source: 'Pero independently authored synthetic example', license: 'CC0-1.0' },
          )}>{example.name}</DropdownMenuItem>)}
        </DropdownMenuContent></DropdownMenu>
        <Button onClick={() => void openPaperApp().catch(error => setError(String(error)))}>{t.paper}</Button>
        <FilePicker compact variant="primary" title={t.limit} label={importing ? t.importing : t.import} emptyLabel="" busy={importing} onFile={file => void importFile(file)}/>
      </>}/>
    {loading && <p role="status">{t.loading}</p>}
    {loadError && <div className="viewer-error"><Feedback kind="error">{loadError}</Feedback><Button disabled={loading} onClick={() => void loadFiles()}>{t.retry}</Button></div>}
    {error && <div className="viewer-error"><Feedback kind="error">{error}</Feedback><Button onClick={() => setError('')}>Dismiss</Button></div>}
    <article className="viewer-content">{!loading && !loadError && (selected === 'research-lab' ? <ResearchLab busy={importing} onOpen={entry => void openResearchModel(entry)} /> : asset ? <PreviewBoundary key={asset.id}><Preview asset={asset} /></PreviewBoundary> : <MolecularExplorer />)}</article>
  </main>;
}
