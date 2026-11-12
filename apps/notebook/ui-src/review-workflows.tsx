import { useState, type ReactNode } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Checkbox, Dialog, Disclosure, Feedback, Field, Input, Select, Textarea } from '@pero/app-sdk/ui';
import { latestReviewWorkflows, type LocalReviewRun, type LocalReviewStage, type LocalReviewWorkflow, type LocalWorkflowWorkspace } from '@pero/notebook/review';

const messages = {
  refresh: { en: 'Reload records and use current versions', zh: '刷新记录并使用当前版本' },
  heading: { en: 'Local review workflows', zh: '本地复核流程' }, configure: { en: 'Configure workflow', zh: '配置流程' }, edit: { en: 'Edit workflow', zh: '编辑流程' },
  hint: { en: 'Stages run in order. All labels within a stage review in parallel and must approve before the next stage opens. Labels are unverified; record only your own decisions. Nothing is sent to participants.', zh: '阶段依次进行，同一阶段内的标签并行复核，全部批准后才进入下一阶段。标签未经身份验证，只能记录自己的决定，不会向参与者发送消息。' },
  choose: { en: 'Saved workflow version', zh: '已保存流程版本' }, name: { en: 'Workflow name', zh: '流程名称' }, stage: { en: 'Stage name', zh: '阶段名称' },
  participants: { en: 'Participant labels (one per line)', zh: '参与者标签（每行一个）' }, add: { en: 'Add stage', zh: '添加阶段' }, remove: { en: 'Remove stage', zh: '移除阶段' },
  up: { en: 'Move stage up', zh: '上移阶段' }, down: { en: 'Move stage down', zh: '下移阶段' }, save: { en: 'Save workflow version', zh: '保存流程版本' },
  request: { en: 'Request workflow review', zh: '请求流程复核' }, fresh: { en: 'Request fresh workflow review', zh: '请求新流程复核' },
  note: { en: 'Workflow note', zh: '流程说明' }, reason: { en: 'Action reason', zh: '操作理由' }, actor: { en: 'Local operator', zh: '本地操作者' },
  participant: { en: 'New participant label', zh: '新的参与者标签' }, reassign: { en: 'Reassign pending review', zh: '重新分配待办复核' },
  approve: { en: 'Approve my assignment', zh: '批准我的复核项' }, changes: { en: 'Request changes in my assignment', zh: '要求修改我的复核项' }, reject: { en: 'Reject my assignment', zh: '拒绝我的复核项' },
  withdraw: { en: 'Withdraw workflow review', zh: '撤回流程复核' }, confirm: { en: 'Record local workflow action', zh: '记录本地流程操作' },
  own: { en: 'This is my own decision under the displayed local label. This is not an electronic signature.', zh: '这是我以所显示本地标签记录的本人决定，并非电子签名。' },
  cancel: { en: 'Cancel', zh: '取消' }, close: { en: 'Close', zh: '关闭' }, pending: { en: 'Saving…', zh: '正在保存…' },
  stale: { en: 'Older revision; this workflow does not approve the latest saved content.', zh: '较早修订，此流程不代表最新保存内容已获批准。' },
  inspect: { en: 'View workflow pinned revision', zh: '查看流程固定修订' }, waiting: { en: 'Waiting for earlier stage', zh: '等待前一阶段' },
  requested: { en: 'Requested locally', zh: '本地已请求' }, approved: { en: 'Approved locally', zh: '本地已批准' }, changes_requested: { en: 'Changes requested', zh: '要求修改' },
  rejected: { en: 'Rejected locally', zh: '本地已拒绝' }, withdrawn: { en: 'Withdrawn', zh: '已撤回' }, assignmentPending: { en: 'Pending', zh: '待复核' },
  history: { en: 'Configuration revisions are immutable. Editing creates a new version; existing runs keep their original plan and decisions.', zh: '流程修订不可变。编辑会创建新版本，现有复核保留原计划和决定。' },
  previous: { en: 'Previous run', zh: '前次流程' }, identity: { en: 'Unverified local label', zh: '未经验证的本地标签' },
} as const;
type DraftStage = { id: string; name: string; labels: string };
type Form = { kind: 'config' | 'request' | 'decision' | 'reassign' | 'withdraw'; config?: LocalReviewWorkflow;
  run?: LocalReviewRun; assignment?: string; decision?: string; name: string; stages: DraftStage[]; choice: string; note: string; participant: string; confirmed: boolean };
