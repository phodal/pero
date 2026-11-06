import React, { useEffect, useId, useRef, useState } from 'react';
import JSX = React.JSX;
import { useAppI18n } from '@pero/app-sdk';
import { Disclosure, Button, Checkbox, EmptyIllustration, EmptyState, Feedback, Icon, LoadingSkeleton, SearchField, Select, SkeletonBlock } from '@pero/app-sdk/ui';
import type { Api, Paper, SearchItem } from './types';
import './discover-search.css';

const messages = {
  heading: { zh: '发现', en: 'Discover' },
  subtitle: { zh: '为你的研究找到下一篇论文。', en: 'Find the next paper for your research.' },
  idle: { zh: '搜索主题、作者或标题，把下一篇论文加入文库。', en: 'Search a topic, author, or title to add the next paper.' },
  addByLink: { zh: '通过链接添加', en: 'Add by link' },
  searchLabel: { zh: '检索文献', en: 'Search literature' },
  placeholder: { zh: '搜索论文、主题或作者…', en: 'Search papers, topics, or authors…' },
  search: { zh: '搜索', en: 'Search' },
  searching: { zh: '搜索中', en: 'Searching' },
  refreshing: { zh: '正在更新检索，下方保留上次结果。', en: 'Updating the search. Previous results remain below.' },
  retained: { zh: '更新未完成，下方仍显示上次检索结果。', en: 'The update did not finish. Previous search results remain below.' },
  sourceLabel: { zh: '文献来源', en: 'Literature source' },
  allSources: { zh: '全部来源', en: 'All sources' },
  fullTextAvailable: { zh: '有全文', en: 'Full text available' },
  sortBy: { zh: '排序', en: 'Sort by' },
  relevance: { zh: '相关度', en: 'Relevance' },
  newest: { zh: '最新', en: 'Newest' },
  cited: { zh: '引用最多', en: 'Most cited' },
  titleSort: { zh: '标题 A–Z', en: 'Title A–Z' },
  publicNote: { zh: '查询会发送到所选公共文献服务。', en: 'Queries are sent to the selected public literature services.' },
  warnOne: { zh: '有一个来源暂不可用。其他结果已就绪。', en: 'One source is unavailable. Other results are ready.' },
  warnMany: { zh: '有部分来源暂不可用。其他结果已就绪。', en: 'Some sources are unavailable. Other results are ready.' },
  warnDetails: { zh: '来源说明', en: 'Source details' },
  retry: { zh: '重试', en: 'Retry' },
  count: { zh: '{n} 篇论文，关于', en: '{n} papers for' },
  countOne: { zh: '{n} 篇论文，关于', en: '{n} paper for' },
  fullText: { zh: '全文', en: 'Full text' },
  abstract: { zh: '摘要', en: 'Abstract' },
  viewDetails: { zh: '查看详情', en: 'View details' },
  inLibrary: { zh: '已在文库', en: 'In library' },
  add: { zh: '添加', en: 'Add' },
  adding: { zh: '添加中', en: 'Adding' },
  citations: { zh: '{n} 次引用', en: '{n} citations' },
  empty: { zh: '没有论文符合这些筛选条件', en: 'No papers match these filters' },
  clear: { zh: '清除筛选', en: 'Clear filters' },
  original: { zh: '原文', en: 'Original' },
  project: { zh: '项目', en: 'Project' },
  searchFailed: { zh: '检索失败。', en: 'Search failed.' },
  addFailed: { zh: '无法添加这篇论文。', en: 'Could not add this paper.' },
  etAl: { zh: '等', en: 'et al.' },
};

const sourceNames: Record<string, string> = {
  huggingface: 'Hugging Face',
  alphaxiv: 'alphaXiv',
  openalex: 'OpenAlex',
  biorxiv: 'bioRxiv',
  pubmed: 'PubMed',
};
const allSources = ['huggingface', 'alphaxiv', 'openalex', 'biorxiv', 'pubmed'];
type Sort = 'relevance' | 'newest' | 'cited' | 'title';
type WarningValue = string | { source?: string; message?: string; error?: string };
type Copy = (key: string, vars?: Record<string, string | number>) => string;

