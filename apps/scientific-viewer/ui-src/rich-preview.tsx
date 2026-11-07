import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppContext } from '@pero/app-sdk';
import { Button, CodeViewer, Feedback, type CodeViewerProps } from '@pero/app-sdk/ui';
import { previewKind, sourceText, type PreviewKind, type PreviewSource } from './preview-source';
import type { Asset } from './files';
import { TablePreview } from './table-preview';
import { PdfPreview } from './pdf-preview';
import './artifact-preview.css';

const NotebookPreview = lazy(() => import('./notebook-preview').then(value => ({ default: value.NotebookPreview })));

function sourceLanguage(name: string): CodeViewerProps['language'] {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return ({ json: 'json', jsonl: 'json', ndjson: 'json', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', html: 'html', css: 'css', java: 'java', sql: 'sql', py: 'python', rs: 'rust', go: 'go', sh: 'shell', bash: 'shell', yml: 'yaml', yaml: 'yaml', r: 'r' } as Record<string, CodeViewerProps['language']>)[extension ?? ''] ?? 'plain';
}

/** Stored data images and Host snapshot URLs are eligible; mutable network images stay literal. */
export function previewImageUrl(value: string): string | undefined {
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  if (value.startsWith('/host/artifacts/')) return value;
  return undefined;
}

function ImagePreview({ source, zh, download }: { source: PreviewSource; zh: boolean; download(): void }) {
  const [zoom, setZoom] = useState(1), [error, setError] = useState(false);
  const url = useMemo(() => URL.createObjectURL(new Blob([new Uint8Array(source.bytes)], { type: source.mediaType })), [source]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <section className="artifact-image">
    <nav className="artifact-image-toolbar" aria-label={zh ? '图片缩放' : 'Image zoom'}>
      <Button variant="ghost" disabled={zoom <= 0.25} onClick={() => setZoom(value => Math.max(0.25, value - 0.25))} aria-label={zh ? '缩小' : 'Zoom out'}>−</Button>
      <Button variant="ghost" onClick={() => setZoom(1)}>{zoom === 1 ? (zh ? '适应窗口' : 'Fit to pane') : `${Math.round(zoom * 100)}%`}</Button>
      <Button variant="ghost" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 0.25))} aria-label={zh ? '放大' : 'Zoom in'}>+</Button>
      <span className="artifact-toolbar-spacer" />
      <Button variant="ghost" onClick={download}>{zh ? '下载' : 'Download'}</Button>
    </nav>
    {error && <Feedback kind="error">{zh ? '无法显示图片，可下载原始文件。' : 'The image could not be displayed. Download the original file.'}</Feedback>}
    <div className="artifact-image-scroll"><img src={url} alt={source.name} style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} onError={() => setError(true)} /></div>
  </section>;
}

function HtmlPreview({ text, name }: { text: string; name: string }) {
  const { dark } = useAppContext();
  // The opaque sandbox has no scripts, parent access or external requests.
  const source = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"><meta name="color-scheme" content="${dark ? 'dark' : 'light'}"><style>html{color-scheme:${dark ? 'dark' : 'light'}}body{margin:20px;font:16px/1.6 system-ui;overflow-wrap:anywhere}img,svg,table{max-width:100%}pre{overflow:auto}table{border-collapse:collapse}td,th{padding:4px 8px;border-bottom:.5px solid #8885}</style>${text}`;
  return <iframe className="artifact-html" title={name} sandbox="" referrerPolicy="no-referrer" srcDoc={source} />;
}

