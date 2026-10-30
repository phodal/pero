import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Feedback, Input, Toolbar } from '@pero/app-sdk/ui';
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

export type ReaderChrome = { toolbar: HTMLElement | null; preserveView: React.MutableRefObject<(() => void) | null> };

export function PdfReader({ paper, api, focus, t, onDiscuss, onMatrixAdded, children, chrome }: {
  paper: Paper; api: Api; focus?: PdfFocus | null; t: Translator; children: React.ReactNode; chrome: ReaderChrome;
  onDiscuss?(text: string, source?: PdfSource): void;
  onMatrixAdded(): Promise<void>;
}) {
  const [reading, setReading] = useState<PdfReading>({ document: null, annotations: [] });
  const [mode, setMode] = useState<'text' | 'pdf'>('text'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (focus && reading.document?.id === focus.documentId) return;
    let alive = true;
    setReading({ document: null, annotations: [] }); setMode('text'); setError('');
    setBusy(!!paper.pdfUrl);
    api.get<PdfReading>(focus ? `/api/pdf/${focus.documentId}` : `/api/pdf?paperId=${paper.id}`).then(async value => {
      if (!value.document && paper.pdfUrl && alive) value = await api.post<PdfReading>('/api/pdf', { paperId: paper.id });
      if (alive) { setReading(value); if (value.document) setMode('pdf'); }
    }).catch(e => { if (alive) setError(String(e.message ?? e)); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [api, paper.id, focus?.documentId]);
  useEffect(() => { if (focus) setMode('pdf'); }, [focus]);
  async function open() {
    if (reading.document) { setMode('pdf'); return; }
    setBusy(true); setError('');
    try { setReading(await api.post<PdfReading>('/api/pdf', { paperId: paper.id })); setMode('pdf'); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="pa-pdf-reading">
    {mode === 'text' && !busy && (paper.pdfUrl || reading.document) && <Toolbar><Button disabled={busy} onClick={() => void open()}>{busy ? t('pdfDownloading') : 'PDF'}</Button><Button variant="ghost" aria-pressed={mode === 'text'} onClick={() => { setMode('text'); setError(''); }}>{t('pdfText')}</Button></Toolbar>}
    {error && <Feedback kind="error"><span>{error}</span><Button onClick={() => void open()} disabled={busy}>{t('retry')}</Button></Feedback>}
    {busy && <p className="pa-loading" role="status">{t('pdfDownloading')}</p>}
    {mode === 'pdf' && reading.document ? <PdfViewer chrome={chrome} onText={() => setMode('text')} key={reading.document.id} document={reading.document} annotations={reading.annotations} api={api} focus={focus} t={t} onDiscuss={onDiscuss} onMatrixAdded={onMatrixAdded} onSaved={annotation => setReading(prior => ({ ...prior, annotations: [...prior.annotations.filter(item => item.id !== annotation.id), annotation] }))}/> : !busy && children}
  </div>;
}

function PdfViewer({ document, annotations, api, focus, t, onSaved, onDiscuss, onMatrixAdded, chrome, onText }: {
  document: PdfDocument; annotations: PdfAnnotation[]; api: Api; focus?: PdfFocus | null; t: Translator; chrome: ReaderChrome; onText(): void;
  onSaved(annotation: PdfAnnotation): void; onDiscuss?(text: string, source?: PdfSource): void;
  onMatrixAdded(): Promise<void>;
}) {
  const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl: new URL(wasmUrl, location.href).href, fontFallback: null });
  const plugins = useMemo(() => [
    createPluginRegistration(DocumentManagerPluginPackage, { initialDocuments: [{ documentId: document.id, url: new URL(`/api/pdf/${document.id}/file`, location.href).href, mode: 'full-fetch' as const }] }),
    createPluginRegistration(ViewportPluginPackage), createPluginRegistration(ScrollPluginPackage),
    createPluginRegistration(RenderPluginPackage), createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(SelectionPluginPackage), createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitPage }),
    createPluginRegistration(CapturePluginPackage, { scale: 2, withAnnotations: false }),
  ], [document.id]);
  if (error) return <Feedback kind="error">{error.message}</Feedback>;
  if (isLoading || !engine) return <p role="status">{t('loading')}</p>;
  return <EmbedPDF engine={engine} plugins={plugins}>{({ activeDocumentId }) => activeDocumentId && <DocumentContent documentId={activeDocumentId}>{({ isLoaded, isError }) => isError ? <Feedback kind="error">{t('pdfLoadError')}</Feedback> : isLoaded ? <PdfPages chrome={chrome} onText={onText} document={document} documentId={activeDocumentId} annotations={annotations} api={api} focus={focus} t={t} onSaved={onSaved} onDiscuss={onDiscuss} onMatrixAdded={onMatrixAdded}/> : <p role="status">{t('loading')}</p>}</DocumentContent>}</EmbedPDF>;
}

