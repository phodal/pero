import React, { useEffect, useRef, useState } from 'react';
import { downloadFile } from '@pero/app-sdk';
import { Button, Feedback, Input, Textarea } from '@pero/app-sdk/ui';
import type { Api, Library, Paper, Report } from './types';
import { reviseEvidence, reportsCitingPaper, type ManualEvidence as Evidence } from './manual-evidence';
import { ResearchWatch, researchHost, type DataPin, type Dataset } from './research-watch';
import './manual-records.css';

type Decision = { paperId: string; decision: 'include' | 'exclude' | 'pending'; reason: string };
export type ResearchAttempt = { paperId: string; documentId: string; annotationId: string; page: number;
  itemId: string; attemptId: string; profile: string; policy: string; seed: number; status: string; startedAt: string };
type RecordRevision = {
  id: string; parentId?: string | null; question: string; scope: string; inclusion: string; exclusion: string;
  paperIds: string[]; decisions: Decision[]; evidence: Evidence[]; createdAt: string;
  attempts?: ResearchAttempt[];
  dataVersions?: DataPin[];
  selections?: { id: string; paperIds: string[]; createdAt: string }[];
  review?: { decision: 'needs_review' | 'accepted' | 'rejected'; note: string } | null;
};
type Impact = { recordId: string; methodStatus: string; affectedAttempts: ResearchAttempt[]; affectedReportIds: string[];
  items: { paperId: string; status: string; reason: string;
  pdfChanged: boolean; structuredChanged: boolean; candidatePaperIds: string[] }[] };

