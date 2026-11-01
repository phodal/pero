import React, { useEffect, useRef, useState } from 'react';
import { Button, Feedback, Input, Textarea } from '@pero/app-sdk/ui';
import type { Api } from './types';
import type { OpenSourceEvidenceReport, SourceEvidenceReport, SourceObservation, SourceEvidenceLocation, SourceEvidenceMatch } from './research-types';

function observationLabel(observation: SourceObservation) {
  const anchor = observation.anchor;
  if (observation.kind === 'source_text') return `${anchor.memberPath} · lines ${anchor.startLine}–${anchor.endLine} · characters ${anchor.start}–${anchor.end}`;
  if (observation.kind === 'source_image') return `${anchor.memberPath ?? 'Source image'} · preview supplied`;
  return anchor.status === 'matched' ? `Source / PDF comparison · ${anchor.matches?.length ?? 0} literal matches` : 'Source / PDF comparison · unresolved';
}

export function SourceReports({ api, bundleId, refresh, navigating, canOpenSource, openSource, canOpenPdf, openPdf }: {
  api: Api; bundleId: string; refresh: number; navigating: boolean;
  canOpenSource(observation: SourceObservation, location: SourceEvidenceLocation): boolean;
  openSource(observation: SourceObservation, location: SourceEvidenceLocation): void;
  canOpenPdf(observation: SourceObservation): boolean;
  openPdf(observation: SourceObservation, match: SourceEvidenceMatch): void;
}) {
  const [observations, setObservations] = useState<SourceObservation[]>([]), [reports, setReports] = useState<SourceEvidenceReport[]>([]);
  const [selected, setSelected] = useState<string[]>([]), [title, setTitle] = useState(''), [interpretation, setInterpretation] = useState('');
  const [opened, setOpened] = useState<OpenSourceEvidenceReport | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const mounted = useRef(true), epoch = useRef(0);
  const request = <T,>(input: Record<string, unknown>) => api.post<T>('/api/research/source-report', { bundleId, ...input });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    Promise.all([request<{ observations: SourceObservation[] }>({ operation: 'observations' }), request<{ reports: SourceEvidenceReport[] }>({ operation: 'list' })])
      .then(([evidence, saved]) => {
        if (!alive) return;
        setObservations(evidence.observations); setReports(saved.reports);
        setSelected(ids => ids.filter(id => evidence.observations.some(item => item.id === id)));
      }, reason => { if (alive) setError(String(reason)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, bundleId, refresh, attempt]);
  async function openOrSave(reportId?: string) {
    if (busy) return;
    const version = ++epoch.current; setBusy(true); setError('');
    try {
      const result = await request<OpenSourceEvidenceReport>(reportId ? { operation: 'read', reportId } : {
        operation: 'create', title: title.trim() || 'Source evidence', observationIds: selected,
        interpretations: interpretation.trim() ? [interpretation.trim()] : [],
      });
      if (mounted.current && version === epoch.current) { setOpened(result); setAttempt(value => value + 1); }
    } catch (reason) { if (mounted.current && version === epoch.current) setError(String(reason)); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  return <section className="pa-source-reports" aria-label="Source evidence reports">
    <h4>Source evidence reports</h4>
    {error && <Feedback kind="error">{error}<Button disabled={busy || loading} onClick={() => setAttempt(value => value + 1)}>Reload source reports</Button></Feedback>}
    {loading && <p role="status">Loading recorded evidence…</p>}
    {!loading && !observations.length ? <p>Read source lines, open an image, or compare a saved PDF to record evidence first.</p> : !!observations.length && <details>
      <summary>New report from recorded evidence</summary>
      <fieldset disabled={busy || loading}><legend>Include observed evidence ({selected.length}/64)</legend>
        {observations.map(item => <label key={item.id} className="pa-source-report-choice"><input type="checkbox" disabled={selected.length >= 64 && !selected.includes(item.id)} checked={selected.includes(item.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))}/><span>{observationLabel(item)}</span></label>)}
      </fieldset>
      <label>Report title<Input value={title} maxLength={200} placeholder="Source evidence" disabled={busy} onChange={event => setTitle(event.target.value)}/></label>
      <label>Interpretation (optional; unresolved)<Textarea value={interpretation} maxLength={1000} rows={2} disabled={busy} onChange={event => setInterpretation(event.target.value)}/></label>
      <Button disabled={busy || loading || !selected.length} onClick={() => void openOrSave()}>{busy ? 'Saving…' : 'Save source report'}</Button>
    </details>}
    {!!reports.length && <ul className="pa-source-report-list">{reports.map(report => <li key={report.id}><Button variant="ghost" disabled={busy} aria-pressed={opened?.id === report.id} onClick={() => void openOrSave(report.id)}>{report.title}</Button><small>{report.observationIds.length} observations</small></li>)}</ul>}
    {opened && <article aria-label="Saved source evidence report"><h4>{opened.title}</h4><p role="status">Saved evidence; interpretations remain unresolved.</p>
      <ul>{opened.observations.map(item => <li key={item.id}><strong>{observationLabel(item)}</strong>
        {opened.currentAvailability.find(value => value.observationId === item.id)?.available === false && <Feedback>{opened.currentAvailability.find(value => value.observationId === item.id)?.reason === 'comparison_scope_unrecorded' ? 'This older comparison did not record its PDF identity. Repeat the comparison to obtain verifiable evidence.' : 'Original currently unavailable. Restore its exact version before rereading.'}</Feedback>}
        {item.kind !== 'source_pdf_comparison' && canOpenSource(item, item.anchor) && <Button disabled={busy || navigating || !opened.currentAvailability.find(value => value.observationId === item.id)?.available} onClick={() => openSource(item, item.anchor)}>Open original evidence</Button>}
        {!!item.anchor.matches?.length && <ul>{item.anchor.matches.map((match, index) => <li key={index}>{match.source.memberPath}, lines {match.source.startLine}–{match.source.endLine} → PDF page {match.pdf.page}
          <div className="pa-actions">{canOpenSource(item, match.source) && <Button disabled={busy || navigating || !opened.currentAvailability.find(value => value.observationId === item.id)?.available} onClick={() => openSource(item, match.source)}>Open matched source</Button>}
          {canOpenPdf(item) && <Button disabled={busy || navigating || !opened.currentAvailability.find(value => value.observationId === item.id)?.available} onClick={() => openPdf(item, match)}>Open report PDF page {match.pdf.page}</Button>}</div>
        </li>)}</ul>}
        <details><summary>Evidence identity and limits</summary><pre className="pa-source-text">{JSON.stringify(item.anchor, null, 2)}</pre><ul>{item.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></details>
      </li>)}</ul>
      {!!opened.interpretations.length && <section aria-label="Unresolved interpretations"><h4>Unresolved interpretations</h4>{opened.interpretations.map((item, index) => <p key={index}>{item.text}</p>)}</section>}
    </article>}
  </section>;
}
