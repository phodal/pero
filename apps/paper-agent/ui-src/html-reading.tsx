import React, { useEffect, useRef, useState } from 'react';
import { useAppContext, useAppI18n } from '@pero/app-sdk';
import { Button, Disclosure, Feedback } from '@pero/app-sdk/ui';
import { mountPaperReader, type OutlineEntry, type ReaderSelection } from '@pero/paper-reader';

/** App adapter: fetch the existing immutable original, own theme and discussion. */
export function HtmlReading({ id, sourceUrl, onDiscuss, renderSelection, children, recorded }: {
  recorded: boolean; id: string; sourceUrl: string; onDiscuss?(text: string): void; children: React.ReactNode; renderSelection?(selection: ReaderSelection): React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const reader = useRef<ReturnType<typeof mountPaperReader> | null>(null);
  const { dark } = useAppContext();
  const { t } = useAppI18n({ loading: { zh: '正在加载正文…', en: 'Loading article…' }, contents: { zh: '目录', en: 'Contents' }, discuss: { zh: '提问选中文本', en: 'Ask about selection' }, retry: { zh: '重试', en: 'Retry' } });
  const [outline, setOutline] = useState<readonly OutlineEntry[]>([]);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [status, setStatus] = useState('loading'), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (recorded) return;
    const abort = new AbortController();
    let mounted: ReturnType<typeof mountPaperReader> | null = null;
    const positionKey = `paper-html-position:${id}`;
    const container = root.current?.closest('.pa-text-reading');
    const position = Number(localStorage.getItem(positionKey) ?? 0);
    const save = () => localStorage.setItem(positionKey, String(container?.scrollTop ?? 0));
    setStatus('loading'); setError(''); setSelection(null); setOutline([]);
    fetch(`/api/paper-documents/${id}/original`, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw Error(`HTML: ${response.status}`);
      const html = await response.text();
      if (abort.signal.aborted) return;
      mounted = mountPaperReader(root.current!, { source: { id, html, sourceUrl }, frameUrl: new URL('./_paper-reader/frame.html', location.href).href,
        appearance: { dark }, onSelection: setSelection, onOpenLink: url => window.open(url, '_blank', 'noopener,noreferrer') });
      reader.current = mounted;
      await mounted.ready;
      if (abort.signal.aborted) return;
      setOutline(mounted.outline); setStatus('ready');
      requestAnimationFrame(() => { if (!abort.signal.aborted && container) { container.scrollTop = position; container.addEventListener('scroll', save, { passive: true }); } });
    }).catch(error => { if (!abort.signal.aborted) { setError(String(error.message ?? error)); setStatus('error'); } });
    return () => { abort.abort(); container?.removeEventListener('scroll', save); mounted?.dispose(); reader.current = null; };
  }, [id, sourceUrl, attempt, recorded]);
  useEffect(() => { reader.current?.updateAppearance({ dark }); }, [dark, status]);
  if (recorded) return <>{children}</>;
  return <div className="pa-html-reading">
    {status === 'loading' && <p role="status">{t('loading')}</p>}
    {error && <Feedback kind="error">{error}<Button onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button></Feedback>}
    {!!outline.length && <Disclosure summary={t('contents')}><nav aria-label={t('contents')}>{outline.map(item => <button key={item.id} className="pa-text-contents-item" onClick={() => reader.current?.reveal(item.id)}>{item.title}</button>)}</nav></Disclosure>}
    {selection && <div className="pa-html-selection">{onDiscuss && <Button onClick={() => onDiscuss(selection.text)}>{t('discuss')}</Button>}{renderSelection?.(selection)}</div>}
    <div ref={root}/>
    {status === 'error' && children}
  </div>;
}
