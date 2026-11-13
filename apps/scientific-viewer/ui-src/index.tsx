import React, { useEffect, useRef, useState } from 'react';
import { useAppChat, useAppContext, openPaperApp } from '@pero/app-sdk';
import { Disclosure, AppBar, Button, ContentPane, ContentSection, EmptyState, Feedback, FilePicker, MetadataList, Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@pero/app-sdk/ui';
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
  render() { return this.state.error ? <PreviewError message={this.state.error} /> : this.props.children; }
}
function PreviewError({ message }: { message: string }) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  return <EmptyState heading={zh ? '无法预览' : 'Preview unavailable'} description={<Feedback kind="error">{message}</Feedback>} actions={<Button onClick={() => document.getElementById('viewer-file')?.focus()}>{zh ? '选择其他文件' : 'Choose another file'}</Button>} />;
}
function Preview({ asset }: { asset: Asset }) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  switch (inspect(asset.name, asset.mediaType)) {
    case 'table': return <TablePreview asset={asset} />;
    case 'structure': return <Structure asset={asset} />;
    case 'molecule': return <Molecules asset={asset} />;
    case 'pdf': return <PdfPreview source={asset} zh={locale === 'zh-CN'} readingOnly />;
    case 'notebook': return <NotebookPreview asset={asset} />;
    case 'json': return <ContentSection id="viewer-json" title={zh ? '元数据' : 'Metadata'}><pre className="metadata-preview">{JSON.stringify(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(asset.bytes)), null, 2)}</pre></ContentSection>;
    case 'sequence': case 'mesh': case 'image': case 'code': case 'markdown': case 'html': case 'text': return <RichPreview source={{ ...asset, mediaType: asset.mediaType ?? '' }} provenance={asset.provenance} />;
    default: return <EmptyState heading={zh ? '仅元数据' : 'Metadata only'} description={zh ? '此格式没有预览。打开来源可查看文件信息。' : 'This format has no preview. Open Source details to inspect the file.'} />;
  }
}
export default function ScientificViewer() {
  const [assets, setAssets] = useState<Asset[]>([]), [selected, setSelected] = useState(''), [error, setError] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null), [removing, setRemoving] = useState(false);
  const [loading, setLoading] = useState(true), [importing, setImporting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const removeButton = useRef<HTMLElement>(null);
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  const text = (en: string, zhText: string) => zh ? zhText : en;
  const t = { molecules: text('Molecular illustrations', '分子示意'), paper: text('Open Paper App', '打开论文'), import: text('Import file', '导入文件'), importing: text('Importing…', '正在导入…'), examples: text('Examples', '示例'), file: text('Current file', '当前文件'), source: text('Source details', '来源'), unverified: text('Unverified', '未核验'), synthetic: text('Synthetic example, unverified', '合成示例，未核验'), size: text('Size', '大小'), origin: text('Source', '来源'), license: text('License', '许可'), discuss: text('Discuss metadata', '讨论元数据'), remove: text('Remove local copy', '移除本地副本'), removing: text('Removing…', '正在移除…'), cancel: text('Cancel', '取消'), confirm: text('Confirm removal', '确认移除'), loading: text('Loading files…', '正在加载文件…'), retry: text('Retry', '重试'), limit: text('Up to 10 MiB per file', '每个文件最大 10 MiB'), researchLab: text('Research Lab', '研究实验室'), removal: (name: string) => zh ? `从本应用移除「${name}」？原始文件不会改变。` : `Remove “${name}” from this App? The original file is unchanged.` };
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
    <AppBar className="viewer-toolbar" aria-label="File actions" scope={<Select id="viewer-file" className="file-select" label={t.file} value={selected} disabled={loading || importing} onChange={value => { setPendingRemoval(null); setSelected(value); }} options={[{ value: '', label: t.molecules }, { value: 'research-lab', label: t.researchLab }, ...assets.map(item => ({ value: item.id, label: item.name }))]} />} tools={<>
      {asset && <Disclosure variant="inline" className="source-details" key={asset.id} summaryProps={{ 'aria-label': t.source, 'aria-describedby': 'source-status' }} summary={<><span id="source-status">{asset.synthetic ? t.synthetic : t.unverified}</span></>}>
        <div className="source-panel">
          <MetadataList layout="stacked" items={[
            { id: 'size', label: t.size, value: `${asset.size.toLocaleString('en-US')} bytes` },
            { id: 'origin', label: t.origin, value: asset.source },
            { id: 'license', label: t.license, value: asset.license },
            { id: 'sha', label: 'SHA-256', value: asset.sha256, format: 'code' },
          ]} />
          <div className="source-actions"><Button onClick={() => void chat.compose(`Inspect metadata for ${asset.name}. SHA-256 ${asset.sha256}; source: ${asset.source}; license: ${asset.license}. Unverified. File contents have not been shared.`).catch(error => setError(String(error)))}>{t.discuss}</Button>
            <Button ref={removeButton} disabled={removing} onClick={() => setPendingRemoval({ id: asset.id, name: asset.name })}>{t.remove}</Button></div>
          {pendingRemoval && <div className="removal-confirmation" role="group" aria-label="Confirm local copy removal" onKeyDown={event => { if (event.key === 'Escape' && !removing) { event.preventDefault(); setPendingRemoval(null); removeButton.current?.focus(); } }}>
            <p>{t.removal(pendingRemoval.name)}</p><div className="source-actions"><Button autoFocus disabled={removing} onClick={() => { setPendingRemoval(null); removeButton.current?.focus(); }}>{t.cancel}</Button>
              <Button variant="danger" disabled={removing} onClick={() => void confirmRemoval()}>{removing ? t.removing : t.confirm}</Button></div>
          </div>}
        </div></Disclosure>}
      </>} commands={<>
        <Button variant="ghost" disabled={importing || loading} onClick={() => { setPendingRemoval(null); setSelected('research-lab'); }}>{t.researchLab}</Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" disabled={importing}>{t.examples}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          {sequenceExamples.map(example => <DropdownMenuItem key={example.name} onSelect={() => void importFile(
            new File([example.text], example.name), { source: example.source, license: 'GenBank data usage policy' },
          )}>{example.name}</DropdownMenuItem>)}
          {examples.map(example => <DropdownMenuItem key={example.name} onSelect={() => void importFile(
            new File([example.text], example.name), { synthetic: true, source: 'Pero independently authored synthetic example', license: 'CC0-1.0' },
          )}>{example.name}</DropdownMenuItem>)}
        </DropdownMenuContent></DropdownMenu>
        <Button variant="ghost" onClick={() => void openPaperApp().catch(error => setError(String(error)))}>{t.paper}</Button>
      </>} primary={<FilePicker compact variant="primary" title={t.limit} label={importing ? t.importing : t.import} emptyLabel="" busy={importing} onFile={file => void importFile(file)}/>}/>
    {loading && <p role="status">{t.loading}</p>}
    {loadError && <div className="viewer-error"><Feedback kind="error">{loadError}</Feedback><Button disabled={loading} onClick={() => void loadFiles()}>{t.retry}</Button></div>}
    {error && <div className="viewer-error"><Feedback kind="error">{error}</Feedback><Button onClick={() => setError('')}>{text('Dismiss', '关闭')}</Button></div>}
    <article className="viewer-content"><ContentPane id="scientific-viewer-preview" label={asset?.name || 'Scientific Viewer'} as="div" surface="reading" inset="none" scroll="content">{!loading && !loadError && (selected === 'research-lab' ? <ResearchLab busy={importing} onOpen={entry => void openResearchModel(entry)} /> : asset ? <PreviewBoundary key={asset.id}><Preview asset={asset} /></PreviewBoundary> : <MolecularExplorer />)}</ContentPane></article>
  </main>;
}
