import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback, Icon, Select } from '@pero/app-sdk/ui';
import type { Api, Paper, PdfDocument } from './types';
import type { Translator } from './i18n';
import type { ResearchBundle } from './research-types';
import { PdfViewer, type ReaderChrome } from './pdf-reader';
import { ResearchSources, type SourceReceipt } from './research-sources';
import { SourceBrowser } from './research-source-browser';

type TexPreview = { id: string; archiveDigest: string; entryId: string; entryPath: string; engine: string; document: PdfDocument; diagnostics: string };
type TexSource = { bundleId: string; resourceId: string; revision: string; available: boolean; status: string; archiveDigest?: string; entries?: { id: string; path: string }[]; previews?: TexPreview[] };
type TexOverview = { sources: TexSource[]; engineAvailable: boolean };
type TexCompilation = { id: string; status: 'running' | 'complete' | 'failed'; error: string; preview: TexPreview | null };

export function TexReader({ api, paper, active, openToken, reloadToken = 0, chrome, t }: {
  api: Api; paper: Paper; active: boolean; openToken: number; reloadToken?: number; chrome: ReaderChrome; t: Translator;
}) {
  const { t: copy } = useAppI18n({
    files: { zh: '查看源码', en: 'View source files' }, close: { zh: '关闭源码', en: 'Close source files' },
    loading: { zh: '正在检查 TeX 源码…', en: 'Checking TeX source…' },
    compiling: { zh: '正在编译 TeX…首次运行需要下载排版依赖。', en: 'Compiling TeX… The first run downloads typesetting packages.' },
    retry: { zh: '重试编译', en: 'Retry compilation' }, compile: { zh: '编译预览', en: 'Compile preview' },
    main: { zh: '主文件', en: 'Main file' }, archive: { zh: '源码版本', en: 'Source version' },
    empty: { zh: '尚未下载这篇论文的 TeX 源码。', en: 'No TeX source has been downloaded for this paper.' },
    review: { zh: '获取 TeX 源码', en: 'Get TeX source' },
    engine: { zh: 'TeX 排版预览目前需要 macOS 和 Tectonic。', en: 'TeX previews currently require macOS and Tectonic.' },
    noMain: { zh: '未找到可编译的主文件，可查看源码。', en: 'No main TeX document was found. Inspect the source files.' },
    derived: { zh: '由 {file} 编译生成', en: 'Compiled from {file}' },
    warnings: { zh: '编译有警告，可在源码中查看', en: 'Compiler warnings; see source details' },
    diagnostics: { zh: '编译信息', en: 'Compilation details' },
  });
  const [overview, setOverview] = useState<TexOverview | null>(null), [source, setSource] = useState<TexSource | null>(null);
  const [entry, setEntry] = useState(''), [preview, setPreview] = useState<TexPreview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [compilation, setCompilation] = useState<TexCompilation | null>(null);
  const [filesOpen, setFilesOpen] = useState(false), [bundle, setBundle] = useState<ResearchBundle | null>(null), [receipt, setReceipt] = useState<SourceReceipt | null>(null);
  const mounted = useRef(true), loadedToken = useRef<number | null>(null), loadedReload = useRef(reloadToken);
  const endpoint = `/api/papers/${paper.id}/tex`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function compile(selected = source, main = entry) {
    if (!selected || !main) return;
    setBusy(true); setError('');
    try {
      const value = await api.post<TexCompilation>(endpoint, { bundleId: selected.bundleId, resourceId: selected.resourceId, entryId: main });
      if (mounted.current) { setCompilation(value); if (value.preview) setPreview(value.preview); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (compilation?.status !== 'running') return;
    const timer = setTimeout(() => {
      api.get<TexCompilation>(`/api/tex-compilations/${compilation.id}`).then(value => {
        if (!mounted.current) return;
        setCompilation(value);
        if (value.preview) setPreview(value.preview);
        if (value.error) setError(value.error);
      }, error => { if (mounted.current) { setError(error instanceof Error ? error.message : String(error)); setCompilation(null); } });
    }, 700);
    return () => clearTimeout(timer);
  }, [compilation, api]);
  async function load() {
    setBusy(true); setError('');
    try {
      const value = await api.get<TexOverview>(endpoint);
      if (!mounted.current) return;
      setOverview(value);
      const selected = value.sources.find(s => s.available) ?? value.sources[0] ?? null;
      setSource(selected); setBundle(null); setReceipt(null);
      const main = selected?.entries?.[0]?.id ?? '';
      setEntry(main);
      const cached = selected?.previews?.find(p => p.entryId === main);
      setPreview(cached ?? null);
      if (!cached && value.engineAvailable && selected?.available && selected.entries?.length === 1) await compile(selected, main);
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (!active || (loadedToken.current === openToken && loadedReload.current === reloadToken)) return;
    loadedToken.current = openToken; loadedReload.current = reloadToken; void load();
  }, [active, openToken, reloadToken]);
  async function files() {
    if (!source) return;
    setFilesOpen(true); setError('');
    try {
      const [saved, status] = await Promise.all([
        api.get<ResearchBundle>(`/api/research/bundles/${source.bundleId}`),
        api.post<{ receipt: SourceReceipt | null }>('/api/research/source', { operation: 'status', bundleId: source.bundleId, resourceId: source.resourceId }),
      ]);
      if (mounted.current) { setBundle(saved); setReceipt(status.receipt); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
  }
  const working = busy || compilation?.status === 'running';
  const controls = <div className="pa-tex-controls">{source && <Button className="pa-tex-files-action" variant="ghost" aria-label={copy('files')} title={copy('files')} onClick={() => void files()}><Icon name="file-code" size={14}/></Button>}</div>;
  return <div className="pa-tex-reader" aria-busy={working}>
    {active && !preview && (chrome.toolbar ? createPortal(controls, chrome.toolbar) : controls)}
    {working && <p className="pa-loading" role="status">{overview ? copy('compiling') : copy('loading')}</p>}
    {error && <Feedback kind="error"><div><p>{error}</p><Button disabled={busy} onClick={() => source && entry ? void compile() : void load()}>{copy('retry')}</Button></div></Feedback>}
    {!busy && overview && !overview.sources.length && <div className="pa-tex-empty"><p>{copy('empty')}</p><Button onClick={() => chrome.onSave('tex')}>{copy('review')}</Button></div>}
    {!busy && source && !source.available && <div className="pa-tex-empty"><p>{copy('empty')}</p><Button onClick={() => void files()}>{copy('review')}</Button></div>}
    {!working && !error && source?.available && !preview && <div className="pa-tex-empty">
      {!overview?.engineAvailable ? <p>{copy('engine')} <code>brew install tectonic</code></p> : !source.entries?.length ? <p>{copy('noMain')}</p> : <>
        <Select label={copy('main')} value={entry} onChange={setEntry} options={source.entries.map(f => ({ value: f.id, label: f.path }))}/><Button onClick={() => void compile()}>{copy('compile')}</Button>
      </>}
    </div>}
    {preview && <><PdfViewer key={preview.id} readOnly document={preview.document} fileUrl={`/api/tex-previews/${preview.id}/file`} annotations={[]} api={api} chrome={{ ...chrome, toolbar: active ? chrome.toolbar : null }} active={active} readLabel="Read" onText={() => {}} onSaved={() => {}} onMatrixAdded={async () => {}} trailingActions={controls} t={t}/><span className="pa-tex-provenance">{copy('derived', { file: preview.entryPath })}{preview.diagnostics.includes('warning:') && ` / ${copy('warnings')}`}</span></>}
    {filesOpen && <Dialog title={`${copy('files')} — ${source?.revision ?? ''}`} size="lg" className="pa-tex-source-dialog" closeLabel={copy('close')} onClose={() => setFilesOpen(false)}>
      {!bundle ? <p role="status">{copy('loading')}</p> : source?.available && receipt ? <><p className="pa-muted">{preview?.engine ?? 'TeX'} / {preview?.entryPath ?? source.entries?.find(f => f.id === entry)?.path}</p>{preview && <details className="pa-tex-diagnostics"><summary>{copy('diagnostics')}</summary><p>{preview.archiveDigest}</p><pre>{preview.diagnostics}</pre></details>}<SourceBrowser inspectionOnly initialMemberId={entry} api={api} bundle={bundle} resourceId={source.resourceId} receipt={receipt} onRead={() => {}}/></> : source && <ResearchSources api={api} bundle={bundle} startSourceIds={[]} scopedIds={[source.resourceId]} onRead={() => {}} onState={state => { if (state.available && !source.available) { setFilesOpen(false); void load(); } }}/>} 
    </Dialog>}
  </div>;
}
