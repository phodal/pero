import React, { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, Feedback, Icon, Select, ToggleGroup, ToggleGroupItem, Toolbar } from '@pero/app-sdk/ui';
import type { Api, DiscoveryBatch, DiscoveryPaper, DiscoveryRelation, Library, Paper } from './types';
import type { Translator } from './i18n';
import './discover-search.css';

export type DiscoveryOpening = { seed: Paper } | { historyId: string };
type Choice = { status: 'choose-seed'; candidates: DiscoveryPaper[] };
export function Discovery({ api, opening, library, locked, selected, onRefresh, onRead, onCompare, onReturn, onBack, t }: {
  api: Api; opening: DiscoveryOpening | null; library: Library; locked: boolean; selected: string[];
  onRefresh(): Promise<void>; onRead(paper: Paper): Promise<void>; onReturn(id: string): void;
  onCompare(paper: Paper, seedId: string): boolean; onBack(): void; t: Translator;
}) {
  const seed = opening && 'seed' in opening ? opening.seed : null;
  const [batch, setBatch] = useState<DiscoveryBatch | null>(null), [choices, setChoices] = useState<DiscoveryPaper[] | null>(null);
  const [relation, setRelation] = useState<DiscoveryRelation>('related'), [busy, setBusy] = useState(false), [action, setAction] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [refreshError, setRefreshError] = useState('');
  const retryHistory = useRef('');
  const version = useRef(0), last = useRef({ relation: 'related' as DiscoveryRelation, page: 1, workId: undefined as string | undefined });
  async function refreshLibrary(current = version.current) {
    setRefreshError('');
    try { await onRefresh(); } catch (reason) { if (version.current === current) setRefreshError(reason instanceof Error ? reason.message : String(reason)); }
  }
  async function load(next: DiscoveryRelation, page = 1, workId?: string, seedId = batch?.seedId ?? seed?.id) {
    if (!seedId) return;
    const current = ++version.current; setBusy(true); setError(''); setNotice(''); setChoices(null); setRefreshError('');
    retryHistory.current = ''; last.current = { relation: next, page, workId };
    try {
      const result = await api.post<DiscoveryBatch | Choice>('/api/discover', { seedId, relation: next, page, ...(workId ? { workId } : {}) });
      if (version.current !== current) return;
      if ('candidates' in result) { setChoices(result.candidates); setBatch(null); }
      else { setBatch(result); setRelation(result.relation); await refreshLibrary(current); }
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
    setBatch(null); setChoices(null); setRefreshError('');
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
      if (saveOnly) { await api.post('/api/favorites', { batchId: batch.id, workId: paper.id }); await refreshLibrary(current); if (current === version.current) setNotice(t('savedFavorite')); }
      else {
        const saved = await api.post<Paper>('/api/discoveries/read', { batchId: batch.id, workId: paper.id });
        await refreshLibrary(current);
        if (current === version.current) { if (compare) { if (onCompare(saved, batch.seedId)) setNotice(t('matrixReady')); } else await onRead(saved); }
      }
    } catch (e) { if (current === version.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { setAction(''); }
  }
  const seedTitle = batch?.seedTitle ?? seed?.title;
  return <section className="pa-discovery pa-explore" aria-label={t('discover')}>
    <header className="pa-discovery-head">
      <Button variant="ghost" className="pa-discovery-back" aria-label={t('backToLibrary')} onClick={onBack}><Icon name="chevron-left" size={16}/><span>{t('discover')}</span></Button>
      {seedTitle && <Button variant="ghost" className="pa-discovery-return" onClick={() => onReturn(batch?.seedId ?? seed!.id)}>{t('backToSeed')}</Button>}
      <h1 className="pa-discovery-seed-title">{seedTitle ?? t('discover')}</h1>
    </header>
    {!!library.discoveries?.length && <div className="pa-exploration-history"><Select label={t('explorationHistory')} value={batch?.id ?? ''} disabled={busy} onChange={id => { if (id) void reopen(id); }} options={[{ value: '', label: t('chooseExploration') }, ...(library.discoveries ?? []).map(item => ({ value: item.id, label: `${item.seedTitle} / ${t(item.relation)} / ${item.page}` }))]}/></div>}
    <ToggleGroup type="single" className="pa-discovery-relations" value={relation} onValueChange={value => { if (value) void load(value as DiscoveryRelation, 1, batch?.work.id ?? last.current.workId); }} disabled={busy || !!action || (!seed && !batch)} aria-label={t('discover')}>
      {(['related', 'references', 'citing'] as const).map(key => <ToggleGroupItem key={key} value={key}>{t(key)}</ToggleGroupItem>)}
    </ToggleGroup>
    {error && <Feedback kind="error"><span>{error}</span><Button onClick={() => void (retryHistory.current ? reopen(retryHistory.current) : load(last.current.relation, last.current.page, last.current.workId))}>{t('retry')}</Button></Feedback>}
    {error && batch && <p className="pa-muted">{t('discoveryRetained')}</p>}
    {refreshError && <Feedback kind="error"><span>{t('discoveryLibraryFailed')} {refreshError}</span><Button disabled={busy} onClick={() => void refreshLibrary()}>{t('retry')}</Button></Feedback>}
    {busy && <p role="status">{t('loading')}</p>}
    {notice && <p role="status" className="pa-discovery-notice">{notice}</p>}
    {choices ? <div className="pa-discovery-confirm"><h2>{t('confirmSeed')}</h2><p className="pa-muted">{t('confirmSeedCopy')}</p>{!choices.length && <p>{t('seedNotFoundCopy')}</p>}<ul className="pa-discovery-results">{choices.map(p => <li key={p.id} className="pa-hit"><div className="pa-hit-body"><h3 className="pa-discovery-title">{p.title}</h3><p className="pa-document-meta"><span>{p.authors.join(', ')}</span><span>{p.publicationDate}</span></p></div><Toolbar className="pa-hit-actions"><a href={p.fullTextUrl ?? p.url} target="_blank" rel="noreferrer">{t('original')}</a><Button onClick={() => void load(relation, 1, p.id)}>{t('useMatchingPaper')}</Button></Toolbar></li>)}</ul></div>
      : batch ? <>
        <details className="pa-retrieval-details"><summary>{t('retrievalDetails')}</summary><p>OpenAlex / {t(batch.relation)} / {batch.page}</p><p>{batch.work.title}</p><p>{batch.fetchedAt}</p></details>
        {!batch.items.length && <EmptyState heading={t('noDiscovery')} description={t('tryOtherRelation')}/>}
        <ul className="pa-discovery-results">{batch.items.map(paper => {
          const saved = (library.favorites ?? []).some(f => f.paper.id === paper.id);
          const reading = library.papers.find(p => p.source === 'openalex' && p.sourceId === paper.id);
          const included = !!reading && selected.includes(reading.id);
          return <li key={paper.id} data-work-id={paper.id} className="pa-hit">
            <div className="pa-hit-body">
              <h2><Button variant="ghost" className="pa-discovery-title" disabled={busy || !!action || !paper.abstract.trim()} onClick={() => void act(paper, false)}>{paper.title}</Button></h2>
              <p className="pa-document-meta"><span>{paper.publicationDate?.slice(0, 4) || t('dateUnavailable')}</span><span>{paper.citations == null ? t('citationsUnavailable') : `${paper.citations.toLocaleString()} ${t('citationCount')} (OpenAlex)`}</span></p>
              <p className="pa-muted">{paper.authors.join(', ')}</p>
              {paper.abstract ? <p className="pa-discovery-preview">{paper.abstract}</p> : <p className="pa-muted">{t('noDiscoveryAbstract')}</p>}
              <details className="pa-result-details"><summary>{t('details')}</summary>{paper.abstract && <p className="pa-prose">{paper.abstract}</p>}<a href={paper.fullTextUrl ?? paper.url} target="_blank" rel="noreferrer">{t('original')}</a></details>
            </div>
            <Toolbar className="pa-hit-actions">
              <Button disabled={busy || !!action || saved} onClick={() => void act(paper, false, true)}>{saved ? t('favorited') : action === paper.id ? t('loading') : t('favorite')}</Button>
              <Button disabled={busy || locked || !!action || !paper.abstract.trim() || included || new Set([...selected, batch.seedId, reading?.id ?? paper.id]).size > 5} onClick={() => void act(paper, true)}>{included ? t('inMatrix') : t('addToMatrix')}</Button>
            </Toolbar>
          </li>;
        })}</ul>
        <Toolbar><Button disabled={busy || !!action || batch.page <= 1} onClick={() => void load(relation, batch.page - 1, batch.work.id)}>{t('previousPage')}</Button><span>{batch.page}</span><Button disabled={busy || !!action || !batch.hasMore} onClick={() => void load(relation, batch.page + 1, batch.work.id)}>{t('nextPage')}</Button></Toolbar>
      </> : !error && !busy && <EmptyState heading={t('chooseDiscoverySeed')} description={t('chooseDiscoveryCopy')}/>}
  </section>;
}
