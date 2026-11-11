import { useEffect, useState } from 'react';
import { Button, Disclosure, Feedback, Select, Table, Textarea } from '@pero/app-sdk/ui';
import type { Citation } from './report-content';
import type { Api, Evidence, Intent, Library, Report } from './types';
import { researchHost } from './research-watch';

type Query = { id: string; question: string; startedAt: string };
type Link = { id: string; queryId: string; snapshotId: string; definitionId: string; resultId: string; source: { contentDigest: string; documentId: string; fileDigest: string };
  claim: { text: string; paperId: string; reportId: string; passageId: string; quote: string; stance: string }; acceptance: 'needs_review' };
type SavedQuery = { definition: { sql: string; unit: string; denominator: string }; receipt: { status: string; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean } };

export function DataEvidence({ api, library, onCite, paperId }: { api: Api; library: Library; paperId?: string; onCite(value: Citation, intent: Intent): void }) {
  const [links, setLinks] = useState<Link[] | null>(null), [queries, setQueries] = useState<Query[] | null>(null);
  const [report, setReport] = useState<Report | null>(null), [queryId, setQueryId] = useState(''), [index, setIndex] = useState('');
  const [claim, setClaim] = useState(''), [stance, setStance] = useState('limitation');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState<{ id: string; query: SavedQuery } | null>(null), [retry, setRetry] = useState(0);
  useEffect(() => { let alive = true;
    api.post<{ links: Link[] }>('/api/data-evidence', { operation: 'list' }).then(value => { if (alive) setLinks(value.links); }, reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [api, retry]);
  async function act(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  }
  const citations: Evidence[] = [...(report?.sections ?? []), ...(report?.matrix?.cells ?? [])].flatMap(group => group.evidence ?? []);
  const chosen = index === '' ? null : citations[Number(index)];
  return <section className="pa-record-editor-section" aria-label="Data query evidence"><h4>Data query evidence</h4>
    <p>Link a saved Data query to an exact quotation in a saved report. Arithmetic and scientific interpretation remain separate.</p>
    {error && <Feedback kind="error">{error}<Button disabled={busy} onClick={() => { setError(''); setRetry(value => value + 1); }}>Reload links</Button></Feedback>}
    <Button disabled={busy || !library.reports.length} onClick={() => void act(async () => {
      setQueries((await researchHost<{ queries: Query[] }>('research-assets', { operation: 'queries' })).queries); setEditing(true);
    })}>Link a saved query</Button>
    {!library.reports.length && <p>Save a report with an observed source quotation first.</p>}
    {editing && <div className="pa-record-evidence-editor">
      <Select label="Data query" value={queryId} onChange={setQueryId} disabled={busy} options={[{ value: '', label: 'Choose a saved query' },
        ...(queries ?? []).map(query => ({ value: query.id, label: `${query.question} · ${query.startedAt}` }))]} />
      <Select label="Claim report" value={report?.id ?? ''} disabled={busy} onChange={value => void act(async () => {
        setReport(value ? await api.get<Report>(`/api/reports/${value}`) : null); setIndex('');
      })} options={[{ value: '', label: 'Choose a saved report' }, ...library.reports.map(item => ({ value: item.id, label: item.title }))]} />
      <Select label="Exact quotation" value={index} onChange={setIndex} disabled={busy} options={[{ value: '', label: 'Choose an observed quotation' },
        ...citations.map((citation, i) => ({ value: String(i), label: citation.quote, disabled: !citation.passageId || !!paperId && citation.paperId !== paperId }))]} />
      {chosen && <blockquote>{chosen.quote}</blockquote>}
      <label>Claim and limitations<Textarea aria-label="Claim and limitations" rows={3} value={claim} onChange={e => setClaim(e.target.value)} /></label>
      <Select label="Relation" value={stance} onChange={setStance} options={[{ value: 'limitation', label: 'Limitation' }, { value: 'support', label: 'Support' }, { value: 'counterevidence', label: 'Counterevidence' }]} />
      <Button disabled={busy || !queryId || !report || !chosen || !claim.trim()} onClick={() => void act(async () => {
        const link = await researchHost<Link>('research-assets', { operation: 'linkquery', queryId,
          claim: { text: claim, stance, reportId: report!.id, paperId: chosen!.paperId, passageId: chosen!.passageId, evidenceIndex: Number(index) } });
        setLinks(values => [link, ...(values ?? []).filter(item => item.id !== link.id)]); setEditing(false);
      })}>Save evidence reference</Button>
    </div>}
    {links === null ? (!error && <p role="status">Loading saved links…</p>) : links.filter(link => !paperId || link.claim.paperId === paperId).map(link => <article key={link.id}>
      <p>{link.claim.text}</p><blockquote>{link.claim.quote}</blockquote><p>{link.claim.stance} · Needs scientific review</p>
      <Button disabled={busy} onClick={() => void act(async () => {
        const report = await api.get<Report>(`/api/reports/${link.claim.reportId}`);
        const intent = await api.get<Intent>(`/api/intents/${report.intentId}`);
        onCite({ paperId: link.claim.paperId, passageId: link.claim.passageId, quote: link.claim.quote }, intent);
      })}>Read cited source</Button>
      <Button disabled={busy} onClick={() => void act(async () => setOpened({ id: link.id,
        query: await researchHost<SavedQuery>('research-assets', { operation: 'queries', queryId: link.queryId }) }))}>Read saved Data result</Button>
      <Disclosure summary="Frozen source and query references"><p>PDF SHA-256: {link.source.fileDigest}</p><p>Query: {link.queryId}</p><p>Snapshot: {link.snapshotId}</p><p>Definition: {link.definitionId}</p></Disclosure>
      {opened?.id === link.id && <div><p>{opened.query.receipt.status} · {opened.query.receipt.rowCount} rows · Unit: {opened.query.definition.unit}</p>
        <p>Denominator: {opened.query.definition.denominator}</p><pre>{opened.query.definition.sql}</pre>
        <Table label="Saved Data query result"><thead><tr>{Object.keys(opened.query.receipt.rows[0] ?? {}).map(key => <th key={key}>{key}</th>)}</tr></thead>
          <tbody>{opened.query.receipt.rows.map((row, i) => <tr key={i}>{Object.entries(row).map(([key, value]) => <td key={key}>{value === null ? 'NULL' : String(value)}</td>)}</tr>)}</tbody></Table>
        {opened.query.receipt.truncated && <p>Only the first 100 rows are displayed; Data retains the full result.</p>}</div>}
    </article>)}
  </section>;
}
