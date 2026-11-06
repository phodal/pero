import React, { useEffect, useRef, useState } from 'react';
import { useAppContext, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Icon, Popover } from '@pero/app-sdk/ui';
import { mountPaperReader, type OutlineEntry, type ReaderSelection } from '@pero/paper-reader';

type ImageManifest = { assets: { url: string; digest: string }[]; status: string };

/** App adapter: fetch the existing immutable original, own theme and discussion. */
export function HtmlReading({ id, sourceUrl, onDiscuss, renderSelection, children, recorded }: {
  recorded: boolean; id: string; sourceUrl: string; onDiscuss?(text: string): void; children: React.ReactNode; renderSelection?(selection: ReaderSelection): React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const reader = useRef<ReturnType<typeof mountPaperReader> | null>(null);
  const { dark } = useAppContext();
  const { t } = useAppI18n({
    loading: { zh: '正在加载正文…', en: 'Loading article…' },
    contents: { zh: '目录', en: 'Contents' },
    discuss: { zh: '提问选中文本', en: 'Ask about selection' },
    retry: { zh: '重试', en: 'Retry' },
    images: { zh: '正在下载图片…', en: 'Downloading images…' },
  });
  const [outline, setOutline] = useState<readonly OutlineEntry[]>([]);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [status, setStatus] = useState('loading'), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [imageStatus, setImageStatus] = useState('');
  useEffect(() => {
    if (recorded) return;
    const abort = new AbortController();
    let mounted: ReturnType<typeof mountPaperReader> | null = null;
    const positionKey = `paper-html-position:${id}`;
    const container = root.current?.closest('.pa-text-reading');
    const save = () => localStorage.setItem(positionKey, String(container?.scrollTop ?? 0));
    setStatus('loading'); setError(''); setSelection(null); setOutline([]); setImageStatus('');
    function paint(html: string, assets?: Map<string, string>) {
      const position = Number(localStorage.getItem(positionKey) ?? 0);
      mounted?.dispose();
      mounted = mountPaperReader(root.current!, {
        source: { id, html, sourceUrl, assets },
        frameUrl: new URL('./_paper-reader/frame.html', location.href).href,
        appearance: { dark }, onSelection: setSelection, onOpenLink: url => window.open(url, '_blank', 'noopener,noreferrer'),
      });
      reader.current = mounted;
      return mounted.ready.then(() => {
        if (abort.signal.aborted) return;
        setOutline(mounted!.outline); setStatus('ready');
        requestAnimationFrame(() => {
          if (abort.signal.aborted || !container) return;
          container.removeEventListener('scroll', save);
          container.scrollTop = position;
          container.addEventListener('scroll', save, { passive: true });
        });
      });
    }
    async function open() {
      const htmlResponse = await fetch(`/api/paper-documents/${id}/original`, { signal: abort.signal });
      if (!htmlResponse.ok) throw Error(`HTML: ${htmlResponse.status}`);
      const html = await htmlResponse.text();
      if (abort.signal.aborted) return;
      await paint(html);
      setImageStatus('loading');
      try {
        const response = await fetch(`/api/paper-documents/${id}/images`, { signal: abort.signal });
        if (!response.ok) throw Error(`Images: ${response.status}`);
        const manifest = await response.json() as ImageManifest;
        if (abort.signal.aborted) return;
        setImageStatus(manifest.status === 'complete' ? 'ready' : manifest.assets.length ? 'partial' : 'empty');
        if (!manifest.assets.length) return;
        const assets = new Map(manifest.assets.map(asset => [asset.url, `/api/paper-documents/${id}/images/${asset.digest}`]));
        await paint(html, assets);
      } catch {
        if (!abort.signal.aborted) setImageStatus('error');
      }
    }
    open().catch(error => { if (!abort.signal.aborted) { setError(String(error.message ?? error)); setStatus('error'); } });
    return () => { abort.abort(); container?.removeEventListener('scroll', save); mounted?.dispose(); reader.current = null; };
  }, [id, sourceUrl, attempt, recorded]);
  useEffect(() => { reader.current?.updateAppearance({ dark }); }, [dark, status]);
  if (recorded) return <>{children}</>;
  return <div className="pa-html-reading">
    <div className="pa-html-chrome">
      {!!outline.length && <Popover className="pa-html-toc" label={t('contents')} align="end" triggerVariant="ghost" trigger={<><Icon name="layout-list" size={14}/><span>{t('contents')}</span></>} contentClassName="pa-html-toc-panel" popupRole="menu">
        {close => <nav aria-label={t('contents')}>{outline.map(item => <Button variant="ghost" key={item.id} type="button" role="menuitem" className="pa-text-contents-item" data-level={item.level} onClick={() => { reader.current?.reveal(item.id); close(); }}>{item.title}</Button>)}</nav>}
      </Popover>}
      {imageStatus === 'loading' && <p className="pa-html-image-status" role="status">{t('images')}</p>}
      {selection && <div className="pa-html-selection">{onDiscuss && <Button onClick={() => onDiscuss(selection.text)}>{t('discuss')}</Button>}{renderSelection?.(selection)}</div>}
    </div>
    {status === 'loading' && <p role="status">{t('loading')}</p>}
    {error && <Feedback kind="error">{error}<Button onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button></Feedback>}
    <div ref={root}/>
    {status === 'error' && children}
  </div>;
}
