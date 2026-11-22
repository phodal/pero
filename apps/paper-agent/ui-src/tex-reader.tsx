import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppI18n } from '@pero/app-sdk';
import { Disclosure, Button, Dialog, Feedback, Icon, Select } from '@pero/app-sdk/ui';
import type { Api, Paper, PdfDocument, PdfSource, PdfFocus, SourceFocus, ReaderLocation } from './types';
import type { Translator } from './i18n';
import type { ResearchBundle } from './research-types';
import { PdfViewer, type ReaderChrome } from './pdf-reader';
import { ResearchSources, type SourceReceipt } from './research-sources';
import { SourceBrowser } from './research-source-browser';

type TexPreview = { id: string; archiveDigest: string; entryId: string; entryPath: string; engine: string; document: PdfDocument; diagnostics: string; sourceMapDigest?: string | null };
type TexSource = { bundleId: string; resourceId: string; revision: string; available: boolean; status: string; archiveDigest?: string; entries?: { id: string; path: string }[]; previews?: TexPreview[] };
type TexOverview = { sources: TexSource[]; engineAvailable: boolean; sourceNavigationAvailable: boolean };
type TexCompilation = { id: string; status: 'running' | 'complete' | 'failed'; error: string; errorCode?: string | null; diagnostics?: string; preview: TexPreview | null };

