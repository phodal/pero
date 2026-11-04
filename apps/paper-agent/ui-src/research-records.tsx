import React, { useEffect, useRef, useState } from 'react';
import { downloadFile, useAppInfo } from '@pero/app-sdk';
import { Button, EmptyState, Feedback, Icon } from '@pero/app-sdk/ui';
import { Experiments, ReportView, type Citation } from './documents';
import { ReadingMatrix } from './reading-matrix';
import type { Api, Intent, Library, Paper, PdfAnnotation, Report, ResearchStudy, StudySummary } from './types';
import './reader-workspace.css';
import type { Translator } from './i18n';
import './research-history.css';

type HistoryEntry = { kind: 'turn'; entry: Intent; reports: Report[] } | { kind: 'study'; entry: StudySummary };
type RecordKind = 'reportSaved' | 'questionSaved' | 'studyUnfinished';
type RecordSummary = { date?: { value: string; time: string }; papers?: string[] };

function HistorySummary({ question, kind, date, papers, t }: RecordSummary & {
  question: string;
  kind: RecordKind;
  t: Translator;
}) {
  return <summary className="pa-history-summary">
    {kind === 'reportSaved' ? <Icon name="file-text" size={15}/> : <Icon family="shell" name="clock" size={15}/>}
    <span className="pa-history-item">
      <span className="pa-history-question">{question}</span>
      {!!papers?.length && <span className="pa-history-papers">{papers.join(' / ')}</span>}
      <span className="pa-history-meta"><span>{t(kind)}</span>{date && <time dateTime={date.value}>{date.time}</time>}</span>
    </span>
    <Icon className="pa-history-chevron" name="chevron-right" size={14}/>
  </summary>;
}