function sourceName(source: string) {
  return sourceNames[source] ?? source;
}
function warningLines(warnings: WarningValue[] | undefined) {
  return (warnings ?? []).map(value => typeof value === 'string' ? value : `${value.source ?? ''}: ${value.message ?? value.error ?? ''}`).filter(value => value.trim() !== '' && value.trim() !== ':');
}
function authorLine(authors: string[] | undefined, etAl: string) {
  if (!authors?.length) return '';
  const head = authors.slice(0, 4).join(', ');
  return authors.length > 4 ? `${head} ${etAl}` : head;
}
function doiHref(doi: string) {
  if (/^https?:\/\//i.test(doi)) return doi;
  return `https://doi.org/${doi.replace(/^doi:/i, '')}`;
}
function hitKey(item: SearchItem) {
  return `${item.source}:${item.id}`;
}
function hasFullText(item: SearchItem) {
  return !!(item.pdfUrl || item.fullTextUrl);
}
function publicationDay(value: string | null | undefined) {
  const text = (value ?? '').trim();
  if (!text) return '';
  const day = text.match(/\d{4}-\d{2}-\d{2}/);
  if (day) return day[0];
  if (/^\d{4}$/.test(text)) return text;
  return text;
}

export function DiscoverSearch({ api, papers, active, onAdded, onOpenSaved, onAddByLink }: {
  api: Api;
  papers: Paper[];
  active: boolean;
  onAdded(paper: Paper, focus: boolean): Promise<void>;
  onOpenSaved(paper: Paper): void;
  onAddByLink(): void;
}): JSX.Element {
  const { t } = useAppI18n(messages);
  const noteId = useId();
  const field = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const burst = useRef(false);
  const attempted = useRef('');
  const resolvedSearch = useRef<{ query: string; source: string; sort: Sort } | null>(null);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState<Sort>('relevance');
  const [fullText, setFullText] = useState(false);
  const [submitted, setSubmitted] = useState('');
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState('');
  const [addError, setAddError] = useState<{ key: string; message: string } | null>(null);
  const [saved, setSaved] = useState<Record<string, Paper>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<'source' | 'sort' | ''>('');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current += 1; }; }, []);
  useEffect(() => { if (active) field.current?.focus(); }, [active]);

  async function run(q: string, src: string, order: Sort) {
    const trimmed = q.trim();
    if (!trimmed) return;
    const version = ++epoch.current;
    attempted.current = trimmed;
    const previous = resolvedSearch.current;
    if (!previous || previous.query !== trimmed || previous.source !== src || previous.sort !== order) {
      setResults(null); setWarnings([]); resolvedSearch.current = null;
    }
    setBusy(true); setError('');
    try {
      const result = await api.post<{ items?: SearchItem[]; warnings?: WarningValue[] }>('/api/search', {
        query: trimmed, limit: 12,
        priority: order === 'newest' ? 'recency' : order === 'cited' ? 'popular' : 'default',
        sources: src === 'all' ? allSources : [src],
      });
      if (!mounted.current || version !== epoch.current) return;
      const items = Array.isArray(result.items) ? result.items : [];
      resolvedSearch.current = { query: trimmed, source: src, sort: order };
      setResults(order === 'title' ? [...items].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })) : items);
      setSubmitted(trimmed);
      setWarnings(warningLines(result.warnings));
    } catch (caught) {
      if (!mounted.current || version !== epoch.current) return;
      setError(caught instanceof Error && caught.message ? caught.message : t('searchFailed'));
    } finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  function submitQuery() {
    if (busy || burst.current) return;
    burst.current = true;
    queueMicrotask(() => { burst.current = false; });
    void run(query, source, sort);
  }
  function changeSource(next: string) {
    setSource(next);
    if (attempted.current) void run(attempted.current, next, sort);
  }
  function changeSort(next: Sort) {
    setSort(next);
    if (attempted.current) void run(attempted.current, source, next);
  }
  function clearFilters() {
    const refetch = !!attempted.current && (source !== 'all' || sort !== 'relevance');
    setFullText(false); setSource('all'); setSort('relevance');
    if (refetch) void run(attempted.current, 'all', 'relevance');
  }
  async function add(item: SearchItem) {
    const key = hitKey(item);
    if (adding) return;
    setAdding(key); setAddError(null);
    try {
      const paper = await api.post<Paper>('/api/papers', { id: item.id, source: item.source, full: true });
      await onAdded(paper, false);
      if (mounted.current) setSaved(current => ({ ...current, [key]: paper }));
    } catch (caught) {
      if (mounted.current) setAddError({ key, message: caught instanceof Error && caught.message ? caught.message : t('addFailed') });
    } finally { if (mounted.current) setAdding(''); }
  }

  const visible = results?.filter(item => !fullText || hasFullText(item)) ?? [];
  const canClear = !!results && visible.length === 0 && ((fullText && results.length > 0) || source !== 'all');
  const retry = () => { void run(attempted.current || submitted || query, source, sort); };

  return <section className="pa-discover" aria-label={t('heading')} aria-busy={busy}>
    <header className="pa-discover-toolbar">
      <p>{t('subtitle')}</p>
      <Button className="pa-discover-secondary" onClick={onAddByLink}><Icon name="link" size={16}/>{t('addByLink')}</Button>
    </header>
    <form className="pa-discover-search" role="search" aria-label={t('searchLabel')} onSubmit={event => { event.preventDefault(); submitQuery(); }}>
      <SearchField ref={field} aria-label={t('searchLabel')} aria-describedby={noteId} placeholder={t('placeholder')} value={query} maxLength={500} autoComplete="off" spellCheck={false} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submitQuery(); } }}/>
      <Button type="submit" variant="primary" disabled={busy || !query.trim()} aria-busy={busy}>{busy ? t('searching') : t('search')}<Icon name="arrow" size={16}/></Button>
    </form>
    <p id={noteId} className="pa-discover-note">{t('publicNote')}</p>
    <div className="pa-discover-filters">
      <div className="pa-discover-filter-start">
        <Select label={t('sourceLabel')} value={source} menuMinWidth={180} open={menu === 'source'} onOpenChange={next => setMenu(next ? 'source' : '')} onChange={changeSource} options={[
          { value: 'all', label: t('allSources') },
          ...allSources.map(value => ({ value, label: sourceName(value) })),
        ]}/>
        <label className="pa-discover-check"><Checkbox checked={fullText} onCheckedChange={value => setFullText(value === true)}/>{t('fullTextAvailable')}</label>
      </div>
      <div className="pa-discover-sort"><span>{t('sortBy')}</span>
        <Select label={t('sortBy')} value={sort} menuMinWidth={160} open={menu === 'sort'} onOpenChange={next => setMenu(next ? 'sort' : '')} onChange={next => { if (next === 'relevance' || next === 'newest' || next === 'cited' || next === 'title') changeSort(next); }} options={[
          { value: 'relevance', label: t('relevance') },
          { value: 'newest', label: t('newest') },
          { value: 'cited', label: t('cited') },
          { value: 'title', label: t('titleSort') },
        ]}/>
      </div>
    </div>
    {!!warnings.length && results && <div className="pa-discover-warn" role="status">
      <Icon name="info" size={16}/>
      <div className="pa-discover-warn-copy">
        {!!results.length && <p>{warnings.length > 1 ? t('warnMany') : t('warnOne')}</p>}
        <Disclosure variant="inline" summary={<>{t('warnDetails')}</>}><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></Disclosure>
      </div>
      <Button variant="ghost" className="pa-discover-retry" onClick={retry}>{t('retry')}<Icon name="refresh" size={14}/></Button>
    </div>}
    {error && <div className="pa-discover-error" role="alert"><p>{error}{results && ` ${t('retained')}`}</p><Button variant="ghost" className="pa-discover-retry" onClick={retry}>{t('retry')}<Icon name="refresh" size={14}/></Button></div>}
    {busy && (results ? <Feedback kind="status">{t('refreshing')}</Feedback> : <LoadingSkeleton className="pa-discover-loading" label={t('searching')}>{[0, 1, 2].map(row => <div className="pa-discover-skeleton" key={row}>
      <SkeletonBlock width="28%"/>
      <SkeletonBlock shape="title" width={row === 1 ? '72%' : '88%'}/>
      <SkeletonBlock width="46%"/>
      <SkeletonBlock width="100%"/>
      <SkeletonBlock width="64%"/>
    </div>)}</LoadingSkeleton>)}
    {!!visible.length && <p className="pa-discover-count" role="status">{t(visible.length === 1 ? 'countOne' : 'count', { n: visible.length })} <strong>{submitted}</strong></p>}
    {!!visible.length && <ul className="pa-discover-results">{visible.map(item => {
      const key = hitKey(item);
      const paper = saved[key] ?? papers.find(candidate => (candidate.source === item.source && candidate.sourceId === item.id) || (!!item.url && candidate.url === item.url));
      return <DiscoverHit key={key} item={item} paper={paper} adding={adding === key} locked={!!adding} error={addError?.key === key ? addError.message : ''} open={!!open[key]} onOpenChange={next => setOpen(current => current[key] === next ? current : { ...current, [key]: next })} onAdd={() => void add(item)} onOpen={onOpenSaved} t={t}/>;
    })}</ul>}
    {!error && !busy && !results && !menu && <EmptyState icon={<EmptyIllustration kind="documents"/>} description={t('idle')}/>}
    {!error && !busy && results && visible.length === 0 && <EmptyState icon={<EmptyIllustration kind="search" size="compact"/>} heading={t('empty')}
      actions={canClear && <Button variant="ghost" onClick={clearFilters}>{t('clear')}</Button>}/>}
  </section>;
}

