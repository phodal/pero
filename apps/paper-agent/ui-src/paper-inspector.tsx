import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Badge, Button, ContentPane, ContentSection, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  EmptyState, Feedback, Icon, IconButton, Input, InspectorHeader, MetadataList, OutlineBadge, Select, Tabs, TabsContent, TabsList, TabsTrigger,
} from '@pero/app-sdk/ui';
import { addedText, contentKind, paperSource } from './library';
import { isShelfStatus, statusOf, type Shelf, type ShelfStatus } from './shelf';
import type { Api, Intent, Library, Paper, PdfAnnotation, PdfReading } from './types';
import type { Translator } from './i18n';
import './paper-inspector.css';

type InspectorTab = 'overview' | 'notes' | 'related';
type AbstractState = { status: 'loading' | 'ready' | 'empty' | 'error'; text: string; error?: string };
type NotesState = { status: 'loading' | 'ready' | 'empty' | 'error' | 'no-pdf'; items: PdfAnnotation[]; error?: string };

const statusTone: Record<ShelfStatus, 'blue' | 'neutral' | 'success'> = {
  reading: 'blue', 'to-read': 'neutral', reviewed: 'success',
};

function authorLine(authors: string[], expanded: boolean) {
  if (!authors.length) return '';
  if (expanded || authors.length <= 2) return authors.join(', ');
  return `${authors.slice(0, 2).join(', ')} et al.`;
}

function byline(paper: Paper, t: Translator) {
  const year = paper.fetchedAt?.slice(0, 4);
  return [paperSource(paper, t), year].filter(Boolean).join(' · ');
}

function notePreview(item: PdfAnnotation) {
  return (item.note || item.quote || '').replace(/\s+/g, ' ').trim();
}

