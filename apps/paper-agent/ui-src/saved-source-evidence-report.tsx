import { useEffect, useRef, useState } from 'react';
import { Button, Disclosure, Feedback, Table } from '@pero/app-sdk/ui';
import type { Api } from './types';
import type { DocumentEvidenceScope, OpenSourceEvidenceReport } from './research-types';
import './structured-reading.css';

type RecordedWindow = { scope: DocumentEvidenceScope; content: string; context: string; limitations: string[];
  items: { text?: string; latex?: string; row?: number; column?: number; alt?: string; url?: string }[] };

/** The source owner resolves report identity and verifies every reopened window. */
export function SavedSourceEvidenceReport({ api, reportId, onClose }: { api: Api; reportId: string; onClose(): void }) {
  const region = useRef<HTMLElement>(null);
  const [report, setReport] = useState<OpenSourceEvidenceReport | null>(null), [retry, setRetry] = useState(0);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [windows, setWindows] = useState<RecordedWindow[] | null>(null);
  useEffect(() => {
    let alive = true;
    region.current?.focus(); setError('');
    api.post<OpenSourceEvidenceReport>('/api/research/source-report', { operation: 'read', reportId })
      .then(value => { if (alive) setReport(value); }, reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [api, reportId, retry]);
  async function read(observationId: string) {
    setBusy(true); setError(''); setWindows(null);
    try {
      const result = await api.post<{ windows: RecordedWindow[] }>('/api/research/source-report', { operation: 'read-observation', reportId, observationId });
      setWindows(result.windows);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <section ref={region} tabIndex={-1} aria-label="Saved HTML evidence report">
    <Button onClick={onClose}>Close report</Button>
    {error && <Feedback kind="error">{error}<Button disabled={busy} onClick={() => setRetry(value => value + 1)}>Reload source report</Button></Feedback>}
    {!report && !error && <p role="status">Loading saved source report…</p>}
    {report && <>
      <h3>{report.title}</h3><p>Recorded source evidence. Interpretations are not verified.</p>
      {report.interpretations.map((item, index) => <p key={index}>{item.text}</p>)}
      <ul>{report.observations.map(item => {
        const available = report.currentAvailability.find(value => value.observationId === item.id)?.available === true;
        return <li key={item.id}>
          {item.anchor.documentScopes?.map((scope, index) => <p key={index}>{scope.unit === 'original-html' ? 'Original HTML' : scope.unit} · {scope.start}–{scope.end}</p>)}
          {item.kind === 'scientific_document' && <Button disabled={busy || !available} onClick={() => void read(item.id)}>Read recorded window</Button>}
          {!available && <Feedback>Original evidence is unavailable. Restore the saved source version to read it.</Feedback>}
          {item.kind !== 'scientific_document' && <p>Open this observation from its source bundle.</p>}
          <Disclosure variant="inline" summary="Saved source identity"><pre className="pa-source-text">{JSON.stringify(item.anchor, null, 2)}</pre></Disclosure>
        </li>;
      })}</ul>
    </>}
    {busy && <p role="status">Reading recorded source…</p>}
    {windows && <section aria-label="Recorded source window">{windows.map((window, index) => <article key={index}>
      <h4>{window.scope.unit === 'original-html' ? 'Original HTML' : 'Recorded source'} · {window.scope.start}–{window.scope.end}</h4>
      {window.context && <p>{window.context}</p>}
      {window.content && <pre className="pa-source-text">{window.content}</pre>}
      {window.scope.unit === 'cells' ? <Table label="Recorded table cells"><thead><tr><th>Row</th><th>Column</th><th>Original value</th></tr></thead><tbody>{window.items.map((item, i) => <tr key={i}><td>{item.row}</td><td>{item.column}</td><td>{item.text}</td></tr>)}</tbody></Table>
        : window.items.length > 0 && <pre className="pa-source-text">{window.items.map(item => item.latex || item.text || item.alt || item.url || '').join('\n')}</pre>}
      {window.scope.unit === 'images' && <p>Image references only; image contents have not been observed.</p>}
      {window.limitations.map((limit, i) => <p key={i}>{limit}</p>)}
    </article>)}</section>}
  </section>;
}