function PdfPages({ document, documentId, annotations, api, focus, t, onSaved, onDiscuss, onMatrixAdded, chrome, onText }: {
  document: PdfDocument; documentId: string; annotations: PdfAnnotation[]; api: Api; focus?: PdfFocus | null; t: Translator; chrome: ReaderChrome; onText(): void;
  onSaved(annotation: PdfAnnotation): void; onDiscuss?(text: string, source?: PdfSource): void;
  onMatrixAdded(): Promise<void>;
}) {
  const { state: scrollState } = useScroll(documentId), { provides: scrollCapability } = useScrollCapability();
  const scroll = useMemo(() => scrollCapability?.forDocument(documentId) ?? null, [scrollCapability, documentId]);
  const { provides: zoom, state: zoomState } = useZoom(documentId);
  const { provides: selection } = useSelectionCapability(), { provides: capture, state: captureState } = useCapture(documentId);
  const selectionState = useStoreState()?.plugins.selection as SelectionState | undefined;
  const [hasSelection, setHasSelection] = useState(false), [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [notes, setNotes] = useState(false), [target, setTarget] = useState('');
  const [menu, setMenu] = useState<{x: number; y: number} | null>(null), [pageText, setPageText] = useState(false);
  const layoutReady = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null), appliedFocus = useRef<PdfFocus | null>(null);
  useEffect(() => { chrome.preserveView.current = () => zoom?.requestZoom(zoom.getState().currentZoomLevel); return () => { chrome.preserveView.current = null; }; }, [zoom, chrome.preserveView]);
  useEffect(() => { if (menu) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [menu]);
  const [matrixAnnotation, setMatrixAnnotation] = useState(''), [column, setColumn] = useState(t('pdfEvidenceColumn'));
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  useEffect(() => scrollCapability?.onLayoutReady(event => { if (event.documentId === documentId) layoutReady.current = true; }), [scrollCapability, documentId]);
  useEffect(() => selection?.forDocument(documentId).onSelectionChange(value => setHasSelection(!!value)), [selection, documentId]);
  useEffect(() => {
    if (!scrollCapability || !focus || focus.documentId !== document.id) return;
    const apply = () => {
      if (appliedFocus.current === focus) return;
      appliedFocus.current = focus;
      const rect = focus.rects?.[0], page = document.pages[focus.page - 1];
      scrollCapability.forDocument(documentId).scrollToPage({ pageNumber: focus.page, behavior: 'instant', ...(rect ? { pageCoordinates: { x: rect.x * page.width, y: rect.y * page.height }, alignY: 25 } : {}) });
      setTarget(focus.annotationId ?? '');
    };
    if (layoutReady.current) apply();
    return scrollCapability.onLayoutReady(event => { if (event.documentId === documentId) apply(); });
  }, [scrollCapability, focus, document.id, documentId]);
  async function save(value: Record<string, unknown>) {
    setBusy(true); setError(''); setStatus('');
    try {
      const annotation = await api.post<PdfAnnotation>('/api/annotations', { documentId: document.id, note, ...value });
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
      if (action === 'discuss') { onDiscuss?.(quote, { documentId: document.id, fileDigest: document.fileDigest, page: parts[0].pageIndex + 1 }); return; }
      const part = parts[0], page = document.pages[part.pageIndex];
      await save({ kind: 'highlight', page: part.pageIndex + 1, quote, rects: part.segmentRects.map(rect => ({ x: Math.max(0, rect.origin.x / page.width), y: Math.max(0, rect.origin.y / page.height), width: rect.size.width / page.width, height: rect.size.height / page.height })) });
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
  return <section className="pa-pdf-viewer" aria-label={t('pdfReader')} tabIndex={0} onContextMenu={event => { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: Math.max(0, Math.min(event.clientX - box.left, box.width - 200)), y: Math.max(0, Math.min(event.clientY - box.top, box.height - 190)) }); }} onKeyDown={event => { if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); setMenu({ x: 16, y: 16 }); } }}>
    {chrome.toolbar && createPortal(<Toolbar>
      <Button variant="ghost" aria-label={t('pdfPrevious')} disabled={!scroll || scrollState.currentPage <= 1} onClick={() => scroll?.scrollToPreviousPage('instant')}>‹</Button>
      <label className="pa-pdf-page-input"><span className="pa-sr-only">{t('pdfPage')}</span><input aria-label={t('pdfPage')} type="number" min={1} max={document.pages.length} value={scrollState.currentPage || 1} onChange={event => { const pageNumber = Number(event.target.value); if (pageNumber >= 1 && pageNumber <= document.pages.length) scroll?.scrollToPage({ pageNumber, behavior: 'instant' }); }}/><span>/ {document.pages.length}</span></label>
      <Button variant="ghost" aria-label={t('pdfNext')} disabled={!scroll || scrollState.currentPage >= document.pages.length} onClick={() => scroll?.scrollToNextPage('instant')}>›</Button>
      <Button variant="ghost" aria-label={t('pdfZoomOut')} onClick={() => zoom?.zoomOut()}>−</Button><Button variant="ghost" aria-label={t('pdfFitPage')} onClick={() => zoom?.requestZoom(ZoomMode.FitPage)}>{Math.round((zoomState.currentZoomLevel || 1) * 100)}%</Button><Button variant="ghost" aria-label={t('pdfZoomIn')} onClick={() => zoom?.zoomIn()}>+</Button>
    </Toolbar>, chrome.toolbar)}
    {captureState.isMarqueeCaptureActive && <div className="pa-pdf-context-action"><Button onClick={() => capture?.disableMarqueeCapture()}>{t('pdfCancelCapture')}</Button></div>}
    {menu && <div className="pa-pdf-menu" role="menu" aria-label={t('pdfActions')} ref={menuRef} style={{left: menu.x, top: menu.y}} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setMenu(null); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setMenu(null); event.currentTarget.closest('section')?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll('button')); const index = buttons.indexOf(window.document.activeElement as HTMLButtonElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
    }}>
      <Button role="menuitem" onClick={() => { capture?.toggleMarqueeCapture(); setMenu(null); }}>{t('pdfCapture')}</Button>
      <Button role="menuitem" onClick={() => { setNotes(value => !value); setMenu(null); }}>{t('pdfNotes')} {annotations.length}</Button>
      <Button role="menuitem" onClick={() => { setPageText(value => !value); setMenu(null); }}>{t('pdfPageText')}</Button>
      <a role="menuitem" href={`/api/pdf/${document.id}/file`} download="paper.pdf">{t('originalPdf')}</a>
      <Button role="menuitem" onClick={onText}>{t('pdfText')}</Button>
    </div>}
    {hasSelection && <div className="pa-pdf-selection" role="toolbar" aria-label={t('pdfSelection')} onKeyDown={event => { if (event.key === 'Escape') selection?.forDocument(documentId).clear(); }}><Input aria-label={t('pdfNote')} placeholder={t('pdfNote')} maxLength={4000} value={note} onChange={event => setNote(event.target.value)}/><Button disabled={busy} onClick={() => void selected('save')}>{t('pdfHighlight')}</Button>{onDiscuss && <Button disabled={busy} onClick={() => void selected('discuss')}>{t('discussSelection')}</Button>}<Button variant="ghost" onClick={() => selection?.forDocument(documentId).clear()}>{t('close')}</Button></div>}
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
      {notes && <aside className="pa-pdf-notes" aria-label={t('pdfNotes')}><Toolbar><h2>{t('pdfNotes')}</h2><Button variant="ghost" aria-label={t('closeAnnotations')} onClick={() => setNotes(false)}>×</Button></Toolbar>{!annotations.length && <p>{t('pdfNoNotes')}</p>}{annotations.map(annotation => <article key={annotation.id} data-note-id={annotation.id}><Button variant="ghost" onClick={() => go(annotation)}>{t('pdfPage')} {annotation.page} ↗</Button>{annotation.kind === 'figure' ? <><img src={`/api/annotations/${annotation.id}/image`} alt={`${t('pdfFigure')} · ${t('pdfPage')} ${annotation.page}`}/><div className="pa-actions"><Button onClick={() => void copyImage(annotation)}>{t('pdfCopyImage')}</Button><a href={`/api/annotations/${annotation.id}/image`} download={`figure-${annotation.page}.png`}>{t('pdfDownload')}</a></div></> : <blockquote>{annotation.quote}</blockquote>}{annotation.note && <p>{annotation.note}</p>}<div className="pa-actions"><Button variant="ghost" onClick={() => setMatrixAnnotation(annotation.id)}>{t('pdfAddMatrix')}</Button></div>{matrixAnnotation === annotation.id && <div className="pa-pdf-matrix-field" role="group" aria-label={t('pdfColumn')} onKeyDown={event => { if (event.key === 'Enter' && column.trim() && !busy) { event.preventDefault(); void addToMatrix(); } if (event.key === 'Escape') setMatrixAnnotation(''); }}><Input aria-label={t('pdfColumn')} value={column} maxLength={80} onChange={event => setColumn(event.target.value)}/><Button onClick={() => void addToMatrix()} disabled={busy || !column.trim()}>{t('pdfAddMatrix')}</Button></div>}</article>)}</aside>}
    </div>
    {pageText && <div className="pa-pdf-page-text"><Toolbar><h2>{t('pdfPageText')}</h2><Button onClick={() => setPageText(false)}>{t('close')}</Button></Toolbar><pre tabIndex={0}>{document.pages[(scrollState.currentPage || 1) - 1]?.text}</pre></div>}
  </section>;
}