function StudyRecord({ study, complete, t }: { study: ResearchStudy; complete: boolean; t: Translator }) {
  const labels = { read: 'readingSource', search: 'searchingSource', note: 'recordingFinding', finalize: 'submittingReport' } as const;
  return <div className="pa-study-record" data-study-id={study.id}>
    <details open={complete ? undefined : true}><summary>{t('researchProgress')} {study.budget.used} / {study.budget.limit} {t('researchSteps')}</summary>
      <ol>{study.steps.map((step, index) => <li key={index}>{t(labels[step.action])}{step.page ? ` — ${t('pdfPage')} ${step.page}` : ''}{step.query ? `: ${step.query}` : ''}</li>)}</ol>
      {!!study.findings.length && <><h3>{t('researchFindings')}</h3><ul>{study.findings.map((finding, index) => <li key={index}>{finding.text}</li>)}</ul></>}
    </details>
    {!complete && !!study.gaps.length && <div role="note"><h3>{t('researchGaps')}</h3><ul>{study.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></div>}
  </div>;
}

function Answer({ report, intent, api, onCite, t }: { report: Report; intent: Intent; api: Api; onCite(citation: Citation, intent: Intent): void; t: Translator }) {
  const [error, setError] = useState('');
  async function exportReport(format: 'markdown' | 'json') {
    try { const value = await api.get<{ filename: string; content: string; mime: string }>(`/api/reports/${report.id}/export?format=${format}`); downloadFile(value.filename, value.content, value.mime); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return <div className="pa-answer">
    <ReportView api={api} report={report} intent={intent} onCite={value => onCite(value, intent)} t={t}/>
    {!!report.experiments?.length && <details><summary>{t('experiments')}</summary><Experiments report={report} intent={intent} onCite={value => onCite(value, intent)} t={t}/></details>}
    <details className="pa-answer-actions"><summary>{t('reportActions')}</summary><div className="pa-actions"><Button onClick={() => void exportReport('markdown')}>{t('exportMarkdown')}</Button><Button onClick={() => void exportReport('json')}>{t('exportJson')}</Button><Button onClick={() => window.print()}>{t('print')}</Button></div></details>
    {error && <Feedback kind="error">{error}<Button onClick={() => setError('')}>{t('dismiss')}</Button></Feedback>}
  </div>;
}

function SavedTurn({ entry, reports, date, papers, api, onCite, onResume, opening, t }: RecordSummary & { entry: Intent; reports: Report[]; api: Api; onCite(citation: Citation, intent: Intent): void; onResume(intent: Intent): void; opening?: number; t: Translator }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (opening && details.current) { details.current.open = true; details.current.scrollIntoView({ block: 'nearest' }); } }, [opening]);
  const [loaded, setLoaded] = useState<{ intent: Intent; reports: Report[] } | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  async function load() {
    if (loaded || loading) return;
    setLoading(true); setError('');
    try { const [intent, answers] = await Promise.all([api.get<Intent>(`/api/intents/${entry.id}`), Promise.all(reports.map(report => api.get<Report>(`/api/reports/${report.id}`)))]); setLoaded({ intent, reports: answers }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  return <details ref={details} className="pa-turn-history pa-record-note" data-turn-id={entry.id} onToggle={event => { if (event.currentTarget.open) void load(); }}>
    <HistorySummary question={entry.question} kind={reports.length ? 'reportSaved' : 'questionSaved'} date={date} papers={papers} t={t}/>
    {loading && <p role="status">{t('loading')}</p>}
    {error && <Feedback kind="error">{error}<Button onClick={() => void load()}>{t('retry')}</Button></Feedback>}
    {loaded?.intent.contextFile?.anchor && <Button onClick={() => onCite({ paperId: loaded.intent.contextFile!.paperId, anchor: loaded.intent.contextFile!.anchor }, loaded.intent)}>{loaded.intent.contextFile.anchor.rects?.length ? 'Show discussed region' : 'Show discussed page'}</Button>}
    {loaded?.reports.map(report => <Answer key={report.id} report={report} intent={loaded.intent} api={api} onCite={onCite} t={t}/>)}
    {loaded && <Button onClick={() => onResume(loaded.intent)}>{t(reports.length ? 'continueFromHere' : 'resumeQuestion')}</Button>}
  </details>;
}

function SavedStudy({ entry, date, papers, api, onContinue, opening, t }: RecordSummary & { entry: StudySummary; api: Api; onContinue(): void; opening?: number; t: Translator }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (opening && details.current) { details.current.open = true; details.current.scrollIntoView({ block: 'nearest' }); } }, [opening]);
  const [study, setStudy] = useState<ResearchStudy | null>(null), [error, setError] = useState('');
  const [open, setOpen] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError('');
    api.get<ResearchStudy>(`/api/studies/${entry.id}`).then(value => { if (active) setStudy(value); }, error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [api, entry.id, entry.budget.used, open, retry]);
  return <details ref={details} className="pa-turn-history pa-record-note" data-saved-study-id={entry.id} onToggle={event => setOpen(event.currentTarget.open)}>
    <HistorySummary question={entry.question} kind="studyUnfinished" date={date} papers={papers} t={t}/>
    {error ? <Feedback kind="error">{error}<Button onClick={() => setRetry(value => value + 1)}>{t('retry')}</Button></Feedback> : study ? <StudyRecord study={study} complete={false} t={t}/> : <p role="status">{t('loading')}</p>}
    <Button onClick={onContinue}>{t('continueStudy')}</Button>
  </details>;
}

/** Paper owns persisted research output; the Host owns the conversation and execution. */
export function ResearchRecords({ api, library, paper, results = false, onFollowUp, onContinue, onCite, matrixOpen, onMatrixOpen, onAnnotation, opening, t }: {
  api: Api; library: Library; paper: Paper | null; opening?: { studyId: string; intentId: string | null; token: number } | null;
  results?: boolean;
  onFollowUp(intent: Intent): void; onContinue(study: StudySummary): void;
  onCite(citation: Citation, intent: Intent): void;
  matrixOpen: boolean; onMatrixOpen(value: boolean): void; onAnnotation(annotation: PdfAnnotation): void; t: Translator;
}) {
  const { locale } = useAppInfo();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RecordKind | 'all'>('all');
  const term = query.trim().toLocaleLowerCase(locale);
  const titles = new Map(library.papers.map(paper => [paper.id, paper.title]));
  const dayFormat = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const turns = library.intents.filter(intent => !paper || intent.paperIds?.includes(paper.id));
  const unfinished = library.studies?.filter(study => !study.reportId && (!paper || study.paperIds.includes(paper.id))) ?? [];
  const history: HistoryEntry[] = [
    ...turns.map(entry => ({ kind: 'turn' as const, entry, reports: library.reports.filter(report => report.intentId === entry.id) })),
    ...unfinished.map(entry => ({ kind: 'study' as const, entry })),
  ];
  const days = new Map<string, (RecordSummary & { record: HistoryEntry })[]>();
  for (const record of history.sort((a, b) => (b.entry.createdAt ?? '').localeCompare(a.entry.createdAt ?? ''))) {
    const papers = record.entry.paperIds?.flatMap(id => titles.get(id) ?? []) ?? [];
    const reports = record.kind === 'turn' ? record.reports : [];
    const kind = record.kind === 'study' ? 'studyUnfinished' : reports.length ? 'reportSaved' : 'questionSaved';
    if (results && filter !== 'all' && filter !== kind) continue;
    if (results && term && ![record.entry.question, ...papers, ...reports.map(report => report.title)].some(text => text.toLocaleLowerCase(locale).includes(term))) continue;
    const value = record.entry.createdAt;
    const instant = value ? Date.parse(value) : NaN;
    const day = Number.isFinite(instant) ? dayFormat.format(instant) : t('recordUndated');
    const date = value && Number.isFinite(instant) ? { value, time: timeFormat.format(instant) } : undefined;
    const items = days.get(day) ?? [];
    items.push({ record, date, papers: results ? papers : undefined });
    days.set(day, items);
  }
  return <div className="pa-records-scroll" aria-label={t(results ? 'researchResults' : 'researchProgress')}>
    {results && <div className="pa-results-tools">
      <input type="search" aria-label={t('searchResearchResults')} placeholder={t('searchResearchResults')} value={query} onChange={event => setQuery(event.currentTarget.value)}/>
      <select aria-label={t('researchResultStatus')} value={filter} onChange={event => setFilter(event.currentTarget.value as typeof filter)}>
        <option value="all">{t('allResearchResults')}</option>
        {(['reportSaved', 'studyUnfinished', 'questionSaved'] as const).map(kind => <option key={kind} value={kind}>{t(kind)}</option>)}
      </select>
    </div>}
    {!days.size && <EmptyState heading={t(history.length ? 'noResearchMatches' : 'noResearchRecords')}/>}
    {[...days].map(([day, items]) => <section className="pa-history-day" key={day}>
      <h3>{day}</h3>
      {items.map(({ record, date, papers }) => record.kind === 'study'
        ? <SavedStudy key={record.entry.id} entry={record.entry} date={date} papers={papers} api={api} opening={opening?.studyId === record.entry.id ? opening.token : undefined} onContinue={() => onContinue(record.entry)} t={t}/>
        : <SavedTurn key={`${record.entry.id}:${record.reports.length}`} entry={record.entry} date={date} papers={papers} api={api} opening={opening?.intentId === record.entry.id ? opening.token : undefined} reports={record.reports} onCite={onCite} onResume={onFollowUp} t={t}/>)}
    </section>)}
    {!!library.matrixCount && (!results || (!term && filter === 'all')) && <details className="pa-output-matrix pa-record-note pa-history-matrix" open={matrixOpen} onToggle={event => onMatrixOpen(event.currentTarget.open)}>
      <summary>{t('matrix')}</summary>
      <ReadingMatrix api={api} active={matrixOpen} count={library.matrixCount} papers={library.papers} onOpen={onAnnotation} t={t}/>
    </details>}
  </div>;
}
