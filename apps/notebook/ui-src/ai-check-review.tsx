import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Feedback, Select } from '@pero/app-sdk/ui';
import { generatedChecksSnapshot, generationIsCurrent, type GeneratedChecks, type GenerationTarget, type CellDecision } from '@pero/notebook/ai-generation';

const messages = {
  region: { en: 'Generated check suggestions', zh: '已生成检查建议' },
  frozen: { en: 'Frozen entry: {entry} · v{revision} · {session}', zh: '冻结条目：{entry} · v{revision} · {session}' },
  disclaimer: { en: 'Suggestions from the configured Host agent. No scientific test or verification has been performed.', zh: '来自已配置 Host Agent 的建议，未执行科学检验或验证。' },
  empty: { en: 'No suggestions returned. This is not a passed audit.', zh: '未返回建议，这不代表已通过检查。' },
  stale: { en: 'The entry revision or draft changed after generation. These suggestions are stale.', zh: '生成后条目版本或草稿已更改，建议已过期。' },
  sources: { en: 'Source blocks: {blocks}', zh: '来源块：{blocks}' },
  documentWide: { en: 'Document-wide', zh: '整份文档' },
  usefulness: { en: 'Usefulness · {id}', zh: '实用性 · {id}' },
  unmarked: { en: 'Unmarked', zh: '未标记' },
  useful: { en: 'Useful', zh: '有用' },
  notUseful: { en: 'Not useful', zh: '无用' },
  ack: { en: 'I reviewed these suggestions, not verified results.', zh: '我已复核这些建议，它们不是已验证结果。' },
  insert: { en: 'Insert reviewed check suggestions', zh: '插入已复核检查建议' },
  applied: { en: 'Review snapshot is in the draft. Save a revision to publish it.', zh: '复核快照已加入草稿，保存修订后发布。' },
} as const;

export function AICheckReview({ result, decisions, busy, applied, onDecide, onApply, getContent, getTarget }: {
  result: GeneratedChecks; decisions: Record<string, CellDecision>; busy: boolean; applied: boolean;
  onDecide(decisions: Record<string, CellDecision>): Promise<void>; onApply(snapshot: unknown): Promise<void>; getContent(): string; getTarget(): GenerationTarget | null;
}) {
  const { t } = useAppI18n(messages);
  const [acknowledged, setAcknowledged] = useState(false), [error, setError] = useState('');
  const stale = !generationIsCurrent(result.frozen, getTarget(), getContent());
  return <section aria-label={t('region')}>
    <p>{t('frozen', { entry: result.frozen.target.entryId, revision: result.frozen.target.revision, session: result.sessionId })}</p>
    <p>{t('disclaimer')}</p>
    {!result.checks.length && <Feedback kind="info">{t('empty')}</Feedback>}
    {stale && !applied && <Feedback kind="warning">{t('stale')}</Feedback>}
    <ol>{result.checks.map(check => <li key={check.id}><strong>{check.severity}</strong><p>{check.text}</p><p>{t('sources', { blocks: check.blockIds.join(', ') || t('documentWide') })}</p>
      <Select label={t('usefulness', { id: check.id })} disabled={busy || applied} value={decisions[check.id] ?? 'pending'} options={[{ value: 'pending', label: t('unmarked') }, { value: 'accepted', label: t('useful') }, { value: 'rejected', label: t('notUseful') }]} onChange={value => { setAcknowledged(false); void onDecide({ ...decisions, [check.id]: value as CellDecision }); }} />
    </li>)}</ol>
    {!applied && <><label><Checkbox checked={acknowledged} disabled={busy || stale} onCheckedChange={value => setAcknowledged(value === true)} /> {t('ack')}</label>
      <Button variant="primary" disabled={busy || stale || !acknowledged} onClick={async () => {
        try { const snapshot = generatedChecksSnapshot(result, decisions, getTarget(), getContent(), acknowledged, new Date().toISOString()); await onApply(snapshot); setError(''); setAcknowledged(false); }
        catch (cause) { setError(String(cause)); }
      }}>{t('insert')}</Button></>}
    {applied && <Feedback kind="success">{t('applied')}</Feedback>}
    {error && <Feedback kind="error">{error}</Feedback>}
  </section>;
}