/** Shared display projection. Acquisition, versions and evidence remain with the owner. */
export function RichPreview({ source, kind: suppliedKind, onDiscuss, selectionOnly = false }: {
  source: PreviewSource; kind?: PreviewKind; onDiscuss?(selection: string): Promise<void>; selectionOnly?: boolean;
}) {
  const { locale } = useAppContext(), zh = locale === 'zh-CN';
  const kind = suppliedKind ?? previewKind(source);
  const binary = kind === 'image' || kind === 'pdf' || kind === 'opaque';
  const text = useMemo(() => binary ? '' : sourceText(source), [source, binary]);
  const [raw, setRaw] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [discussing, setDiscussing] = useState(false), [selection, setSelection] = useState('');
  const [pageText, setPageText] = useState('');
  const receivePageText = useCallback((value: string) => { setPageText(value); setSelection(''); }, []);
  const body = useRef<HTMLDivElement>(null);
  const asset = useMemo<Asset>(() => ({ ...source, size: source.bytes.length, source: 'Host-owned immutable snapshot', license: 'Unknown', synthetic: false }), [source]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(source.bytes)], { type: source.mediaType }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = source.name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const showSource = !binary && !['code', 'text'].includes(kind);
  const captureSelection = () => {
    const value = window.getSelection();
    if (value?.anchorNode && body.current?.contains(value.anchorNode)) setSelection(value.toString());
  };
  let preview: React.ReactNode;
  if (kind === 'notebook') preview = <>
    <div hidden={raw}><Suspense fallback={<p role="status">{zh ? '正在载入 Notebook…' : 'Loading notebook…'}</p>}><NotebookPreview asset={asset} embedded /></Suspense></div>
    {raw && <CodeViewer documentId={source.id} text={text} language="json" label={zh ? '源码' : 'Source'} />}
  </>;
  else if (raw || kind === 'code' || kind === 'text') preview = <CodeViewer documentId={source.id} text={text} language={sourceLanguage(source.name)} label={zh ? '源码' : 'Source'} wrap={kind === 'text'} onCursor={() => setSelection('')} />;
  else if (kind === 'image') preview = <ImagePreview source={source} zh={zh} download={download} />;
  else if (kind === 'pdf') preview = <PdfPreview source={source} zh={zh} onPageText={receivePageText} />;
  else if (kind === 'table') preview = <TablePreview asset={asset} />;
  else if (kind === 'html') preview = <HtmlPreview text={text} name={source.name} />;
  else if (kind === 'markdown') preview = <article className="artifact-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={(url, key) => key === 'src' ? previewImageUrl(url) ?? '' : defaultUrlTransform(url)}
    components={{ img: ({ src, alt }) => src ? <img src={src} alt={alt ?? ''} /> : <span className="artifact-missing-image">{alt ? `${alt}: ` : ''}{zh ? '图片未包含在快照中' : 'Image is not included in the snapshot'}</span>, a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{text}</ReactMarkdown></article>;
  else preview = <div className="artifact-empty">{zh ? '此格式暂未提供预览，可下载原始文件。' : 'No preview is available for this format. Download the original file.'}</div>;
  const auxiliary = showSource || Boolean(onDiscuss && (!selectionOnly || selection || pageText));
  return <section className="artifact-rich-preview" data-preview-kind={kind}>
    {auxiliary && <nav className="artifact-preview-toolbar" aria-label={zh ? '产物预览' : 'Artifact preview'}>
      {showSource && <Button variant="ghost" onClick={() => setRaw(!raw)}>{raw ? (zh ? '返回预览' : 'Back to preview') : (zh ? '源码' : 'Source')}</Button>}
      <span className="artifact-toolbar-spacer" />
      {onDiscuss && (!selectionOnly || selection || pageText) && <Button variant="ghost" disabled={discussing} onClick={() => {
        setDiscussing(true); setError(''); setNotice('');
        void onDiscuss(selection || pageText).then(() => setNotice(zh ? '已加入提问' : 'Added to prompt')).catch(reason => setError(String(reason.message))).finally(() => setDiscussing(false));
      }}>{selection ? (zh ? '引用选区' : 'Discuss selection') : pageText ? (zh ? '引用本页' : 'Discuss page') : (zh ? '加入提问' : 'Add to prompt')}</Button>}
      {kind !== 'image' && <Button variant="ghost" onClick={download}>{zh ? '下载' : 'Download'}</Button>}
    </nav>}
    {kind !== 'image' && !auxiliary && <nav className="artifact-preview-toolbar" aria-label={zh ? '产物预览' : 'Artifact preview'}>
      <span className="artifact-toolbar-spacer" />
      <Button variant="ghost" onClick={download}>{zh ? '下载' : 'Download'}</Button>
    </nav>}
    {notice && <p className="artifact-notice" role="status">{notice}</p>}
    {error && <Feedback kind="error">{error}</Feedback>}
    <div className={`artifact-preview-body artifact-kind-${kind}`} ref={body} onMouseUp={captureSelection} onKeyUp={captureSelection}>{preview}</div>
  </section>;
}
