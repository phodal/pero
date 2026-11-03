import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Feedback, Icon, Input, Popover, Toolbar } from '@pero/app-sdk/ui';
import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF, useStoreState } from '@embedpdf/core/react';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { DocumentContent, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react';
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { Scroller, ScrollPluginPackage, useScroll, useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react';
import { PagePointerProvider, InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager/react';
import { SelectionLayer, SelectionPluginPackage, useSelectionCapability, type SelectionState } from '@embedpdf/plugin-selection/react';
import { ZoomPluginPackage, ZoomMode, useZoom } from '@embedpdf/plugin-zoom/react';
import { CapturePluginPackage, MarqueeCapture, useCapture } from '@embedpdf/plugin-capture/react';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm';
import type { Api, Paper, PdfAnnotation, PdfDocument, PdfFocus, PdfReading, PdfSource } from './types';
import type { Translator } from './i18n';
import { Reproduction, reproductionPolicy } from './reproduction';
import { loadReaderState, saveReaderState, type PdfReaderState } from './reader-state';
import { TexReader } from './tex-reader';

type ReadingView = 'text' | 'pdf' | 'tex' | 'original';

export type ReaderChrome = { toolbar: HTMLElement | null; preserveView: React.MutableRefObject<(() => void) | null>; onNavigate(): void; onSave(): void; back?: () => void };

export function PdfReader({ paper, api, focus, lockText, t, onDiscuss, onMatrixAdded, children, chrome, readLabel, readRequest = 0, pdfReloadToken = 0, sourceUrl, openToken = 0 }: {
  paper: Paper; api: Api; focus?: PdfFocus | null; lockText?: boolean; t: Translator; children: React.ReactNode; chrome: ReaderChrome; readLabel?: string; readRequest?: number; pdfReloadToken?: number;
  onDiscuss?(text: string, source?: PdfSource): void;
  onMatrixAdded(): Promise<void>;
  sourceUrl?: string; openToken?: number;
}) {
  const [reading, setReading] = useState<PdfReading>({ document: null, annotations: [] });
  const pdfLoadEpoch = useRef(0);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [mode, setMode] = useState<ReadingView>('text'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [visitedTex, setVisitedTex] = useState(false);
  useEffect(() => {
    if (lockText) return;
    if (focus && reading.document?.id === focus.documentId) return;
    let alive = true; const version = ++pdfLoadEpoch.current;
    setReading({ document: null, annotations: [] }); setMode('text'); setError('');
    setBusy(!!paper.pdfUrl);
    api.get<PdfReading>(focus ? `/api/pdf/${focus.documentId}` : `/api/pdf?paperId=${paper.id}`).then(value => {
      if (alive && version === pdfLoadEpoch.current) { setReading(value); if (value.document) setMode(focus ? 'pdf' : loadReaderState(value.document)?.mode ?? 'pdf'); }
    }).catch(e => { if (alive && version === pdfLoadEpoch.current) setError(String(e.message ?? e)); }).finally(() => { if (alive && version === pdfLoadEpoch.current) setBusy(false); });
    return () => { alive = false; };
  }, [api, paper.id, focus?.documentId, lockText, lookupAttempt]);
  // Export may attach a PDF to a metadata paper. Refresh that missing document
  // only; existing PDF/Read views and annotations keep their mounted owners.
  const seenPdfReload = useRef(pdfReloadToken);
  useEffect(() => {
    if (lockText || seenPdfReload.current === pdfReloadToken) return;
    seenPdfReload.current = pdfReloadToken;
    if (focus || reading.document) return;
    let alive = true; const version = ++pdfLoadEpoch.current;
    api.get<PdfReading>(`/api/pdf?paperId=${paper.id}`).then(value => {
      if (!alive || version !== pdfLoadEpoch.current || !value.document) return;
      setReading(value); setMode(loadReaderState(value.document)?.mode ?? 'pdf');
    }).catch(error => { if (alive && version === pdfLoadEpoch.current) setError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (alive && version === pdfLoadEpoch.current) setBusy(false); });
    return () => { alive = false; };
  }, [api, paper.id, pdfReloadToken, lockText, reading.document, focus?.documentId]);
  useEffect(() => { if (lockText) setMode('text'); else if (focus) setMode('pdf'); }, [focus, lockText]);
  useEffect(() => { if (readRequest) setMode('text'); }, [readRequest]);
  const view = lockText ? 'text' : mode;
  const textLabel = readLabel ?? 'Read';
  const originalUrl = sourceUrl ?? paper.fullTextUrl ?? paper.metadataUrl ?? (paper.source === 'local-pdf' ? reading.originalUrl ?? reading.document?.sourceUrl : paper.url);
  const modes = <div className="pa-reader-modes" role="group" aria-label={t('readerView')}>
    <Button variant="ghost" aria-pressed={view === 'text'} onClick={() => { setMode('text'); setError(''); }}>{textLabel}</Button>
    <Button variant="ghost" aria-pressed={view === 'pdf'} disabled={!paper.pdfUrl && !reading.document} onClick={() => void open()}>PDF</Button>
    <Button variant="ghost" aria-pressed={view === 'tex'} onClick={() => { setVisitedTex(true); setMode('tex'); }}>TeX</Button>
    <Button variant="ghost" aria-pressed={view === 'original'} title={originalUrl} disabled={!originalUrl?.startsWith('https://')} onClick={() => setMode('original')}>{t('readerOriginal')}</Button>
  </div>;
  function open() {
    if (reading.document) { setMode('pdf'); return; }
    chrome.onSave();
  }
  // Reader input (including portal toolbar events) supersedes a pending search
  // reveal. Programmatic focus/scroll updates do not invalidate their own request.
  return <div className="pa-pdf-reading" data-reader-view={view} onPointerDownCapture={chrome.onNavigate} onClickCapture={chrome.onNavigate}
    onKeyDownCapture={chrome.onNavigate} onWheelCapture={chrome.onNavigate} onChangeCapture={chrome.onNavigate}>
    {!lockText && (chrome.toolbar ? createPortal(modes, chrome.toolbar) : <Toolbar>{modes}</Toolbar>)}
    {error && <Feedback kind="error"><span>{error}</span><Button onClick={() => setLookupAttempt(value => value + 1)} disabled={busy}>{t('retry')}</Button>{paper.pdfUrl && <a href={paper.pdfUrl} target="_blank" rel="noreferrer">{t('original')}</a>}</Feedback>}
    {busy && <p className="pa-loading" role="status">{t('loading')}</p>}
    <div className="pa-reader-views" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', flex: 1, minHeight: 0, minWidth: 0 }}>
      {reading.document && <div className="pa-pdf-view-slot" aria-hidden={view !== 'pdf'} inert={view !== 'pdf'} style={{ gridArea: '1 / 1', display: 'flex', minHeight: 0, minWidth: 0, visibility: view === 'pdf' ? 'visible' : 'hidden' }}>
        <PdfViewer chrome={{ ...chrome, toolbar: view === 'pdf' ? chrome.toolbar : null }} active={view === 'pdf'} readLabel={textLabel} onText={() => setMode('text')} key={`${reading.document.id}:${reading.document.fileDigest}`} document={reading.document} annotations={reading.annotations} api={api} focus={focus} t={t} onDiscuss={onDiscuss} onMatrixAdded={onMatrixAdded} onSaved={annotation => setReading(prior => ({ ...prior, annotations: [...prior.annotations.filter(item => item.id !== annotation.id), annotation] }))}/>
      </div>}
      <div className="pa-text-view-slot" aria-hidden={view !== 'text'} inert={view !== 'text'} style={{ gridArea: '1 / 1', display: view === 'text' ? 'flex' : 'none', minHeight: 0, minWidth: 0 }}>{children}</div>
      {visitedTex && <div className="pa-tex-view-slot" aria-hidden={view !== 'tex'} inert={view !== 'tex'} style={{ gridArea: '1 / 1', display: 'flex', minHeight: 0, minWidth: 0, visibility: view === 'tex' ? 'visible' : 'hidden' }}><TexReader api={api} paper={paper} active={view === 'tex'} openToken={openToken} reloadToken={pdfReloadToken} chrome={chrome} t={t}/></div>}
      {view === 'original' && originalUrl?.startsWith('https://') && <section className="pa-original-view" style={{ gridArea: '1 / 1' }} aria-label={t('readerOriginal')}><div className="pa-original-location"><a href={originalUrl} target="_blank" rel="noreferrer"><Icon name="external-link"/>{originalUrl}</a></div><iframe title={t('readerOriginal')} src={originalUrl} sandbox="allow-same-origin allow-popups" referrerPolicy="no-referrer"/></section>}
    </div>
  </div>;
}

export function PdfViewer({ document, annotations, api, focus, t, onSaved, onDiscuss, onMatrixAdded, chrome, onText, active, readLabel, fileUrl, readOnly = false, trailingActions }: {
  document: PdfDocument; annotations: PdfAnnotation[]; api: Api; focus?: PdfFocus | null; t: Translator; chrome: ReaderChrome; onText(): void; active: boolean; readLabel: string; fileUrl?: string; readOnly?: boolean; trailingActions?: React.ReactNode;
  onSaved(annotation: PdfAnnotation): void; onDiscuss?(text: string, source?: PdfSource): void;
  onMatrixAdded(): Promise<void>;
}) {
  const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl: new URL(wasmUrl, location.href).href, fontFallback: null });
  const initial = useMemo(() => loadReaderState(document), [document.id, document.fileDigest]);
  const plugins = useMemo(() => [
    createPluginRegistration(DocumentManagerPluginPackage, { initialDocuments: [{ documentId: document.id, url: new URL(fileUrl ?? `/api/pdf/${document.id}/file`, location.href).href, mode: 'full-fetch' as const }] }),
    createPluginRegistration(ViewportPluginPackage), createPluginRegistration(ScrollPluginPackage),
    createPluginRegistration(RenderPluginPackage), createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(SelectionPluginPackage), createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitPage }),
    createPluginRegistration(CapturePluginPackage, { scale: 2, withAnnotations: false }),
  ], [document.id, document.fileDigest, fileUrl]);
  if (error) return <Feedback kind="error">{error.message}{trailingActions}</Feedback>;
  if (isLoading || !engine) return <><p role="status">{t('loading')}</p>{trailingActions}</>;
  return <EmbedPDF engine={engine} plugins={plugins}>{({ activeDocumentId }) => activeDocumentId && <DocumentContent documentId={activeDocumentId}>{({ isLoaded, isError }) => isError ? <Feedback kind="error">{t('pdfLoadError')}{trailingActions}</Feedback> : isLoaded ? <PdfPages chrome={chrome} onText={onText} active={active} readLabel={readLabel} initial={initial} document={document} documentId={activeDocumentId} annotations={annotations} api={api} focus={focus} t={t} onSaved={onSaved} onDiscuss={onDiscuss} onMatrixAdded={onMatrixAdded} readOnly={readOnly} trailingActions={trailingActions}/> : <><p role="status">{t('loading')}</p>{trailingActions}</>}</DocumentContent>}</EmbedPDF>;
}

