import React, { useEffect, useRef, useState } from 'react';
import { downloadFile } from '@pero/app-sdk';
import { Button, Checkbox, Feedback, Field, Icon, Select, SettingsGroup, Textarea } from '@pero/app-sdk/ui';
import { EvidencePanel, Experiments, ReportView, type Citation } from './documents';
import { PaperList } from './library';
import { ReadingMatrix } from './reading-matrix';
import type { useResearch } from './use-research';
import type { Agent, Api, EvidenceLocation, Intent, Library, Paper, PdfAnnotation, PdfSource, Report, ResearchStudy } from './types';
import type { Translator } from './i18n';

export type QuestionDraft = { question: string; fullText: boolean; verifyCode: boolean; verificationPlan: string; selected: string[]; context: string; contextSource?: PdfSource & { paperId: string }; parentIntentId?: string };
type Task = ReturnType<typeof useResearch>;

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

function SavedTurn({ entry, reports, api, onCite, onResume, disabled, t }: { entry: Intent; reports: Report[]; api: Api; onCite(citation: Citation, intent: Intent): void; onResume(): void; disabled: boolean; t: Translator }) {
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
    {!reports.length && <Button disabled={disabled} onClick={onResume}>{t('resumeQuestion')}</Button>}
  </details>;
}

export function Conversation({ api, agent, agentId, onAgent, task, library, paper, draft, onDraft, onReadContext, onSend, onClose, onCite, citation, evidence, evidenceBusy, onCloseEvidence, onReadEvidence, onOpenChat, matrixOpen, onMatrixOpen, onAnnotation, t }: {
  api: Api; agent: Agent; agentId: string; onAgent(id: string): void; task: Task; library: Library; paper: Paper | null;
  onReadContext(): void; draft: QuestionDraft; onDraft(value: Partial<QuestionDraft>): void; onSend(execute?: boolean): void; onClose(): void;
  onCite(citation: Citation, intent: Intent): void; citation: (Citation & { intent: Intent }) | null; evidence: EvidenceLocation | null; evidenceBusy: boolean;
  onCloseEvidence(): void; onReadEvidence(page?: number): void; onOpenChat(): void;
  matrixOpen: boolean; onMatrixOpen(value: boolean): void; onAnnotation(annotation: PdfAnnotation): void; t: Translator;
}) {
  const [settings, setSettings] = useState(false);
  const panel = useRef<HTMLElement>(null), bottom = useRef<HTMLDivElement>(null);
  const locked = task.working || task.busy || task.pending;
  const belongsToPaper = !paper || (task.study ? task.study.paperIds.includes(paper.id) : task.intent ? task.intent.papers.some(p => p.id === paper.id) : true);
  const current = task.intent && (!paper || task.intent.papers.some(p => p.id === paper.id)) ? task.intent : null;
  const history = library.intents.filter(intent => (!paper || intent.paperIds?.includes(paper.id)) && intent.id !== current?.id).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  useEffect(() => { panel.current?.querySelector<HTMLTextAreaElement>('#paper-question')?.focus(); }, []);
  useEffect(() => {
    const scroll = bottom.current?.parentElement;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [task.report?.id, task.intent?.id, task.study?.id, task.study?.steps.length, task.plannedQuestion, task.status, locked]);
  function close() { onClose(); }
  return <aside className="pa-conversation" aria-label={t('ask')} ref={panel} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); if (citation) onCloseEvidence(); else if (settings) setSettings(false); else close(); }
    if (window.matchMedia('(max-width: 760px)').matches && event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]')).filter(node => node.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="pa-conversation-header"><h2>{t('ask')}</h2><Button variant="ghost" aria-label={t('researchOptions')} aria-expanded={settings} onClick={() => setSettings(value => !value)}><Icon name="settings"/></Button><Button variant="ghost" aria-label={t('closeAgent')} onClick={close}>×</Button></header>
    <div className="pa-conversation-scroll">
      {library.studies?.filter(study => !study.reportId && study.id !== task.study?.id && (!paper || study.paperIds.includes(paper.id))).map(study => <section className="pa-turn-history" data-saved-study-id={study.id} key={study.id}><p>{study.question}</p><Button disabled={locked} onClick={() => void task.openStudy(study.id)}>{t('savedStudy')}</Button></section>)}
      {!belongsToPaper && locked && <Feedback>{t('otherPaperTask')} {task.study?.question ?? task.plannedQuestion}</Feedback>}
      {history.map(intent => <SavedTurn key={intent.id} entry={intent} reports={library.reports.filter(report => report.intentId === intent.id)} api={api} onCite={onCite} disabled={locked} onResume={() => { void task.openIntent(intent.id).then(() => onDraft({ question: intent.question, parentIntentId: intent.id })); }} t={t}/>)}
      {belongsToPaper && (current || task.plannedQuestion) && <section className="pa-turn" data-turn-id={current?.id}><p className="pa-user-message">{current?.question ?? task.plannedQuestion}</p>
        {task.report && current && <Answer report={task.report} intent={current} api={api} onCite={onCite} t={t}/>}
        {task.working && <p role="status" className="pa-run-status">{t(task.status === 'needs_input' ? 'needsInput' : task.phase === 'research' ? 'researching' : 'running')}{task.status === 'needs_input' && <Button onClick={onOpenChat}>{t('openChat')}</Button>}</p>}
        {task.study && <StudyRecord study={task.study} complete={!!task.report} t={t}/>}
        {task.status === 'failed' && !task.repair && !task.report && <Feedback kind="error">{t('failed')}{!task.study && <Button onClick={task.retryPoll}>{t('retry')}</Button>}</Feedback>}
        {task.status === 'cancelled' && !task.report && <p role="status">{t('cancelled')}</p>}
        {task.study && !task.report && !locked && <Button disabled={!agent.available || !agentId} onClick={() => void task.continueStudy(agentId)}>{t('continueStudy')}</Button>}
        {task.repair && <Feedback kind="error">{t('invalidReport')}</Feedback>}
      </section>}
      {citation && <EvidencePanel citation={citation} location={evidence} paper={citation.intent.papers.find(p => p.id === citation.paperId)} busy={evidenceBusy} onClose={onCloseEvidence} onRead={onReadEvidence} t={t}/>}
      {!!library.matrixCount && <details className="pa-output-matrix" open={matrixOpen} onToggle={event => onMatrixOpen(event.currentTarget.open)}><summary>{t('matrix')}</summary><ReadingMatrix api={api} active={matrixOpen} count={library.matrixCount} papers={library.papers} onOpen={onAnnotation} t={t}/></details>}
      {(settings || task.repair) && <SettingsGroup className="pa-conversation-settings" aria-label={t('researchOptions')}>
        <label className="pa-checkbox-label"><Checkbox checked={draft.fullText} disabled={locked || draft.verifyCode} onCheckedChange={fullText => onDraft({ fullText })}/>{t('fullTextQuestion')}</label>
        <label className="pa-checkbox-label"><Checkbox checked={draft.verifyCode} disabled={locked || draft.fullText} onCheckedChange={verifyCode => onDraft({ verifyCode })}/>{t('verifyCode')}</label>
        {draft.verifyCode && <Field label={t('boundary')}>{props => <Textarea {...props} rows={3} value={draft.verificationPlan} maxLength={4000} disabled={locked} onChange={event => onDraft({ verificationPlan: event.target.value })}/>}</Field>}
        <Select label={t('agent')} value={agentId} onChange={onAgent} disabled={locked} options={agent.agents.map(agent => ({ value: agent.id, label: agent.name }))}/>
        <details><summary>{t('chooseSources')}</summary><PaperList selecting papers={library.papers} selected={draft.selected} readingId={paper?.id ?? ''} locked={locked} onRead={p => onDraft({ selected: [p.id] })} onSelect={(id, checked) => onDraft({ selected: checked ? [...draft.selected, id] : draft.selected.filter(value => value !== id) })} t={t}/></details>
        {!task.working && !task.pending && <Button disabled={!draft.question.trim() || !draft.selected.length || locked} onClick={() => onSend(false)}>{t('prepare')}</Button>}
        {current && <><Button onClick={() => downloadFile('research-prompt.txt', current.prompt, 'text/plain;charset=utf-8')}>{t('prompt')}</Button>
          {current.retrieval && <details><summary>{t('retrievalDetails')}</summary><p>{t('observedPassages')}: {current.passages?.length} / {t('searchMatches')}: {current.retrieval.totalMatches}</p><p>{t(current.retrieval.method === 'pero.paper-study.agent-tools.v1' ? 'studyScope' : 'localScope')}</p>{!!current.retrieval.unmatchedPaperIds.length && <Feedback>{t('unmatchedSources')} {current.retrieval.unmatchedPaperIds.map(id => current.papers.find(p => p.id === id)?.title).join(', ')}</Feedback>}</details>}
          <details className="pa-output" open={task.repair}><summary>{t('importReport')}</summary><Field label={t('rawOutput')}>{props => <Textarea {...props} rows={6} value={task.raw} disabled={task.working || task.busy} maxLength={500000} onChange={event => task.setRaw(event.target.value)}/>}</Field><Button disabled={locked || !task.raw.trim()} onClick={() => void task.saveRaw()}>{t('saveReport')}</Button></details>
        </>}
      </SettingsGroup>}
      <div ref={bottom}/>
    </div>
    <div className="pa-composer" role="group" aria-label={t('question')}>
      {!!draft.context && <div className="pa-question-context"><blockquote>{draft.context}</blockquote>{draft.contextSource && <Button variant="ghost" onClick={onReadContext}>{t('pdfPage')} {draft.contextSource.page} ↗</Button>}<Button variant="ghost" aria-label={t('removeContext')} onClick={() => onDraft({ context: '', contextSource: undefined })}>×</Button></div>}
      {!agent.available && <Feedback>{t('noAgentChoice')}<Button onClick={() => void agent.refresh()}>{t('refresh')}</Button></Feedback>}
      <label className="pa-sr-only" htmlFor="paper-question">{t('question')}</label><Textarea id="paper-question" rows={2} value={draft.question} maxLength={2000} disabled={locked} placeholder={t('askPlaceholder')} onChange={event => onDraft({ question: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (draft.question.trim() && !locked && agent.available) onSend(); } }}/>
      {task.working ? <Button aria-label={t('cancel')} disabled={task.busy || task.status === 'cancelling'} onClick={() => void task.cancel()}>{t('cancel')}</Button> : <Button onClick={() => onSend()} variant="primary" aria-label={t(task.pending ? 'retryStart' : 'sendQuestion')} disabled={task.busy || !agent.available || !agentId || (!task.pending && (!draft.question.trim() || !draft.selected.length || (draft.verifyCode && !draft.verificationPlan.trim())))}>{task.busy ? t('preparing') : task.pending ? t('retryStart') : '↑'}</Button>}
    </div>
  </aside>;
}
