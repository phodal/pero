import React, { useEffect, useId, useRef, useState } from 'react';
import { Button, Feedback, Input, Select } from '@pero/app-sdk/ui';
import { LiteratureHits } from './library';
import type { Api, LocalSearchHit, LocalSearchResult, Paper, SearchItem } from './types';
import type { Translator } from './i18n';

const webSources = ['huggingface', 'alphaxiv', 'openalex', 'biorxiv', 'pubmed'];
type Scope = 'local' | 'web';

export function LibrarySearch({ api, t, onOpen, onAdded, activeHitId, children }: {
  api: Api; t: Translator; onOpen(hit: LocalSearchHit): Promise<void>; onAdded(paper: Paper, focus: boolean): Promise<void>; activeHitId?: string | null; children: React.ReactNode;
}) {
  const [scope, setScope] = useState<Scope>('local'), [query, setQuery] = useState(''), [source, setSource] = useState('all'), [priority, setPriority] = useState('recency');
  const [result, setResult] = useState<LocalSearchResult | null>(null), [web, setWeb] = useState<SearchItem[] | null>(null), [resultPriority, setResultPriority] = useState('default');
  const [warnings, setWarnings] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [adding, setAdding] = useState(''), [addError, setAddError] = useState<{ key: string; message: string } | null>(null);
  const epoch = useRef(0), mounted = useRef(true), form = useRef<HTMLFormElement>(null);
  const inputId = useId(), noteId = useId();
  const label = scope === 'local' ? t('localSearch') : t('findLabel');
  useEffect(() => () => { mounted.current = false; epoch.current++; }, []);
  function resetResults() {
    epoch.current++; setResult(null); setWeb(null); setBusy(false); setError(''); setWarnings([]); setAddError(null);
  }
  function change(value: string) { setQuery(value); resetResults(); }
  function choose(next: Scope) {
    if (next === scope) return;
    setScope(next);
    if (next === 'web' && query.length > 500) setQuery(query.slice(0, 500));
    resetResults();
  }
  async function searchLocal() {
    const version = ++epoch.current; setBusy(true); setError(''); setResult(null); setWeb(null);
    try {
      const found = await api.post<LocalSearchResult>('/api/library/search', { query });
      if (version === epoch.current) setResult(found);
    } catch (e) { if (version === epoch.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (version === epoch.current) setBusy(false); }
  }
  async function searchWeb() {
    const version = ++epoch.current; setBusy(true); setError(''); setResult(null); setWeb(null); setWarnings([]); setAddError(null);
    try {
      const found = await api.post<{ items: SearchItem[]; warnings?: (string | { source?: string; message?: string; error?: string })[] }>('/api/search', {
        query, limit: 12, priority, sources: source === 'all' ? webSources : [source],
      });
      if (mounted.current && version === epoch.current) {
        setWeb(found.items); setResultPriority(priority);
        setWarnings((found.warnings ?? []).map(value => typeof value === 'string' ? value : `${value.source ?? ''}: ${value.message ?? value.error ?? ''}`));
      }
    } catch (e) { if (mounted.current && version === epoch.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  function submit() {
    if (!query.trim() || busy) return;
    if (scope === 'local') void searchLocal(); else void searchWeb();
  }
  async function add(input: { id: string; source?: string }, key = input.id) {
    if (adding) return;
    setAdding(key); setAddError(null);
    try {
      const paper = await api.post<Paper>('/api/papers', { ...input, full: true });
      await onAdded(paper, mounted.current);
    } catch (e) { if (mounted.current) setAddError({ key, message: e instanceof Error ? e.message : String(e) }); }
    finally { if (mounted.current) setAdding(''); }
  }
  return <section className="pa-local-search" aria-label={label}>
    <form ref={form} className="pa-query-line" role="search" onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!event.nativeEvent.isComposing) submit(); } }}>
      <div className="pa-query-scope" role="radiogroup" aria-label={t('searchScope')}>
        <label><input type="radio" name="paper-search-scope" value="local" checked={scope === 'local'} onChange={() => choose('local')}/>{t('scopeLocal')}</label>
        <label><input type="radio" name="paper-search-scope" value="web" checked={scope === 'web'} onChange={() => choose('web')}/>{t('scopeWeb')}</label>
      </div>
      {scope === 'web' && <div className="pa-query-filters">
        <Select label={t('sourceLabel')} value={source} onChange={setSource} options={[{ value: 'all', label: t('allSources') }, { value: 'huggingface', label: 'Hugging Face' }, { value: 'alphaxiv', label: 'alphaXiv' }, { value: 'openalex', label: 'OpenAlex' }, { value: 'biorxiv', label: 'bioRxiv' }, { value: 'pubmed', label: 'PubMed' }]}/>
        <Select label={t('searchOrder')} value={priority} onChange={setPriority} options={[{ value: 'default', label: t('orderRelevant') }, { value: 'recency', label: t('orderNewest') }, { value: 'popular', label: t('orderCited') }]}/>
      </div>}
      <div className="pa-query-field">
        <label className="pa-sr-only" htmlFor={inputId}>{label}</label>
        <Input id={inputId} type="search" name="q" enterKeyHint="search" maxLength={scope === 'web' ? 500 : 2000} value={query} placeholder={scope === 'local' ? t('localSearch') : t('searchPlaceholder')} aria-describedby={scope === 'web' ? noteId : undefined} onChange={event => change(event.target.value)}/>
        {!!query && <Button variant="ghost" onClick={() => { change(''); form.current?.querySelector<HTMLInputElement>('input[type=search]')?.focus(); }}>{t('clearSearch')}</Button>}
        {scope === 'web' && !!query.trim() && <Button busy={adding === query} disabled={!!adding} onClick={() => void add({ id: query, ...(source !== 'all' ? { source } : {}) })}>{adding === query ? t('addingPaper') : t('fetchPaper')}</Button>}
        <Button onClick={submit} variant="primary" busy={busy} disabled={busy || !query.trim()}>{busy ? t('searching') : error ? t('retry') : t('search')}</Button>
      </div>
    </form>
    {scope === 'web' && <small id={noteId} className="pa-query-note">{t('publicSearch')}</small>}
    {busy && <p className="pa-sr-only" role="status">{t('searching')}</p>}
    {!!error && <Feedback kind="error">{error}</Feedback>}
    {scope === 'web' && addError?.key === query && <Feedback kind="error">{addError.message}</Feedback>}
    {scope === 'web' && warnings.map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
    {result ? <>
      <p className="pa-muted" role="status">{result.returned} / {result.totalMatches} {t('localPassages')}</p>
      {!result.items.length && <Feedback>{t('localNoMatches')}</Feedback>}
      {result.queryTruncated && <Feedback>{t('localQueryTruncated')}</Feedback>}
      <ol className="pa-local-results">{result.items.map(hit => <li key={hit.id} data-search-hit={hit.id} data-search-page={hit.page ?? undefined} data-current={activeHitId === hit.id ? 'true' : undefined}>
        <Button variant="ghost" aria-current={activeHitId === hit.id ? 'true' : undefined} onClick={() => void onOpen(hit)}>{hit.source.title}{hit.page ? ` · ${t('pdfPage')} ${hit.page}` : ''}</Button>
        <small>{hit.page ? 'PDF' : t(hit.source.contentKind === 'abstract' ? 'abstract' : hit.source.contentKind === 'report' ? 'sourceReport' : 'fullText')}{hit.heading ? ` · ${hit.heading}` : ''}</small>
        <p className="pa-local-preview">{hit.content}</p>
        <details><summary>{t('sourceDetails')}</summary><p>{hit.content}</p><small>{hit.source.url}</small><code>{hit.source.fileDigest ?? hit.source.contentDigest}</code></details>
      </li>)}</ol>
      <small>{t('localScope')}</small>
    </> : web ? <LiteratureHits results={web} resultPriority={resultPriority} adding={adding} addError={addError} onAdd={add} t={t}/> : !busy && !error && children}
  </section>;
}
