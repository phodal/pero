import { useState } from 'react';
import { Button, Checkbox, Disclosure, Feedback, Table } from '@pero/app-sdk/ui';
import { applyTypedProposal, reviewTypedCells, type AIApplication, type CellDecision, type FrozenTypedGeneration, type GenerationTarget, type TypedProposal } from '@pero/notebook/ai-generation';

export function AICellReview({ frozen, proposal, decisions, busy, applied, onDecide, onApply, getContent, getTarget }: {
  frozen: FrozenTypedGeneration; proposal: TypedProposal; decisions: Record<string, CellDecision>; busy: boolean; applied: boolean;
  onDecide(decisions: Record<string, CellDecision>): Promise<void>; onApply(application: AIApplication): Promise<void>; getContent(): string; getTarget(): GenerationTarget | null;
}) {
  const [acknowledged, setAcknowledged] = useState(false), [error, setError] = useState('');
  const rows = reviewTypedCells(frozen, proposal, decisions);
  const decide = (id: string, decision: CellDecision) => { setAcknowledged(false); void onDecide({ ...decisions, [id]: decision }); };
  return <section className="notebook-science-panel" aria-label="Typed cell proposal review / 类型单元格建议复核">
    <p>Review every cell. Accepted values update only this local table draft; they do not register records or change owner snapshots. / 逐格复核，仅修改本地表格草稿，不登记记录或修改来源快照。</p>
    <p>{frozen.table.table.name || frozen.table.blockId} · schema {frozen.table.table.schema.id} r{frozen.table.table.schema.revision}</p>
    {!rows.length && <Feedback kind="info">The session returned no supported cell proposals. No values were changed. / 会话未返回单元格建议，未修改数据。</Feedback>}
    <Table label="Cell proposals / 单元格建议" density="compact"><thead><tr><th>Cell / 单元格</th><th>Before / 原值</th><th>Proposed / 建议值</th><th>Evidence / 依据</th><th>Decision / 决定</th></tr></thead><tbody>
      {rows.map(({ cell, column, previous, error: issue, decision, typed }) => <tr key={cell.id}>
        <th>{cell.rowId} · {column?.name || cell.columnId}<br /><small>{column?.type ?? 'Unknown target'}</small></th>
        <td>{previous || '∅'}</td><td>{cell.value || '∅'}{issue && <Feedback kind="error">{issue}</Feedback>}{typed && <Disclosure summary="Typed value / 类型值"><pre>{JSON.stringify(typed, null, 2)}</pre></Disclosure>}</td>
        <td>{cell.sourceIds.map(id => frozen.sources.find(source => source.id === id)?.name || id).join(', ')}<br />{cell.reason}</td>
        <td><span role="status">{decision}</span><div className="notebook-science-actions">
          <Button disabled={busy || applied || !!issue || decision === 'accepted'} onClick={() => decide(cell.id, 'accepted')}>Accept / 接受</Button>
          <Button disabled={busy || applied || decision === 'rejected'} onClick={() => decide(cell.id, 'rejected')}>Reject / 拒绝</Button>
        </div></td>
      </tr>)}
    </tbody></Table>
    <Button disabled={busy || applied || !rows.length} onClick={() => { setAcknowledged(false); void onDecide(Object.fromEntries(rows.map(({ cell }) => [cell.id, 'rejected']))); }}>Reject all / 全部拒绝</Button>
    {!applied && <><label><Checkbox checked={acknowledged} disabled={busy} onCheckedChange={value => setAcknowledged(value === true)} /> I reviewed all changes. These are proposals, not verified measurements. / 我已复核全部修改，建议不代表已验证测量。</label>
      <Button variant="primary" disabled={busy || !acknowledged || !rows.some(row => row.decision === 'accepted') || rows.some(row => row.decision === 'pending')} onClick={async () => {
        try { const application = applyTypedProposal(frozen, proposal, decisions, getTarget(), getContent(), acknowledged); await onApply(application); setError(''); setAcknowledged(false); }
        catch (cause) { setError(String(cause)); }
      }}>Apply accepted cells / 应用已接受单元格</Button></>}
    {applied && <Feedback kind="success">Applied to the draft with provenance. Save the entry to publish a revision. / 已应用至草稿并保存来源，请保存条目以发布修订。</Feedback>}
    {error && <Feedback kind="error">{error}</Feedback>}
  </section>;
}
