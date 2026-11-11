import React, { useEffect, useId, useState } from 'react';
import { downloadFile, useAppInfo } from '@pero/app-sdk';
import { Button, Select, EmptyState, Feedback, Icon, Input } from '@pero/app-sdk/ui';
import { Experiments, ReportView, type Citation } from './report-content';
import { ReadingMatrix } from './reading-matrix';
import { ManualRecords, type ResearchAttempt } from './manual-records';
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
  return <span className="pa-history-summary">
    {kind === 'reportSaved' ? <Icon name="file-text" size={15}/> : <Icon family="shell" name="clock" size={15}/>}
    <span className="pa-history-item">
      <span className="pa-history-question">{question}</span>
      {!!papers?.length && <span className="pa-history-papers">{papers.join(' / ')}</span>}
      <span className="pa-history-meta"><span>{t(kind)}</span>{date && <time dateTime={date.value}>{date.time}</time>}</span>
    </span>
    <Icon className="pa-history-chevron" name="chevron-right" size={14}/>
  </span>;
}

function StudyRecord({ study, complete, t }: { study: ResearchStudy; complete: boolean; t: Translator }) {
  const labels = { read: 'readingSource', search: 'searchingSource', note: 'recordingFinding', finalize: 'submittingReport' } as const;
  return <div className="pa-study-record" data-study-id={study.id}>
    <section><h3>{t('researchProgress')} {study.budget.used} / {study.budget.limit} {t('researchSteps')}</h3>
      <ol>{study.steps.map((step, index) => <li key={index}>{t(labels[step.action])}{step.page ? ` — ${t('pdfPage')} ${step.page}` : ''}{step.query ? `: ${step.query}` : ''}</li>)}</ol>
      {!!study.findings.length && <><h3>{t('researchFindings')}</h3><ul>{study.findings.map((finding, index) => <li key={index}>{finding.text}</li>)}</ul></>}
    </section>
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
    {!!report.experiments?.length && <section aria-label={t('experiments')}><h3>{t('experiments')}</h3><Experiments report={report} intent={intent} onCite={value => onCite(value, intent)} t={t}/></section>}
    <div className="pa-answer-actions" aria-label={t('reportActions')}><div className="pa-actions"><Button onClick={() => void exportReport('markdown')}>{t('exportMarkdown')}</Button><Button onClick={() => void exportReport('json')}>{t('exportJson')}</Button><Button onClick={() => window.print()}>{t('print')}</Button></div></div>
    {error && <Feedback kind="error">{error}<Button onClick={() => setError('')}>{t('dismiss')}</Button></Feedback>}
  </div>;
}

function SavedTurn({ entry, reports, api, onCite, onResume, t }: { entry: Intent; reports: Report[]; api: Api; onCite(citation: Citation, intent: Intent): void; onResume(intent: Intent): void; t: Translator }) {
  const [loaded, setLoaded] = useState<{ intent: Intent; reports: Report[] } | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    Promise.all([api.get<Intent>(`/api/intents/${entry.id}`), Promise.all(reports.map(report => api.get<Report>(`/api/reports/${report.id}`)))])
      .then(([intent, answers]) => { if (alive) setLoaded({ intent, reports: answers }); }, reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, entry.id, reports.length, retry]);
  return <article className="pa-record-detail" data-turn-id={entry.id} aria-busy={loading}>
    <h2>{entry.question}</h2>
    {loading && <p role="status">{t('loading')}</p>}
    {error && <Feedback kind="error">{error}<Button onClick={() => setRetry(value => value + 1)}>{t('retry')}</Button></Feedback>}
    {loaded?.intent.contextFile?.anchor && <Button onClick={() => onCite({ paperId: loaded.intent.contextFile!.paperId, anchor: loaded.intent.contextFile!.anchor }, loaded.intent)}>{loaded.intent.contextFile.anchor.rects?.length ? 'Show discussed region' : 'Show discussed page'}</Button>}
    {loaded?.reports.map(report => <Answer key={report.id} report={report} intent={loaded.intent} api={api} onCite={onCite} t={t}/>)}
    {loaded && <Button onClick={() => onResume(loaded.intent)}>{t(reports.length ? 'continueFromHere' : 'resumeQuestion')}</Button>}
  </article>;
}

