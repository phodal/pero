import React, { useEffect, useRef, useState } from 'react';
import { downloadFile } from '@pero/app-sdk';
import { Button, Checkbox, Feedback, Field, Icon, Select, Textarea } from '@pero/app-sdk/ui';
import { EvidencePanel, Experiments, ReportView, type Citation } from './documents';
import { PaperList } from './library';
import { ReadingMatrix } from './reading-matrix';
import type { useResearch } from './use-research';
import type { Agent, Api, EvidenceLocation, Intent, Library, Paper, PdfAnnotation, Report } from './types';
import type { Translator } from './i18n';

export type QuestionDraft = { question: string; fullText: boolean; verifyCode: boolean; verificationPlan: string; selected: string[]; context: string };
type Task = ReturnType<typeof useResearch>;

function Answer({ report, intent, api, onCite, t }: { report: Report; intent: Intent; api: Api; onCite(citation: Citation, intent: Intent): void; t: Translator }) {
  const [error, setError] = useState('');
  async function exportReport(format: 'markdown' | 'json') {
    try { const value = await api.get<{ filename: string; content: string; mime: string }>(`/api/reports/${report.id}/export?format=${format}`); downloadFile(value.filename, value.content, value.mime); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return <div className="pa-answer">
    <ReportView report={report} intent={intent} onCite={value => onCite(value, intent)} t={t}/>
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

export function Conversation({ api, agent, agentId, onAgent, task, library, paper, draft, onDraft, onSend, onClose, onCite, citation, evidence, evidenceBusy, onCloseEvidence, onReadEvidence, onOpenChat, matrixOpen, onMatrixOpen, onAnnotation, t }: {
  api: Api; agent: Agent; agentId: string; onAgent(id: string): void; task: Task; library: Library; paper: Paper | null;
  draft: QuestionDraft; onDraft(value: Partial<QuestionDraft>): void; onSend(execute?: boolean): void; onClose(): void;
  onCite(citation: Citation, intent: Intent): void; citation: (Citation & { intent: Intent }) | null; evidence: EvidenceLocation | null; evidenceBusy: boolean;
  onCloseEvidence(): void; onReadEvidence(page?: number): void; onOpenChat(): void;
  matrixOpen: boolean; onMatrixOpen(value: boolean): void; onAnnotation(annotation: PdfAnnotation): void; t: Translator;
}) {
  const [settings, setSettings] = useState(false);
  const panel = useRef<HTMLElement>(null), bottom = useRef<HTMLDivElement>(null);
  const locked = task.working || task.busy || task.pending;
  const current = task.intent && (!paper || task.intent.papers.some(p => p.id === paper.id)) ? task.intent : null;
  const history = library.intents.filter(intent => (!paper || intent.paperIds?.includes(paper.id)) && intent.id !== current?.id).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  useEffect(() => { panel.current?.querySelector<HTMLTextAreaElement>('#paper-question')?.focus(); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [task.report?.id, task.intent?.id]);
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
      {history.map(intent => <SavedTurn key={intent.id} entry={intent} reports={library.reports.filter(report => report.intentId === intent.id)} api={api} onCite={onCite} disabled={locked} onResume={() => { void task.openIntent(intent.id).then(() => onDraft({ question: intent.question })); }} t={t}/>)}
      {current && <section className="pa-turn" data-turn-id={current.id}><p className="pa-user-message">{current.question}</p>
        {task.report && <Answer report={task.report} intent={current} api={api} onCite={onCite} t={t}/>}
        {task.working && <p role="status" className="pa-run-status">{t(task.status === 'needs_input' ? 'needsInput' : 'running')}{task.status === 'needs_input' && <Button onClick={onOpenChat}>{t('openChat')}</Button>}</p>}
        {task.status === 'failed' && <Feedback kind="error">{t('failed')}<Button onClick={task.retryPoll}>{t('retry')}</Button></Feedback>}
        {task.status === 'cancelled' && <p role="status">{t('cancelled')}</p>}
        {task.repair && <Feedback kind="error">{t('invalidReport')}</Feedback>}
      </section>}
      {citation && <EvidencePanel citation={citation} location={evidence} paper={citation.intent.papers.find(p => p.id === citation.paperId)} busy={evidenceBusy} onClose={onCloseEvidence} onRead={onReadEvidence} t={t}/>}
      {!!library.matrixCount && <details className="pa-output-matrix" open={matrixOpen} onToggle={event => onMatrixOpen(event.currentTarget.open)}><summary>{t('matrix')}</summary><ReadingMatrix api={api} active={matrixOpen} count={library.matrixCount} papers={library.papers} onOpen={onAnnotation} t={t}/></details>}
      {(settings || task.repair) && <div className="pa-conversation-settings" aria-label={t('researchOptions')}>
        <label className="pa-checkbox-label"><Checkbox checked={draft.fullText} disabled={locked || draft.verifyCode} onCheckedChange={fullText => onDraft({ fullText })}/>{t('fullTextQuestion')}</label>
        <label className="pa-checkbox-label"><Checkbox checked={draft.verifyCode} disabled={locked || draft.fullText} onCheckedChange={verifyCode => onDraft({ verifyCode })}/>{t('verifyCode')}</label>
        {draft.verifyCode && <Field label={t('boundary')}>{props => <Textarea {...props} rows={3} value={draft.verificationPlan} maxLength={4000} disabled={locked} onChange={event => onDraft({ verificationPlan: event.target.value })}/>}</Field>}
        <Select label={t('agent')} value={agentId} onChange={onAgent} disabled={locked} options={agent.agents.map(agent => ({ value: agent.id, label: agent.name }))}/>
        <details><summary>{t('chooseSources')}</summary><PaperList selecting papers={library.papers} selected={draft.selected} readingId={paper?.id ?? ''} locked={locked} onRead={p => onDraft({ selected: [p.id] })} onSelect={(id, checked) => onDraft({ selected: checked ? [...draft.selected, id] : draft.selected.filter(value => value !== id) })} t={t}/></details>
        {!task.working && !task.pending && <Button disabled={!draft.question.trim() || !draft.selected.length || locked} onClick={() => onSend(false)}>{t('prepare')}</Button>}
        {current && <><Button onClick={() => downloadFile('research-prompt.txt', current.prompt, 'text/plain;charset=utf-8')}>{t('prompt')}</Button>
          {current.retrieval && <details><summary>{t('retrievalDetails')}</summary><p>{current.passages?.length} / {current.retrieval.totalMatches} {t('localPassages')}</p><p>{t('localScope')}</p>{!!current.retrieval.unmatchedPaperIds.length && <Feedback>{t('unmatchedSources')} {current.retrieval.unmatchedPaperIds.map(id => current.papers.find(p => p.id === id)?.title).join(', ')}</Feedback>}</details>}
          <details className="pa-output" open={task.repair}><summary>{t('importReport')}</summary><Field label={t('rawOutput')}>{props => <Textarea {...props} rows={6} value={task.raw} disabled={task.working || task.busy} maxLength={500000} onChange={event => task.setRaw(event.target.value)}/>}</Field><Button disabled={locked || !task.raw.trim()} onClick={() => void task.saveRaw()}>{t('saveReport')}</Button></details>
        </>}
      </div>}
      <div ref={bottom}/>
    </div>
    <div className="pa-composer" role="group" aria-label={t('question')}>
      {!!draft.context && <div className="pa-question-context"><blockquote>{draft.context}</blockquote><Button variant="ghost" aria-label={t('removeContext')} onClick={() => onDraft({ context: '' })}>×</Button></div>}
      {!agent.available && <Feedback>{t('noAgentChoice')}<Button onClick={() => void agent.refresh()}>{t('refresh')}</Button></Feedback>}
      <label className="pa-sr-only" htmlFor="paper-question">{t('question')}</label><Textarea id="paper-question" rows={2} value={draft.question} maxLength={2000} disabled={locked} placeholder={t('askPlaceholder')} onChange={event => onDraft({ question: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (draft.question.trim() && !locked && agent.available) onSend(); } }}/>
      {task.working ? <Button aria-label={t('cancel')} disabled={task.busy || task.status === 'cancelling'} onClick={() => void task.cancel()}>{t('cancel')}</Button> : <Button onClick={() => onSend()} variant="primary" aria-label={t(task.pending ? 'retryStart' : 'sendQuestion')} disabled={task.busy || !agent.available || !agentId || (!task.pending && (!draft.question.trim() || !draft.selected.length || (draft.verifyCode && !draft.verificationPlan.trim())))}>{task.busy ? t('preparing') : task.pending ? t('retryStart') : '↑'}</Button>}
    </div>
  </aside>;
}
