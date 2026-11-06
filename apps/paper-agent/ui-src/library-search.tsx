import React, { useEffect, useId, useRef, useState } from 'react';
import { Disclosure, Button, EmptyIllustration, EmptyState, Feedback, Icon, IconButton, SearchField, LoadingSkeleton, SkeletonText } from '@pero/app-sdk/ui';
import type { Api, LocalSearchHit, LocalSearchResult } from './types';
import type { Translator } from './i18n';

function markedPassage(text: string, terms: string[]) {
  const useful = [...terms].filter(term => term.length >= 2).sort((left, right) => right.length - left.length);
  if (!useful.length) return text;
  const pattern = new RegExp(useful.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const parts = text.split(pattern);
  const matches = text.match(pattern) ?? [];
  return parts.map((part, index) => <React.Fragment key={index}>{part}{matches[index] ? <mark>{matches[index]}</mark> : null}</React.Fragment>);
}

function hitMeta(hit: LocalSearchHit, t: Translator) {
  const year = hit.source.fetchedAt?.slice(0, 4);
  const kind = hit.page != null ? 'PDF' : t(hit.source.contentKind === 'abstract' ? 'abstract' : hit.source.contentKind === 'report' ? 'sourceReport' : 'fullText');
  const place = hit.page != null ? `${t('pdfPage')} ${hit.page}` : '';
  return [year, kind, place, hit.heading].filter((part): part is string => !!part);
}

export function LibrarySearch({ api, t, onOpen, activeHitId, onQueryChange, onFind, children }: {
  api: Api; t: Translator; onOpen(hit: LocalSearchHit): Promise<void>; activeHitId?: string | null;
  onQueryChange?(query: string): void; onFind?(): void; children: React.ReactNode;
}) {
  const [query, setQuery] = useState(''), [activeQuery, setActiveQuery] = useState('');
  const [result, setResult] = useState<LocalSearchResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), mounted = useRef(true), form = useRef<HTMLFormElement>(null);
  const inputId = useId();
  useEffect(() => () => { mounted.current = false; epoch.current++; }, []);
  useEffect(() => { onQueryChange?.(result?.items.length ? activeQuery : ''); }, [result, activeQuery, onQueryChange]);
  function resetResults() {
    epoch.current++; setResult(null); setActiveQuery(''); setBusy(false); setError('');
  }
  function change(value: string) { setQuery(value); resetResults(); }
  async function searchLocal() {
    const current = query;
    const version = ++epoch.current; setBusy(true); setError('');
    try {
      const found = await api.post<LocalSearchResult>('/api/library/search', { query: current });
      if (version === epoch.current) { setResult(found); setActiveQuery(current); }
    } catch (e) { if (version === epoch.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (version === epoch.current) setBusy(false); }
  }
  function submit() {
    if (!query.trim() || busy) return;
    void searchLocal();
  }
  function clear() {
    change('');
    form.current?.querySelector<HTMLInputElement>('input[type=search]')?.focus();
  }
  const papers = result ? new Set(result.items.map(hit => hit.source.paperId)).size : 0;
  return <section className="pa-local-search" aria-label={t('localSearch')}>
    <form ref={form} className="pa-query-line" role="search" onSubmit={event => { event.preventDefault(); submit(); }}>
      <label className="pa-sr-only" htmlFor={inputId}>{t('localSearch')}</label>
      <SearchField id={inputId} name="q" enterKeyHint="search" maxLength={2000} value={query} placeholder={t('librarySearchPlaceholder')} onChange={event => change(event.target.value)} onKeyDown={event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (!event.nativeEvent.isComposing) submit();
      }}/>
      {!!query && <IconButton label={t('clearSearch')} onClick={clear}><Icon name="close" size={16}/></IconButton>}
      <IconButton label={t('search')} busy={busy} disabled={busy || !query.trim()} onClick={submit}><Icon name="search" size={18}/></IconButton>
    </form>
    {busy && (result ? <Feedback kind="status">{t('searching')}</Feedback> : <LoadingSkeleton label={t('searching')}><SkeletonText/></LoadingSkeleton>)}
    {!!error && <Feedback kind="error">{error}{result && ` ${t('localSearchRetained')}`}<Button disabled={busy} onClick={submit}>{t('retry')}</Button></Feedback>}
    {result ? <>
      <div className="pa-results-caption" role="status">
        <span><strong>{papers}</strong> {t('papers')}<span className="pa-meta-gap"/>{result.returned} {t('passages')}</span>
        <span>{t('bestMatches')}</span>
      </div>
      {result.queryTruncated && <Feedback>{t('localQueryTruncated')}</Feedback>}
      {!busy && !result.items.length && <EmptyState icon={<EmptyIllustration kind="search" size="compact"/>} description={t('localNoMatches')}
        actions={onFind && <Button variant="ghost" onClick={onFind}>{t('findMore')}</Button>}/>}
      <ol className="pa-local-results">{result.items.map(hit => <li key={hit.id} data-search-hit={hit.id} data-search-page={hit.page ?? undefined} data-current={activeHitId === hit.id ? 'true' : undefined}>
        <div className="pa-local-hit">
          <span className="pa-paper-file" aria-hidden="true"><Icon name="document" size={18}/></span>
          <div className="pa-local-hit-name">
            <Button variant="ghost" className="pa-local-title" aria-current={activeHitId === hit.id ? 'true' : undefined} onClick={() => void onOpen(hit)}>{hit.source.title}</Button>
            <div className="pa-meta-line">{hitMeta(hit, t).map((part, index) => <span key={`${index}:${part}`}>{part}</span>)}</div>
          </div>
        </div>
        <p className="pa-local-passage">{markedPassage(hit.content, result.queryTerms ?? [])}</p>
        <Disclosure variant="inline" summary={<>{t('sourceDetails')}</>}><p>{hit.content}</p><small>{hit.source.url}</small><code>{hit.source.fileDigest ?? hit.source.contentDigest}</code></Disclosure>
      </li>)}</ol>
      <small>{t('localScope')}</small>
    </> : !busy && !error && children}
  </section>;
}