export function PaperInspectorHeader({ paper, status, savingId, locked, t, onStatus, onDownload, onRead }: {
  paper: Paper; status: ShelfStatus; savingId?: string; locked: boolean; t: Translator;
  onStatus(id: string, value: ShelfStatus): void;
  onDownload(paper: Paper, format: 'pdf' | 'tex'): void;
  onRead(paper: Paper): void;
}) {
  const [authorsOpen, setAuthorsOpen] = useState(false);
  const canPdf = !!(paper.pdfUrl || paper.pdfCandidateUrl || paper.hasCachedPdf);
  useEffect(() => { setAuthorsOpen(false); }, [paper.id]);
  return <InspectorHeader
    title={paper.title}
    identity={t('paperDetails')}
    subtitle={<>
      {!!paper.authors.length && <span className="pa-inspector-authors">{authorLine(paper.authors, authorsOpen)}{' '}
        {paper.authors.length > 2 && <Button variant="ghost" className="pa-inspector-authors-toggle" onClick={() => setAuthorsOpen(value => !value)}>{t(authorsOpen ? 'showFewerAuthors' : 'showAllAuthors')}</Button>}
      </span>}
      <span className="pa-inspector-byline">{byline(paper, t)}</span>
    </>}
    status={<div className="pa-inspector-tags">
      <Badge tone={statusTone[status]}>{t(status === 'reading' ? 'statusReading' : status === 'to-read' ? 'statusToRead' : 'statusReviewed')}</Badge>
      <OutlineBadge>{contentKind(paper, t)}</OutlineBadge>
    </div>}
    actions={<><Button variant="ghost" disabled={locked} onClick={() => onRead(paper)}>{t(status === 'to-read' ? 'openReader' : 'continueReading')}</Button><DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t('moreActions')} variant="ghost"><Icon name="dots" size={16}/></IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {paper.source !== 'local-pdf' && <DropdownMenuItem onSelect={() => window.open(paper.url, '_blank', 'noopener,noreferrer')}>{t('openOriginal')}</DropdownMenuItem>}
        <DropdownMenuItem disabled={!!savingId || !canPdf} onSelect={() => onDownload(paper, 'pdf')}>{t('downloadPdf')}</DropdownMenuItem>
        {paper.arxivUrl && <DropdownMenuItem disabled={!!savingId} onSelect={() => onDownload(paper, 'tex')}>{t('downloadTex')}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={locked} onSelect={() => onStatus(paper.id, status === 'to-read' ? 'reading' : status === 'reading' ? 'reviewed' : 'to-read')}>{t('cycleReadingStatus')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu></>}
  />;
}

export function PaperResearchBrief({ t }: { t: Translator }) {
  return <section className="pa-inspector-brief" aria-label={t('researchBrief')}>
    <div className="pa-inspector-brief-head">
      <h3><Icon name="ai-sparkles" size={14}/>{t('researchBrief')}</h3>
      <OutlineBadge>{t('briefUnavailable')}</OutlineBadge>
    </div>
    <p className="pa-inspector-muted">{t('briefUnavailableCopy')}</p>
  </section>;
}

export function PaperOverview({ api, paper, t, onRead }: {
  api: Api; paper: Paper; t: Translator; onRead(paper: Paper): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [abstract, setAbstract] = useState<AbstractState>({ status: 'loading', text: '' });
  useEffect(() => {
    let alive = true;
    setExpanded(false);
    setAbstract({ status: 'loading', text: '' });
    const local = paper.content?.trim() ?? '';
    if (local) { setAbstract({ status: 'ready', text: local }); return () => { alive = false; }; }
    void api.get<Paper>(`/api/papers/${encodeURIComponent(paper.id)}`).then(full => {
      if (!alive) return;
      const text = full.content?.trim() ?? '';
      setAbstract({ status: text ? 'ready' : 'empty', text });
    }).catch(error => {
      if (!alive) return;
      setAbstract({ status: 'error', text: '', error: error instanceof Error ? error.message : String(error) });
    });
    return () => { alive = false; };
  }, [api, paper.id, paper.content, retry]);
  const preview = abstract.text.length > 420 && !expanded ? `${abstract.text.slice(0, 420).trim()}…` : abstract.text;
  return <div className="pa-inspector-overview">
    <ContentSection id={`paper-abstract-${paper.id}`} title={t('abstract')}>
      {abstract.status === 'loading' && <p role="status" className="pa-inspector-muted">{t('loading')}</p>}
      {abstract.status === 'error' && <Feedback kind="error">{abstract.error}<Button onClick={() => setRetry(value => value + 1)}>{t('retry')}</Button></Feedback>}
      {abstract.status === 'empty' && <EmptyState description={t('noAbstractPreview')} actions={<Button variant="ghost" onClick={() => onRead(paper)}>{t('openReader')}</Button>}/>}
      {abstract.status === 'ready' && <>
        <p className="pa-inspector-abstract-body">{preview}</p>
        <div className="pa-inspector-abstract-actions">
          {abstract.text.length > 420 && <Button variant="ghost" onClick={() => setExpanded(value => !value)}>{t(expanded ? 'collapseAbstract' : 'expandAbstract')}</Button>}
          <Button variant="ghost" onClick={() => onRead(paper)}>{t('abstractOpenReader')}</Button>
        </div>
      </>}
    </ContentSection>
    <PaperResearchBrief t={t}/>
  </div>;
}

export function PaperNotes({ api, paper, t, onRead, onRecords }: {
  api: Api; paper: Paper; t: Translator; onRead(paper: Paper): void; onRecords(paper: Paper): void;
}) {
  const [retry, setRetry] = useState(0);
  const [notes, setNotes] = useState<NotesState>({ status: 'loading', items: [] });
  useEffect(() => {
    let alive = true;
    setNotes({ status: 'loading', items: [] });
    void api.get<PdfReading>(`/api/pdf?paperId=${encodeURIComponent(paper.id)}`).then(reading => {
      if (!alive) return;
      if (!reading.document) { setNotes({ status: 'no-pdf', items: [] }); return; }
      const items = [...reading.annotations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setNotes({ status: items.length ? 'ready' : 'empty', items });
    }).catch(error => {
      if (!alive) return;
      setNotes({ status: 'error', items: [], error: error instanceof Error ? error.message : String(error) });
    });
    return () => { alive = false; };
  }, [api, paper.id, retry]);
  return <div className="pa-inspector-notes">
    {notes.status === 'loading' && <p role="status" className="pa-inspector-muted">{t('loading')}</p>}
    {notes.status === 'error' && <Feedback kind="error">{notes.error}<Button onClick={() => setRetry(value => value + 1)}>{t('retry')}</Button></Feedback>}
    {notes.status === 'no-pdf' && <EmptyState description={t('notesNeedPdf')} actions={<Button variant="ghost" onClick={() => onRead(paper)}>{t('openReader')}</Button>}/>}
    {notes.status === 'empty' && <EmptyState description={t('noPaperNotes')} actions={<Button variant="ghost" onClick={() => onRead(paper)}>{t('addNoteInReader')}</Button>}/>}
    {notes.status === 'ready' && <ul className="pa-inspector-note-list">{notes.items.map(item => {
      const preview = notePreview(item);
      return <li key={item.id}>
        <button type="button" className="pa-inspector-note" onClick={() => onRead(paper)}>
          <span className="pa-inspector-note-preview">{preview || t('untitledNote')}</span>
          <span className="pa-inspector-note-meta">{t('pdfPage')} {item.page} · {addedText(item.createdAt, t) || item.createdAt.slice(0, 10)}</span>
        </button>
      </li>;
    })}</ul>}
    <div className="pa-inspector-note-actions">
      <Button variant="ghost" onClick={() => onRecords(paper)}><Icon family="shell" name="clock" size={14}/>{t('researchProgress')}</Button>
      <Button variant="ghost" onClick={() => onRead(paper)}><Icon name="plus" size={14}/>{t('addNoteInReader')}</Button>
    </div>
  </div>;
}

export function PaperRelated({ paper, library, t, onDiscover, onRead }: {
  paper: Paper; library?: Pick<Library, 'intents' | 'studies' | 'discoveries' | 'favorites'>;
  t: Translator; onDiscover(paper: Paper): void; onRead(paper: Paper): void;
}) {
  const intents = (library?.intents ?? []).filter(intent => (intent.paperIds ?? intent.papers.map(item => item.id)).includes(paper.id));
  const studies = (library?.studies ?? []).filter(study => study.paperIds.includes(paper.id));
  const discoveries = (library?.discoveries ?? []).filter(item => item.seedId === paper.id);
  const favorites = (library?.favorites ?? []).filter(item => item.seedId === paper.id || item.paper.id === paper.id);
  const empty = !intents.length && !studies.length && !discoveries.length && !favorites.length;
  return <div className="pa-inspector-related">
    {empty ? <EmptyState description={t('noRelatedResearch')} actions={<Button variant="ghost" onClick={() => onDiscover(paper)}>{t('discover')}</Button>}/> : <ul className="pa-inspector-related-list">
      {studies.slice(0, 4).map(study => <li key={study.id}><button type="button" onClick={() => onRead(paper)}><span>{study.question}</span><small>{t('savedStudy')}</small></button></li>)}
      {intents.slice(0, 4).map((intent: Intent) => <li key={intent.id}><button type="button" onClick={() => onRead(paper)}><span>{intent.question}</span><small>{t('researchProgress')}</small></button></li>)}
      {discoveries.slice(0, 3).map(item => <li key={item.id}><button type="button" onClick={() => onDiscover(paper)}><span>{item.seedTitle}</span><small>{t('viewDiscovery')} · {item.relation}</small></button></li>)}
      {favorites.slice(0, 3).map(item => <li key={item.id}><button type="button" onClick={() => onDiscover(paper)}><span>{item.paper.title}</span><small>{t('favorites')}</small></button></li>)}
    </ul>}
    <div className="pa-inspector-note-actions">
      <Button variant="ghost" onClick={() => onDiscover(paper)}><Icon name="drafting-compass" size={14}/>{t('discover')}</Button>
    </div>
  </div>;
}

export function PaperResearchContext({ paper, status, studyCount, t, onStatus }: {
  paper: Paper; status: ShelfStatus; studyCount: number; t: Translator;
  onStatus(id: string, value: ShelfStatus): void;
}) {
  return <ContentSection id={`paper-context-${paper.id}`} title={t('researchWorkspace')}>
    <MetadataList items={[
      { id: 'status', label: t('readingStatus'), value: <Select label={t('readingStatus')} value={status} onChange={value => { if (isShelfStatus(value)) onStatus(paper.id, value); }} options={[
        { value: 'to-read', label: t('statusToRead') },
        { value: 'reading', label: t('statusReading') },
        { value: 'reviewed', label: t('statusReviewed') },
      ]} /> },
      { id: 'project', label: t('linkedProject'), value: t('projectUnlinked') },
      ...(studyCount > 0 ? [{ id: 'studies', label: t('researchProgress'), value: studyCount }] : []),
    ]} />
  </ContentSection>;
}

export function PaperAskAgent({ paper, locked, t, onAsk }: {
  paper: Paper; locked: boolean; t: Translator; onAsk?(paper: Paper, message: string): void;
}) {
  const [message, setMessage] = useState('');
  const inputId = useId();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { setMessage(''); }, [paper.id]);
  if (!onAsk) {
    return <section className="pa-inspector-ask" aria-label={t('askPaper')}>
      <div className="pa-inspector-ask-head"><Icon name="ai-sparkles" size={14}/><span>{t('askPaper')}</span></div>
      <p className="pa-inspector-muted">{t('askPaperUnavailable')}</p>
    </section>;
  }
  return <section className="pa-inspector-ask" aria-label={t('askPaper')}>
    <div className="pa-inspector-ask-head"><Icon name="ai-sparkles" size={14}/><label htmlFor={inputId}>{t('askPaper')}</label></div>
    <form className="pa-inspector-ask-form" onSubmit={event => {
      event.preventDefault();
      const next = message.trim();
      if (!next || locked) return;
      onAsk(paper, next);
      setMessage('');
      field.current?.focus();
    }}>
      <Input id={inputId} ref={field} value={message} disabled={locked} maxLength={2000} placeholder={t('askPlaceholder')} onChange={event => setMessage(event.target.value)}/>
      <IconButton type="submit" label={t('sendQuestion')} disabled={locked || !message.trim()}><Icon name="arrow-up" size={16}/></IconButton>
    </form>
    {!paper.hasSavedText && !paper.hasCachedPdf && !paper.pdfUrl && !paper.pdfCandidateUrl && <p className="pa-inspector-muted">{t('askNeedsSource')}</p>}
  </section>;
}

/** Context-aware research assistant for the selected library paper. */
export const PaperInspector = React.forwardRef<HTMLElement, {
  api: Api; paper: Paper; shelf: Shelf; library?: Pick<Library, 'intents' | 'studies' | 'discoveries' | 'favorites'>;
  savingId?: string; locked: boolean; t: Translator;
  onStatus(id: string, value: ShelfStatus): void; onRead(paper: Paper): void; onRecords(paper: Paper): void;
  onDiscover(paper: Paper): void; onDownload(paper: Paper, format: 'pdf' | 'tex'): void;
  onAsk?(paper: Paper, message: string): void;
}>(function PaperInspector({ api, paper, shelf, library, savingId, locked, t, onStatus, onRead, onRecords, onDiscover, onDownload, onAsk }, ref) {
  const [tab, setTab] = useState<InspectorTab>('overview');
  const status = statusOf(shelf, paper.id);
  const studyCount = (library?.studies ?? []).filter(study => study.paperIds.includes(paper.id)).length
    + (library?.intents ?? []).filter(intent => (intent.paperIds ?? intent.papers.map(item => item.id)).includes(paper.id)).length;
  useEffect(() => { setTab('overview'); }, [paper.id]);
  return <section ref={ref} className="pa-paper-inspector" tabIndex={-1} aria-label={t('paperDetails')}>
    <Tabs value={tab} onValueChange={value => setTab(value as InspectorTab)} className="pa-inspector-tabs">
      <ContentPane id={`paper-inspector-${paper.id}`} label={t('paperDetails')} as="div" surface="reading" inset="compact" scroll="pane"
        header={<PaperInspectorHeader paper={paper} status={status} savingId={savingId} locked={locked} t={t} onStatus={onStatus} onDownload={onDownload} onRead={onRead}/>}
        toolbar={<TabsList aria-label={t('paperDetails')} variant="navigation">
          <TabsTrigger value="overview">{t('overview')}</TabsTrigger>
          <TabsTrigger value="notes">{t('notesTab')}</TabsTrigger>
          <TabsTrigger value="related">{t('relatedTab')}</TabsTrigger>
        </TabsList>}>
        <TabsContent value="overview" forceMount hidden={tab !== 'overview'}><PaperOverview api={api} paper={paper} t={t} onRead={onRead}/></TabsContent>
        <TabsContent value="notes" forceMount hidden={tab !== 'notes'}><PaperNotes api={api} paper={paper} t={t} onRead={onRead} onRecords={onRecords}/></TabsContent>
        <TabsContent value="related" forceMount hidden={tab !== 'related'}><PaperRelated paper={paper} library={library} t={t} onDiscover={onDiscover} onRead={onRead}/></TabsContent>
        <PaperResearchContext paper={paper} status={status} studyCount={studyCount} t={t} onStatus={onStatus}/>
        <PaperAskAgent paper={paper} locked={locked} t={t} onAsk={onAsk}/>
      </ContentPane>
    </Tabs>
  </section>;
});
