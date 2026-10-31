import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, EmptyState, Feedback, Field, FilePicker, Input, ListRow, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Toolbar } from '@pero/app-sdk/ui';
import type { Api, Paper, SearchItem } from './types';
import type { Translator } from './i18n';

const sourceNames: Record<string, string> = { huggingface: 'Hugging Face', alphaxiv: 'alphaXiv', openalex: 'OpenAlex', biorxiv: 'bioRxiv', pubmed: 'PubMed' };

export function ImportPanel({ api, t, active, onAdded, onClose, onError, onImportPdf, importingPdf }: { api: Api; active: boolean; onImportPdf(file: File): Promise<void>; importingPdf: boolean; t: Translator; onAdded(paper: Paper, focus: boolean): Promise<void>; onClose(): void; onError(error: unknown): void }) {
  const [tab, setTab] = useState('search'), [query, setQuery] = useState(''), [source, setSource] = useState('all'), [priority, setPriority] = useState('recency');
  const [results, setResults] = useState<SearchItem[] | null>(null), [warnings, setWarnings] = useState<string[]>([]);
  const [resultPriority, setResultPriority] = useState('default');
  const [busy, setBusy] = useState(false), [adding, setAdding] = useState('');
  const [addError, setAddError] = useState<{ key: string; message: string } | null>(null), [searchError, setSearchError] = useState('');
  const [title, setTitle] = useState(''), [url, setUrl] = useState(''), [content, setContent] = useState(''), [kind, setKind] = useState('full-text');
  const mounted = useRef(true), epoch = useRef(0), panel = useRef<HTMLElement>(null), activeNow = useRef(active);
  activeNow.current = active;
  useEffect(() => { if (active) panel.current?.querySelector<HTMLInputElement>('[role=tabpanel]:not([hidden]) input')?.focus(); }, [active]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true); const version = ++epoch.current; setWarnings([]); setResults(null); setSearchError(''); setAddError(null);
    try {
      const result = await api.post<{ items: SearchItem[]; warnings?: (string | { source?: string; message?: string; error?: string })[] }>('/api/search', { query, limit: 12, priority, sources: source === 'all' ? ['huggingface', 'alphaxiv', 'openalex', 'biorxiv', 'pubmed'] : [source] });
      if (mounted.current && version === epoch.current) {
        setResults(result.items); setResultPriority(priority);
        setWarnings((result.warnings ?? []).map(value => typeof value === 'string' ? value : `${value.source ?? ''}: ${value.message ?? value.error ?? ''}`));
      }
    } catch (error) { if (mounted.current && version === epoch.current) setSearchError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  async function add(input: { id: string; source?: string }, key = input.id) {
    if (adding) return;
    setAdding(key); setAddError(null);
    try {
      const paper = await api.post<Paper>('/api/papers', { ...input, full: true });
      await onAdded(paper, mounted.current && activeNow.current);
    } catch (error) { if (mounted.current) setAddError({ key, message: error instanceof Error ? error.message : String(error) }); }
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
  async function file(selected: File) {
    if (selected.size > 500000 || !/\.(txt|md|markdown)$/i.test(selected.name)) { onError(new Error(t('importFileError'))); return; }
    const text = await selected.text();
    if (!mounted.current) return;
    setContent(text); if (!title) setTitle(selected.name.replace(/\.[^.]+$/, ''));
  }
  return <section className="pa-import" ref={panel} aria-label={t('add')}>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label={t('add')}><TabsTrigger value="search">{t('search')}</TabsTrigger><TabsTrigger value="pdf">PDF</TabsTrigger><TabsTrigger value="import">{t('import')}</TabsTrigger></TabsList>
      <TabsContent value="search" forceMount>
        <div className="pa-search-form" role="search" onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement) { event.preventDefault(); void search(); } }}>
          <Field label={t('findLabel')}>{props => <Input {...props} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} maxLength={500}/>}</Field>
          <Toolbar><Select label={t('sourceLabel')} value={source} onChange={setSource} options={[{ value: 'all', label: t('allSources') }, { value: 'huggingface', label: 'Hugging Face' }, { value: 'alphaxiv', label: 'alphaXiv' }, { value: 'openalex', label: 'OpenAlex' }, { value: 'biorxiv', label: 'bioRxiv' }, { value: 'pubmed', label: 'PubMed' }]}/>
            <Select label={t('searchOrder')} value={priority} onChange={setPriority} options={[{ value: 'default', label: t('orderRelevant') }, { value: 'recency', label: t('orderNewest') }, { value: 'popular', label: t('orderCited') }]}/>
            <Button onClick={() => void search()} variant="primary" busy={busy} disabled={!query.trim()}>{busy ? t('searching') : t('searchAction')}</Button>
            <Button busy={adding === query} disabled={!!adding || !query.trim()} onClick={() => void add({ id: query, ...(source !== 'all' ? { source } : {}) })}>{adding === query ? t('addingPaper') : t('fetchPaper')}</Button>
          </Toolbar><small>{t('publicSearch')}</small>
        </div>
        {searchError && <Feedback kind="error">{searchError}<Button disabled={busy} onClick={() => void search()}>{t('retry')}</Button></Feedback>}
        {addError?.key === query && <Feedback kind="error">{addError.message}</Feedback>}
        {warnings.map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
        {!!results?.length && resultPriority === 'popular' && <p className="pa-muted">{t('citedOrderScope')}</p>}
        {results?.length === 0 && <Feedback>{t('noMatches')}</Feedback>}
        <ol className="pa-search-results">{results?.map(item => <li key={`${item.source}:${item.id}`}>
          <div><h3>{item.title}</h3>
            {!!item.authors?.length && <p className="pa-muted">{item.authors.slice(0, 4).join(', ')}{item.authors.length > 4 ? ' et al.' : ''}</p>}
            <div className="pa-search-meta"><span>{item.publicationDate?.slice(0, 10) || t('dateUnavailable')}</span><span>{item.citations == null ? t('citationsUnavailable') : `${item.citations.toLocaleString()} ${t('citationCount')}${item.citationSource ? ` (${sourceNames[item.citationSource] ?? item.citationSource})` : ''}`}</span>{item.hfVotes != null && <span>{item.hfVotes.toLocaleString()} {t('communityLikes')} (Hugging Face)</span>}{item.githubStars != null && <span>{item.githubStars.toLocaleString()} {t('githubStars')} (GitHub)</span>}<span>{sourceNames[item.source] ?? item.source}</span></div>
            {item.abstract && <p className="pa-search-abstract">{item.abstract}</p>}
            {adding === `${item.source}:${item.id}` && <p role="status">{t('addingPaper')}</p>}
            {addError?.key === `${item.source}:${item.id}` && <Feedback kind="error">{addError.message}</Feedback>}
            <div className="pa-search-links">{item.url && item.url !== item.paperUrl && <a href={item.url} target="_blank" rel="noreferrer">{t('searchOriginal')}</a>}{item.paperUrl && <a href={item.paperUrl} target="_blank" rel="noreferrer">Hugging Face</a>}{item.pdfUrl && <a href={item.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}{item.githubUrl && <a href={item.githubUrl} target="_blank" rel="noreferrer">GitHub</a>}{item.projectUrl && item.projectUrl !== item.githubUrl && <a href={item.projectUrl} target="_blank" rel="noreferrer">{t('projectPage')}</a>}{item.thumbnailUrl && <a href={item.thumbnailUrl} target="_blank" rel="noreferrer">{t('searchImage')}</a>}{item.doi && <span>DOI: {item.doi}</span>}</div>
            {!!item.alternatives?.length && <details className="pa-search-alternatives"><summary>{t('otherSources')} ({item.alternatives.length})</summary><ul>{item.alternatives.map(alternative => <li key={`${alternative.source}:${alternative.id}`}>{alternative.url ? <a href={alternative.url} target="_blank" rel="noreferrer">{sourceNames[alternative.source] ?? alternative.source}</a> : sourceNames[alternative.source] ?? alternative.source}</li>)}</ul></details>}
          </div>
          {item.thumbnailId && <img className="pa-search-thumbnail" src={`/api/paper-thumbnails/${encodeURIComponent(item.thumbnailId)}.png`} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }}/>}
          <Button busy={adding === `${item.source}:${item.id}`} disabled={!!adding} onClick={() => void add({ id: item.id, source: item.source }, `${item.source}:${item.id}`)}>{adding === `${item.source}:${item.id}` ? t('addingPaper') : addError?.key === `${item.source}:${item.id}` ? t('retry') : t('addShort')}</Button>
        </li>)}</ol>
      </TabsContent>
      <TabsContent value="pdf" forceMount>
        <div className="pa-import-form"><FilePicker label={importingPdf ? t('pdfImporting') : t('importPdf')} emptyLabel={t('pdfFileHint')} accept="application/pdf,.pdf" busy={importingPdf} onFile={file => void onImportPdf(file)}/></div>
      </TabsContent>
      <TabsContent value="import" forceMount>
        <div className="pa-import-form" role="group" aria-label={t('import')}>
          <Field label={t('paperTitle')}>{props => <Input {...props} required value={title} maxLength={1000} onChange={event => setTitle(event.target.value)}/>}</Field>
          <Field label={t('paperUrl')}>{props => <Input {...props} type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…"/>}</Field>
          <Select label={t('contentKind')} value={kind} onChange={setKind} options={[{ value: 'full-text', label: t('fullText') }, { value: 'abstract', label: t('abstract') }, { value: 'report', label: t('sourceReport') }]}/>
          <Field label={t('paperText')}>{props => <Textarea {...props} required rows={12} value={content} maxLength={120000} onChange={event => setContent(event.target.value)}/>}</Field>
          <FilePicker label={t('importFile')} emptyLabel={t('textFileHint')} accept=".txt,.md,.markdown,text/plain,text/markdown" onFile={selected => void file(selected)}/>
          <Toolbar><Button onClick={() => void importText()} variant="primary" busy={adding === 'text'} disabled={!!adding || !title.trim() || !url.trim() || !content.trim()}>{adding === 'text' ? t('loading') : t('importAction')}</Button></Toolbar>
        </div>
      </TabsContent>
    </Tabs>
  </section>;
}

export function PaperList({ papers, selecting, selected, readingId, locked, onSelect, onRead, onDiscover, t }: { papers: Paper[]; selecting: boolean; selected: string[]; readingId: string; locked: boolean; onSelect(id: string, checked: boolean): void; onRead(paper: Paper): void; onDiscover?(paper: Paper): void; t: Translator }) {
  return <>
    <ul className="pa-library-list">{papers.map(paper => <li key={paper.id}>
      {selecting && <Checkbox checked={selected.includes(paper.id)} disabled={locked || selected.length >= 5 && !selected.includes(paper.id)} aria-label={`${t('usePaper')}: ${paper.title}`} onCheckedChange={checked => onSelect(paper.id, checked)}/>}
      <ListRow title={paper.title} meta={t(paper.contentKind === 'abstract' ? 'abstract' : paper.contentKind === 'report' ? 'sourceReport' : 'fullText')} current={readingId === paper.id} onOpen={() => onRead(paper)}
        trailing={onDiscover && <Button variant="ghost" onClick={() => onDiscover(paper)}>{t('discover')}</Button>}/>
    </li>)}</ul>
  </>;
}
