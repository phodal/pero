import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Dialog, Feedback, Field, Input, Select, Textarea } from '@pero/app-sdk/ui';
import { summarizeReviewBulk, type LocalBulkResult } from '@pero/notebook/review';

type RecordChoice = { id: string; version: number; label: string; reviewerDisplay?: string };
interface Props { kind: 'threads' | 'tasks' | 'reviews'; items: RecordChoice[]; actor: string; disabled: boolean; error: string;
  reload: () => Promise<unknown>;
  mutate: (payload: Record<string, unknown>) => Promise<{ bulkResults?: LocalBulkResult[] } | undefined>; }
const messages = {
  refresh: { en: 'Reload records and use current versions', zh: '刷新记录并使用当前版本' },
  open: { en: 'Bulk actions', zh: '批量操作' }, choose: { en: 'Selected local records', zh: '所选本地记录' }, action: { en: 'Bulk operation', zh: '批量操作类型' },
  hint: { en: 'Each selected record is checked independently. Conflicts and failures stay selected; successful changes are not repeated. Retrying an interrupted request uses its original request ID.', zh: '独立检查每个所选记录。冲突和失败项仍保持选中，成功项不会重复执行。重试中断请求会沿用原请求 ID。' },
  resolve: { en: 'Resolve selected threads', zh: '解决所选线程' }, reopen: { en: 'Reopen selected threads', zh: '重新打开所选线程' },
  todo: { en: 'Mark tasks to do', zh: '标记任务为待办' }, in_progress: { en: 'Mark tasks in progress', zh: '标记任务为进行中' }, done: { en: 'Mark tasks done', zh: '标记任务为已完成' }, cancelled: { en: 'Cancel selected tasks', zh: '取消所选任务' },
  reassign: { en: 'Reassign selected tasks', zh: '重新分配所选任务' }, retract: { en: 'Retract my selected self-reviews', zh: '撤回所选本人自我复核' },
  owner: { en: 'New task owner label', zh: '新的任务负责者标签' }, reason: { en: 'Bulk action reason', zh: '批量操作理由' },
  confirm: { en: 'I am the original local reviewer and am retracting only my own selected records.', zh: '我是原本地复核者，仅撤回所选的本人复核记录。' },
  submit: { en: 'Apply to selected records', zh: '应用于所选记录' }, close: { en: 'Close', zh: '关闭' }, cancel: { en: 'Cancel', zh: '取消' },
  result: { en: '{succeeded} succeeded; {failed} failed', zh: '{succeeded} 项成功；{failed} 项失败' }, saving: { en: 'Saving…', zh: '正在保存…' },
} as const;

export function ReviewBulk({ kind, items, actor, disabled, error, mutate, reload }: Props) {
  const { t } = useAppI18n(messages);
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<RecordChoice[]>([]);
  const [action, setAction] = useState(kind === 'threads' ? 'resolve' : kind === 'tasks' ? 'done' : 'retract');
  const [owner, setOwner] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [results, setResults] = useState<LocalBulkResult[]>([]);
  const available = items.filter(item => kind !== 'reviews' || item.reviewerDisplay === actor.trim());
  const options = (kind === 'threads' ? ['resolve', 'reopen'] : kind === 'tasks' ? ['todo', 'in_progress', 'done', 'cancelled', 'reassign'] : ['retract']) as ('resolve' | 'reopen' | 'todo' | 'in_progress' | 'done' | 'cancelled' | 'reassign' | 'retract')[];
  const apply = async () => {
    if (busy) return; setBusy(true);
    const changes = selected.map(item => ({ id: item.id, expectedVersion: item.version,
      ...(kind === 'threads' ? { action: action === 'resolve' ? 'resolve-thread' : 'reopen-thread' }
        : kind === 'tasks' ? action === 'reassign' ? { action: 'reassign-task', ownerDisplay: owner, reason } : { action: 'set-task-status', status: action }
          : { action: 'transition-review', status: 'retracted', note: reason, confirmedLocalDecision: confirmed }) }));
    try {
      const result = await mutate({ action: 'bulk-change', changes });
      if (result?.bulkResults) {
        setResults(result.bulkResults);
        const failed = summarizeReviewBulk(result.bulkResults).failedIds;
        setSelected(previous => previous.filter(item => failed.includes(item.id)));
      }
    } finally { setBusy(false); }
  };
  const summary = summarizeReviewBulk(results);
  return <><Button variant="ghost" disabled={disabled || !available.length} onClick={() => setOpen(true)}>{t('open')}</Button>
    {open && <Dialog title={t('open')} closeLabel={t('close')} onClose={() => setOpen(false)} size="lg"
      footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t('cancel')}</Button>
        <Button disabled={disabled || busy || !selected.length || selected.length > 100 || action === 'reassign' && (!owner.trim() || !reason.trim()) || kind === 'reviews' && (!confirmed || !reason.trim())}
          onClick={() => void apply()}>{busy ? t('saving') : t('submit')}</Button></>}>
      <div className="notebook-workspace-form"><p>{t('hint')}</p>{error && <Feedback kind="error">{error}</Feedback>}
        <Select label={t('action')} options={options.map(value => ({ value, label: t(value) }))} value={action} disabled={busy} onChange={setAction} />
        <fieldset disabled={busy}><legend>{t('choose')} ({selected.length}/100)</legend>
          {available.map(item => <label className="notebook-checkbox" key={item.id}><Checkbox checked={selected.some(value => value.id === item.id)}
            onCheckedChange={checked => setSelected(previous => checked ? [...previous, item] : previous.filter(value => value.id !== item.id))} />{item.label}</label>)}
        </fieldset>
        {action === 'reassign' && <Field label={t('owner')}>{control => <Input {...control} maxLength={120} value={owner} disabled={busy} onChange={event => setOwner(event.target.value)} />}</Field>}
        {(action === 'reassign' || kind === 'reviews') && <Field label={t('reason')}>{control => <Textarea {...control} maxLength={8000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />}</Field>}
        {kind === 'reviews' && <label className="notebook-checkbox"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)} />{t('confirm')}</label>}
        {!!results.length && <><Feedback kind={summary.failed ? 'warning' : 'success'}>{t('result', { succeeded: summary.succeeded, failed: summary.failed })}</Feedback>
          <ul>{results.map(result => <li key={result.index}>{items.find(item => item.id === result.id)?.label ?? result.id}: {result.ok ? '✓' : result.detail}</li>)}</ul>
          {!!summary.failed && <Button variant="ghost" disabled={disabled || busy} onClick={async () => { setBusy(true); try { const data = await reload() as { threads: RecordChoice[]; tasks: RecordChoice[]; reviews: RecordChoice[] } | undefined; if (data) setSelected(previous => previous.map(item => { const current = data[kind].find(latest => latest.id === item.id); return current ? { ...item, version: current.version } : item; })); } finally { setBusy(false); } }}>{t('refresh')}</Button>}
        </>}
      </div>
    </Dialog>}
  </>;
}
