import { useEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Disclosure, Feedback, Field, FilePicker, Input, NativeSelect, Table, Textarea } from '@pero/app-sdk/ui';
import { acceptDataReview, compareReviewRows, editReviewCell, parseCandidateResponse, parseRecordedChecks, recordedChecksSnapshot, selectReviewRun, startDataReview, type ColumnPolicy, type DataReview, type RecordedChecks } from '@pero/notebook/science-review';
import { generationIsCurrent, type GeneratedCandidates, type GenerationTarget } from '@pero/notebook/ai-generation';
import { scienceMessages, type SciencePanelProps } from './science-tools-shared';

const candidateFormat = JSON.stringify({ runResults: [{ displayName: 'Source name', modelFamily: 'Declared family', runConfigKey: 'source-1', hadError: false, newRows: { Results: [[{ text: 'Candidate value' }]] } }] }, null, 2);
const checksFormat = JSON.stringify({ traceId: 'Source trace identifier', checkedAt: '2026-01-01T00:00:00Z', checkedVersion: 0, hadError: false, errorMessage: null, checkResults: [{ text: 'Recorded suggestion' }] }, null, 2);

function JsonReviewInput({ format, load, invalidate }: { format: string; load(raw: string): void; invalidate(): void }) {
  const { t } = useAppI18n(scienceMessages);
  const [raw, setRaw] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const parse = (value: string) => { try { load(value); setError(''); } catch (cause) { invalidate(); setError(cause instanceof Error ? cause.message : String(cause)); } };
  return <div className="notebook-science-panel">
    <p className="notebook-note">{t('noInput')}</p>
    <Field label={t('external')}>{control => <Textarea {...control} value={raw} maxLength={1_000_000} rows={5} spellCheck={false} onChange={event => { request.current++; setBusy(false); setRaw(event.target.value); setError(''); invalidate(); }} />}</Field>
    <div className="notebook-science-actions">
      <Button disabled={!raw.trim() || busy} onClick={() => parse(raw)}>{t('load')}</Button>
      <FilePicker label={t('import')} emptyLabel="" compact accept=".json,application/json" busy={busy} onFile={async file => {
        const id = ++request.current; setBusy(true); invalidate(); setError('');
        try {
          if (file.size > 1_000_000) throw new Error('JSON file exceeds 1 MB.');
          const value = await file.text();
          if (request.current === id) { setRaw(value); parse(value); }
        } catch (cause) { if (request.current === id) setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { if (request.current === id) setBusy(false); }
      }} />
    </div>
    {error && <Feedback kind="error">{t('failure')} {error}</Feedback>}
    <Disclosure summary={t('schema')}><pre className="notebook-science-json">{format}</pre></Disclosure>
  </div>;
}

export function CandidateReviewPanel({ onSnapshot, getContent, generated, getTarget }: SciencePanelProps & { generated?: GeneratedCandidates; getTarget?: () => GenerationTarget | null }) {
  const { t } = useAppI18n(scienceMessages);
  const [review, setReview] = useState<DataReview | null>(null), [onlyDifferences, setOnlyDifferences] = useState(false), [acknowledged, setAcknowledged] = useState(false), [error, setError] = useState(''), [page, setPage] = useState(0);
  useEffect(() => { if (generated) { setReview(startDataReview(generated.response, generated.baseContent)); setAcknowledged(false); setError(''); setPage(0); } }, [generated]);
  const update = (next: DataReview) => { setReview(next); setAcknowledged(false); setError(''); };
  const rows = review ? compareReviewRows(review) : [], visible = rows.filter(row => !onlyDifferences || row.different), shown = visible.slice(page * 25, (page + 1) * 25);
  const primary = review?.response.runs[review.run];
  return <div className="notebook-science-panel">
    {!generated && <JsonReviewInput format={candidateFormat} invalidate={() => { setReview(null); setAcknowledged(false); setError(''); }} load={raw => { update(startDataReview(parseCandidateResponse(raw), getContent())); setPage(0); }} />}
    <p className="notebook-note">{t('reviewLimits')}</p>
    {review && primary && <>
      <div className="notebook-science-fields">
        <Field label={t('table')}>{control => <NativeSelect {...control} value={review.table} onChange={event => { update(selectReviewRun(review, review.run, event.target.value)); setPage(0); }}>{review.response.tables.map(name => <option key={name}>{name}</option>)}</NativeSelect>}</Field>
        <Field label={t('run')}>{control => <NativeSelect {...control} value={review.run} onChange={event => { update(selectReviewRun(review, Number(event.target.value))); setPage(0); }}>{review.response.runs.map((run, index) => <option key={index} value={index}>{run.name} · {run.family}{run.failed ? ` · ${t('failed')}` : ''}</option>)}</NativeSelect>}</Field>
        <Field label={t('policy')}>{control => <NativeSelect {...control} value={review.policy} onChange={event => update({ ...review, policy: event.target.value as ColumnPolicy })}>{(['writable', 'protected', 'read-only', 'computed', 'snapshot', 'converted'] as const).map(policy => <option key={policy} value={policy}>{t(policy)}</option>)}</NativeSelect>}</Field>
      </div>
      {primary.failed && <Feedback kind="error">{t('failed')}</Feedback>}
      <div className="notebook-science-actions">
        <label><Checkbox checked={onlyDifferences} onCheckedChange={value => { setOnlyDifferences(value === true); setPage(0); }} /> {t('differences')}</label>
        <Button onClick={() => update({ ...review, selected: rows.map(row => row.index) })}>{t('selectAll')}</Button>
        <Button onClick={() => update({ ...review, selected: [] })}>{t('clearSelection')}</Button>
        <Button onClick={() => update({ ...review, edits: {} })}>{t('resetEdits')}</Button>
      </div>
      <Table label={t('review')} density="compact">
        <thead><tr><th>{t('row')}</th>{rows[0]?.cells.map((_, c) => <th key={c}>{t('field')} {c + 1}</th>)}</tr></thead>
        <tbody>{shown.map(row => <tr key={row.index}>
          <th><label><Checkbox aria-label={`${t('row')} ${row.index + 1}`} checked={review.selected.includes(row.index)} onCheckedChange={value => update({ ...review, selected: value === true ? [...review.selected, row.index] : review.selected.filter(i => i !== row.index) })} /> {row.index + 1}</label></th>
          {row.cells.map((cell, c) => <td key={c} className={cell.different ? 'notebook-science-difference' : undefined}>
            <Input aria-label={`${t('row')} ${row.index + 1} ${t('field')} ${c + 1}`} value={cell.value} disabled={review.policy !== 'writable' || primary.failed} maxLength={10_000} onChange={event => update(editReviewCell(review, row.index, c, event.target.value))} />
            {cell.different && <small>{cell.others.map((value, index) => <span key={index}>{review.response.runs.filter((_, i) => i !== review.run)[index].name}: {value === null ? '∅' : value}<br /></span>)}</small>}
          </td>)}
        </tr>)}</tbody>
      </Table>
      {!visible.length && <p>{t('noRows')}</p>}
      {visible.length > 25 && <div className="notebook-science-actions"><Button aria-label="Previous page / 上一页" disabled={page === 0} onClick={() => setPage(page - 1)}>←</Button><span>{page + 1}/{Math.ceil(visible.length / 25)}</span><Button aria-label="Next page / 下一页" disabled={(page + 1) * 25 >= visible.length} onClick={() => setPage(page + 1)}>→</Button></div>}
      <Disclosure summary={t('extraRows')}><ul>{review.response.runs.map((run, index) => <li key={index}><strong>{run.name} · {run.family}</strong> {run.failed ? t('failed') : `${run.tables[review.table]?.length ?? 0} ${t('row')}`}<pre className="notebook-science-json">{JSON.stringify(run.tables[review.table] ?? [], null, 2)}</pre></li>)}</ul></Disclosure>
      <label><Checkbox checked={acknowledged} onCheckedChange={value => setAcknowledged(value === true)} /> {t('reviewAck')}</label>
      {error && <Feedback kind="error">{error}</Feedback>}
      <Button variant="primary" disabled={!acknowledged || !review.selected.length || primary.failed} onClick={() => {
        try {
          if (generated && !generationIsCurrent({ target: generated.target, content: generated.baseContent }, getTarget?.() ?? null, getContent())) throw new Error('The saved revision or current draft changed. Generate and review a new proposal.');
          const accepted = acceptDataReview(review, getContent(), acknowledged);
          const snapshot = generated ? { ...accepted, method: 'pero-host-agent-candidate-review/1', provenance: { sessionId: generated.sessionId, requestId: generated.requestId, agentId: generated.agentId, target: generated.target, transcript: generated.transcript }, limits: 'Human-reviewed Host Agent candidates inserted as new literal text. No existing cells are overwritten. Input saved revision and current draft must still match. Model agreement is not scientific verification.' } : accepted;
          if (generated && JSON.stringify(snapshot, null, 2).length > 32_768) throw new Error('The proposal provenance exceeds the Notebook evidence block limit. Generate a smaller result before accepting.');
          if (onSnapshot(t('review'), snapshot, snapshot.rows)) { setAcknowledged(false); setReview(null); } }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      }}>{t('insert')}</Button>
    </>}
  </div>;
}

export function RecordedChecksPanel({ onSnapshot }: SciencePanelProps) {
  const { t } = useAppI18n(scienceMessages);
  const [checks, setChecks] = useState<RecordedChecks | null>(null), [acknowledged, setAcknowledged] = useState(false);
  return <div className="notebook-science-panel">
    <JsonReviewInput format={checksFormat} invalidate={() => { setChecks(null); setAcknowledged(false); }} load={raw => { setChecks(parseRecordedChecks(raw)); setAcknowledged(false); }} />
    <p className="notebook-note">{t('checksLimits')}</p>
    {checks && <>
      <Feedback kind={checks.status === 'error' ? 'error' : checks.status === 'partial' ? 'warning' : 'info'}>{t(checks.status)}{checks.error && `: ${checks.error}`}{checks.missing.length > 0 && <p>Missing / 缺失: {checks.missing.join(', ')}</p>}</Feedback>
      <p className="notebook-note">{checks.traceId ?? '∅'} · {checks.checkedAt ?? '∅'} · v{checks.checkedVersion ?? '∅'}</p>
      <div className="notebook-science-checks">{checks.items.map((item, i) => <div key={i}>
        <label><Checkbox checked={item.acknowledged} aria-label={`${t('acknowledged')} ${i + 1}`} onCheckedChange={value => { setChecks({ ...checks, items: checks.items.map((check, index) => index === i ? { ...check, acknowledged: value === true } : check) }); setAcknowledged(false); }} /> {item.text}</label>
        <Field label={`${t('usefulness')} ${i + 1}`}>{control => <NativeSelect {...control} value={item.usefulness} onChange={event => { setChecks({ ...checks, items: checks.items.map((check, index) => index === i ? { ...check, usefulness: event.target.value as typeof item.usefulness } : check) }); setAcknowledged(false); }}>{(['unmarked', 'useful', 'not-useful'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</NativeSelect>}</Field>
      </div>)}</div>
      <label><Checkbox checked={acknowledged} onCheckedChange={value => setAcknowledged(value === true)} /> {t('checkAck')}</label>
      <Button variant="primary" disabled={!acknowledged} onClick={() => { if (onSnapshot(t('checks'), recordedChecksSnapshot(checks, acknowledged))) setAcknowledged(false); }}>{t('insert')}</Button>
    </>}
  </div>;
}