function SavedStudy({ entry, api, onContinue, t }: { entry: StudySummary; api: Api; onContinue(): void; t: Translator }) {
  const [study, setStudy] = useState<ResearchStudy | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true; setError('');
    api.get<ResearchStudy>(`/api/studies/${entry.id}`).then(value => { if (alive) setStudy(value); }, reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [api, entry.id, entry.budget.used, retry]);
  return <article className="pa-record-detail" data-saved-study-id={entry.id}>
    <h2>{entry.question}</h2>
    {error && <Feedback kind="error">{error}<Button onClick={() => setRetry(value => value + 1)}>{t('retry')}</Button></Feedback>}
    {study ? <StudyRecord study={study} complete={false} t={t}/> : !error && <p role="status">{t('loading')}</p>}
    <Button onClick={onContinue}>{t('continueStudy')}</Button>
  </article>;
}

/** Paper owns persisted research output; the Host owns the conversation and execution. */
export function ResearchRecords({ api, library, paper, results = false, onFollowUp, onContinue, onCite, matrixOpen, onMatrixOpen, onAnnotation, onRead, onAttempt, opening, t }: {
  api: Api; library: Library; paper: Paper | null; opening?: { studyId: string; intentId: string | null; token: number } | null;
  results?: boolean;
  onFollowUp(intent: Intent): void; onContinue(study: StudySummary): void;
  onCite(citation: Citation, intent: Intent): void;
  onRead(id: string): void; onAttempt(attempt: ResearchAttempt): void;
  matrixOpen: boolean; onMatrixOpen(value: boolean): void; onAnnotation(annotation: PdfAnnotation): void; t: Translator;
}) {
  const { locale } = useAppInfo();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RecordKind | 'all'>('all');
  const detailId = useId();
  const [selectedId, setSelectedId] = useState('');
  useEffect(() => { if (opening) setSelectedId(opening.intentId ? `turn:${opening.intentId}` : `study:${opening.studyId}`); }, [opening]);
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
  const visible = [...days.values()].flat();
  const selected = visible.find(item => `${item.record.kind}:${item.record.entry.id}` === selectedId) ?? visible[0];
  return <div className="pa-records-scroll" aria-label={t(results ? 'researchResults' : 'researchProgress')}>
    {results && <div className="pa-results-tools">
      <Input type="search" aria-label={t('searchResearchResults')} placeholder={t('searchResearchResults')} value={query} onChange={event => setQuery(event.currentTarget.value)}/>
      <Select label={t('researchResultStatus')} value={filter} onChange={value => setFilter(value as typeof filter)}
        options={[{ value: 'all', label: t('allResearchResults') }, ...(['reportSaved', 'studyUnfinished', 'questionSaved'] as const).map(kind => ({ value: kind, label: t(kind) }))]}/>
    </div>}
    <div hidden={results && (!!term || filter !== 'all')}><ManualRecords api={api} library={library} paper={paper} onRead={onRead} onAttempt={onAttempt} onCite={onCite}/></div>
    {!days.size && <EmptyState heading={t(history.length ? 'noResearchMatches' : 'noResearchRecords')}/>}
    {!!days.size && <div className="pa-result-browser">
      <nav aria-label={t('researchResults')} className="pa-result-list">
        {[...days].map(([day, items]) => <section className="pa-history-day" key={day}>
          <h3>{day}</h3><ul>{items.map(({ record, date, papers }) => {
            const kind = record.kind === 'study' ? 'studyUnfinished' : record.reports.length ? 'reportSaved' : 'questionSaved';
            return <li key={`${record.kind}:${record.entry.id}`}><Button variant="ghost" aria-pressed={selected?.record === record} aria-controls={detailId} onClick={() => setSelectedId(`${record.kind}:${record.entry.id}`)}>
              <HistorySummary question={record.entry.question} kind={kind} date={date} papers={papers} t={t}/>
            </Button></li>;
          })}</ul>
        </section>)}
      </nav>
      <section id={detailId} aria-label={t('researchResultDetail')} className="pa-result-content">
        {selected?.record.kind === 'study'
          ? <SavedStudy key={selected.record.entry.id} entry={selected.record.entry} api={api} onContinue={() => onContinue(selected.record.entry as StudySummary)} t={t}/>
          : selected?.record.kind === 'turn' && <SavedTurn key={`${selected.record.entry.id}:${selected.record.reports.length}`} entry={selected.record.entry} reports={selected.record.reports} api={api} onCite={onCite} onResume={onFollowUp} t={t}/>}
      </section>
    </div>}
    {!!library.matrixCount && <section className="pa-output-matrix pa-history-matrix">
      <Button variant="ghost" aria-expanded={matrixOpen} aria-controls="paper-reading-matrix" onClick={() => onMatrixOpen(!matrixOpen)}>{t('matrix')}</Button>
      <div id="paper-reading-matrix" hidden={!matrixOpen}><ReadingMatrix api={api} active={matrixOpen} count={library.matrixCount} papers={library.papers} onOpen={onAnnotation} t={t}/></div>
    </section>}
  </div>;
}
