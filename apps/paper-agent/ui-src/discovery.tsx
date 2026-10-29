import React, { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, Feedback, Select, Toolbar } from '@pero/app-sdk/ui';
import type { Api, DiscoveryBatch, DiscoveryPaper, DiscoveryRelation, Library, Paper } from './types';
import type { Translator } from './i18n';

export type DiscoveryOpening = { seed: Paper } | { historyId: string };
type Choice = { status: 'choose-seed'; candidates: DiscoveryPaper[] };
export function Discovery({ api, opening, library, locked, selected, onRefresh, onRead, onCompare, onReturn, t }: {
  api: Api; opening: DiscoveryOpening | null; library: Library; locked: boolean; selected: string[];
  onRefresh(): Promise<void>; onRead(paper: Paper): Promise<void>; onReturn(id: string): void;
  onCompare(paper: Paper, seedId: string): boolean; t: Translator;
}) {
  const seed = opening && 'seed' in opening ? opening.seed : null;
  const [batch, setBatch] = useState<DiscoveryBatch | null>(null), [choices, setChoices] = useState<DiscoveryPaper[] | null>(null);
  const [relation, setRelation] = useState<DiscoveryRelation>('related'), [busy, setBusy] = useState(false), [action, setAction] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const retryHistory = useRef('');
  const version = useRef(0), last = useRef({ relation: 'related' as DiscoveryRelation, page: 1, workId: undefined as string | undefined });
  async function load(next: DiscoveryRelation, page = 1, workId?: string, seedId = batch?.seedId ?? seed?.id) {
    if (!seedId) return;
    const current = ++version.current; setBusy(true); setError(''); setNotice(''); setRelation(next); setChoices(null);
    retryHistory.current = ''; last.current = { relation: next, page, workId };
    try {
      const result = await api.post<DiscoveryBatch | Choice>('/api/discover', { seedId, relation: next, page, ...(workId ? { workId } : {}) });
      if (version.current !== current) return;
      if ('candidates' in result) { setChoices(result.candidates); setBatch(null); }
      else { setBatch(result); await onRefresh(); }
    } catch (e) { if (version.current === current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (version.current === current) setBusy(false); }
  }
  async function reopen(id: string) {
    retryHistory.current = id;
    const current = ++version.current; setBusy(true); setError(''); setNotice(''); setChoices(null);
    try {
      const saved = await api.get<DiscoveryBatch>(`/api/discoveries/${id}`);
      if (version.current === current) { setBatch(saved); setRelation(saved.relation); last.current = { relation: saved.relation, page: saved.page, workId: saved.work.id }; }
    } catch (e) { if (version.current === current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (version.current === current) setBusy(false); }
  }
  useEffect(() => {
    // Opening exploration is explicit; changing the reading alone never changes this seed.
    setBatch(null); setChoices(null);
    if (opening) {
      if ('seed' in opening) void load('related', 1, undefined, opening.seed.id);
      else void reopen(opening.historyId);
    }
    return () => { version.current++; };
  }, [opening]);
  async function act(paper: DiscoveryPaper, compare: boolean, saveOnly = false) {
    if (!batch || action) return;
    setAction(paper.id); setError(''); const current = version.current;
    try {
      if (saveOnly) { await api.post('/api/favorites', { batchId: batch.id, workId: paper.id }); await onRefresh(); if (current === version.current) setNotice(t('savedFavorite')); }
      else {
        const saved = await api.post<Paper>('/api/discoveries/read', { batchId: batch.id, workId: paper.id });
        await onRefresh();
        if (current === version.current) { if (compare) { if (onCompare(saved, batch.seedId)) setNotice(t('matrixReady')); } else await onRead(saved); }
      }
    } catch (e) { if (current === version.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { setAction(''); }
  }
  const seedTitle = batch?.seedTitle ?? seed?.title;
  return <section className="pa-discovery" aria-label={t('discover')}>
    <Toolbar actions={seedTitle && <Button variant="ghost" onClick={() => onReturn(batch?.seedId ?? seed!.id)}>{t('backToSeed')}</Button>}><h1>{seedTitle ?? t('discover')}</h1></Toolbar>
    <details className="pa-exploration-history"><summary>{t('explorationHistory')}</summary>
    <Select label={t('explorationHistory')} value={batch?.id ?? ''} disabled={busy} onChange={id => { if (id) void reopen(id); }} options={[{ value: '', label: t('chooseExploration') }, ...(library.discoveries ?? []).map(item => ({ value: item.id, label: `${item.seedTitle} / ${t(item.relation)} / ${item.page}` }))]}/></details>
    <Toolbar>{(['related', 'references', 'citing'] as const).map(key => <Button key={key} variant={key === relation ? 'primary' : 'ghost'} aria-pressed={key === relation} disabled={busy || !!action || (!seed && !batch)} onClick={() => void load(key, 1, batch?.work.id ?? last.current.workId)}>{t(key)}</Button>)}</Toolbar>
    {error && <Feedback kind="error"><span>{error}</span><Button onClick={() => void (retryHistory.current ? reopen(retryHistory.current) : load(last.current.relation, last.current.page, last.current.workId))}>{t('retry')}</Button></Feedback>}
    {notice && <p role="status" className="pa-discovery-notice">{notice}</p>}
    {busy ? <p role="status">{t('loading')}</p> : choices ? <div><h2>{t('confirmSeed')}</h2><p className="pa-muted">{t('confirmSeedCopy')}</p>{!choices.length && <p>{t('seedNotFoundCopy')}</p>}<ul className="pa-discovery-results">{choices.map(p => <li key={p.id}><h3>{p.title}</h3><p className="pa-document-meta"><span>{p.authors.join(', ')}</span><span>{p.publicationDate}</span></p><Toolbar><a href={p.url} target="_blank" rel="noreferrer">{t('original')}</a><Button onClick={() => void load(relation, 1, p.id)}>{t('useMatchingPaper')}</Button></Toolbar></li>)}</ul></div>
      : batch && !error ? <>
        <details className="pa-retrieval-details"><summary>{t('retrievalDetails')}</summary><p>OpenAlex</p><p>{batch.work.title}</p><p>{batch.fetchedAt}</p></details>
        {!batch.items.length && <EmptyState heading={t('noDiscovery')} description={t('tryOtherRelation')}/>}
        <ul className="pa-discovery-results">{batch.items.map(paper => {
          const saved = (library.favorites ?? []).some(f => f.paper.id === paper.id);
          const reading = library.papers.find(p => p.source === 'openalex' && p.sourceId === paper.id);
          const included = !!reading && selected.includes(reading.id);
          return <li key={paper.id} data-work-id={paper.id}>
            <h2><button type="button" className="pa-discovery-title" disabled={!!action || !paper.abstract.trim()} onClick={() => void act(paper, false)}>{paper.title}</button></h2><p className="pa-document-meta"><span>{paper.publicationDate?.slice(0, 4) || '—'}</span><span>{paper.citations} {t('citationCount')}</span></p><p className="pa-muted">{paper.authors.join(', ')}</p>
            {paper.abstract ? <p className="pa-discovery-preview">{paper.abstract}</p> : <p className="pa-muted">{t('noDiscoveryAbstract')}</p>}
            <Toolbar>
              <Button disabled={!!action || saved} onClick={() => void act(paper, false, true)}>{saved ? t('favorited') : action === paper.id ? t('loading') : t('favorite')}</Button>
              <Button disabled={locked || !!action || !paper.abstract.trim() || included || new Set([...selected, batch.seedId, reading?.id ?? paper.id]).size > 5} onClick={() => void act(paper, true)}>{included ? t('inMatrix') : t('addToMatrix')}</Button>
            </Toolbar>
            <details className="pa-result-details"><summary>{t('details')}</summary>{paper.abstract && <p className="pa-prose">{paper.abstract}</p>}<a href={paper.url} target="_blank" rel="noreferrer">{t('original')}</a></details>
          </li>;
        })}</ul>
        <Toolbar><Button disabled={busy || !!action || batch.page <= 1} onClick={() => void load(relation, batch.page - 1, batch.work.id)}>{t('previousPage')}</Button><span>{batch.page}</span><Button disabled={busy || !!action || !batch.hasMore} onClick={() => void load(relation, batch.page + 1, batch.work.id)}>{t('nextPage')}</Button></Toolbar>
      </> : !error && <EmptyState heading={t('chooseDiscoverySeed')} description={t('chooseDiscoveryCopy')}/>}
  </section>;
}
