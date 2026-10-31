import React, { useEffect, useState } from 'react';
import { downloadFile } from '@pero/app-sdk';
import { Button, EmptyState, Feedback } from '@pero/app-sdk/ui';
import { Experiments, ReportView, type Citation } from './documents';
import { ReadingMatrix } from './reading-matrix';
import type { Api, Intent, Library, Paper, PdfAnnotation, Report, ResearchStudy, StudySummary } from './types';
import type { Translator } from './i18n';

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

function SavedTurn({ entry, reports, api, onCite, onResume, disabled, t }: { entry: Intent; reports: Report[]; api: Api; onCite(citation: Citation, intent: Intent): void; onResume(intent: Intent): void; disabled: boolean; t: Translator }) {
  const [loaded, setLoaded] = useState<{ intent: Intent; reports: Report[] } | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  async function load() {
    if (loaded || loading) return;
    setLoading(true); setError('');
    try { const [intent, answers] = await Promise.all([api.get<Intent>(`/api/intents/${entry.id}`), Promise.all(reports.map(report => api.get<Report>(`/api/reports/${report.id}`)))]); setLoaded({ intent, reports: answers }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  return <details className="pa-turn-history" data-turn-id={entry.id} onToggle={event => { if (event.currentTarget.open) void load(); }}><summary>{entry.question}</summary>
    {loading && <p role="status">{t('loading')}</p>}
    {error && <Feedback kind="error">{error}<Button onClick={() => void load()}>{t('retry')}</Button></Feedback>}
    {loaded?.reports.map(report => <Answer key={report.id} report={report} intent={loaded.intent} api={api} onCite={onCite} t={t}/>)}
    <Button disabled={disabled || !loaded} onClick={() => loaded && onResume(loaded.intent)}>{t(reports.length ? 'continueFromHere' : 'resumeQuestion')}</Button>
  </details>;
}

function SavedStudy({ entry, api, onContinue, t }: { entry: StudySummary; api: Api; onContinue(): void; t: Translator }) {
  const [study, setStudy] = useState<ResearchStudy | null>(null), [error, setError] = useState('');
  const [open, setOpen] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError('');
    api.get<ResearchStudy>(`/api/studies/${entry.id}`).then(value => { if (active) setStudy(value); }, error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [api, entry.id, entry.budget.used, open, retry]);
  return <details className="pa-turn-history" data-saved-study-id={entry.id} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{entry.question}</summary>
    {error ? <Feedback kind="error">{error}<Button onClick={() => setRetry(value => value + 1)}>{t('retry')}</Button></Feedback> : study ? <StudyRecord study={study} complete={false} t={t}/> : <p role="status">{t('loading')}</p>}
    <Button onClick={onContinue}>{t('continueStudy')}</Button>
  </details>;
}

/** Paper owns persisted research output; the Host owns the conversation and execution. */
export function ResearchRecords({ api, library, paper, onFollowUp, onContinue, onCite, matrixOpen, onMatrixOpen, onAnnotation, t }: {
  api: Api; library: Library; paper: Paper | null;
  onFollowUp(intent: Intent): void; onContinue(study: StudySummary): void;
  onCite(citation: Citation, intent: Intent): void;
  matrixOpen: boolean; onMatrixOpen(value: boolean): void; onAnnotation(annotation: PdfAnnotation): void; t: Translator;
}) {
  const history = library.intents.filter(intent => !paper || intent.paperIds?.includes(paper.id)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const unfinished = library.studies?.filter(study => !study.reportId && (!paper || study.paperIds.includes(paper.id))) ?? [];
  return <div className="pa-records-scroll" aria-label={t('researchProgress')}>
    {!history.length && !unfinished.length && !library.matrixCount && <EmptyState heading={t('noResearchRecords')}/>}
    {unfinished.map(study => <SavedStudy key={study.id} entry={study} api={api} onContinue={() => onContinue(study)} t={t}/>)}
    {history.map(intent => <SavedTurn key={`${intent.id}:${library.reports.filter(report => report.intentId === intent.id).length}`} entry={intent} reports={library.reports.filter(report => report.intentId === intent.id)} api={api} onCite={onCite} onResume={onFollowUp} disabled={false} t={t}/>)}
    {!!library.matrixCount && <details className="pa-output-matrix" open={matrixOpen} onToggle={event => onMatrixOpen(event.currentTarget.open)}><summary>{t('matrix')}</summary><ReadingMatrix api={api} active={matrixOpen} count={library.matrixCount} papers={library.papers} onOpen={onAnnotation} t={t}/></details>}
  </div>;
}