interface Props { data: LocalWorkflowWorkspace; revision: number; actor: string; disabled: boolean; readonly: boolean; error: string; reload: () => Promise<LocalWorkflowWorkspace | undefined>;
  mutate: (payload: Record<string, unknown>) => Promise<unknown>; snapshot: (revision: number, onLoaded?: (ready: boolean) => void) => ReactNode; }

export function ReviewWorkflows({ data, revision, actor, disabled, readonly, mutate, snapshot, error, reload }: Props) {
  const { t } = useAppI18n(messages);
  const [form, setForm] = useState<Form | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [inspect, setInspect] = useState<number | null>(null);
  const latest = latestReviewWorkflows(data.workflowConfigs);
  const blank = (): Form => ({ kind: 'config', name: '', stages: [{ id: crypto.randomUUID(), name: '', labels: actor }], choice: '', note: '', participant: '', confirmed: false });
  const open = (kind: Form['kind'], config?: LocalReviewWorkflow, run?: LocalReviewRun, assignment?: string, decision?: string) => {
    setReady(false);
    setForm({ ...blank(), kind, config, run, assignment, decision, name: config?.name ?? '',
      stages: config?.stages.map(stage => ({ ...stage, labels: stage.participants.join('\n') })) ?? blank().stages,
      choice: config ? `${config.id}:${config.version}` : latest[0] ? `${latest[0].id}:${latest[0].version}` : '' });
  };
  const change = (value: Partial<Form>) => setForm(current => current && { ...current, ...value });
  const stageChange = (index: number, value: Partial<DraftStage>) => change({ stages: form!.stages.map((stage, at) => at === index ? { ...stage, ...value } : stage) });
  const move = (index: number, delta: number) => { const stages = [...form!.stages]; [stages[index], stages[index + delta]] = [stages[index + delta], stages[index]]; change({ stages }); };
  const submit = async () => {
    if (!form || busy) return;
    const target = form; setBusy(true);
    let payload: Record<string, unknown>;
    if (form.kind === 'config') payload = { action: 'save-workflow', expectedVersion: form.config?.version ?? 0,
      ...(form.config ? { id: form.config.id } : {}), name: form.name,
      stages: form.stages.map(stage => ({ id: stage.id, name: stage.name, participants: stage.labels.split('\n').filter(label => label.trim()) } satisfies LocalReviewStage)) };
    else if (form.kind === 'request') {
      const config = data.workflowConfigs.find(item => `${item.id}:${item.version}` === form.choice);
      if (!config) { setBusy(false); return; }
      payload = { action: 'request-workflow', expectedVersion: 0, revision, workflowId: config.id, workflowVersion: config.version, note: form.note,
        ...(form.run ? { previousRunId: form.run.id } : {}) };
    } else payload = { action: form.kind === 'decision' ? 'decide-workflow' : `${form.kind}-workflow`, id: form.run!.id,
      expectedVersion: form.run!.version, reason: form.note,
      ...(form.kind !== 'withdraw' ? { assignmentId: form.assignment } : {}),
      ...(form.kind === 'reassign' ? { participantDisplay: form.participant } : {}),
      ...(form.kind === 'decision' ? { decision: form.decision, confirmedLocalDecision: form.confirmed } : {}) };
    try { if (await mutate(payload)) setForm(current => current === target ? null : current); }
    finally { setBusy(false); }
  };
  const valid = form && (form.kind === 'config' ? form.name.trim() && form.stages.every(stage => stage.name.trim() && stage.labels.trim())
    : form.kind === 'request' ? form.choice && ready : form.note.trim() && (form.kind !== 'decision' || form.confirmed && ready)
      && (form.kind !== 'reassign' || form.participant.trim()));
  return <section className="notebook-workspace-form" aria-label={t('heading')}>
    {!!data.workflowRuns.length && <h3>{t('heading')}</h3>}
    {!readonly && <div className="notebook-workspace-actions"><Button disabled={disabled} onClick={() => open('config')}>{t('configure')}</Button>
      {!!latest.length && <Button disabled={disabled} onClick={() => open('request')}>{t('request')} · r{revision}</Button>}</div>}
    {latest.map(config => <div className="notebook-workspace-actions" key={config.id}><strong>{config.name} · v{config.version}</strong>
      <span>{config.stages.map(stage => `${stage.name} (${stage.participants.join(', ')})`).join(' → ')}</span>
      {!readonly && <Button variant="ghost" disabled={disabled} onClick={() => open('config', config)}>{t('edit')}</Button>}</div>)}
    <ul className="notebook-review-list">{data.workflowRuns.map(run => <li key={run.id} data-review-run={run.id}>
      <strong>{run.workflow.name} · v{run.workflow.version} · r{run.revision}</strong> <Badge>{t(run.status)}</Badge>
      <p>{t('actor')}: {run.requesterDisplay} · {run.updatedAt}</p>{run.note && <p>{run.note}</p>}
      {run.stale && <Feedback kind="warning">{t('stale')}</Feedback>}
      {run.previousRunId && <small>{t('previous')}: {run.previousRunId}</small>}
      <Button variant="ghost" onClick={() => setInspect(run.revision)}>{t('inspect')}</Button>
      <ol>{run.workflow.stages.map(stage => <li key={stage.id}><strong>{stage.name}</strong>
        {run.status === 'requested' && stage.id !== run.activeStageId && run.assignments.some(item => item.stageId === stage.id && item.status === 'pending') && <p>{t('waiting')}</p>}
        <ul>{run.assignments.filter(item => item.stageId === stage.id).map(item => <li key={item.id}>
          <span>{item.participantDisplay} · {t('identity')} · {t(item.status === 'pending' ? 'assignmentPending' : item.status)}</span>
          {item.reason && <p>{item.reason} · {item.decidedAt} · {item.actorDisplay}</p>}
          {!readonly && run.status === 'requested' && item.status === 'pending' && <div className="notebook-workspace-actions">
            <Button variant="ghost" disabled={disabled} onClick={() => open('reassign', undefined, run, item.id)}>{t('reassign')}</Button>
            {stage.id === run.activeStageId && actor.trim() === item.participantDisplay && (['approved', 'changes_requested', 'rejected'] as const).map(decision =>
              <Button key={decision} variant="ghost" disabled={disabled} onClick={() => open('decision', undefined, run, item.id, decision)}>{t(decision === 'approved' ? 'approve' : decision === 'rejected' ? 'reject' : 'changes')}</Button>)}
          </div>}
        </li>)}</ul>
      </li>)}</ol>
      {!readonly && <div className="notebook-workspace-actions">
        {run.status !== 'withdrawn' && run.requesterDisplay === actor.trim() && <Button variant="ghost" disabled={disabled} onClick={() => open('withdraw', undefined, run)}>{t('withdraw')}</Button>}
        <Button variant="ghost" disabled={disabled} onClick={() => open('request', run.workflow, run)}>{t('fresh')} · r{revision}</Button>
      </div>}
    </li>)}</ul>
    {form && <Dialog size="lg" title={t(form.kind === 'config' ? 'configure' : form.kind === 'request' ? 'request' : form.kind === 'reassign' ? 'reassign' : form.kind === 'withdraw' ? 'withdraw' : 'confirm')} closeLabel={t('close')} onClose={() => setForm(null)}
      footer={<><Button variant="ghost" onClick={() => setForm(null)}>{t('cancel')}</Button><Button disabled={disabled || busy || !valid} onClick={() => void submit()}>{busy ? t('pending') : t(form.kind === 'config' ? 'save' : form.kind === 'request' ? 'request' : 'confirm')}</Button></>}>
      <div className="notebook-workspace-form">
        {error && <Feedback kind="error">{error}<Button variant="ghost" disabled={busy || disabled} onClick={async () => {
          setBusy(true);
          try { const target = form, current = await reload();
          if (current) setForm(previous => previous === target ? { ...previous,
            run: current.workflowRuns.find(item => item.id === previous.run?.id) ?? previous.run,
            config: latestReviewWorkflows(current.workflowConfigs).find(item => item.id === previous.config?.id) ?? previous.config,
          } : previous); } finally { setBusy(false); }
        }}>{t('refresh')}</Button></Feedback>}
        {form.kind === 'config' ? <><p>{t('history')}</p><Disclosure variant="inline" summary={t('identity')}><p>{t('hint')}</p></Disclosure>
          <Field label={t('name')}>{control => <Input {...control} maxLength={120} disabled={busy} value={form.name} onChange={event => change({ name: event.target.value })} />}</Field>
          {form.stages.map((stage, index) => <section className="notebook-workspace-form" key={stage.id}>
            <Field label={`${t('stage')} ${index + 1}`}>{control => <Input {...control} maxLength={120} disabled={busy} value={stage.name} onChange={event => stageChange(index, { name: event.target.value })} />}</Field>
            <Field label={`${t('participants')} ${index + 1}`}>{control => <Textarea {...control} disabled={busy} value={stage.labels} onChange={event => stageChange(index, { labels: event.target.value })} />}</Field>
            <div className="notebook-workspace-actions"><Button variant="ghost" disabled={busy || index === 0} onClick={() => move(index, -1)}>{t('up')}</Button>
              <Button variant="ghost" disabled={busy || index === form.stages.length - 1} onClick={() => move(index, 1)}>{t('down')}</Button>
              <Button variant="ghost" disabled={busy || form.stages.length === 1} onClick={() => change({ stages: form.stages.filter((_, at) => at !== index) })}>{t('remove')}</Button></div>
          </section>)}
          <Button variant="ghost" disabled={busy || form.stages.length >= 10} onClick={() => change({ stages: [...form.stages, { id: crypto.randomUUID(), name: '', labels: actor }] })}>{t('add')}</Button>
        </> : <>
          {form.kind === 'request' && <Select label={t('choose')} value={form.choice} disabled={busy} onChange={choice => change({ choice })} options={data.workflowConfigs.map(config => ({ value: `${config.id}:${config.version}`, label: `${config.name} · v${config.version}` }))} />}
          <p>{t('actor')}: {actor} · {t('identity')}</p>
          {form.kind === 'reassign' && <Field label={t('participant')}>{control => <Input {...control} maxLength={120} disabled={busy} value={form.participant} onChange={event => change({ participant: event.target.value })} />}</Field>}
          <Field label={t(form.kind === 'request' ? 'note' : 'reason')}>{control => <Textarea {...control} maxLength={8000} disabled={busy} value={form.note} onChange={event => change({ note: event.target.value })} />}</Field>
          {(form.kind === 'request' || form.kind === 'decision') && snapshot(form.kind === 'request' ? revision : form.run!.revision, setReady)}
          {form.kind === 'decision' && <label className="notebook-checkbox"><Checkbox checked={form.confirmed} disabled={busy} onCheckedChange={checked => change({ confirmed: checked === true })} />{t('own')}</label>}
        </>}
      </div>
    </Dialog>}
    {inspect !== null && <Dialog size="lg" title={t('inspect')} closeLabel={t('close')} onClose={() => setInspect(null)}>{snapshot(inspect)}</Dialog>}
  </section>;
}
