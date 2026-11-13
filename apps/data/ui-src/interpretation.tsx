import { useEffect, useState } from 'react';
import { useAppApi } from '@pero/app-sdk';
import { Table, Button, ContentSection, Feedback } from '@pero/app-sdk/ui';
import { applyInterpretation, interpretationPreview, type Inspection, type ViewSpec } from './model';

/** A draft inspection never replaces the active view or its records. */
export function InterpretationPreview({ field, numeric, datasetId, assetId, parserVersion, view, busy, onApply, onCancel }: {
  field: string; numeric: boolean; datasetId: string; assetId: string; parserVersion: string;
  view: ViewSpec; busy: boolean; onApply(view: ViewSpec): void; onCancel(): void;
}) {
  const api = useAppApi();
  const [result, setResult] = useState<Inspection | null>(null), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const applied = applyInterpretation(view, field, numeric);
  const draft = interpretationPreview(view, field, numeric);
  const identity = JSON.stringify([datasetId, assetId, parserVersion, view, field, numeric, attempt]);
  const [loadedIdentity, setLoadedIdentity] = useState('');
  useEffect(() => {
    let current = true;
    setResult(null); setError(''); setLoadedIdentity('');
    void api.post<Inspection>('/api/inspect', { datasetId, assetId, parserVersion, view: draft, offset: 0, limit: 5 })
      .then(value => { if (current) { setResult(value); setLoadedIdentity(identity); } })
      .catch(reason => { if (current) { setError(String(reason)); setLoadedIdentity(identity); } });
    return () => { current = false; };
  }, [identity, api]);
  const current = loadedIdentity === identity ? result : null;
  const profile = current?.status === 'ok' ? current.report.fields.find(item => item.name === field) : null;
  return <section className="data-type-preview" aria-label={`Type preview for ${field}`}>
    <ContentSection id="data-type-preview" title={`${numeric ? 'Preview decimal number' : 'Preview original text'}: ${field}`}>
    <p className="data-note">Full input. Original bytes and displayed text stay unchanged, including leading zeros. {numeric ? 'Signed decimals and exponents are accepted; currency, separators and empty strings fail conversion. Failed values never become zero.' : 'Numeric filtering and aggregation will require number interpretation again.'}</p>
    {view.issue?.kind === 'conversion' && !applied.issue ? <p className="data-note">Applying this change clears the conversion issue condition because its number interpretation is being removed.</p> : null}
    {view.filter && !applied.filter ? <p className="data-note">Applying this change clears the numeric filter on {field} because its number interpretation is being removed.</p> : null}
    {loadedIdentity !== identity ? <p role="status">Checking interpretation…</p> : null}
    {error || (current && current.status !== 'ok') ? <Feedback kind="error">{error || (current && current.status !== 'ok' ? current.message : '')}<Button onClick={() => setAttempt(value => value + 1)}>Retry preview</Button></Feedback> : null}
    {current?.status === 'ok' ? <>
      <p>{current.report.rowCount} records checked / {profile?.conversionFailures ?? 0} conversion failures in {field}</p>
      <Table label="Interpretation preview" density="compact" className="data-rows-scroll" tableClassName="data-rows"><thead><tr><th>Source row</th><th>Original text</th><th>Interpretation</th></tr></thead>
        <tbody>{current.rows.map(row => <tr key={row.row}><td>{row.row}{row.line == null ? '' : ` / line ${row.line}`}</td><td>{row.cells[0]?.text || '(empty)'}</td><td>{row.cells[0]?.conversionError ? 'Conversion failed' : row.cells[0]?.exact ?? row.cells[0]?.kind}</td></tr>)}</tbody>
      </Table>
      {!!profile?.conversionExamples?.length && <><h4>Failure examples</h4><ul>{profile.conversionExamples.map(item => <li key={item.row}>Row {item.row}{item.sourceLine == null ? '' : ` / line ${item.sourceLine}`}: {item.text || '(empty)'}</li>)}</ul></>}
    </> : null}
    <div className="data-actions"><Button disabled={busy || current?.status !== 'ok'} onClick={() => onApply(applied)}>Apply type</Button><Button onClick={onCancel}>Cancel</Button></div>
    </ContentSection>
  </section>;
}