function DiscoverHit({ item, paper, adding, locked, error, open, onOpenChange, onAdd, onOpen, t }: {
  item: SearchItem; paper?: Paper; adding: boolean; locked: boolean; error: string; open: boolean;
  onOpenChange(open: boolean): void; onAdd(): void; onOpen(paper: Paper): void; t: Copy;
}) {
  const panelId = `pa-hit-${hitKey(item).replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const published = publicationDay(item.publicationDate);
  const authors = authorLine(item.authors, t('etAl'));
  const links = [
    item.url ? { href: item.url, label: t('original') } : null,
    item.pdfUrl ? { href: item.pdfUrl, label: 'PDF' } : null,
    item.fullTextUrl && item.fullTextUrl !== item.url && item.fullTextUrl !== item.pdfUrl ? { href: item.fullTextUrl, label: t('fullText') } : null,
    item.githubUrl ? { href: item.githubUrl, label: 'GitHub' } : null,
    item.projectUrl && item.projectUrl !== item.githubUrl ? { href: item.projectUrl, label: t('project') } : null,
    item.doi ? { href: doiHref(item.doi), label: 'DOI' } : null,
    item.paperUrl && item.paperUrl !== item.url ? { href: item.paperUrl, label: sourceName(item.source) } : null,
  ].filter((link): link is { href: string; label: string } => !!link);
  const showDetails = !!item.abstract || links.length > 0 || !!item.alternatives?.length;
  return <li className="pa-hit">
    <div className="pa-hit-body">
      <p className="pa-hit-meta"><span className="pa-hit-source">{sourceName(item.source)}</span>{published && <span className="pa-hit-date">{published}</span>}<span>{hasFullText(item) ? t('fullText') : t('abstract')}</span></p>
      <h2>{showDetails
        ? <Button variant="ghost" className="pa-hit-title" aria-expanded={open} aria-controls={panelId} onClick={() => { const details = detailsRef.current; if (details) details.open = !details.open; }}>{item.title}</Button>
        : <span className="pa-hit-title">{item.title}</span>}</h2>
      {authors && <p className="pa-hit-authors">{authors}</p>}
      {item.abstract && <p className="pa-hit-abstract">{item.abstract}</p>}
      {(item.citations != null || showDetails) && <div className="pa-hit-foot">
        {item.citations != null && <span>{t('citations', { n: item.citations.toLocaleString() })}</span>}
        {showDetails && <Disclosure variant="inline" ref={detailsRef} id={panelId} className="pa-hit-details" onOpenChange={onOpenChange} summary={<>{t('viewDetails')}</>}>
          <div className="pa-hit-extra">
            {item.abstract && <p className="pa-hit-full">{item.abstract}</p>}
            {!!links.length && <div className="pa-hit-links">{links.map(link => <a key={link.label + link.href} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>)}</div>}
            {!!item.alternatives?.length && <ul className="pa-hit-alts">{item.alternatives.map(alternative => <li key={`${alternative.source}:${alternative.id}`}>{alternative.url ? <a href={alternative.url} target="_blank" rel="noreferrer">{sourceName(alternative.source)}</a> : sourceName(alternative.source)}</li>)}</ul>}
          </div>
        </Disclosure>}
      </div>}
    </div>
    <div className="pa-hit-side">
      {paper
        ? <Button variant="link" className="pa-in-library" aria-label={`${t('inLibrary')}: ${item.title}`} onClick={() => onOpen(paper)}><Icon name="check" size={15}/>{t('inLibrary')}</Button>
        : <Button className="pa-hit-add" aria-label={`${adding ? t('adding') : t('add')}: ${item.title}`} disabled={locked} aria-busy={adding} onClick={onAdd}><Icon name="plus" size={15}/>{adding ? t('adding') : t('add')}</Button>}
      {error && <p className="pa-hit-error" role="alert">{error}</p>}
    </div>
  </li>;
}
