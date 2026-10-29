import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, EmptyState, Feedback, Field, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Toolbar } from '@pero/app-sdk/ui';
import type { Api, Paper, SearchItem } from './types';
import type { Translator } from './i18n';

export function ImportPanel({ api, t, active, onAdded, onClose, onError }: { api: Api; active: boolean; t: Translator; onAdded(paper: Paper, focus: boolean): Promise<void>; onClose(): void; onError(error: unknown): void }) {
  const [tab, setTab] = useState('search'), [query, setQuery] = useState(''), [source, setSource] = useState('all');
  const [results, setResults] = useState<SearchItem[] | null>(null), [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [adding, setAdding] = useState('');
  const [title, setTitle] = useState(''), [url, setUrl] = useState(''), [content, setContent] = useState(''), [kind, setKind] = useState('full-text');
  const mounted = useRef(true), epoch = useRef(0), panel = useRef<HTMLElement>(null), activeNow = useRef(active);
  activeNow.current = active;
  useEffect(() => { if (active) panel.current?.querySelector<HTMLInputElement>('[role=tabpanel]:not([hidden]) input')?.focus(); }, [active]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true); const version = ++epoch.current; setWarnings([]);
    try {
      const result = await api.post<{ items: SearchItem[]; warnings?: (string | { source?: string; message?: string; error?: string })[] }>('/api/search', { query, limit: 12, sources: source === 'all' ? ['alphaxiv', 'openalex', 'biorxiv', 'pubmed'] : [source] });
      if (mounted.current && version === epoch.current) {
        setResults(result.items);
        setWarnings((result.warnings ?? []).map(value => typeof value === 'string' ? value : `${value.source ?? ''}: ${value.message ?? value.error ?? ''}`));
      }
    } catch (error) { if (mounted.current && version === epoch.current) onError(error); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  async function add(input: { id: string; source?: string }, key = input.id) {
    if (adding) return;
    setAdding(key);
    try {
      const paper = await api.post<Paper>('/api/papers', { ...input, full: true });
      await onAdded(paper, mounted.current && activeNow.current);
    } catch (error) { if (mounted.current) onError(error); }
    finally { if (mounted.current) setAdding(''); }
  }
  async function importText() {
    if (adding) return;
    setAdding('text');
    try {
      const paper = await api.post<Paper>('/api/papers/import', { title, url, content, contentKind: kind, authors: [] });
      await onAdded(paper, mounted.current && activeNow.current);
    } catch (error) { if (mounted.current) onError(error); }
    finally { if (mounted.current) setAdding(''); }
  }
  async function file(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected) return;
    if (selected.size > 500000 || !/\.(txt|md|markdown)$/i.test(selected.name)) { onError(new Error(t('importFileError'))); return; }
    const text = await selected.text();
    if (!mounted.current) return;
    setContent(text); if (!title) setTitle(selected.name.replace(/\.[^.]+$/, ''));
  }
  return <section className="pa-import" ref={panel} aria-label={t('add')}>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList><TabsTrigger value="search">{t('search')}</TabsTrigger><TabsTrigger value="import">{t('import')}</TabsTrigger></TabsList>
      <TabsContent value="search" forceMount>
        <div className="pa-search-form" role="search" onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void search(); } }}>
          <Field label={t('findLabel')}>{props => <Input {...props} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} maxLength={500}/>}</Field>
          <div className="pa-actions"><Select label={t('sourceLabel')} value={source} onChange={setSource} options={[{ value: 'all', label: t('allSources') }, { value: 'alphaxiv', label: 'alphaXiv' }, { value: 'openalex', label: 'OpenAlex' }, { value: 'biorxiv', label: 'bioRxiv' }, { value: 'pubmed', label: 'PubMed' }]}/>
            <Button onClick={() => void search()} variant="primary" disabled={busy || !query.trim()}>{busy ? t('searching') : t('searchAction')}</Button>
            <Button disabled={!!adding || !query.trim()} onClick={() => void add({ id: query, ...(source !== 'all' ? { source } : {}) })}>{t('fetchPaper')}</Button>
          </div><small>{t('publicSearch')}</small>
        </div>
        {warnings.map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
        {results?.length === 0 && <Feedback>{t('noMatches')}</Feedback>}
        <ol className="pa-search-results">{results?.map(item => <li key={`${item.source}:${item.id}`}>
          <div><h3>{item.title}</h3><small>{item.source}</small>{!!item.authors?.length && <p className="pa-muted">{item.authors.slice(0, 4).join(', ')}</p>}{item.abstract && <p className="pa-search-abstract">{item.abstract}</p>}</div>
          <Button disabled={!!adding} onClick={() => void add({ id: item.id, source: item.source }, `${item.source}:${item.id}`)}>{adding === `${item.source}:${item.id}` ? t('loading') : t('addShort')}</Button>
        </li>)}</ol>
      </TabsContent>
      <TabsContent value="import" forceMount>
        <div className="pa-import-form" role="group" aria-label={t('import')}>
          <Field label={t('paperTitle')}>{props => <Input {...props} required value={title} maxLength={1000} onChange={event => setTitle(event.target.value)}/>}</Field>
          <Field label={t('paperUrl')}>{props => <Input {...props} type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…"/>}</Field>
          <Select label={t('contentKind')} value={kind} onChange={setKind} options={[{ value: 'full-text', label: t('fullText') }, { value: 'abstract', label: t('abstract') }, { value: 'report', label: t('sourceReport') }]}/>
          <Field label={t('paperText')}>{props => <Textarea {...props} required rows={12} value={content} maxLength={120000} onChange={event => setContent(event.target.value)}/>}</Field>
          <div className="pa-actions"><label className="pa-file">{t('importFile')}<input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={event => void file(event)}/></label><Button onClick={() => void importText()} variant="primary" disabled={!!adding || !title.trim() || !url.trim() || !content.trim()}>{adding === 'text' ? t('loading') : t('importAction')}</Button></div>
        </div>
      </TabsContent>
    </Tabs>
  </section>;
}

export function PaperList({ papers, selecting, selected, readingId, locked, onSelect, onRead, onDiscover, t }: { papers: Paper[]; selecting: boolean; selected: string[]; readingId: string; locked: boolean; onSelect(id: string, checked: boolean): void; onRead(paper: Paper): void; onDiscover?(paper: Paper): void; t: Translator }) {
  return <>
    <ul className="pa-library-list">{papers.map(paper => <li key={paper.id} data-current={readingId === paper.id}>
      {selecting && <Checkbox checked={selected.includes(paper.id)} disabled={locked || selected.length >= 5 && !selected.includes(paper.id)} aria-label={`${t('usePaper')}: ${paper.title}`} onCheckedChange={checked => onSelect(paper.id, checked)}/>}
      <div><Button variant="ghost" onClick={() => onRead(paper)} aria-current={readingId === paper.id ? 'true' : undefined}><span>{paper.title}</span></Button>
        <small>{t(paper.contentKind === 'abstract' ? 'abstract' : paper.contentKind === 'report' ? 'sourceReport' : 'fullText')}</small></div>
      {onDiscover && <Button variant="ghost" onClick={() => onDiscover(paper)}>{t('discover')}</Button>}
    </li>)}</ul>
  </>;
}