function PdfPages({ document, documentId, annotations, api, focus, t, onSaved, onDiscuss, onMatrixAdded, chrome, onText, active, readLabel, initial, readOnly, trailingActions }: {
  readOnly?: boolean; trailingActions?: React.ReactNode; initial: PdfReaderState | null; document: PdfDocument; documentId: string; annotations: PdfAnnotation[]; api: Api; focus?: PdfFocus | null; t: Translator; chrome: ReaderChrome; onText(): void; active: boolean; readLabel: string;
  onSaved(annotation: PdfAnnotation): void; onDiscuss?(text: string, source?: PdfSource): void;
  onMatrixAdded(): Promise<void>;
}) {
  const { state: scrollState } = useScroll(documentId), { provides: scrollCapability } = useScrollCapability();
  const scroll = useMemo(() => scrollCapability?.forDocument(documentId) ?? null, [scrollCapability, documentId]);
  const { provides: zoom, state: zoomState } = useZoom(documentId);
  const { provides: selection } = useSelectionCapability(), { provides: capture, state: captureState } = useCapture(documentId);
  const selectionState = useStoreState()?.plugins.selection as SelectionState | undefined;
  const [hasSelection, setHasSelection] = useState(false), [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  const selectedText = useRef('');
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [notes, setNotes] = useState(false), [target, setTarget] = useState('');
  const [menu, setMenu] = useState<{x: number; y: number} | null>(null), [pageText, setPageText] = useState(false);
  const layoutReady = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null), appliedFocus = useRef<PdfFocus | null>(null);
  useEffect(() => { if (!active) return; chrome.preserveView.current = () => zoom?.requestZoom(zoom.getState().currentZoomLevel); return () => { chrome.preserveView.current = null; }; }, [zoom, chrome.preserveView, active]);
  useEffect(() => { if (menu) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [menu]);
  const [matrixAnnotation, setMatrixAnnotation] = useState(''), [column, setColumn] = useState(t('pdfEvidenceColumn'));
  const [verificationAnnotation, setVerificationAnnotation] = useState('');
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  useEffect(() => scrollCapability?.onLayoutReady(event => { if (event.documentId === documentId) layoutReady.current = true; }), [scrollCapability, documentId]);
  const activeNow = useRef(active), focusNow = useRef(focus), restored = useRef(false), stateReady = useRef(false);
  activeNow.current = active; focusNow.current = focus;
  const persistView = useRef<() => void>(() => {});
  useEffect(() => {
    if (!scroll || !zoom || !selection || !scrollCapability) return;
    const selected = selection.forDocument(documentId);
    let alive = true;
    const persist = () => {
      if (!alive || !stateReady.current) return;
      const metrics = scroll.getMetrics(), scale = zoom.getState().currentZoomLevel;
      const page = metrics.pageVisibilityMetrics.find(item => item.pageNumber === metrics.currentPage);
      if (!page || !scale) return;
      const value: PdfReaderState = { schema: 1, documentId: document.id, fileDigest: document.fileDigest,
        page: metrics.currentPage, zoom: scale, mode: activeNow.current ? 'pdf' : 'text',
        position: { x: page.original.pageX - page.viewportX / scale, y: page.original.pageY - page.viewportY / scale },
        selection: selected.getState().selection };
      if (!saveReaderState(document, value)) setError('Reading position could not be saved.');
    };
    persistView.current = persist;
    const restore = () => {
      if (restored.current || !scroll.getMetrics().pageVisibilityMetrics.length) return;
      restored.current = true;
      // Numeric plugin defaults never release EmbedPDF's initial viewport gate.
      // Boot with FitPage, then restore the saved scale through its public API.
      if (initial) zoom.requestZoom(initial.zoom);
      if (!initial || focusNow.current) { stateReady.current = true; persist(); return; }
      scroll.scrollToPage({ pageNumber: initial.page, pageCoordinates: initial.position, alignX: 0, alignY: 0, behavior: 'instant' });
      const focusAtRestore = focusNow.current;
      void selected.setSelection(initial.selection).toPromise().then(() => {
        if (!alive) return;
        // An explicit citation received while geometry was loading wins over a
        // saved selection; it never inherits a different historical selection.
        if (focusNow.current !== focusAtRestore) selected.clear();
        stateReady.current = true; persist();
      }, () => {
        if (!alive) return;
        stateReady.current = true; setError('Saved selection could not be restored. The PDF remains readable.');
      });
    };
    const unsubscribe = [scroll.onScroll(persist), zoom.onStateChange(persist), selected.onSelectionChange(persist),
      scrollCapability.onLayoutReady(event => { if (event.documentId === documentId) restore(); })];
    restore();
    return () => { persist(); alive = false; unsubscribe.forEach(stop => stop()); persistView.current = () => {}; };
  }, [scroll, zoom, selection, scrollCapability, documentId, document.id, document.fileDigest]);
  useEffect(() => { persistView.current(); }, [active]);

  useEffect(() => selection?.forDocument(documentId).onSelectionChange(value => {
    setHasSelection(!!value);
    if (!value) { selectedText.current = ''; return; }
    void selection.forDocument(documentId).getSelectedText().toPromise().then(parts => { selectedText.current = parts.join('\n'); }).catch(() => { selectedText.current = ''; });
  }), [selection, documentId]);
  useEffect(() => {
    const copy = (event: ClipboardEvent) => {
      if (!activeNow.current) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      const text = selectedText.current.trim();
      if (!text || window.getSelection()?.toString()) return;
      event.preventDefault();
      event.clipboardData?.setData('text/plain', text);
    };
    window.document.addEventListener('copy', copy);
    return () => window.document.removeEventListener('copy', copy);
  }, []);
  useEffect(() => {
    if (!scrollCapability || !focus || focus.documentId !== document.id) return;
    const apply = () => {
      if (appliedFocus.current === focus) return;
      appliedFocus.current = focus;
      const rect = focus.rects?.[0], page = document.pages[focus.page - 1];
      scrollCapability.forDocument(documentId).scrollToPage({ pageNumber: focus.page, behavior: 'instant', ...(rect ? { pageCoordinates: { x: rect.x * page.width, y: rect.y * page.height }, alignY: 50 } : {}) });
      setTarget(focus.annotationId ?? '');
    };
    if (layoutReady.current) apply();
    return scrollCapability.onLayoutReady(event => { if (event.documentId === documentId) apply(); });
  }, [scrollCapability, focus, document.id, documentId]);
  async function save(value: Record<string, unknown>) {
    setBusy(true); setError(''); setStatus('');
    try {
      const annotation = await api.post<PdfAnnotation>('/api/annotations', { documentId: document.id, fileDigest: document.fileDigest, note, ...value });
      onSaved(annotation); setNotes(true); setTarget(annotation.id); setStatus(t('pdfSaved')); setNote('');
      selection?.forDocument(documentId).clear();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  useEffect(() => capture?.onCaptureArea(event => {
    const page = document.pages[event.pageIndex], { origin, size } = event.rect;
    capture.disableMarqueeCapture();
    void save({ kind: 'figure', page: event.pageIndex + 1, rects: [{ x: origin.x / page.width, y: origin.y / page.height, width: size.width / page.width, height: size.height / page.height }] });
  }), [capture, document, note]);
  async function selected(action: 'save' | 'discuss') {
    try {
      const scope = selection?.forDocument(documentId), parts = scope?.getFormattedSelection() ?? [];
      if (parts.length !== 1) throw new Error(t('pdfOnePage'));
      const quote = (await scope!.getSelectedText().toPromise()).join('\n');
      const part = parts[0], page = document.pages[part.pageIndex];
      const rects = part.segmentRects.map(rect => ({ x: Math.max(0, rect.origin.x / page.width), y: Math.max(0, rect.origin.y / page.height), width: rect.size.width / page.width, height: rect.size.height / page.height }));
      if (action === 'discuss') { onDiscuss?.(quote, { documentId: document.id, fileDigest: document.fileDigest, page: part.pageIndex + 1, rects }); return; }
      await save({ kind: 'highlight', page: part.pageIndex + 1, quote, rects });
    } catch (e) { fail(e); }
  }
  function go(annotation: PdfAnnotation) { scroll?.scrollToPage({ pageNumber: annotation.page, behavior: 'instant' }); setTarget(annotation.id); }
  async function copyImage(annotation: PdfAnnotation) {
    try {
      const blob = await (await fetch(`/api/annotations/${annotation.id}/image`)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); setStatus(t('pdfCopied'));
    } catch { setError(t('pdfCopyError')); }
  }
  async function addToMatrix() {
    setBusy(true); setError('');
    try { await api.post('/api/matrix', { annotationId: matrixAnnotation, column }); setMatrixAnnotation(''); await onMatrixAdded(); setNotes(false); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  const pager = <div className="pa-reader-pager">
      {chrome.back && <Button variant="ghost" aria-label={t('backToLibrary')} onClick={chrome.back}>‹</Button>}
      <Button variant="ghost" aria-label={t('pdfPrevious')} disabled={!scroll || scrollState.currentPage <= 1} onClick={() => scroll?.scrollToPreviousPage('instant')}>‹</Button>
      <label className="pa-pdf-page-input"><span className="pa-sr-only">{t('pdfPage')}</span><input aria-label={t('pdfPage')} type="number" min={1} max={document.pages.length} value={scrollState.currentPage || 1} onChange={event => { const pageNumber = Number(event.target.value); if (pageNumber >= 1 && pageNumber <= document.pages.length) scroll?.scrollToPage({ pageNumber, behavior: 'instant' }); }}/><span>/ {document.pages.length}</span></label>
      <Button variant="ghost" aria-label={t('pdfNext')} disabled={!scroll || scrollState.currentPage >= document.pages.length} onClick={() => scroll?.scrollToNextPage('instant')}>›</Button>
      <Button className="pa-pdf-zoom-inline" variant="ghost" aria-label={t('pdfZoomOut')} onClick={() => zoom?.zoomOut()}>−</Button><Button className="pa-pdf-zoom-inline" variant="ghost" aria-label={t('pdfFitPage')} onClick={() => zoom?.requestZoom(ZoomMode.FitPage)}>{Math.round((zoomState.currentZoomLevel || 1) * 100)}%</Button><Button className="pa-pdf-zoom-inline" variant="ghost" aria-label={t('pdfZoomIn')} onClick={() => zoom?.zoomIn()}>+</Button>
      <Popover className="pa-pdf-zoom-menu" label={t('pdfZoom')} trigger={`${Math.round((zoomState.currentZoomLevel || 1) * 100)}%`} triggerVariant="ghost" contentClassName="pa-pdf-zoom-panel">{() => <><Button variant="ghost" aria-label={t('pdfZoomOut')} onClick={() => zoom?.zoomOut()}>−</Button><Button variant="ghost" onClick={() => zoom?.requestZoom(ZoomMode.FitPage)}>{t('pdfFitPage')}</Button><Button variant="ghost" aria-label={t('pdfZoomIn')} onClick={() => zoom?.zoomIn()}>+</Button></>}</Popover>
      {trailingActions}
    </div>;
  return <section className="pa-pdf-viewer" aria-label={readOnly ? 'TeX preview' : t('pdfReader')} tabIndex={0} onContextMenu={event => { if (readOnly) return; event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: Math.max(0, Math.min(event.clientX - box.left, box.width - 200)), y: Math.max(0, Math.min(event.clientY - box.top, box.height - 190)) }); }} onKeyDown={event => { if (!readOnly && event.key === 'F10' && event.shiftKey) { event.preventDefault(); setMenu({ x: 16, y: 16 }); } }}>
    {chrome.toolbar ? createPortal(pager, chrome.toolbar) : <div className="pa-pdf-inline-toolbar">{pager}</div>}
    {captureState.isMarqueeCaptureActive && <div className="pa-pdf-context-action"><Button onClick={() => capture?.disableMarqueeCapture()}>{t('pdfCancelCapture')}</Button></div>}
    {menu && <div className="pa-pdf-menu" role="menu" aria-label={t('pdfActions')} ref={menuRef} style={{left: menu.x, top: menu.y}} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setMenu(null); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setMenu(null); event.currentTarget.closest('section')?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll('button')); const index = buttons.indexOf(window.document.activeElement as HTMLButtonElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
    }}>
      <Button role="menuitem" onClick={() => { capture?.toggleMarqueeCapture(); setMenu(null); }}>{t('pdfCapture')}</Button>
      <Button role="menuitem" onClick={() => { setNotes(value => !value); setMenu(null); }}>{t('pdfNotes')} {annotations.length}</Button>
      <Button role="menuitem" onClick={() => { setPageText(value => !value); setMenu(null); }}>{t('pdfPageText')}</Button>
      <a role="menuitem" href={`/api/pdf/${document.id}/file`} download="paper.pdf">{t('originalPdf')}</a>
      <Button role="menuitem" onClick={() => { setMenu(null); chrome.onSave(); }}>{t('downloadPaper')}</Button>
      <Button role="menuitem" onClick={() => { setMenu(null); onText(); }}>{readLabel}</Button>
    </div>}
    {hasSelection && !readOnly && <div className="pa-pdf-selection" role="toolbar" aria-label={t('pdfSelection')} onKeyDown={event => { if (event.key === 'Escape') selection?.forDocument(documentId).clear(); }}><Input aria-label={t('pdfNote')} placeholder={t('pdfNote')} maxLength={4000} value={note} onChange={event => setNote(event.target.value)}/><Button disabled={busy} onClick={() => void selected('save')}>{t('pdfHighlight')}</Button>{onDiscuss && <Button disabled={busy} onClick={() => void selected('discuss')}>{t('discussSelection')}</Button>}<Button variant="ghost" onClick={() => selection?.forDocument(documentId).clear()}>{t('close')}</Button></div>}
    {error && <Feedback kind="error">{error}<Button variant="ghost" onClick={() => setError('')}>{t('dismiss')}</Button></Feedback>}
    {(busy || status) && <div role="status" className="pa-pdf-status">{busy ? t('pdfSaving') : status}</div>}
    <div className="pa-pdf-body" data-notes={notes}>
      <Viewport documentId={documentId} className="pa-pdf-viewport" style={{ height: '100%', minHeight: 0, background: 'var(--pero-surface-muted)' }}>
        <Scroller documentId={documentId} renderPage={({ width, height, pageIndex }) => <div className="pa-pdf-page" data-page-number={pageIndex + 1} data-selection-ready={!!selectionState?.documents[documentId]?.geometry[pageIndex]} style={{ width, height, position: 'relative', background: 'white' }}>
          <PagePointerProvider documentId={documentId} pageIndex={pageIndex}>
            <RenderLayer documentId={documentId} pageIndex={pageIndex} draggable={false}/>
            <div className="pa-pdf-marks" aria-hidden="true">{focus?.page === pageIndex + 1 && focus.rects?.map((rect, i) => <span key={`citation:${i}`} data-citation-region="true" data-focused="true" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}/>) }{annotations.filter(item => item.page === pageIndex + 1).flatMap(item => item.rects.map((rect, i) => <span key={`${item.id}:${i}`} data-annotation-id={item.id} data-kind={item.kind} data-focused={target === item.id} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}/>))}</div>
            <SelectionLayer documentId={documentId} pageIndex={pageIndex}/><MarqueeCapture documentId={documentId} pageIndex={pageIndex}/>
          </PagePointerProvider>
        </div>}/>
      </Viewport>
      {notes && <aside className="pa-pdf-notes" aria-label={t('pdfNotes')}><Toolbar><h2>{t('pdfNotes')}</h2><Button variant="ghost" aria-label={t('closeAnnotations')} onClick={() => setNotes(false)}>×</Button></Toolbar>{!annotations.length && <p>{t('pdfNoNotes')}</p>}{annotations.map(annotation => <article key={annotation.id} data-note-id={annotation.id}><Button variant="ghost" onClick={() => go(annotation)}>{t('pdfPage')} {annotation.page} ↗</Button>{annotation.kind === 'figure' ? <><img src={`/api/annotations/${annotation.id}/image`} alt={`${t('pdfFigure')} · ${t('pdfPage')} ${annotation.page}`}/><div className="pa-actions"><Button onClick={() => void copyImage(annotation)}>{t('pdfCopyImage')}</Button><a href={`/api/annotations/${annotation.id}/image`} download={`figure-${annotation.page}.png`}>{t('pdfDownload')}</a></div></> : <blockquote>{annotation.quote}</blockquote>}{annotation.note && <p>{annotation.note}</p>}<div className="pa-actions"><Button variant="ghost" onClick={() => setMatrixAnnotation(annotation.id)}>{t('pdfAddMatrix')}</Button>{annotation.kind === 'highlight' && reproductionPolicy(annotation.quote) && <Button variant="ghost" aria-expanded={verificationAnnotation === annotation.id} onClick={() => setVerificationAnnotation(current => current === annotation.id ? '' : annotation.id)}>{t('reproductionVerify')}</Button>}</div>{verificationAnnotation === annotation.id && <Reproduction key={annotation.id} api={api} annotation={annotation} t={t}/>} {matrixAnnotation === annotation.id && <div className="pa-pdf-matrix-field" role="group" aria-label={t('pdfColumn')} onKeyDown={event => { if (event.key === 'Enter' && column.trim() && !busy) { event.preventDefault(); void addToMatrix(); } if (event.key === 'Escape') setMatrixAnnotation(''); }}><Input aria-label={t('pdfColumn')} value={column} maxLength={80} onChange={event => setColumn(event.target.value)}/><Button onClick={() => void addToMatrix()} disabled={busy || !column.trim()}>{t('pdfAddMatrix')}</Button></div>}</article>)}</aside>}
    </div>
    {pageText && <div className="pa-pdf-page-text"><Toolbar><h2>{t('pdfPageText')}</h2>{onDiscuss && <Button onClick={() => { const page = document.pages[(scrollState.currentPage || 1) - 1]; setPageText(false); onDiscuss(page.text, { documentId: document.id, fileDigest: document.fileDigest, page: page.number }); }}>{t('discussPage')}</Button>}<Button onClick={() => setPageText(false)}>{t('close')}</Button></Toolbar><pre tabIndex={0}>{document.pages[(scrollState.currentPage || 1) - 1]?.text}</pre></div>}
  </section>;
}
