import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Disclosure, Feedback, Table } from '@pero/app-sdk/ui';
import { applyTypedProposal, reviewTypedCells, type AIApplication, type CellDecision, type FrozenTypedGeneration, type GenerationTarget, type TypedProposal } from '@pero/notebook/ai-generation';

const messages = {
  region: { en: 'Typed cell proposal review', zh: '类型单元格建议复核' },
  scope: { en: 'Review every cell. Accepted values update only this local table draft; they do not register records or change owner snapshots.', zh: '逐格复核，仅修改本地表格草稿，不登记记录或修改来源快照。' },
  empty: { en: 'The session returned no supported cell proposals. No values were changed.', zh: '会话未返回单元格建议，未修改数据。' },
  table: { en: 'Cell proposals', zh: '单元格建议' },
  cell: { en: 'Cell', zh: '单元格' },
  before: { en: 'Before', zh: '原值' },
  proposed: { en: 'Proposed', zh: '建议值' },
  evidence: { en: 'Evidence', zh: '依据' },
  decision: { en: 'Decision', zh: '决定' },
  unknown: { en: 'Unknown target', zh: '未知目标' },
  typed: { en: 'Typed value', zh: '类型值' },
  accept: { en: 'Accept', zh: '接受' },
  reject: { en: 'Reject', zh: '拒绝' },
  rejectAll: { en: 'Reject all', zh: '全部拒绝' },
  ack: { en: 'I reviewed all changes. These are proposals, not verified measurements.', zh: '我已复核全部修改，建议不代表已验证测量。' },
  apply: { en: 'Apply accepted cells', zh: '应用已接受单元格' },
  applied: { en: 'Applied to the draft with provenance. Save the entry to publish a revision.', zh: '已应用至草稿并保存来源，请保存条目以发布修订。' },
} as const;

export function AICellReview({ frozen, proposal, decisions, busy, applied, onDecide, onApply, getContent, getTarget }: {
  frozen: FrozenTypedGeneration; proposal: TypedProposal; decisions: Record<string, CellDecision>; busy: boolean; applied: boolean;
  onDecide(decisions: Record<string, CellDecision>): Promise<void>; onApply(application: AIApplication): Promise<void>; getContent(): string; getTarget(): GenerationTarget | null;
}) {
  const { t } = useAppI18n(messages);
  const [acknowledged, setAcknowledged] = useState(false), [error, setError] = useState('');
  const rows = reviewTypedCells(frozen, proposal, decisions);
  const decide = (id: string, decision: CellDecision) => { setAcknowledged(false); void onDecide({ ...decisions, [id]: decision }); };
  return <section className="notebook-science-panel" aria-label={t('region')}>
    <p>{t('scope')}</p>
    <p>{frozen.table.table.name || frozen.table.blockId} · schema {frozen.table.table.schema.id} r{frozen.table.table.schema.revision}</p>
    {!rows.length && <Feedback kind="info">{t('empty')}</Feedback>}
    <Table label={t('table')} density="compact"><thead><tr><th>{t('cell')}</th><th>{t('before')}</th><th>{t('proposed')}</th><th>{t('evidence')}</th><th>{t('decision')}</th></tr></thead><tbody>
      {rows.map(({ cell, column, previous, error: issue, decision, typed }) => <tr key={cell.id}>
        <th>{cell.rowId} · {column?.name || cell.columnId}<br /><small>{column?.type ?? t('unknown')}</small></th>
        <td>{previous || '∅'}</td><td>{cell.value || '∅'}{issue && <Feedback kind="error">{issue}</Feedback>}{typed && <Disclosure summary={t('typed')}><pre>{JSON.stringify(typed, null, 2)}</pre></Disclosure>}</td>
        <td>{cell.sourceIds.map(id => frozen.sources.find(source => source.id === id)?.name || id).join(', ')}<br />{cell.reason}</td>
        <td><span role="status">{decision}</span><div className="notebook-science-actions">
          <Button disabled={busy || applied || !!issue || decision === 'accepted'} onClick={() => decide(cell.id, 'accepted')}>{t('accept')}</Button>
          <Button disabled={busy || applied || decision === 'rejected'} onClick={() => decide(cell.id, 'rejected')}>{t('reject')}</Button>
        </div></td>
      </tr>)}
    </tbody></Table>
    <Button disabled={busy || applied || !rows.length} onClick={() => { setAcknowledged(false); void onDecide(Object.fromEntries(rows.map(({ cell }) => [cell.id, 'rejected']))); }}>{t('rejectAll')}</Button>
    {!applied && <><label><Checkbox checked={acknowledged} disabled={busy} onCheckedChange={value => setAcknowledged(value === true)} /> {t('ack')}</label>
      <Button variant="primary" disabled={busy || !acknowledged || !rows.some(row => row.decision === 'accepted') || rows.some(row => row.decision === 'pending')} onClick={async () => {
        try { const application = applyTypedProposal(frozen, proposal, decisions, getTarget(), getContent(), acknowledged); await onApply(application); setError(''); setAcknowledged(false); }
        catch (cause) { setError(String(cause)); }
      }}>{t('apply')}</Button></>}
    {applied && <Feedback kind="success">{t('applied')}</Feedback>}
    {error && <Feedback kind="error">{error}</Feedback>}
  </section>;
}
