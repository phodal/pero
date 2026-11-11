import { useEffect, useState } from 'react';
import { downloadFile, useAppApi } from '@pero/app-sdk';
import { Button, Checkbox, Disclosure, Feedback, Input, Select, Table, Textarea } from '@pero/app-sdk/ui';

type QuerySummary = { id: string; question: string; startedAt: string; snapshotId: string; definitionId: string };
type Receipt = { status: string; reason: string; rows: Record<string, unknown>[]; rowCount: number | null; truncated: boolean };
type QueryEvidence = { id: string; intent: { question: string; snapshotId: string; definitionId: string }; receipt: Receipt;
  definition: { sql: string; unit: string; denominator: string; reviewer: string }; snapshot: { sources: { manifest: { name: string; assetId: string } }[] } };

export function SemanticPanel({ datasetId, assetId, fields }: { datasetId: string; assetId: string; fields: string[] }) {
  const api = useAppApi();
  const [numeric, setNumeric] = useState<string[]>([]), [question, setQuestion] = useState('How many records are in this fixed version?');
  const [sql, setSql] = useState('SELECT COUNT(*) AS value FROM sample'), [unit, setUnit] = useState('records');
  const [denominator, setDenominator] = useState('All records'), [grain, setGrain] = useState('One result for the entire table');
  const [joins, setJoins] = useState('None'), [missing, setMissing] = useState('Count includes null values');
  const [reviewer, setReviewer] = useState(''), [reviewed, setReviewed] = useState(false);
  const [params, setParams] = useState('{}'), [types, setTypes] = useState('{}');
  const [check, setCheck] = useState('count'), [column, setColumn] = useState('');
  const [history, setHistory] = useState<QuerySummary[] | null>(null), [evidence, setEvidence] = useState<QueryEvidence | null>(null);
  const [checkResult, setCheckResult] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [retry, setRetry] = useState(0), [editing, setEditing] = useState(true);
  const request = <T,>(body: object) => api.post<T>('/api/queries', body);
  useEffect(() => { let alive = true;
    request<{ queries: QuerySummary[] }>({ operation: 'list' }).then(value => { if (alive) setHistory(value.queries); }, reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [api, retry]);
  async function act(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function execute() {
    const snapshot = await request<{ id: string }>({ operation: 'snapshot', sources: [{ datasetId, assetId, table: 'sample',
      columns: Object.fromEntries(fields.map(field => [field, numeric.includes(field) ? 'number' : 'text'])) }] });
    const definition = await request<{ id: string }>({ operation: 'definition', definition: { name: question, sql, parameters: JSON.parse(types),
      unit, grain, denominator, joins, missing, seedPolicy: 'No stochastic execution', reviewer, reviewed,
      check: check === 'none' ? null : { operation: check, table: 'sample', column, resultColumn: 'value' } } });
    const result = await request<QueryEvidence>({ operation: 'execute', snapshotId: snapshot.id, definitionId: definition.id, parameters: JSON.parse(params), question });
    setEvidence(result); setEditing(false); setCheckResult(''); setRetry(value => value + 1);
  }
  const current = evidence?.snapshot.sources.some(source => source.manifest.assetId === assetId);
  const resultColumns = Object.keys(evidence?.receipt.rows[0] ?? {});
  return <section className="data-overview" aria-label="Reviewed queries">
    <p>Query a fixed read-only copy. Review the definition before running; results still need scientific review.</p>
    {error && <Feedback kind="error">{error}<Button disabled={busy} onClick={() => { setError(''); setRetry(value => value + 1); }}>Reload history</Button></Feedback>}
    {!editing && <Button disabled={busy} onClick={() => setEditing(true)}>New query</Button>}
    {editing && <div className="data-form">
      <label>Question<Input value={question} onChange={e => { setQuestion(e.target.value); setReviewed(false); }} /></label>
      <label>SQL<Textarea aria-label="SQL" rows={3} value={sql} onChange={e => { setSql(e.target.value); setReviewed(false); }} /></label>
      <p className="data-note">Table: sample. The complete version is used, independent of preview filters. Empty strings and null become SQL NULL. Choose numeric fields explicitly.</p>
      <div className="data-actions">{fields.map(field => <label className="data-checkbox" key={field}><Checkbox checked={numeric.includes(field)} onCheckedChange={value => {
        setNumeric(previous => value === true ? [...previous, field] : previous.filter(name => name !== field)); setReviewed(false);
      }} />{field} as number</label>)}</div>
      <div className="data-actions">
        <label>Unit<Input value={unit} onChange={e => { setUnit(e.target.value); setReviewed(false); }} /></label>
        <label>Denominator<Input value={denominator} onChange={e => { setDenominator(e.target.value); setReviewed(false); }} /></label>
      </div>
      <Disclosure summary="Grain, missing values, joins and parameters">
        <label>Grain<Input value={grain} onChange={e => { setGrain(e.target.value); setReviewed(false); }} /></label>
        <label>Missing values<Input value={missing} onChange={e => { setMissing(e.target.value); setReviewed(false); }} /></label>
        <label>Join cardinality<Input value={joins} onChange={e => { setJoins(e.target.value); setReviewed(false); }} /></label>
        <label>Parameter types (JSON: str, int, number)<Textarea aria-label="Parameter types" value={types} onChange={e => { setTypes(e.target.value); setReviewed(false); }} /></label>
        <label>Parameter values (JSON)<Textarea aria-label="Parameter values" value={params} onChange={e => setParams(e.target.value)} /></label>
      </Disclosure>
      <Select label="Independent check" value={check} onChange={value => { setCheck(value); setReviewed(false); }} options={[
        { value: 'count', label: 'Whole-table count' }, { value: 'sum', label: 'Whole-table sum' }, { value: 'mean', label: 'Whole-table mean' }, { value: 'none', label: 'No supported independent check' }]} />
      {(check === 'sum' || check === 'mean') && <Select label="Check column" value={column} onChange={value => { setColumn(value); setReviewed(false); }} options={[{ value: '', label: 'Choose numeric column' }, ...numeric.map(name => ({ value: name, label: name }))]} />}
      <p className="data-note">Independent checks use the original export and compare the single result column “value”, with absolute tolerance 0.000001. This checks arithmetic, not the scientific interpretation.</p>
      <label>Reviewer<Input value={reviewer} onChange={e => { setReviewer(e.target.value); setReviewed(false); }} /></label>
      <label className="data-checkbox"><Checkbox checked={reviewed} onCheckedChange={value => setReviewed(value === true)} />I reviewed SQL, units, denominator, joins and missing values.</label>
      <div className="data-actions"><Button variant="primary" disabled={busy || !reviewed || !reviewer.trim() || !fields.length} onClick={() => void act(execute)}>Save definition and run</Button>
        {busy && <span role="status">Processing query evidence…</span>}</div>
    </div>}
    {evidence && <section aria-label="Saved query result">
      <h3>{evidence.intent.question}</h3>
      <p>{evidence.receipt.status} · {evidence.receipt.rowCount ?? 'Unknown'} rows · Needs scientific review</p>
      {!current && <p>This saved result belongs to another fixed data version: {evidence.snapshot.sources.map(s => s.manifest.name).join(', ')}.</p>}
      {evidence.receipt.reason && <Feedback kind="error">{evidence.receipt.reason}</Feedback>}
      <p>Unit: {evidence.definition.unit} · Denominator: {evidence.definition.denominator} · Reviewed by {evidence.definition.reviewer}</p>
      <pre>{evidence.definition.sql}</pre>
      {evidence.receipt.truncated && <p>Showing 100 of {evidence.receipt.rowCount} rows. The full result is saved.</p>}
      {!!resultColumns.length && <Table label="Query result" className="data-rows-scroll" tableClassName="data-rows"><thead><tr>{resultColumns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{evidence.receipt.rows.map((row, index) => <tr key={index}>{resultColumns.map(c => <td key={c}>{row[c] === null ? 'NULL' : String(row[c])}</td>)}</tr>)}</tbody></Table>}
      <div className="data-actions"><Button disabled={busy || evidence.receipt.status !== 'completed'} onClick={() => void act(async () => {
        const result = await request<{ status: string; expected: string; actual: unknown }>({ operation: 'check', queryId: evidence.id });
        setCheckResult(`${result.status}: expected ${result.expected ?? 'NULL'}, observed ${result.actual ?? 'NULL'}. Scientific review remains required.`);
      })}>Recompute from source</Button><Button onClick={() => downloadFile(`query-${evidence.id}.json`, JSON.stringify(evidence, null, 2), 'application/json')}>Export receipt</Button></div>
      {checkResult && <p role="status">{checkResult}</p>}
      <p className="data-note">Query {evidence.id}. In Paper, choose this saved query when linking a claim.</p>
    </section>}
    <h3>Saved queries</h3>
    {history === null ? (!error && <p role="status">Loading history…</p>) : history.length === 0 ? <p>No saved query yet.</p> : history.map(item =>
      <div className="data-actions" key={item.id}><Button variant="ghost" disabled={busy} onClick={() => void act(async () => {
        setEvidence(await request<QueryEvidence>({ operation: 'read', queryId: item.id })); setEditing(false); setCheckResult('');
      })}>{item.question} · {item.startedAt}</Button></div>)}
  </section>;
}