export function TexReader({ api, paper, active, openToken, reloadToken = 0, chrome, t, onDiscuss }: {
  api: Api; paper: Paper; active: boolean; openToken: number; reloadToken?: number; chrome: ReaderChrome; t: Translator; onDiscuss?(text: string, source?: PdfSource): void;
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
    failure: { zh: 'TeX 编译失败', en: 'TeX compilation failed' },
    loadFailed: { zh: '无法读取 TeX 源码信息', en: 'Could not load TeX source information' },
    reload: { zh: '重新加载', en: 'Reload' },
    compilationLog: { zh: '查看编译日志', en: 'View compilation log' },
    biberUnavailable: { zh: '这篇论文的参考文献需要可运行的 Biber。请安装与 Tectonic 所用 BibLaTeX 兼容的版本，再重试编译。', en: 'This paper needs Biber to build its bibliography. Install a Biber version compatible with Tectonic’s BibLaTeX and retry.' },
    biberVersion: { zh: 'Biber 与当前 BibLaTeX 版本不匹配。请查看日志中的版本信息。', en: 'Biber does not match the current BibLaTeX version. Check the versions in the log.' },
    timedOut: { zh: '编译超过 180 秒。可重试编译，或查看源码和日志。', en: 'Compilation exceeded 180 seconds. Retry or review the source and log.' },
    retained: { zh: '下方仍显示上次生成的预览。', en: 'The previous preview is still shown below.' },
    rebuild: { zh: '重新编译以启用源码定位', en: 'Recompile to enable source navigation' },
    navigation: { zh: '点击行号定位排版；⌘/Ctrl 点击排版正文查看对应源码。', en: 'Click a line number to reveal its typeset position; ⌘/Ctrl-click the preview to inspect its source.' },
    missingNavigation: { zh: '源码定位需要 SyncTeX，当前可继续查看源码。', en: 'Source navigation requires SyncTeX. Source files remain readable.' },
  });
  const [overview, setOverview] = useState<TexOverview | null>(null), [source, setSource] = useState<TexSource | null>(null);
  const [entry, setEntry] = useState(''), [preview, setPreview] = useState<TexPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<{ action: 'load' | 'compile'; message: string } | null>(null);
  const [compilation, setCompilation] = useState<TexCompilation | null>(null);
  const [filesOpen, setFilesOpen] = useState(false), [bundle, setBundle] = useState<ResearchBundle | null>(null), [receipt, setReceipt] = useState<SourceReceipt | null>(null);
  const [filesError, setFilesError] = useState('');
  const [sourceFocus, setSourceFocus] = useState<SourceFocus | null>(null), [sourceAnchor, setSourceAnchor] = useState<PdfFocus | null>(null), [navigationError, setNavigationError] = useState('');
  const currentPage = useRef(1);
  const reportLocation = useCallback((value: ReaderLocation) => { if ('page' in value) currentPage.current = value.page; chrome.onLocation?.(value); }, [chrome.onLocation]);
  const mounted = useRef(true), loadedToken = useRef<number | null>(null), loadedReload = useRef(reloadToken), loadedFigure = useRef<number | undefined>(undefined);
  const endpoint = `/api/papers/${paper.id}/tex`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function compile(selected = source, main = entry) {
    if (!selected || !main) return;
    setBusy(true); setRequestError(null); setCompilation(null);
    try {
      const value = await api.post<TexCompilation>(endpoint, { bundleId: selected.bundleId, resourceId: selected.resourceId, entryId: main });
      if (mounted.current) { setCompilation(value); if (value.preview) setPreview(value.preview); }
    } catch (error) { if (mounted.current) setRequestError({ action: 'compile', message: error instanceof Error ? error.message : String(error) }); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (compilation?.status !== 'running') return;
    const timer = setTimeout(() => {
      api.get<TexCompilation>(`/api/tex-compilations/${compilation.id}`).then(value => {
        if (!mounted.current) return;
        setCompilation(value);
        if (value.preview) setPreview(value.preview);
      }, error => { if (mounted.current) { setRequestError({ action: 'compile', message: error instanceof Error ? error.message : String(error) }); setCompilation(null); } });
    }, 700);
    return () => clearTimeout(timer);
  }, [compilation, api]);
  async function load() {
    setBusy(true); setRequestError(null); setCompilation(null);
    try {
      const value = await api.get<TexOverview>(endpoint);
      if (!mounted.current) return;
      setOverview(value);
      const target = chrome.figure;
      const selected = (target && value.sources.find(s => s.bundleId === target.bundleId && s.resourceId === target.resourceId)) ?? value.sources.find(s => s.available) ?? value.sources[0] ?? null;
      setSource(selected); setBundle(null); setReceipt(null);
      const referenced = target?.preview && selected?.previews?.find(p => p.id === target.preview!.previewId);
      const main = referenced?.entryId ?? selected?.entries?.[0]?.id ?? '';
      setEntry(main);
      const cached = referenced ?? selected?.previews?.find(p => p.entryId === main);
      setPreview(cached ?? null);
      if (!cached && value.engineAvailable && selected?.available && selected.entries?.length === 1) await compile(selected, main);
    } catch (error) { if (mounted.current) setRequestError({ action: 'load', message: error instanceof Error ? error.message : String(error) }); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (!active || (loadedToken.current === openToken && loadedReload.current === reloadToken && loadedFigure.current === chrome.figure?.token)) return;
    loadedToken.current = openToken; loadedReload.current = reloadToken; loadedFigure.current = chrome.figure?.token; void load();
  }, [active, openToken, reloadToken, chrome.figure?.token]);
  async function files(focus?: SourceFocus) {
    if (!source) return;
    setFilesOpen(true); setFilesError(''); setNavigationError('');
    const figure = chrome.figure?.figures.length === 1 ? chrome.figure.figures[0] : null;
    setSourceFocus(focus ?? (figure ? { memberId: figure.texMemberId, line: figure.startLine } : null));
    try {
      const [saved, status] = await Promise.all([
        api.get<ResearchBundle>(`/api/research/bundles/${source.bundleId}`),
        api.post<{ receipt: SourceReceipt | null }>('/api/research/source', { operation: 'status', bundleId: source.bundleId, resourceId: source.resourceId }),
      ]);
      if (mounted.current) { setBundle(saved); setReceipt(status.receipt); }
    } catch (error) { if (mounted.current) setFilesError(error instanceof Error ? error.message : String(error)); }
  }
  async function revealSource(page: number, x: number, y: number) {
    if (!preview) return;
    setNavigationError('');
    try { await files(await api.post<SourceFocus>(`/api/tex-previews/${preview.id}/locate`, { page, x, y })); }
    catch (error) { setNavigationError(error instanceof Error ? error.message : String(error)); }
  }
  async function revealPreview(focus: SourceFocus) {
    if (!preview) return;
    const value = await api.post<{ anchor: PdfFocus }>(`/api/tex-previews/${preview.id}/locate`, { memberId: focus.memberId, line: focus.line });
    setSourceFocus(focus); setSourceAnchor(value.anchor); setFilesOpen(false);
  }
  const working = busy || compilation?.status === 'running';
  const failedCompilation = compilation?.status === 'failed' ? compilation : null;
  const failure = requestError?.message ?? (failedCompilation && (
    failedCompilation.errorCode === 'biber_unavailable' ? copy('biberUnavailable') :
    failedCompilation.errorCode === 'biber_version' ? copy('biberVersion') :
    failedCompilation.errorCode === 'timeout' ? copy('timedOut') : failedCompilation.error
  ));
  const reload = requestError?.action === 'load';
  const mainPath = source?.entries?.find(file => file.id === entry)?.path;
  const mainPicker = source?.entries && source.entries.length > 1 &&
    <Select label={copy('main')} value={entry} onChange={value => { setEntry(value); setCompilation(null); setRequestError(null); }}
      options={source.entries.map(file => ({ value: file.id, label: file.path }))}/>;
  const figureFocus = useMemo(() => {
    const target = chrome.figure?.preview;
    return preview && target?.previewId === preview.id ? { documentId: preview.document.id, page: target.page, rects: target.rects } : null;
  }, [chrome.figure?.token, preview?.id]);
  useEffect(() => { setSourceAnchor(null); }, [chrome.figure?.token, preview?.id]);
  const controls = <div className="pa-tex-controls">{source && <Button className="pa-tex-files-action" variant="ghost" aria-label={copy('files')} title={copy('files')} onClick={() => overview?.sourceNavigationAvailable && preview?.sourceMapDigest && !chrome.figure
    ? void revealSource(currentPage.current, 0.5, 0.5) : void files()}><Icon name="file-code" size={14}/></Button>}</div>;
  return <div className="pa-tex-reader" aria-busy={working}>
    {active && !preview && (chrome.toolbar ? createPortal(controls, chrome.toolbar) : controls)}
    {working && <p className="pa-loading" role="status">{overview ? copy('compiling') : copy('loading')}</p>}
    {!working && failure && <div className="pa-tex-failure-region" data-retained={!!preview}>
      <section className="pa-tex-failure">
        <Feedback kind="error" variant="block">
          <h2>{copy(reload ? 'loadFailed' : 'failure')}</h2>
          <p>{failure}</p>
        </Feedback>
        {!reload && ((!preview && mainPicker) || (mainPath && <p className="pa-muted">{copy('main')} <code>{mainPath}</code></p>))}
        {preview && <p className="pa-muted">{copy('retained')}</p>}
        <div className="pa-actions">
          <Button variant="primary" onClick={() => reload ? void load() : void compile()}>{copy(reload ? 'reload' : 'retry')}</Button>
          {source && <Button onClick={() => void files()}>{copy('files')}</Button>}
        </div>
        {failedCompilation?.diagnostics && <Disclosure variant="inline" summary={copy('compilationLog')}>
          <pre className="pa-tex-log" tabIndex={0} aria-label={copy('compilationLog')}>{failedCompilation.diagnostics}</pre>
        </Disclosure>}
      </section>
    </div>}
    {navigationError && <Feedback kind="error"><span>{navigationError}</span><Button variant="ghost" onClick={() => setNavigationError('')}>{t('dismiss')}</Button></Feedback>}
    {!busy && overview && !overview.sources.length && <div className="pa-tex-empty"><p>{copy('empty')}</p><Button onClick={() => chrome.onSave('tex')}>{copy('review')}</Button></div>}
    {!busy && source && !source.available && <div className="pa-tex-empty"><p>{copy('empty')}</p><Button onClick={() => void files()}>{copy('review')}</Button></div>}
    {!working && !failure && source?.available && !preview && <div className="pa-tex-empty">
      {!overview?.engineAvailable ? <p>{copy('engine')} <code>brew install tectonic</code></p> : !source.entries?.length ? <p>{copy('noMain')}</p> : <>
        {mainPicker}<Button onClick={() => void compile()}>{copy('compile')}</Button>
      </>}
    </div>}
    {preview && <><PdfViewer key={preview.id} focus={sourceAnchor ?? figureFocus} readOnly onDiscuss={onDiscuss} document={preview.document} fileUrl={`/api/tex-previews/${preview.id}/file`} annotations={[]} api={api} chrome={{ ...chrome, texPreviewId: preview.id, onLocation: reportLocation,
      onSourcePoint: overview?.sourceNavigationAvailable && preview.sourceMapDigest ? (page, x, y) => void revealSource(page, x, y) : undefined, toolbar: active ? chrome.toolbar : null }} active={active} readLabel="Read" onText={() => {}} onSaved={() => {}} onMatrixAdded={async () => {}} trailingActions={controls} t={t}/><span className="pa-tex-provenance">{copy('derived', { file: preview.entryPath })}{preview.diagnostics.includes('warning:') && ` / ${copy('warnings')}`}</span></>}
    {filesOpen && <Dialog title={`${copy('files')} — ${source?.revision ?? ''}`} size="lg" className="pa-tex-source-dialog" closeLabel={copy('close')} onClose={() => setFilesOpen(false)}>
      {filesError ? <Feedback kind="error" variant="block">{filesError}<Button onClick={() => void files(sourceFocus ?? undefined)}>{copy('reload')}</Button></Feedback> : !bundle ? <p role="status">{copy('loading')}</p> : source?.available && receipt ? <><p className="pa-muted">{preview?.engine ?? 'TeX'} / {preview?.entryPath ?? mainPath}</p>{preview && <Disclosure variant="inline" className="pa-tex-diagnostics" summary={copy('diagnostics')}><p>{preview.archiveDigest}</p><pre className="pa-tex-log" tabIndex={0} aria-label={copy('diagnostics')}>{preview.diagnostics}</pre></Disclosure>}{!preview?.sourceMapDigest && overview?.engineAvailable && <Button disabled={working} onClick={() => { setFilesOpen(false); void compile(); }}>{copy('rebuild')}</Button>}
        {overview?.sourceNavigationAvailable && preview?.sourceMapDigest ? <p className="pa-muted">{copy('navigation')}</p> : !overview?.sourceNavigationAvailable && <p className="pa-muted">{copy('missingNavigation')}</p>}
        <SourceBrowser inspectionOnly initialFocus={sourceFocus} initialMemberId={entry} onPreview={overview?.sourceNavigationAvailable && preview?.sourceMapDigest ? revealPreview : undefined} api={api} bundle={bundle} resourceId={source.resourceId} receipt={receipt} onRead={() => {}}/></> : source && <ResearchSources api={api} bundle={bundle} startSourceIds={[]} scopedIds={[source.resourceId]} onRead={() => {}} onState={state => { if (state.available && !source.available) { setFilesOpen(false); void load(); } }}/>}
    </Dialog>}
  </div>;
}
