import React, { useEffect, useRef, useState } from 'react';
import { Button, Feedback, Field, Input } from '@pero/app-sdk/ui';
import type { Api, LocalSearchHit, LocalSearchResult } from './types';
import type { Translator } from './i18n';

export function LibrarySearch({ api, t, onOpen, children }: {
  api: Api; t: Translator; onOpen(hit: LocalSearchHit): Promise<void>; children: React.ReactNode;
}) {
  const [query, setQuery] = useState(''), [result, setResult] = useState<LocalSearchResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), form = useRef<HTMLDivElement>(null);
  useEffect(() => () => { epoch.current++; }, []);
  function change(value: string) {
    epoch.current++; setQuery(value); setResult(null); setBusy(false); setError('');
  }
  async function search() {
    if (!query.trim() || busy) return;
    const version = ++epoch.current; setBusy(true); setError(''); setResult(null);
    try {
      const found = await api.post<LocalSearchResult>('/api/library/search', { query });
      if (version === epoch.current) setResult(found);
    } catch (e) { if (version === epoch.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (version === epoch.current) setBusy(false); }
  }
  return <section className="pa-local-search" aria-label={t('localSearch')}>
    <div ref={form} role="search">
      <Field label={t('localSearch')}>{props => <Input {...props} type="search" maxLength={2000} value={query} onChange={event => change(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void search(); } }}/>}</Field>
      <div className="pa-actions"><Button disabled={busy || !query.trim()} onClick={() => void search()}>{busy ? t('searching') : error ? t('retry') : t('search')}</Button>
        {!!query && <Button variant="ghost" onClick={() => { change(''); form.current?.querySelector('input')?.focus(); }}>{t('clearSearch')}</Button>}</div>
    </div>
    {busy && <p role="status">{t('searching')}</p>}
    {!!error && <Feedback kind="error">{error}</Feedback>}
    {result ? <>
      <p className="pa-muted" role="status">{result.returned} / {result.totalMatches} {t('localPassages')}</p>
      {!result.items.length && <Feedback>{t('localNoMatches')}</Feedback>}
      {result.queryTruncated && <Feedback>{t('localQueryTruncated')}</Feedback>}
      <ol className="pa-local-results">{result.items.map(hit => <li key={hit.id} data-search-hit={hit.id} data-search-page={hit.page ?? undefined}>
        <Button variant="ghost" onClick={() => void onOpen(hit)}>{hit.source.title}{hit.page ? ` · ${t('pdfPage')} ${hit.page}` : ''}</Button>
        <small>{hit.page ? 'PDF' : t(hit.source.contentKind === 'abstract' ? 'abstract' : hit.source.contentKind === 'report' ? 'sourceReport' : 'fullText')}{hit.heading ? ` · ${hit.heading}` : ''}</small>
        <p className="pa-local-preview">{hit.content}</p>
        <details><summary>{t('sourceDetails')}</summary><p>{hit.content}</p><small>{hit.source.url}</small><code>{hit.source.fileDigest ?? hit.source.contentDigest}</code></details>
      </li>)}</ol>
      <small>{t('localScope')}</small>
    </> : !busy && !error && children}
  </section>;
}
