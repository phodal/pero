import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Feedback, Field, FilePicker, Icon, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Toolbar } from '@pero/app-sdk/ui';
import type { Api, Paper, SearchItem } from './types';
import type { Translator } from './i18n';
import { ResearchImport } from './research-import';
import type { ResearchBundle } from './research-types';
import { addedWhen, isShelfFilter, statusOf, type Shelf, type ShelfFilter, type ShelfStatus } from './shelf';

const sourceNames: Record<string, string> = { huggingface: 'Hugging Face', alphaxiv: 'alphaXiv', openalex: 'OpenAlex', biorxiv: 'bioRxiv', pubmed: 'PubMed' };

export function ImportPanel({ api, t, active, onAdded, onClose, onError, onImportPdf, importingPdf, onBundleSaved }: { onBundleSaved(bundle: ResearchBundle, startDownloadIds: string[], startPdfIds: string[], startSourceIds: string[]): Promise<void>; api: Api; active: boolean; onImportPdf(file: File): Promise<void>; importingPdf: boolean; t: Translator; onAdded(paper: Paper, focus: () => boolean): Promise<void>; onClose(): void; onError(error: unknown): void }) {
  const [tab, setTab] = useState('search'), [query, setQuery] = useState(''), [source, setSource] = useState('all'), [priority, setPriority] = useState('recency');
  const [results, setResults] = useState<SearchItem[] | null>(null), [warnings, setWarnings] = useState<string[]>([]);
  const [resultPriority, setResultPriority] = useState('default');
  const [busy, setBusy] = useState(false), [adding, setAdding] = useState('');
  const [addError, setAddError] = useState<{ key: string; message: string } | null>(null), [searchError, setSearchError] = useState('');
  const [title, setTitle] = useState(''), [url, setUrl] = useState(''), [content, setContent] = useState(''), [kind, setKind] = useState('full-text');
  const mounted = useRef(true), epoch = useRef(0), importSession = useRef(0), panel = useRef<HTMLElement>(null), activeNow = useRef(active);
  activeNow.current = active;
  const mayOpen = (session: number) => mounted.current && activeNow.current && session === importSession.current;
  useEffect(() => {
    if (active) panel.current?.querySelector<HTMLInputElement>('[role=tabpanel]:not([hidden]) input')?.focus();
    // Reopening the importer must not let a previous visit's response navigate.
    return () => { importSession.current++; };
  }, [active]);
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
    const session = importSession.current;
    setAdding(key); setAddError(null);
    try {
      const paper = await api.post<Paper>('/api/papers', { ...input, full: true });
      await onAdded(paper, () => mayOpen(session));
    } catch (error) { if (mounted.current) setAddError({ key, message: error instanceof Error ? error.message : String(error) }); }
    finally { if (mounted.current) setAdding(''); }
  }
  async function importText() {
    if (adding) return;
    const session = importSession.current;
    setAdding('text');
    try {
      const paper = await api.post<Paper>('/api/papers/import', { title, url, content, contentKind: kind, authors: [] });
      await onAdded(paper, () => mayOpen(session));
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
      <TabsList aria-label={t('add')}><TabsTrigger value="search">{t('search')}</TabsTrigger><TabsTrigger value="pdf">PDF</TabsTrigger><TabsTrigger value="import">{t('import')}</TabsTrigger><TabsTrigger value="research">{t('researchUrl')}</TabsTrigger></TabsList>
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
        <LiteratureHits results={results} resultPriority={resultPriority} adding={adding} addError={addError} onAdd={add} t={t}/>
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
      <TabsContent value="research" forceMount><ResearchImport api={api} active={active && tab === 'research'} onSaved={onBundleSaved}/></TabsContent>
    </Tabs>
  </section>;
}

export function LiteratureHits({ results, resultPriority, adding, addError, onAdd, t }: {
  results: SearchItem[] | null; resultPriority: string; adding: string; addError: { key: string; message: string } | null;
  onAdd(input: { id: string; source?: string }, key?: string): void; t: Translator;
}) {
  return <>
    {!!results?.length && resultPriority === 'popular' && <p className="pa-muted">{t('citedOrderScope')}</p>}
    {results?.length === 0 && <Feedback>{t('noMatches')}</Feedback>}
    <ol className="pa-search-results">{results?.map(item => {
      const key = `${item.source}:${item.id}`;
      return <li key={key}>
        <div><h3>{item.title}</h3>
          {!!item.authors?.length && <p className="pa-muted">{item.authors.slice(0, 4).join(', ')}{item.authors.length > 4 ? ' et al.' : ''}</p>}
          <div className="pa-search-meta"><span>{item.publicationDate?.slice(0, 10) || t('dateUnavailable')}</span><span>{item.citations == null ? t('citationsUnavailable') : `${item.citations.toLocaleString()} ${t('citationCount')}${item.citationSource ? ` (${sourceNames[item.citationSource] ?? item.citationSource})` : ''}`}</span>{item.hfVotes != null && <span>{item.hfVotes.toLocaleString()} {t('communityLikes')} (Hugging Face)</span>}{item.githubStars != null && <span>{item.githubStars.toLocaleString()} {t('githubStars')} (GitHub)</span>}<span>{sourceNames[item.source] ?? item.source}</span></div>
          {item.abstract && <p className="pa-search-abstract">{item.abstract}</p>}
          {adding === key && <p role="status">{t('addingPaper')}</p>}
          {addError?.key === key && <Feedback kind="error">{addError.message}</Feedback>}
          <div className="pa-search-links">{item.url && item.url !== item.paperUrl && <a href={item.url} target="_blank" rel="noreferrer">{t('searchOriginal')}</a>}{item.paperUrl && <a href={item.paperUrl} target="_blank" rel="noreferrer">Hugging Face</a>}{item.pdfUrl && <a href={item.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}{item.githubUrl && <a href={item.githubUrl} target="_blank" rel="noreferrer">GitHub</a>}{item.projectUrl && item.projectUrl !== item.githubUrl && <a href={item.projectUrl} target="_blank" rel="noreferrer">{t('projectPage')}</a>}{item.thumbnailUrl && <a href={item.thumbnailUrl} target="_blank" rel="noreferrer">{t('searchImage')}</a>}{item.doi && <span>DOI: {item.doi}</span>}</div>
          {!!item.alternatives?.length && <details className="pa-search-alternatives"><summary>{t('otherSources')} ({item.alternatives.length})</summary><ul>{item.alternatives.map(alternative => <li key={`${alternative.source}:${alternative.id}`}>{alternative.url ? <a href={alternative.url} target="_blank" rel="noreferrer">{sourceNames[alternative.source] ?? alternative.source}</a> : sourceNames[alternative.source] ?? alternative.source}</li>)}</ul></details>}
        </div>
        {item.thumbnailId && <img className="pa-search-thumbnail" src={`/api/paper-thumbnails/${encodeURIComponent(item.thumbnailId)}.png`} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }}/>}
        <Button busy={adding === key} disabled={!!adding} onClick={() => void onAdd({ id: item.id, source: item.source }, key)}>{adding === key ? t('addingPaper') : addError?.key === key ? t('retry') : t('addShort')}</Button>
      </li>;
    })}</ol>
  </>;
}