/** Manual decisions reference existing evidence; they never create observations or execute research. */
export function ManualRecords({ api, library, paper, onRead, onAttempt }: { api: Api; library: Library; paper: Paper | null;
  onRead(id: string): void; onAttempt(attempt: ResearchAttempt): void }) {
  const [reports, setReports] = useState<Report[]>([]), [reportsLoading, setReportsLoading] = useState(false), [reportsError, setReportsError] = useState(''), [reportsRetry, setReportsRetry] = useState(0);
  const [records, setRecords] = useState<RecordRevision[]>([]), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false), [parentId, setParentId] = useState<string | undefined>();
  const [review, setReview] = useState(''), [reviewNote, setReviewNote] = useState('');
  const [question, setQuestion] = useState(''), [scope, setScope] = useState(''), [inclusion, setInclusion] = useState(''), [exclusion, setExclusion] = useState('');
  const [decisions, setDecisions] = useState<Decision[]>([]), [evidence, setEvidence] = useState<Evidence[]>([]);
  const [attempts, setAttempts] = useState<ResearchAttempt[]>([]), [availableAttempts, setAvailableAttempts] = useState<ResearchAttempt[] | null>(null);
  const [handoffNotes, setHandoffNotes] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [dataPins, setDataPins] = useState<Record<string, string>>({});
  const [opened, setOpened] = useState<RecordRevision | null>(null), [impact, setImpact] = useState<Impact | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true), pending = useRef(false), epoch = useRef(0);
  const request = <T,>(body: object) => api.post<T>('/api/research/record', body);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    request<{ records: RecordRevision[] }>({ operation: 'list' }).then(value => { if (alive) setRecords(value.records); }, reason => { if (alive) setError(String(reason)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, retry]);
  useEffect(() => {
    if (!editing) return;
    let alive = true; setReportsLoading(true); setReportsError('');
    Promise.all(library.reports.map(report => report.sections === undefined ? api.get<Report>(`/api/reports/${report.id}`) : Promise.resolve(report)))
      .then(values => { if (alive) setReports(values); }, reason => { if (alive) setReportsError(String(reason)); })
      .finally(() => { if (alive) setReportsLoading(false); });
    return () => { alive = false; };
  }, [api, editing, library.reports, reportsRetry]);
  async function act(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (reason) { if (mounted.current) setError(String(reason)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  function edit(record?: RecordRevision) {
    setParentId(record?.id); setQuestion(record?.question ?? ''); setScope(record?.scope ?? '');
    setInclusion(record?.inclusion ?? ''); setExclusion(record?.exclusion ?? '');
    setDecisions(record?.decisions ?? (paper ? [{ paperId: paper.id, decision: 'pending', reason: '' }] : []));
    setReview(''); setReviewNote('');
    setAttempts(record?.attempts ?? []); setAvailableAttempts(null);
    setDatasets(null); setDataPins(Object.fromEntries((record?.dataVersions ?? []).map(pin => [pin.datasetId, pin.versionId])));
    setEvidence(record?.evidence ?? []); setEditing(true); setError(''); setMessage('');
  }
  async function open(record: RecordRevision) {
    const value = await request<RecordRevision>({ operation: 'read', recordId: record.id });
    if (!mounted.current) return;
    epoch.current++; setOpened(value); setImpact(null); setSelected([]); setMessage(''); setHandoffNotes(false);
  }
  function updateDecision(id: string, patch: Partial<Decision>) { setDecisions(items => items.map(item => item.paperId === id ? { ...item, ...patch } : item)); }
  function updateEvidence(index: number, patch: Partial<Evidence> | null) { setEvidence(items => reviseEvidence(items, index, patch)); }
  async function save() {
    const record = { operation: 'create', ...(parentId ? { parentId } : {}), question, scope, inclusion, exclusion,
      paperIds: decisions.map(item => item.paperId), decisions, evidence, attempts: attempts.map(({ itemId, attemptId }) => ({ itemId, attemptId })),
      ...(review ? { review: { decision: review, note: reviewNote } } : {}) };
    const result = datasets === null ? await request<RecordRevision>(record) : await researchHost<RecordRevision>('research-assets', {
      operation: 'saverecord', record, datasets: Object.entries(dataPins).map(([datasetId, versionId]) => ({ datasetId, versionId })),
    });
    if (!mounted.current) return;
    setRecords(items => [result, ...items.filter(item => item.id !== result.id)]); setEditing(false); await open(result); setMessage('Revision saved. Earlier records are unchanged.');
  }
  function submit() {
    // App frames deliberately omit allow-forms; validate without native submission.
    if (valid && form.current?.reportValidity()) void act(save);
  }
  async function exportHandoff(record: RecordRevision, attempt: ResearchAttempt) {
    const response = await fetch('/api/research/record-handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId: record.id, itemId: attempt.itemId, attemptId: attempt.attemptId, includeNotes: true }) });
    if (!response.ok) throw Error((await response.json()).detail);
    const bytes = await response.arrayBuffer();
    if (mounted.current) downloadFile(`research-${record.id.slice(0, 12)}-${attempt.attemptId.slice(0, 12)}.zip`, bytes, 'application/zip');
  }
  const visible = records.filter(record => !paper || record.paperIds.includes(paper.id));
  const title = (id: string) => library.papers.find(item => item.id === id)?.title ?? 'Unavailable paper';
  const valid = question.trim() && scope.trim() && inclusion.trim() && exclusion.trim() && decisions.length && decisions.every(item => item.reason.trim());
  const attemptLabel = (attempt: ResearchAttempt) => `${attempt.profile} / ${attempt.policy}, seed ${attempt.seed} / ${attempt.status} / ${attempt.startedAt}`;
  return <details className="pa-manual-records"><summary>Question and scope</summary>
    {loading && <p role="status">Loading records…</p>}
    {error && <Feedback kind="error">{error}<Button disabled={busy || loading} onClick={() => setRetry(value => value + 1)}>Reload records</Button></Feedback>}
    {message && <p role="status">{message}</p>}
    {!editing && <Button disabled={busy || loading || !library.papers.length} onClick={() => edit()}>New record</Button>}
    {editing && <form ref={form} onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={event => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'text') {
        event.preventDefault(); if (!event.nativeEvent.isComposing) submit();
      }
    }}>
      <fieldset disabled={busy}><legend>{parentId ? 'Revise question and scope' : 'New question and scope'}</legend>
        <label>Question<Input required maxLength={2000} value={question} onChange={event => setQuestion(event.target.value)}/></label>
        <label>Scope<Textarea required maxLength={4000} rows={2} value={scope} onChange={event => setScope(event.target.value)}/></label>
        <label>Inclusion criteria<Textarea required maxLength={2000} rows={2} value={inclusion} onChange={event => setInclusion(event.target.value)}/></label>
        <label>Exclusion criteria<Textarea required maxLength={2000} rows={2} value={exclusion} onChange={event => setExclusion(event.target.value)}/></label>
        <details open><summary>Papers and screening reasons</summary>
          {library.papers.map(item => {
            const decision = decisions.find(value => value.paperId === item.id), options = reportsCitingPaper(reports, item.id);
            const citations = evidence.map((citation, index) => ({ citation, index })).filter(({ citation }) => citation.paperId === item.id);
            return <div className="pa-manual-paper" key={item.id}>
              <label className="pa-manual-choice"><input type="checkbox" disabled={!decision && decisions.length >= 32} checked={!!decision} onChange={event => {
                setDecisions(values => event.target.checked ? [...values, { paperId: item.id, decision: 'pending', reason: '' }] : values.filter(value => value.paperId !== item.id));
                setEvidence(values => values.filter(value => value.paperId !== item.id));
                setAttempts(values => values.filter(value => value.paperId !== item.id)); setAvailableAttempts(null);
              }}/><span>{item.title}</span></label>
              {decision && <>
                <label>Decision<select value={decision.decision} onChange={event => updateDecision(item.id, { decision: event.target.value as Decision['decision'] })}><option value="pending">Pending</option><option value="include">Include</option><option value="exclude">Exclude</option></select></label>
                <label>Reason<Textarea required maxLength={2000} rows={2} value={decision.reason} onChange={event => updateDecision(item.id, { reason: event.target.value })}/></label>
                <details><summary>Evidence or gaps (optional)</summary>
                  {reportsLoading && <p role="status">Loading cited reports…</p>}
                  {reportsError && <Feedback kind="error">Reports could not be loaded. Existing references are unchanged.<Button onClick={() => setReportsRetry(value => value + 1)}>Reload cited reports</Button></Feedback>}
                  {citations.map(({ citation, index }) => <fieldset key={index}><legend>Evidence {citations.findIndex(value => value.index === index) + 1}</legend>
                    <label>Saved report<select disabled={reportsLoading || !!reportsError} value={citation.reportId ?? '__gap__'} onChange={event => updateEvidence(index, event.target.value === '__gap__' ? { reportId: null, stance: 'gap' } : { reportId: event.target.value })}>
                      <option value="__gap__">Unresolved gap (no report)</option>
                      {citation.reportId && !options.some(report => report.id === citation.reportId) && <option value={citation.reportId} disabled>Saved reference (not currently available)</option>}
                      {options.map(report => <option key={report.id} value={report.id}>{report.title}</option>)}
                    </select></label>
                    <label>Relation<select disabled={citation.reportId === null} value={citation.stance} onChange={event => updateEvidence(index, { stance: event.target.value as Evidence['stance'] })}><option value="support">Support</option><option value="counterevidence">Counterevidence</option><option value="gap">Gap</option></select></label>
                    <label>Conditions and limitations<Textarea required maxLength={2000} rows={2} value={citation.note} onChange={event => updateEvidence(index, { note: event.target.value })}/></label>
                    <Button onClick={() => updateEvidence(index, null)}>Remove evidence</Button>
                  </fieldset>)}
                  <Button disabled={evidence.length >= 64} onClick={() => setEvidence(values => [...values, { paperId: item.id, reportId: null, stance: 'gap', note: '' }])}>Add evidence or gap</Button>
                </details>
              </>}
            </div>;
          })}
        </details>
        <details><summary>Execution history</summary>
          <Button disabled={busy || !decisions.length} onClick={() => void act(async () => {
            const result = await request<{ attempts: ResearchAttempt[] }>({ operation: 'attempts', paperIds: decisions.map(item => item.paperId) });
            if (mounted.current) setAvailableAttempts(result.attempts);
          })}>Find attempts</Button>
          {availableAttempts?.length === 0 && <p role="status">No finished attempts for these papers.</p>}
          {(availableAttempts ?? attempts).map(attempt => {
            const matching = (value: ResearchAttempt) => value.itemId === attempt.itemId && value.attemptId === attempt.attemptId;
            const checked = attempts.some(matching);
            return <label className="pa-manual-choice" key={`${attempt.itemId}/${attempt.attemptId}`}>
              <input type="checkbox" checked={checked} disabled={!checked && attempts.length >= 32} onChange={event =>
                setAttempts(values => event.target.checked ? [...values, attempt] : values.filter(value => !matching(value)))}/>
              <span>{attemptLabel(attempt)}</span></label>;
          })}
        </details>
        <details><summary>Data Workspace</summary>
          <Button disabled={busy} onClick={() => void act(async () => {
            const values = await researchHost<Dataset[]>('research-assets', { operation: 'datasets' });
            if (mounted.current) setDatasets(values.filter(dataset => !dataset.archived || dataPins[dataset.datasetId]));
          })}>Choose Data versions</Button>
          {datasets?.length === 0 && <p role="status">Import a dataset in Data Workspace first.</p>}
          {datasets?.map(dataset => <label key={dataset.datasetId}>{dataset.name}<select value={dataPins[dataset.datasetId] ?? ''} onChange={event => {
            const next = { ...dataPins };
            if (event.target.value) next[dataset.datasetId] = event.target.value;
            else delete next[dataset.datasetId];
            setDataPins(next);
          }}>
            <option value="">No reference</option>
            {[...dataset.versions].reverse().map((version, index) => <option key={version.versionId} value={version.versionId}
              disabled={dataset.archived || version.availability !== 'present'}>{version.versionId.slice(0, 8)}{index === 0 ? ' (latest)' : ''}</option>)}
          </select></label>)}
        </details>
        <details><summary>Local review (optional)</summary>
          <p>Your recorded decision, not independent review or scientific acceptance.</p>
          <label>Review decision<select value={review} onChange={event => setReview(event.target.value)}><option value="">No review recorded</option><option value="needs_review">Needs review</option><option value="accepted">Accepted by me</option><option value="rejected">Rejected by me</option></select></label>
          {review && <label>Review reason<Textarea required maxLength={2000} rows={2} value={reviewNote} onChange={event => setReviewNote(event.target.value)}/></label>}
        </details>
        <div className="pa-actions"><Button type="button" disabled={!valid} onClick={submit}>{busy ? 'Saving…' : 'Save revision'}</Button><Button type="button" onClick={() => setEditing(false)}>Cancel</Button></div>
      </fieldset>
    </form>}
    {!!visible.length && <ul className="pa-manual-history">{visible.map(record => <li key={record.id}><Button variant="ghost" disabled={busy} aria-pressed={opened?.id === record.id} onClick={() => void act(() => open(record))}>{record.question}</Button><small>{record.createdAt}{record.parentId ? ' — revised' : ''}</small></li>)}</ul>}
    {opened && <article aria-label="Saved research record"><h3>{opened.question}</h3><p>{opened.scope}</p>
      <dl><dt>Inclusion</dt><dd>{opened.inclusion}</dd><dt>Exclusion</dt><dd>{opened.exclusion}</dd></dl>
      <ul>{opened.decisions.map(item => <li key={item.paperId}><strong>{title(item.paperId)}</strong><p>{item.decision}: {item.reason}</p></li>)}</ul>
      {!!opened.evidence.length && <><h3>Evidence references</h3><ul>{opened.evidence.map((item, index) => <li key={index}>{title(item.paperId)} — {item.stance}<p>{item.note}</p><small>{item.reportId ? library.reports.find(report => report.id === item.reportId)?.title ?? 'Saved report reference' : 'No source evidence yet'}</small></li>)}</ul></>}
      {opened.review && <p>Local review: {opened.review.decision} — {opened.review.note}. Identity is self-declared, not independent review.</p>}
      {!!opened.attempts?.length && <details open><summary>Execution history</summary>
        <ul>{opened.attempts.map(attempt => <li key={`${attempt.itemId}/${attempt.attemptId}`}><p>{attemptLabel(attempt)}</p>
          <Button variant="ghost" disabled={busy} onClick={() => onAttempt(attempt)}>Open result in PDF</Button>
          {attempt.status === 'completed' && <Button disabled={busy || !handoffNotes} onClick={() => void act(() => exportHandoff(opened, attempt))}>Export research handoff</Button>}
        </li>)}</ul>
        {opened.attempts.some(attempt => attempt.status === 'completed') && <label className="pa-manual-choice">
          <input type="checkbox" checked={handoffNotes} disabled={busy} onChange={event => setHandoffNotes(event.target.checked)}/>
          <span>Include this revision’s notes, the bound PDF excerpt, and the selected attempt’s numeric evidence.</span>
        </label>}
      </details>}
      <div className="pa-actions"><Button disabled={busy || editing} onClick={() => edit(opened)}>Revise</Button>
        <Button disabled={busy} onClick={() => void act(async () => { const version = epoch.current, result = await request<Impact>({ operation: 'impact', recordId: opened.id }); if (mounted.current && version === epoch.current) { setImpact(result); setSelected([]); } })}>Check saved source updates</Button>
        <Button disabled={busy} onClick={() => void act(async () => { const result = await request<object>({ operation: 'export', recordId: opened.id }); if (mounted.current) downloadFile(`research-record-${opened.id.slice(0,12)}.json`, JSON.stringify(result, null, 2), 'application/json'); })}>Export references</Button>
      </div>
      <details onToggle={event => setWatchOpen(event.currentTarget.open)}><summary>Watch for updates</summary>
        {watchOpen && <ResearchWatch key={opened.id} recordId={opened.id} versions={opened.dataVersions ?? []} reports={library.reports} onAttempt={onAttempt}/>}
      </details>
      {!!opened.selections?.length && <details><summary>Saved reread selections</summary><ul>{opened.selections.map(selection => <li key={selection.id}>{selection.createdAt}
        {selection.paperIds.map(id => <Button key={id} variant="ghost" disabled={busy} onClick={() => onRead(id)}>{title(id)}</Button>)}</li>)}</ul></details>}
      {impact && <section aria-label="Source update impact">
        <p>Saved versions only. Upstream freshness is unknown.</p>
        {impact.methodStatus === 'changed' && <p>The installed PC-Gym method has changed. Freeze a new item before running it.</p>}
        {!!impact.affectedAttempts.length && <ul aria-label="Affected attempts">{impact.affectedAttempts.map(attempt => <li key={`${attempt.itemId}/${attempt.attemptId}`}>
          <Button variant="ghost" disabled={busy} onClick={() => onAttempt(attempt)}>{attemptLabel(attempt)}</Button>
        </li>)}</ul>}
        {!!impact.affectedReportIds.length && <ul aria-label="Affected reports">{impact.affectedReportIds.map(id => <li key={id}>
          {library.reports.find(report => report.id === id)?.title ?? 'Saved report reference'}
        </li>)}</ul>}
        <ul>{impact.items.map(item => <li key={item.paperId}><label className="pa-manual-choice"><input type="checkbox" disabled={busy} checked={selected.includes(item.paperId)} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.paperId] : ids.filter(id => id !== item.paperId))}/><span>{title(item.paperId)} — {item.status}</span></label>
          <p>{item.reason}{item.pdfChanged ? ' / PDF changed' : ''}{item.structuredChanged ? ' / Parsed document changed' : ''}</p>
          {item.candidatePaperIds.map(id => <Button key={id} variant="ghost" disabled={busy} onClick={() => onRead(id)}>{title(id)}</Button>)}
        </li>)}</ul>
        <Button disabled={busy || !selected.length} onClick={() => void act(async () => { await request({ operation: 'select', recordId: opened.id, paperIds: selected }); const value = await request<RecordRevision>({ operation: 'read', recordId: opened.id }); if (mounted.current) { setOpened(value); setSelected([]); setMessage('Reread selection saved.'); if (selected.length === 1) onRead(selected[0]); } })}>Save reread selection</Button>
      </section>}
    </article>}
  </details>;
}
