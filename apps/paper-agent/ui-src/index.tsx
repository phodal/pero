import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppAgent, useAppApi, useAppI18n, useAppInfo, useAppChat, useAppObject, useAppDataChanged, appObjectProps } from '@pero/app-sdk';
import { Button, EmptyState, Feedback, Icon, PageHeader } from '@pero/app-sdk/ui';
import { messages } from './i18n';
import { ImportPanel, PaperList } from './library';
import { LibrarySearch } from './library-search';
import { Reader, type Citation } from './documents';
import { Conversation, type QuestionDraft } from './conversation';
import { Discovery, type DiscoveryOpening } from './discovery';
import { useResearch } from './use-research';
import type { EvidenceLocation, Intent, Library, Paper, PdfAnnotation, PdfFocus, PdfSource, SavedDiscovery } from './types';
import './styles.css';

type WorkspaceScreen = 'library' | 'reading';
type LibraryScreen = 'papers' | 'import' | 'discovery';
const emptyDraft: QuestionDraft = { question: '', fullText: false, verifyCode: false, verificationPlan: '', selected: [], context: '' };

export default function PaperAgent() {
  const api = useAppApi(), agent = useAppAgent(), chat = useAppChat(), info = useAppInfo(), { t } = useAppI18n(messages);
  const [library, setLibrary] = useState<Library>({ papers: [], intents: [], reports: [] });
  const [screen, setScreen] = useState<WorkspaceScreen>('library'), [libraryScreen, setLibraryScreen] = useState<LibraryScreen>('papers');
  const [importingPdf, setImportingPdf] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reading, setReading] = useState<Paper | null>(null), [readingBusy, setReadingBusy] = useState(false);
  const [showResearch, setShowResearch] = useState(false), [draft, setDraft] = useState<QuestionDraft>(emptyDraft), [agentId, setAgentId] = useState('');
  const [discoveryOpening, setDiscoveryOpening] = useState<DiscoveryOpening | null>(null), [matrixOpen, setMatrixOpen] = useState(false);
  const [pdfFocus, setPdfFocus] = useState<PdfFocus | null>(null), [pdfToolbar, setPdfToolbar] = useState<HTMLDivElement | null>(null);
  const [citation, setCitation] = useState<(Citation & { intent: Intent }) | null>(null), [evidence, setEvidence] = useState<EvidenceLocation | null>(null), [evidenceBusy, setEvidenceBusy] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const mounted = useRef(true), active = useRef(info.active), readVersion = useRef(0), libraryVersion = useRef(0), evidenceVersion = useRef(0);
  const preserveView = useRef<(() => void) | null>(null), askButton = useRef<HTMLDivElement>(null), citationTrigger = useRef<HTMLElement | null>(null);
  active.current = info.active;
  const onError = useCallback((value: unknown) => setError(value instanceof Error ? value.message : String(value)), []);
  const refresh = useCallback(async () => {
    const version = ++libraryVersion.current, result = await api.get<Library>('/api/library');
    if (mounted.current && version === libraryVersion.current) setLibrary(result);
  }, [api]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readVersion.current++; evidenceVersion.current++; libraryVersion.current++; }; }, []);
  useEffect(() => {
    if (!info.active) return;
    let alive = true; setLoading(true);
    refresh().catch(error => { if (alive) onError(error); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [info.active, refresh, onError]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)'), change = () => setNarrow(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!agentId || !agent.agents.some(item => item.available && item.id === agentId)) setAgentId(agent.agents.find(item => item.available)?.id ?? '');
  }, [agent.agents, agentId]);
  const task = useResearch(api, agent, refresh, onError, t);
  const locked = task.working || task.busy || task.pending;
  const updateDraft = (value: Partial<QuestionDraft>) => setDraft(prior => ({ ...prior,
    ...(value.selected && prior.contextSource && !value.selected.includes(prior.contextSource.paperId) ? { context: '', contextSource: undefined } : {}), ...value }));
  useEffect(() => {
    const study = task.study;
    if (study && (!reading || study.paperIds.includes(reading.id))) setDraft(prior => ({ ...prior, selected: study.paperIds, fullText: true, verifyCode: false }));
  }, [task.study?.id]);
  useEffect(() => {
    if (!task.intent || (reading && !task.intent.papers.some(paper => paper.id === reading.id))) return;
    const intent = task.intent;
    setDraft(prior => ({ ...prior, selected: intent.papers.map(p => p.id), fullText: !!intent.fullText, verifyCode: intent.verifyCode, verificationPlan: intent.verificationPlan }));
  }, [task.intent?.id]);
  function openAgent() { preserveView.current?.(); setShowResearch(true); requestAnimationFrame(() => window.document.getElementById('paper-question')?.focus()); }
  function closeAgent() { preserveView.current?.(); setShowResearch(false); requestAnimationFrame(() => askButton.current?.querySelector('button')?.focus({ preventScroll: true })); }
  function back() { preserveView.current?.(); setScreen('library'); setLibraryScreen('papers'); setShowResearch(false); setCitation(null); }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (!info.active || screen !== 'reading') return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); if (showResearch) closeAgent(); else openAgent(); }
      if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); back(); }
      if (event.key === 'Escape' && showResearch && !event.defaultPrevented) closeAgent();
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [screen, showResearch, info.active]);

  async function read(paper: Paper, keepAgent = false, propagate = false) {
    const version = ++readVersion.current; setReadingBusy(true); setScreen('reading'); setCitation(null); setError('');
    if (paper.id !== reading?.id) setPdfFocus(null);
    if (!keepAgent) { setShowResearch(false); setDraft({ ...emptyDraft, selected: [paper.id], fullText: !!paper.pdfUrl || paper.source === 'local-pdf' }); }
    try {
      const full = paper.content ? paper : await api.get<Paper>(`/api/papers/${paper.id}`);
      if (mounted.current && version === readVersion.current) setReading(full);
    } catch (error) { if (mounted.current && version === readVersion.current) onError(error); if (propagate) throw error; }
    finally { if (mounted.current && version === readVersion.current) setReadingBusy(false); }
  }
  async function added(paper: Paper, focus: boolean | (() => boolean)) {
    await refresh();
    if (mounted.current && active.current && (typeof focus === 'function' ? focus() : focus)) await read(paper);
  }
  async function importPdf(file: File) {
    if (importingPdf) return;
    setImportingPdf(true); setError('');
    try {
      const response = await fetch(`/api/pdf/import?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? t('pdfLoadError'));
      await added(result, true);
    } catch (error) { onError(error); }
    finally { if (mounted.current) setImportingPdf(false); }
  }
  function discover(paper: Paper) { setDiscoveryOpening({ seed: paper }); setScreen('library'); setLibraryScreen('discovery'); setShowResearch(false); }
  function addToComparison(paper: Paper, seedId: string) {
    if (locked || task.repair) return false;
    const ids = Array.from(new Set([seedId, paper.id]));
    task.reset(); setDraft({ ...emptyDraft, selected: ids, question: t('matrixInstruction') });
    const seed = library.papers.find(p => p.id === seedId);
    if (seed) void read(seed, true).then(openAgent); else { setScreen('reading'); openAgent(); }
    return true;
  }
  async function readFavorite(favorite: SavedDiscovery, compare = false) {
    try { const paper = await api.post<Paper>('/api/discoveries/read', { batchId: favorite.batchId, workId: favorite.paper.id }); await refresh(); if (compare) addToComparison(paper, favorite.seedId); else await read(paper); }
    catch (error) { onError(error); }
  }
  async function full() {
    if (!reading || readingBusy) return;
    const source = reading; setReadingBusy(true);
    try { await added(await api.post<Paper>('/api/papers', { source: source.source, id: source.sourceId, full: true }), true); }
    catch (error) { onError(error); }
    finally { if (mounted.current) setReadingBusy(false); }
  }
  async function revealPdf(paper: Paper, focus: PdfFocus) {
    if (reading?.id !== paper.id) await read(paper, true, true);
    setPdfFocus(focus);
    if (narrow) closeAgent();
  }
  async function cite(value: Citation, intent: Intent) {
    citationTrigger.current = window.document.activeElement as HTMLElement;
    setCitation({ ...value, intent }); setEvidence(null); const version = ++evidenceVersion.current;
    if (!value.quote) { setEvidenceBusy(false); return; }
    setEvidenceBusy(true);
    try {
      const result = await api.post<EvidenceLocation>('/api/evidence', { intentId: intent.id, paperId: value.paperId, quote: value.quote, passageId: value.passageId });
      if (mounted.current && version === evidenceVersion.current) {
        setEvidence(result);
        if (result.pdf && value.passageId) {
          const paper = intent.papers.find(p => p.id === value.paperId);
          if (paper) await revealPdf(paper, { documentId: result.pdf.documentId, page: result.pdf.pages[0], rects: result.pdf.rects });
          setCitation(null);
        }
      }
    } catch (error) { if (mounted.current && version === evidenceVersion.current) onError(error); }
    finally { if (mounted.current && version === evidenceVersion.current) setEvidenceBusy(false); }
  }
  function closeEvidence() { evidenceVersion.current++; setCitation(null); requestAnimationFrame(() => citationTrigger.current?.isConnected && citationTrigger.current.focus({ preventScroll: true })); }
  function selectedText(text: string, pdf?: PdfSource) {
    if (!text || !reading) return;
    updateDraft({ context: text, contextSource: pdf ? { ...pdf, paperId: reading.id } : undefined, selected: [reading.id], fullText: !!pdf || !!reading.pdfUrl || reading.source === 'local-pdf', verifyCode: false }); openAgent();
  }
  async function send(execute = true) {
    if (task.busy || task.working) return;
    setError('');
    const question = draft.question.trim();
    try {
      const context = draft.context ? await api.post<{ id: string }>('/api/contexts', {
        content: draft.context, paperId: draft.contextSource?.paperId ?? draft.selected[0],
        ...(draft.contextSource ? { documentId: draft.contextSource.documentId, page: draft.contextSource.page } : {}),
      }) : null;
      const previous = draft.parentIntentId ?? (task.report && task.intent?.papers.some(paper => draft.selected.includes(paper.id)) ? task.intent.id : [...library.intents].filter(intent => intent.paperIds?.some(id => draft.selected.includes(id)) && library.reports.some(report => report.intentId === intent.id)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]?.id);
      const frozen = await task.begin({ question, ...(context ? { contextId: context.id } : {}), paperIds: draft.selected, fullText: draft.fullText, verifyCode: draft.verifyCode, verificationPlan: draft.verificationPlan, parentIntentId: previous }, agentId, execute);
      if (frozen && execute) updateDraft({ question: '', context: '', contextSource: undefined, parentIntentId: undefined });
    } catch (error) { onError(error); }
  }
  function annotation(annotation: PdfAnnotation) {
    const paper = library.papers.find(p => p.id === annotation.paperId);
    if (paper) void revealPdf(paper, { documentId: annotation.documentId, page: annotation.page, annotationId: annotation.id }).catch(onError);
  }
  useAppDataChanged(() => refresh().catch(onError));
  useAppObject({id:'paper-agent',kind:'research-library',label:'Paper Agent',state:{
    paperCount:library.papers.length,reportCount:library.reports.length,selected:draft.selected,
    readingId:reading?.id??null,title:reading?.title??null,contentDigest:reading?.contentDigest??null,url:reading?.url??null,sourceId:reading?.sourceId??null,
    sourceExcerpt:reading?.content?.slice(0,4000)??null,sourceTruncated:(reading?.content?.length??0)>4000,
    loading:loading||readingBusy,status:task.status,acceptance:'unverified',
  },actions:{
    open_paper:{description:'Read an existing source snapshot from the library',parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},run:async({id})=>{const paper=library.papers.find(paper=>paper.id===id);if(!paper)throw new Error('The paper is not in this library');await read(paper,false,true);}},
    refresh:{description:'Refresh the persisted source library',parameters:{type:'object',properties:{},additionalProperties:false},run:refresh},
  }});
  return <div onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); void importPdf(event.dataTransfer.files[0]); }} className="pa-workbench pa-reading-first" data-screen={screen} data-research={showResearch} {...appObjectProps('paper-agent')}>
    {importingPdf && <p className="pa-loading" role="status">{t('pdfImporting')}</p>}
    {error && <div className="pa-global-error"><Feedback kind="error"><span>{error}</span><Button variant="ghost" onClick={() => setError('')}>{t('dismiss')}</Button></Feedback></div>}
    <section className="pa-library-screen" hidden={screen !== 'library'} aria-label={t('papers')}>
      <PageHeader title={t(libraryScreen === 'import' ? 'add' : libraryScreen === 'discovery' ? 'discover' : 'papers')}
        navigation={libraryScreen !== 'papers' && <Button variant="ghost" aria-label={t('backToLibrary')} onClick={() => setLibraryScreen('papers')}><Icon name="chevron-left"/></Button>}
        actions={libraryScreen === 'papers' && <><Button variant="ghost" aria-label={t('refresh')} onClick={() => void refresh().catch(onError)}><Icon name="refresh"/></Button><Button variant="primary" onClick={() => setLibraryScreen('import')}><Icon name="plus"/>{t('add')}</Button></>}/>
      <div className="pa-library-content" hidden={libraryScreen !== 'papers'}>
        {loading ? <p role="status">{t('loading')}</p> : !library.papers.length ? <EmptyState heading={t('emptyLibrary')} description={t('emptyLibraryCopy')}/> : <LibrarySearch api={api} t={t} onOpen={async hit => { const paper = library.papers.find(p => p.id === hit.source.paperId); if (paper) { await read(paper); if (hit.source.documentId && hit.page) setPdfFocus({ documentId: hit.source.documentId, page: hit.page }); } }}><PaperList selecting={false} papers={library.papers} selected={draft.selected} readingId={reading?.id ?? ''} locked={locked} onRead={paper => void read(paper)} onSelect={() => {}} onDiscover={discover} t={t}/></LibrarySearch>}
        {!!library.favorites?.length && <details className="pa-library-saved"><summary>{t('favorites')} {library.favorites.length}</summary><ul className="pa-report-list">{library.favorites.map(favorite => <li key={favorite.id} data-favorite-work={favorite.paper.id}><Button variant="ghost" disabled={!favorite.paper.abstract.trim()} onClick={() => void readFavorite(favorite)}>{favorite.paper.title}</Button><div className="pa-actions"><Button variant="ghost" disabled={locked || !favorite.paper.abstract.trim()} onClick={() => void readFavorite(favorite, true)}>{t('addToMatrix')}</Button><Button variant="ghost" onClick={() => { setDiscoveryOpening({ historyId: favorite.batchId }); setLibraryScreen('discovery'); }}>{t('viewDiscovery')}</Button><a href={favorite.paper.url} target="_blank" rel="noreferrer">{t('original')}</a></div></li>)}</ul></details>}
      </div>
      <div hidden={libraryScreen !== 'import'}><ImportPanel onImportPdf={importPdf} importingPdf={importingPdf} api={api} t={t} active={screen === 'library' && libraryScreen === 'import' && info.active} onAdded={added} onError={onError} onClose={() => setLibraryScreen('papers')}/></div>
      <div hidden={libraryScreen !== 'discovery'}><Discovery api={api} opening={discoveryOpening} library={library} locked={locked} selected={draft.selected} onRefresh={refresh} onRead={paper => read(paper)} onCompare={addToComparison} onReturn={id => { const paper = library.papers.find(p => p.id === id); if (paper) void read(paper); }} t={t}/></div>
    </section>
    <section className="pa-reading-screen" hidden={screen !== 'reading'} data-agent={showResearch}>
      <div className="pa-reading-main" inert={narrow && showResearch}>
        <header className="pa-reading-bar pero-reader-header"><Button variant="ghost" aria-label={t('backToLibrary')} onClick={back}>‹</Button><h1>{reading?.title ?? t('loading')}</h1><div className="pa-pdf-toolbar-slot" ref={setPdfToolbar}/>{!showResearch && <div ref={askButton}><Button variant="primary" disabled={!reading || readingBusy} onMouseDown={event => event.preventDefault()} onClick={openAgent} aria-keyshortcuts="Control+j Meta+j">{t('ask')}</Button></div>}</header>
        <main className="pa-reading-canvas" aria-busy={readingBusy}>{reading ? <Reader key={reading.id} chrome={{ toolbar: pdfToolbar, preserveView }} api={api} paper={reading} busy={readingBusy} pdfFocus={pdfFocus} onFull={() => void full()} onDiscuss={selectedText} onMatrixAdded={async () => { await refresh(); setMatrixOpen(true); openAgent(); }} t={t}/> : <p role="status">{t('loading')}</p>}</main>
      </div>
      {screen === 'reading' && showResearch && <Conversation api={api} agent={agent} agentId={agentId} onAgent={setAgentId} task={task} library={library} paper={reading} draft={draft} onDraft={updateDraft} onReadContext={() => { const source = draft.contextSource; if (!source) return; const paper = library.papers.find(p => p.id === source.paperId); if (paper) void revealPdf(paper, { documentId: source.documentId, page: source.page, rects: source.rects }).catch(onError); }} onSend={execute => void send(execute)} onClose={closeAgent} onCite={(value, intent) => void cite(value, intent)} citation={citation} evidence={evidence} evidenceBusy={evidenceBusy} onCloseEvidence={closeEvidence} onReadEvidence={page => { const paper = citation?.intent.papers.find(p => p.id === citation.paperId), pdf = evidence?.pdf; if (paper && pdf) void revealPdf(paper, { documentId: pdf.documentId, page: page ?? pdf.pages[0], rects: pdf.rects }).catch(onError); else if (paper) void read(paper, true); }} onOpenChat={() => { void chat.open().catch(onError); }} matrixOpen={matrixOpen} onMatrixOpen={setMatrixOpen} onAnnotation={annotation} t={t}/>}
    </section>
  </div>;
}