export function contentKind(paper: Paper, t: Translator) {
  if (paper.resourceKind === 'web_article') return 'Article excerpt';
  return t(paper.contentKind === 'abstract' ? 'abstract' : paper.contentKind === 'report' ? 'sourceReport' : 'fullText');
}

export function paperSource(paper: Paper, t: Translator) {
  if (paper.source === 'local-pdf') return t('localPdfFile');
  if (paper.source === 'import' || paper.source === 'research-import') return t('importedSource');
  return sourceNames[paper.source] ?? paper.source;
}

export function addedText(fetchedAt: string, t: Translator) {
  const now = new Date();
  const when = addedWhen(fetchedAt, now);
  if (when === 'today') return t('addedToday');
  if (when === 'yesterday') return t('addedYesterday');
  if (!when) return '';
  if (when.getFullYear() === now.getFullYear()) return when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${when.getFullYear()}-${month}-${day}`;
}

const statusLabel: Record<ShelfStatus, 'statusReading' | 'statusToRead' | 'statusReviewed'> = {
  reading: 'statusReading', 'to-read': 'statusToRead', reviewed: 'statusReviewed',
};

export function PaperList({ papers, sort, onSort, selected, previewId, locked, shelf, shelfFilter, onShelfFilter, onCycleStatus, onFindMore, onSelect, onRead, onPreview, t }: {
  papers: Paper[]; sort: 'recent' | 'title'; onSort(value: 'recent' | 'title'): void; selected: string[]; previewId: string; locked: boolean;
  shelf: Shelf; shelfFilter: ShelfFilter; onShelfFilter(filter: ShelfFilter): void; onCycleStatus(id: string): void; onFindMore(): void;
  onSelect(id: string, checked: boolean): void; onRead(paper: Paper): void; onPreview(paper: Paper): void; t: Translator;
}) {
  const rows = papers;
  return <div className="pa-library-table">
    <div className="pa-library-toolbar">
      <div className="pa-filter-control"><Icon name="filter" size={15}/>
        <Select label={t('readingStatus')} value={shelfFilter} onChange={value => { if (isShelfFilter(value)) onShelfFilter(value); }} options={[
          { value: 'all', label: t('allStatuses') },
          { value: 'reading', label: t('statusReading') },
          { value: 'to-read', label: t('statusToRead') },
          { value: 'reviewed', label: t('statusReviewed') },
        ]}/>
      </div>
      <div className="pa-sort-control">
        <Select label={t('searchOrder')} value={sort} onChange={value => onSort(value === 'title' ? 'title' : 'recent')} options={[
          { value: 'recent', label: t('recentlyAdded') },
          { value: 'title', label: t('titleSort') },
        ]}/>
      </div>
    </div>
    <div className="pa-library-head" aria-hidden="true"><span>{t('paperColumn')}</span><span>{t('source')}</span><span>{t('readingStatus')}</span></div>
    <ul className="pa-library-list">{rows.map(paper => {
      const status = statusOf(shelf, paper.id);
      const authors = paper.authors.slice(0, 4).join(', ');
      return <li key={paper.id} className="pa-paper-row" data-current={previewId === paper.id ? 'true' : undefined}>
        <div className="pa-paper-main">
          <Checkbox checked={selected.includes(paper.id)} disabled={locked || selected.length >= 5 && !selected.includes(paper.id)} aria-label={`${t('usePaper')}: ${paper.title}`} onCheckedChange={checked => onSelect(paper.id, checked === true)}/>
          <Button variant="ghost" className="pero-list-open" aria-pressed={previewId === paper.id} onClick={() => onPreview(paper)} onDoubleClick={() => onRead(paper)}>
            <span className="pa-paper-name">
              <span className="pero-list-title">{paper.title}</span>
              {authors && <span className="pa-meta-line pa-paper-authors">{authors}{paper.authors.length > 4 ? ' et al.' : ''}</span>}
            </span>
          </Button>
        </div>
        <span className="pa-paper-source">{paperSource(paper, t)}</span>
        <Button variant="ghost" className="pa-status" data-status={status} onClick={() => onCycleStatus(paper.id)}>
          {status === 'to-read' ? <Icon family="shell" name="clock" size={13}/> : <Icon name={status === 'reading' ? 'skill' : 'check'} size={13}/>}
          {t(statusLabel[status])}
        </Button>
      </li>;
    })}</ul>
    {!rows.length && <p className="pa-filter-empty">{t('noPapersFilter')}</p>}
    <div className="pa-library-footer"><Button variant="ghost" onClick={onFindMore}>{t('findMore')}<Icon name="open" size={14}/></Button></div>
  </div>;
}
