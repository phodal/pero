import { useState } from 'react';
import { Button, Checkbox, Feedback, Select } from '@pero/app-sdk/ui';
import { generatedChecksSnapshot, generationIsCurrent, type GeneratedChecks, type GenerationTarget, type CellDecision } from '@pero/notebook/ai-generation';

export function AICheckReview({ result, decisions, busy, applied, onDecide, onApply, getContent, getTarget }: {
  result: GeneratedChecks; decisions: Record<string, CellDecision>; busy: boolean; applied: boolean;
  onDecide(decisions: Record<string, CellDecision>): Promise<void>; onApply(snapshot: unknown): Promise<void>; getContent(): string; getTarget(): GenerationTarget | null;
}) {
  const [acknowledged, setAcknowledged] = useState(false), [error, setError] = useState('');
  const stale = !generationIsCurrent(result.frozen, getTarget(), getContent());
  return <section aria-label="Generated check suggestions / 已生成检查建议">
    <p>Frozen entry / 冻结条目: {result.frozen.target.entryId} · v{result.frozen.target.revision} · {result.sessionId}</p>
    <p>Suggestions from the configured Host agent. No scientific test or verification has been performed. / 来自已配置 Host Agent 的建议，未执行科学检验或验证。</p>
    {!result.checks.length && <Feedback kind="info">No suggestions returned. This is not a passed audit. / 未返回建议，这不代表已通过检查。</Feedback>}
    {stale && !applied && <Feedback kind="warning">The entry revision or draft changed after generation. These suggestions are stale. / 生成后条目版本或草稿已更改，建议已过期。</Feedback>}
    <ol>{result.checks.map(check => <li key={check.id}><strong>{check.severity}</strong><p>{check.text}</p><p>Source blocks / 来源块: {check.blockIds.join(', ') || 'Document-wide / 整份文档'}</p>
      <Select label={`Usefulness / 实用性 · ${check.id}`} disabled={busy || applied} value={decisions[check.id] ?? 'pending'} options={[{ value: 'pending', label: 'Unmarked / 未标记' }, { value: 'accepted', label: 'Useful / 有用' }, { value: 'rejected', label: 'Not useful / 无用' }]} onChange={value => { setAcknowledged(false); void onDecide({ ...decisions, [check.id]: value as CellDecision }); }} />
    </li>)}</ol>
    {!applied && <><label><Checkbox checked={acknowledged} disabled={busy || stale} onCheckedChange={value => setAcknowledged(value === true)} /> I reviewed these suggestions, not verified results. / 我已复核这些建议，它们不是已验证结果。</label>
      <Button variant="primary" disabled={busy || stale || !acknowledged} onClick={async () => {
        try { const snapshot = generatedChecksSnapshot(result, decisions, getTarget(), getContent(), acknowledged, new Date().toISOString()); await onApply(snapshot); setError(''); setAcknowledged(false); }
        catch (cause) { setError(String(cause)); }
      }}>Insert reviewed check suggestions / 插入已复核检查建议</Button></>}
    {applied && <Feedback kind="success">Review snapshot is in the draft. Save a revision to publish it. / 复核快照已加入草稿，保存修订后发布。</Feedback>}
    {error && <Feedback kind="error">{error}</Feedback>}
  </section>;
}
