import React, { useEffect, useRef, useState } from 'react';
import { Button, Feedback, Field, Input, Select, Textarea } from '@pero/app-sdk/ui';
import type { Api, Evidence, Intent, Report } from './types';
import type { Translator } from './i18n';
import type { Citation } from './documents';

type Matrix = NonNullable<Report['matrix']>;
type Cell = Matrix['cells'][number];
type Revision = { id: string; version: number; cell: Cell; reason: string };
type MatrixState = { matrix: Matrix; revisions: Revision[] };

function CellEditor({ cell, title, intent, busy, onSave, onClose, t }: { cell: Cell; title: string; intent: Intent; busy: boolean; onSave(cell: Cell, reason: string): void; onClose(): void; t: Translator }) {
  const [value, setValue] = useState(cell.value), [status, setStatus] = useState(cell.status), [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState<Evidence[]>(cell.evidence.length ? cell.evidence : [{ paperId: cell.paperId, quote: '' }]);
  const passages = intent.passages?.filter(p => p.paperId === cell.paperId) ?? [];
  return <div className="pa-cell-editor" role="group" aria-label={t('editCell')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <h3>{title}</h3>
    <Field label={t('matrixValue')}>{props => <Textarea {...props} autoFocus rows={3} maxLength={4000} value={value} disabled={busy} onChange={event => setValue(event.target.value)}/>}</Field>
    <Select label={t('evidenceStatus')} value={status} disabled={busy} onChange={value => setStatus(value as Cell['status'])} options={[{value:'supported',label:t('supported')},{value:'missing',label:t('missing')},{value:'conflict',label:t('conflict')}]}/>
    {status !== 'missing' && evidence.map((ref, index) => <div key={index}>
      {!!passages.length && <Select label={`${t('sourcePassage')} ${index + 1}`} value={ref.passageId ?? ''} disabled={busy} onChange={passageId => setEvidence(prior => prior.map((item, i) => i === index ? { ...item, passageId } : item))} options={[{value:'',label:t('choosePassage')},...passages.map(p => ({value:p.id,label:`${t('pdfPage')} ${p.page}: ${p.content.slice(0,60)}`}))]}/>}
      <Field label={`${t('exactQuote')} ${index + 1}`}>{props => <Textarea {...props} rows={3} maxLength={4000} value={ref.quote} disabled={busy} onChange={event => setEvidence(prior => prior.map((item, i) => i === index ? { ...item, quote: event.target.value } : item))}/>}</Field>
    </div>)}
    {status === 'conflict' && evidence.length < 2 && <Button disabled={busy} onClick={() => setEvidence(prior => [...prior, {paperId:cell.paperId,quote:''}])}>{t('addEvidence')}</Button>}
    <Field label={t('correctionNote')}>{props => <Input {...props} value={reason} maxLength={2000} disabled={busy} onChange={event => setReason(event.target.value)}/>}</Field>
    <div className="pa-actions"><Button variant="primary" disabled={busy} onClick={() => onSave({ ...cell, value: status === 'missing' ? '' : value, status, evidence: status === 'missing' ? [] : evidence }, reason)}>{t('saveCorrection')}</Button><Button disabled={busy} onClick={onClose}>{t('close')}</Button></div>
  </div>;
}

export function EvidenceMatrix({ matrix, intent, onCite, t, api, reportId }: {
  matrix: Report['matrix']; intent: Intent; onCite(value: Citation): void; t: Translator; api?: Api; reportId?: string;
}) {
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState<MatrixState | null>(null), [editing, setEditing] = useState<Cell | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    setState(null); setEditing(null); setError('');
    if (!api || !reportId || !matrix) return;
    let alive = true;
    api.get<MatrixState>(`/api/reports/${reportId}/matrix`).then(value => { if (alive) setState(value); }).catch(error => { if (alive) setError(error.message); });
    return () => { alive = false; };
  }, [api, reportId, matrix, retry]);
  if (!matrix) return null;
  const shown = state?.matrix ?? matrix;
  function closeEditor() { setEditing(null); requestAnimationFrame(() => editTrigger.current?.focus()); }
  async function save(cell: Cell, reason: string) {
    if (!api || busy) return;
    setBusy(true); setError('');
    try { setState(await api.post<MatrixState>(`/api/reports/${reportId}/matrix`, {cell,reason})); closeEditor(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="pa-matrix">
    <h2>{t('matrix')}</h2>
    {error && <Feedback kind="error">{error}{!editing && <Button onClick={() => setRetry(value => value + 1)}>{t('retry')}</Button>}</Feedback>}
    <div className="pa-table-scroll" tabIndex={0} role="region" aria-label={t('matrix')}><table>
      <thead><tr><th scope="col">{t('papers')}</th>{shown.columns.map(column => <th scope="col" key={column.id}>{column.label}</th>)}</tr></thead>
      <tbody>{intent.papers.map((paper, index) => <tr key={paper.id}>
        <th scope="row"><button type="button" className="pa-matrix-source" onClick={() => onCite({paperId:paper.id})}>[{index + 1}] {paper.title}</button></th>
        {shown.columns.map(column => {
          const cell = shown.cells.find(cell => cell.paperId === paper.id && cell.columnId === column.id) ?? {paperId:paper.id,columnId:column.id,value:'',status:'missing' as const,evidence:[]};
          const active = editing?.paperId === paper.id && editing.columnId === column.id;
          const corrected = state?.revisions.some(r => r.cell.paperId === paper.id && r.cell.columnId === column.id);
          return <td key={column.id} data-status={cell.status}>
            {cell.status === 'conflict' && <span>{t('conflict')}</span>}
            {api && reportId ? <button className="pa-cell-value" aria-expanded={active} aria-label={`${t('editCell')}: ${column.label}`} onClick={event => { editTrigger.current = event.currentTarget; setEditing(cell); }}>{cell.value || t('missing')}</button> : <p>{cell.value || t('missing')}</p>}
            {corrected && <small>{t('corrected')}</small>}
            <div className="pa-cell-evidence">{cell.evidence.map((ref, i) => <button className="pa-inline-citation" type="button" key={i} aria-label={`${column.label} ${t('evidence')} ${i + 1}`} onClick={() => onCite(ref)}>[{i + 1}]</button>)}</div>
          </td>;
        })}
      </tr>)}</tbody>
    </table></div>
    {editing && <CellEditor key={`${editing.paperId}:${editing.columnId}`} title={shown.columns.find(column => column.id === editing.columnId)!.label} cell={editing} intent={intent} busy={busy} onSave={(value, reason) => void save(value, reason)} onClose={closeEditor} t={t}/>}
    {!!state?.revisions.length && <details className="pa-matrix-history"><summary>{t('correctionHistory')}</summary><ol>{state.revisions.map(revision => <li key={revision.id}>{revision.version}: {revision.cell.value || t('missing')}{revision.reason && <p>{revision.reason}</p>}</li>)}</ol></details>}
  </section>;
}
