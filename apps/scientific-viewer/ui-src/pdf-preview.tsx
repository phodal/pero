import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Disclosure, Button, Feedback } from '@pero/app-sdk/ui';
import type { PreviewSource } from './preview-source';

/** The existing pinned PDF.js engine, without the Paper evidence workflow. */
export function PdfPreview({ source, zh, onPageText }: { source: PreviewSource; zh: boolean; onPageText?(text: string): void }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1), [zoom, setZoom] = useState(1);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [width, setWidth] = useState(320);
  const [pageText, setPageText] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null), viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = viewport.current;
    if (!container) return;
    const measure = () => setWidth(Math.max(160, container.clientWidth - 24));
    const observer = new ResizeObserver(measure); observer.observe(container); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true, destroy: (() => Promise<void>) | undefined;
    setDocument(null); setPage(1); setError(''); setLoading(true);
    void import('pdfjs-dist').then(async pdfjs => {
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.mjs', window.location.href).href;
      const task = pdfjs.getDocument({ data: source.bytes.slice(), enableXfa: false, stopAtErrors: true,
        disableAutoFetch: true, disableStream: true, useWorkerFetch: false,
        cMapUrl: new URL('./pdfjs-cmaps/', window.location.href).href, cMapPacked: true,
        standardFontDataUrl: new URL('./pdfjs-fonts/', window.location.href).href,
        wasmUrl: new URL('./pdfjs-wasm/', window.location.href).href });
      destroy = () => task.destroy();
      const value = await task.promise;
      if (active) setDocument(value);
    }).catch(reason => { if (active) { setError(String(reason.message)); setLoading(false); } });
    return () => { active = false; void destroy?.(); };
  }, [source]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let active = true, render: RenderTask | undefined;
    const node = canvas.current;
    const paint = async () => {
      setLoading(true); setError('');
      setPageText(''); onPageText?.('');
      const pdfPage = await document.getPage(page);
      if (!active) return;
      const initial = pdfPage.getViewport({ scale: 1 });
      const scale = width / initial.width * zoom;
      const view = pdfPage.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      node.width = Math.ceil(view.width * ratio); node.height = Math.ceil(view.height * ratio);
      node.style.width = `${view.width}px`; node.style.height = `${view.height}px`;
      render = pdfPage.render({ canvas: node, viewport: view, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      const content = await pdfPage.getTextContent();
      const text = content.items.filter(item => 'str' in item).map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
      await render.promise;
      if (active) { setPageText(text); onPageText?.(`PDF page ${page} / ${document.numPages}\n${text}`); setLoading(false); }
    };
    void paint().catch(reason => {
      if (active && reason.name !== 'RenderingCancelledException') { setError(String(reason.message)); setLoading(false); }
    });
    return () => { active = false; render?.cancel(); };
  }, [document, page, zoom, width, onPageText]);
  return <section className="artifact-pdf" aria-label={source.name}>
    <nav className="artifact-pdf-toolbar" aria-label={zh ? 'PDF 页面' : 'PDF pages'}>
      <Button variant="ghost" disabled={!document || page <= 1} onClick={() => setPage(value => value - 1)}>{zh ? '上一页' : 'Previous'}</Button>
      <span>{page} / {document?.numPages ?? '—'}</span>
      <Button variant="ghost" disabled={!document || page >= document.numPages} onClick={() => setPage(value => value + 1)}>{zh ? '下一页' : 'Next'}</Button>
      <span className="artifact-toolbar-spacer" />
      <Button variant="ghost" disabled={zoom <= 0.5} aria-label={zh ? '缩小' : 'Zoom out'} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}>−</Button>
      <Button variant="ghost" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
      <Button variant="ghost" disabled={zoom >= 3} aria-label={zh ? '放大' : 'Zoom in'} onClick={() => setZoom(value => Math.min(3, value + 0.25))}>+</Button>
    </nav>
    {error && <Feedback kind="error">{error}</Feedback>}
    {loading && <div className="artifact-loading" role="status">{zh ? '正在载入 PDF…' : 'Loading PDF…'}</div>}
    <div className="artifact-pdf-pages" ref={viewport}><canvas ref={canvas} aria-label={`${source.name}, ${zh ? '第' : 'page'} ${page}`} />
      <Disclosure variant="inline" className="artifact-pdf-text" summary={<>{zh ? '本页文字' : 'Page text'}</>}><pre>{pageText || (zh ? '本页没有可提取的文字。' : 'No extractable text on this page.')}</pre></Disclosure>
    </div>
  </section>;
}
