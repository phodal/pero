import { useEffect, useMemo, useRef, useState } from 'react';
import { AppApiError, downloadFile, useAppApi, useAppDataChanged, useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Checkbox, CodeCompare, Dialog, EmptyState, Feedback, Field, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@pero/app-sdk/ui';
import type { NotebookDocument, NotebookEntry, NotebookEntrySummary } from '@pero/notebook';
import { type LocalWorkflowWorkspace, type LocalBulkResult, compareNotebookRevisions, reviewAnchorBlocks } from '@pero/notebook/review';
import { notebookMarkdown } from '@pero/notebook/workspace';
import { ReviewWorkflows } from './review-workflows';
import { ReviewBulk } from './review-bulk';

const messages = {
  comments: { en: 'Comments', zh: '评论' }, tasks: { en: 'Local tasks', zh: '本地任务' },
  reviews: { en: 'Human review', zh: '人工复核' }, history: { en: 'History and compare', zh: '历史与比较' },
  label: { en: 'Review workspace', zh: '复核工作区' }, refresh: { en: 'Refresh records', zh: '刷新记录' },
  loading: { en: 'Loading saved records…', zh: '正在加载已保存记录…' }, pending: { en: 'Saving…', zh: '正在保存…' },
  scope: { en: 'Local notebook records only. Names are unverified display labels. No invitations, mentions or notifications are sent. Shared review needs real identity, authorization and synchronization; electronic signing additionally needs authentication, signing declarations and a protected audit system.', zh: '仅为本地笔记记录，姓名是未经验证的显示标签，不发送邀请、提及或通知。多人复核需要实际身份、授权和同步服务；电子签署还需要身份认证、签署声明及受保护的审计系统。' },
  actor: { en: 'Your local display label', zh: '你的本地显示名称' }, actorHint: { en: 'Enter your own label. This is not an authenticated account.', zh: '填写你自己的名称，此处不是经过认证的账户。' },
  localUser: { en: 'Local notebook user', zh: '本地笔记使用者' }, addComment: { en: 'Start comment thread', zh: '新建评论线程' },
  noComments: { en: 'No comment threads yet', zh: '暂无评论线程' }, noTasks: { en: 'No local tasks yet', zh: '暂无本地任务' },
  noReviews: { en: 'No local review records yet', zh: '暂无本地复核记录' }, noActivity: { en: 'No recorded changes yet', zh: '暂无变更记录' },
  body: { en: 'Comment', zh: '评论内容' }, reply: { en: 'Reply', zh: '回复' }, edit: { en: 'Edit', zh: '编辑' },
  edited: { en: 'Edited', zh: '已编辑' }, resolve: { en: 'Resolve thread', zh: '解决线程' }, reopen: { en: 'Reopen thread', zh: '重新打开线程' },
  open: { en: 'Open', zh: '未解决' }, resolved: { en: 'Resolved', zh: '已解决' }, filter: { en: 'Thread filter', zh: '筛选线程' },
  all: { en: 'All threads', zh: '全部线程' }, unresolved: { en: 'Unresolved only', zh: '仅未解决' }, noMatches: { en: 'No threads match this filter', zh: '没有符合筛选条件的线程' },
  anchor: { en: 'Anchor in saved revision', zh: '已保存修订中的锚点' }, wholeEntry: { en: 'Whole entry', zh: '整条记录' },
  quote: { en: 'Exact quoted text (optional)', zh: '准确引用原文（可选）' }, quoteHint: { en: 'The quote must exist in the selected block of the saved revision.', zh: '引用文字必须存在于已保存修订的所选内容块中。' },
  savedRevision: { en: 'Saved revision {revision}', zh: '已保存修订 {revision}' }, viewSource: { en: 'View pinned revision', zh: '查看固定修订' },
  reveal: { en: 'Reveal block in Notes', zh: '在笔记中定位内容块' }, changed: { en: 'Anchor content changed', zh: '锚点内容已变化' },
  missing: { en: 'Original block was removed', zh: '原内容块已被删除' }, unchanged: { en: 'Block unchanged in a newer revision', zh: '新修订中此块内容未变化' },
  revision_changed: { en: 'Pinned to an older revision', zh: '固定于较早修订' }, current: { en: 'Current saved revision', zh: '当前已保存修订' },
  stale: { en: 'Older revision; does not review the latest content', zh: '较早修订，不代表最新内容已经复核' },
  unsaved: { en: 'There are unsaved edits. Comments and reviews here refer to saved revision {revision}, not the draft. Save first to review those edits.', zh: '存在未保存更改。此处的评论与复核指向已保存修订 {revision}，不是草稿。请先保存后再复核这些更改。' },
  taskHint: { en: 'Notebook to-dos are manual local records. Assigning a label does not notify a person, start Host execution, or mark a scientific procedure complete.', zh: '笔记待办是手动维护的本地记录，填写负责者不会通知他人、启动 Host 执行或标记实验步骤已完成。' },
  addTask: { en: 'Add local task', zh: '添加本地任务' }, title: { en: 'Task title', zh: '任务标题' },
  description: { en: 'Description', zh: '说明' }, owner: { en: 'Owner display label', zh: '负责者显示名称' },
  deadline: { en: 'Due date (optional)', zh: '截止日期（可选）' }, overdue: { en: 'Overdue', zh: '已逾期' },
  todo: { en: 'To do', zh: '待办' }, in_progress: { en: 'In progress', zh: '进行中' }, done: { en: 'Done', zh: '已完成' }, cancelled: { en: 'Cancelled', zh: '已取消' },
  status: { en: 'Status', zh: '状态' }, requestReview: { en: 'Request local self-review', zh: '请求本地自我复核' },
  reviewHint: { en: 'Review a fixed saved revision yourself. This is neither an independent reviewer approval nor a compliance electronic signature.', zh: '由你自己复核固定的已保存修订。这不是独立审核人的批准，也不是合规电子签名。' },
  requested: { en: 'Requested', zh: '已请求' }, approved: { en: 'Approved locally', zh: '本地已批准' },
  rejected: { en: 'Rejected locally', zh: '本地已拒绝' }, reject: { en: 'Reject my review', zh: '拒绝我的复核' },
  changes_requested: { en: 'Changes requested', zh: '要求修改' }, retracted: { en: 'Retracted', zh: '已撤回' },
  begin: { en: 'Begin my review', zh: '开始我的复核' }, approve: { en: 'Record my approval', zh: '记录我的批准' },
  requestChanges: { en: 'Request changes', zh: '要求修改' }, retract: { en: 'Retract review', zh: '撤回复核' },
  fresh: { en: 'Request a fresh review', zh: '请求新复核' }, note: { en: 'Review note or decision reason', zh: '复核说明或决策理由' },
  reviewer: { en: 'Local reviewer', zh: '本地复核者' }, previous: { en: 'Prior review', zh: '前次复核' },
  previousDecision: { en: 'Recorded decision', zh: '已记录的决策' }, confirm: { en: 'I am the local reviewer named above and am recording my own action on this saved revision. This is not an electronic signature.', zh: '我是上方显示的本地复核者，正在记录自己针对该已保存修订的操作。这不是电子签名。' },
  ownLabel: { en: 'Use the same local display label as the original request: {name}', zh: '请使用原请求中相同的本地显示名称：{name}' },
  confirmAction: { en: 'Confirm local action', zh: '确认本地操作' }, close: { en: 'Close', zh: '关闭' }, cancel: { en: 'Cancel', zh: '取消' }, save: { en: 'Save record', zh: '保存记录' },
  sourceLoading: { en: 'Loading the pinned saved revision…', zh: '正在加载固定的已保存修订…' },
  snapshotHint: { en: 'Read-only Markdown preview. Formatting, some structured fields and file bytes are omitted; download the saved JSON for the complete source.', zh: '只读 Markdown 预览省略了格式、部分结构字段和文件字节；下载已保存 JSON 可查看完整来源。' },
  truncated: { en: 'Preview is limited to 20,000 characters. Download the saved revision for the complete source.', zh: '预览限制为 20,000 字符；下载该修订可查看完整来源。' },
  downloadSnapshot: { en: 'Download saved JSON', zh: '下载已保存 JSON' }, exportRecords: { en: 'Export local records', zh: '导出本地记录' },
  before: { en: 'Earlier side', zh: '比较左侧' }, after: { en: 'Later side', zh: '比较右侧' }, compare: { en: 'Compare saved revisions', zh: '比较已保存修订' },
  comparing: { en: 'Loading comparison…', zh: '正在加载比较…' }, identical: { en: 'These saved documents are identical', zh: '这两个已保存文档完全相同' },
  differences: { en: '{count} changes', zh: '{count} 项变化' },
  compareHint: { en: 'Comparison uses the actual saved values and stable block IDs. Display is limited to 100 differences and 280-character value previews; embedded file bytes are omitted. Changes beyond a truncated preview still count.', zh: '比较使用实际保存值及稳定内容块 ID。显示前 100 项差异及最多 280 字符的值预览，不显示内嵌文件字节；截断部分中的真实变化仍会计入。' },
  limited: { en: 'Additional differences are omitted from this preview.', zh: '预览省略了更多差异。' },
  timeline: { en: 'Local activity', zh: '本地活动' }, activityLimit: { en: 'Showing the latest 500 actual events. Older events remain stored locally.', zh: '显示最近 500 项真实事件，较早事件仍保存在本地。' },
  added: { en: 'Added', zh: '新增' }, removed: { en: 'Removed', zh: '删除' }, reordered: { en: 'Reordered', zh: '重排' },
  'create-thread': { en: 'Started thread', zh: '新建线程' }, 'edit-comment': { en: 'Edited comment', zh: '编辑评论' },
  'resolve-thread': { en: 'Resolved thread', zh: '解决线程' }, 'reopen-thread': { en: 'Reopened thread', zh: '重新打开线程' },
  'create-task': { en: 'Created local task', zh: '创建本地任务' }, 'update-task': { en: 'Updated local task', zh: '更新本地任务' },
  'save-workflow': { en: 'Saved workflow version', zh: '保存流程版本' }, 'request-workflow': { en: 'Requested workflow review', zh: '请求流程复核' },
  'decide-workflow': { en: 'Recorded workflow decision', zh: '记录流程决定' }, 'reassign-workflow': { en: 'Reassigned pending review', zh: '重新分配待办复核' },
  'withdraw-workflow': { en: 'Withdrew workflow review', zh: '撤回流程复核' }, 'set-task-status': { en: 'Changed task status', zh: '更改任务状态' },
  'reassign-task': { en: 'Reassigned local task', zh: '重新分配本地任务' }, details: { en: 'Saved event details', zh: '已保存事件详情' },
  'request-review': { en: 'Requested local review', zh: '请求本地复核' }, 'transition-review': { en: 'Recorded local review action', zh: '记录本地复核操作' },
} as const;
type MessageKey = keyof typeof messages;
type Anchor = { revision: number; blockId: string | null; quote: string };
type Anchored = { id: string; version: number; anchor: Anchor; stale: boolean; anchorStatus: 'current' | 'changed' | 'missing' | 'unchanged' | 'revision_changed'; updatedAt: string };
type Comment = { id: string; text: string; authorDisplay: string; createdAt: string; editedAt: string | null };
type Thread = Anchored & { status: 'open' | 'resolved'; comments: Comment[] };
type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
type Task = Anchored & { title: string; description: string; ownerDisplay: string; deadline: string; status: TaskStatus };
type ReviewStatus = 'requested' | 'in_progress' | 'approved' | 'changes_requested' | 'rejected' | 'retracted';
type Review = Anchored & { reviewerDisplay: string; status: ReviewStatus; note: string; previousReviewId: string | null; decisionAt: string | null; decisionReason: string | null; decisionStatus: ReviewStatus | null; decisionBy: string | null };
type Workspace = LocalWorkflowWorkspace & { bulkResults?: LocalBulkResult[]; entryId: string; headRevision: number; threads: Thread[]; tasks: Task[]; reviews: Review[]; activity: { id: number; at: string; actorDisplay: string; action: string; recordId: string; revision: number; version: number; detail: string }[]; activityLimited: boolean };
type Composer = { kind: 'comment' | 'reply' | 'edit-comment' | 'task' | 'review' | 'decision'; id?: string; version: number; revision: number; blockId: string; quote: string; text: string; title: string; description: string; owner: string; deadline: string; status: string; commentId?: string; previousReviewId?: string; reviewer?: string; confirmed: boolean };

export interface ReviewerPanelProps {
  entryId: string;
  revision: number;
  document?: NotebookDocument;
  readonly?: boolean;
  onRevealBlock?: (blockId: string) => void;
}
const endpoint = (id: string) => `/api/entries/${encodeURIComponent(id)}`;
function messageOf(cause: unknown) {
  if (cause instanceof AppApiError) {
    try { const body = JSON.parse(cause.body) as { detail?: string }; if (body.detail) return body.detail; } catch { /* Transport errors may be plain text. */ }
  }
  return cause instanceof Error ? cause.message : String(cause);
}

function ReviewEventDetail({ action, detail }: { action: string; detail: string }) {
  const { t } = useAppI18n(messages);
  if (!action.endsWith('workflow') && action !== 'reassign-task') return <p className="notebook-review-text">{detail}</p>;
  let summary = detail;
  try {
    const event = JSON.parse(detail) as { name?: string; version?: number; previousOwner?: string; owner?: string; reason?: string;
      command?: { reason?: string; note?: string; participant?: string }; previousAssignment?: { participant?: string } };
    summary = action === 'save-workflow' ? `${event.name} · v${event.version}`
      : action === 'reassign-workflow' ? `${event.previousAssignment?.participant} → ${event.command?.participant}
${event.command?.reason ?? ''}`
        : action === 'reassign-task' ? `${event.previousOwner} → ${event.owner}
${event.reason ?? ''}`
          : event.command?.reason || event.command?.note || t(action as MessageKey);
  } catch { /* Older local events can contain plain text. */ }
  return <><p className="notebook-review-text">{summary}</p><details><summary>{t('details')}</summary><p className="notebook-review-text">{detail}</p></details></>;
}

function SavedRevision({ entryId, revision, onLoaded }: { entryId: string; revision: number; onLoaded?: (ready: boolean) => void }) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [snapshot, setSnapshot] = useState<NotebookEntry | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const ready = useRef(onLoaded); ready.current = onLoaded;
  useEffect(() => {
    let active = true; setSnapshot(null); setError(''); ready.current?.(false);
    void api.get<NotebookEntry>(`${endpoint(entryId)}/revisions/${revision}`).then(value => {
      if (active) { setSnapshot(value); ready.current?.(true); }
    }).catch(cause => { if (active) setError(messageOf(cause)); });
    return () => { active = false; ready.current?.(false); };
  }, [api, entryId, revision, retry]);
  const preview = snapshot ? notebookMarkdown(snapshot.document) : '';
  return <section className="notebook-review-snapshot">
    <strong>{t('savedRevision', { revision })}{snapshot && ` · ${snapshot.document.title}`}</strong>
    {error ? <Feedback kind="error">{error}<Button variant="ghost" onClick={() => setRetry(value => value + 1)}>{t('refresh')}</Button></Feedback>
      : !snapshot ? <p role="status">{t('sourceLoading')}</p> : <>
        <p className="notebook-workspace-hint">{t('snapshotHint')}</p>
        <pre>{preview.slice(0, 20_000)}</pre>
        {preview.length > 20_000 && <p>{t('truncated')}</p>}
        <Button variant="ghost" onClick={() => downloadFile(`Notebook-r${revision}.json`, JSON.stringify(snapshot.document, null, 2), 'application/json')}>{t('downloadSnapshot')}</Button>
      </>}
  </section>;
}

function HistoryComparison({ entryId, revisions }: { entryId: string; revisions: NotebookEntrySummary[] }) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [left, setLeft] = useState(''), [right, setRight] = useState(''), [request, setRequest] = useState(0);
  const [pair, setPair] = useState<[NotebookEntry, NotebookEntry] | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const before = left || String(revisions[1]?.revision ?? revisions[0]?.revision ?? '');
  const after = right || String(revisions[0]?.revision ?? '');
  useEffect(() => {
    if (!before || !after) return;
    let active = true; setLoading(true); setError(''); setPair(null);
    void Promise.all([api.get<NotebookEntry>(`${endpoint(entryId)}/revisions/${before}`), api.get<NotebookEntry>(`${endpoint(entryId)}/revisions/${after}`)]).then(values => {
      if (active) setPair(values);
    }).catch(cause => { if (active) setError(messageOf(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, entryId, before, after, request]);
  const comparison = useMemo(() => pair && compareNotebookRevisions(pair[0].document, pair[1].document), [pair]);
  const options = revisions.map(item => ({ value: String(item.revision), label: `r${item.revision} · ${item.updatedAt} · ${item.title}` }));
  return <section className="notebook-workspace-form">
    <div className="notebook-workspace-actions">
      <Select label={t('before')} value={before} options={options} onChange={setLeft} />
      <Select label={t('after')} value={after} options={options} onChange={setRight} />
      <Button variant="ghost" disabled={loading} onClick={() => setRequest(value => value + 1)}>{t('compare')}</Button>
    </div>
    <p className="notebook-workspace-hint">{t('compareHint')}</p>
    {loading && <p role="status">{t('comparing')}</p>}
    {error && <Feedback kind="error">{error}</Feedback>}
    {pair && comparison && <>
      <p role="status">{comparison.total ? t('differences', { count: comparison.total }) : t('identical')}</p>
      {comparison.limited && <Feedback kind="warning">{t('limited')}</Feedback>}
      {comparison.total > 0 && <CodeCompare label={t('compare')} className="notebook-review-compare"
        left={{ documentId: `${entryId}:${pair[0].revision}`, label: `r${pair[0].revision}`, text: comparison.changes.map(item => `${item.path} [${t(item.kind)}]\n${item.before}`).join('\n\n') }}
        right={{ documentId: `${entryId}:${pair[1].revision}`, label: `r${pair[1].revision}`, text: comparison.changes.map(item => `${item.path} [${t(item.kind)}]\n${item.after}`).join('\n\n') }} />}
    </>}
  </section>;
}

/** Local records are separate from document edits and save immediately with optimistic versions. */
export function ReviewerPanel(props: ReviewerPanelProps) {
  return <ReviewWorkspace key={props.entryId} {...props} />;
}

function ReviewWorkspace({ entryId, revision, document, readonly = false, onRevealBlock }: ReviewerPanelProps) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [tab, setTab] = useState('comments'), [filter, setFilter] = useState('all');
  const [actor, setActor] = useState(document?.metadata?.author || t('localUser'));
  const [data, setData] = useState<Workspace | null>(null), [saved, setSaved] = useState<NotebookEntry | null>(null);
  const [revisions, setRevisions] = useState<NotebookEntrySummary[] | null>(null);
  const [loadError, setLoadError] = useState(''), [savedError, setSavedError] = useState(''), [historyError, setHistoryError] = useState('');
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [pending, setPending] = useState(false), [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState<Composer | null>(null), [formOpen, setFormOpen] = useState(false), [snapshot, setSnapshot] = useState<number | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const lock = useRef(false), live = useRef(true), epoch = useRef(0), dialogEpoch = useRef(0), requestIdentity = useRef<{ content: string; id: string } | null>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    const generation = ++epoch.current; setLoading(true); setLoadError(''); setSavedError(''); setHistoryError('');
    const accept = () => live.current && generation === epoch.current;
    void api.get<Workspace>(`${endpoint(entryId)}/review-workspace`).then(value => {
      if (!accept()) return;
      setData(value);
      setForm(previous => {
        if (!previous?.id) return previous;
        const records = previous.kind === 'task' ? value.tasks : previous.kind === 'decision' ? value.reviews : value.threads;
        const record = records.find(item => item.id === previous.id);
        return record ? { ...previous, version: record.version } : previous;
      });
    })
      .catch(cause => { if (accept()) setLoadError(messageOf(cause)); }).finally(() => { if (accept()) setLoading(false); });
    setSaved(null);
    void api.get<NotebookEntry>(`${endpoint(entryId)}/revisions/${revision}`).then(value => { if (accept()) setSaved(value); })
      .catch(cause => { if (accept()) setSavedError(messageOf(cause)); });
    void api.get<{ revisions: NotebookEntrySummary[] }>(`${endpoint(entryId)}/revisions`).then(value => { if (accept()) setRevisions(value.revisions); })
      .catch(cause => { if (accept()) setHistoryError(messageOf(cause)); });
  }, [api, entryId, revision, refresh]);
  useAppDataChanged(() => setRefresh(value => value + 1));
  const blocks = useMemo(() => saved ? reviewAnchorBlocks(saved.document) : [], [saved]);
  const draftChanged = useMemo(() => !!document && !!saved && compareNotebookRevisions(saved.document, document, 1).total > 0, [document, saved]);
  const currentBlocks = useMemo(() => new Set(document ? reviewAnchorBlocks(document).map(item => item.value) : []), [document]);
  const change = (partial: Partial<Composer>) => setForm(value => value && { ...value, ...partial });
  const open = (kind: Composer['kind'], partial: Partial<Composer> = {}) => {
    dialogEpoch.current++; setError(''); setSnapshotReady(false);
    const same = form?.kind === kind && form?.id === partial.id && form?.commentId === partial.commentId && form?.status === (partial.status ?? 'todo');
    setForm(same ? { ...form!, revision, previousReviewId: undefined, ...partial } : { kind, version: 0, revision, blockId: '', quote: '', text: '', title: '', description: '', owner: actor, deadline: '', status: 'todo', confirmed: false, ...partial });
    setFormOpen(true);
  };
  const close = () => { dialogEpoch.current++; setFormOpen(false); };
  const run = async (payload: Record<string, unknown>, closeOnSuccess = false) => {
    if (readonly || lock.current) return;
    lock.current = true; setPending(true); setError('');
    const currentDialog = dialogEpoch.current;
    const content = JSON.stringify({ ...payload, actorDisplay: actor.trim() });
    if (requestIdentity.current?.content !== content) requestIdentity.current = { content, id: crypto.randomUUID() };
    try {
      const result = await api.post<Workspace>(`${endpoint(entryId)}/review-workspace`, { ...payload, actorDisplay: actor.trim(), requestId: requestIdentity.current.id });
      if (!live.current) return;
      epoch.current++; setData(result); setLoadError(''); setLoading(false); requestIdentity.current = null;
      if (closeOnSuccess && currentDialog === dialogEpoch.current) { setFormOpen(false); setForm(null); }
      return result;
    } catch (cause) { if (live.current) setError(messageOf(cause)); }
    finally { lock.current = false; if (live.current) setPending(false); }
  };
  const reload = async () => {
    try {
      const result = await api.get<Workspace>(`${endpoint(entryId)}/review-workspace`);
      if (live.current) setData(result);
      return result;
    } catch (cause) { if (live.current) setError(messageOf(cause)); }
  };
  const submit = () => {
    if (!form) return;
    const anchor = { revision: form.revision, blockId: form.blockId || null, quote: form.quote };
    const base = { expectedVersion: form.version };
    if (form.kind === 'comment') void run({ ...base, action: 'create-thread', ...anchor, text: form.text }, true);
    if (form.kind === 'reply') void run({ ...base, action: 'reply', id: form.id, text: form.text }, true);
    if (form.kind === 'edit-comment') void run({ ...base, action: 'edit-comment', id: form.id, commentId: form.commentId, text: form.text }, true);
    if (form.kind === 'task') void run({ ...base, action: form.id ? 'update-task' : 'create-task', ...(form.id ? { id: form.id, status: form.status } : anchor),
      title: form.title, description: form.description, ownerDisplay: form.owner, deadline: form.deadline }, true);
    if (form.kind === 'review') void run({ ...base, action: 'request-review', revision: form.revision, reviewerDisplay: actor.trim(), mode: 'local_self_review', note: form.text,
      ...(form.previousReviewId ? { previousReviewId: form.previousReviewId } : {}) }, true);
    if (form.kind === 'decision') void run({ ...base, action: 'transition-review', id: form.id, status: form.status, note: form.text, confirmedLocalDecision: form.confirmed }, true);
  };
  const anchorView = (item: Anchored) => <div className="notebook-review-anchor">
    <div className="notebook-workspace-actions"><Badge>{t('savedRevision', { revision: item.anchor.revision })}</Badge>
      {item.anchorStatus !== 'current' && <Badge>{t(item.anchorStatus)}</Badge>}
      <Button variant="ghost" onClick={() => setSnapshot(item.anchor.revision)}>{t('viewSource')}</Button>
      {onRevealBlock && item.anchor.blockId && item.anchor.revision === revision && !draftChanged && currentBlocks.has(item.anchor.blockId) &&
        <Button variant="ghost" onClick={() => onRevealBlock(item.anchor.blockId!)}>{t('reveal')}</Button>}
    </div>
    {item.anchor.blockId && <small>{item.anchor.blockId}</small>}{item.anchor.quote && <p className="notebook-review-text">“{item.anchor.quote}”</p>}
  </div>;
  const disabled = readonly || pending || !actor.trim();
  const taskOptions = (['todo', 'in_progress', 'done', 'cancelled'] as const).map(value => ({ value, label: t(value) }));
  const filtered = data?.threads.filter(thread => filter !== 'unresolved' || thread.status === 'open') ?? [];
  const today = new Date(), localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const formTitle = form ? t(form.kind === 'comment' ? 'addComment' : form.kind === 'task' ? form.id ? 'edit' : 'addTask' : form.kind === 'review' ? 'requestReview' : form.kind === 'decision' ? 'confirmAction' : form.kind === 'edit-comment' ? 'edit' : 'reply') : '';
  const validForm = !!form && (form.kind === 'task' ? !!form.title.trim() && !!form.owner.trim() : form.kind === 'review' ? snapshotReady : !!form.text.trim())
    && (form.kind !== 'decision' || form.confirmed && snapshotReady && actor.trim() === form.reviewer);
  return <div className="notebook-review-panel">
    <p className="notebook-workspace-hint">{t('scope')}</p>
    <div className="notebook-workspace-actions">
      <Field label={t('actor')} description={t('actorHint')}>{control => <Input {...control} value={actor} maxLength={120} disabled={pending || readonly} onChange={event => setActor(event.target.value)} />}</Field>
      <Button variant="ghost" disabled={loading || pending} onClick={() => setRefresh(value => value + 1)}>{t('refresh')}</Button>
      {data && <Button variant="ghost" onClick={() => downloadFile(`Notebook-${entryId}-local-records.json`, JSON.stringify(data, null, 2), 'application/json')}>{t('exportRecords')}</Button>}
    </div>
    {draftChanged && <Feedback kind="warning">{t('unsaved', { revision })}</Feedback>}
    {loading && <p role="status">{t('loading')}</p>}
    {loadError && <Feedback kind="error">{loadError}</Feedback>}
    {savedError && <Feedback kind="error">{savedError}</Feedback>}
    {error && !formOpen && <Feedback kind="error">{error}</Feedback>}
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label={t('label')} variant="navigation">{(['comments', 'tasks', 'reviews', 'history'] as const).map(value => <TabsTrigger key={value} value={value}>{t(value)}</TabsTrigger>)}</TabsList>
      <TabsContent value="comments" forceMount>
        <div className="notebook-workspace-actions">
          {!readonly && <Button disabled={disabled || !saved} onClick={() => open('comment')}>{t('addComment')}</Button>}
          {!readonly && data && <ReviewBulk kind="threads" items={filtered.map(item => ({ ...item, label: `${item.comments[0]?.text ?? item.id} · ${t(item.status)}` }))} actor={actor} disabled={disabled} error={error} mutate={run} reload={reload} />}
          <Select label={t('filter')} value={filter} onChange={setFilter} options={[{ value: 'all', label: t('all') }, { value: 'unresolved', label: t('unresolved') }]} />
        </div>
        {data && !filtered.length && <EmptyState title={t(data.threads.length ? 'noMatches' : 'noComments')} />}
        <ul className="notebook-review-list">{filtered.map(thread => <li key={thread.id}>
          <Badge>{t(thread.status)}</Badge>{anchorView(thread)}
          <ol className="notebook-review-comments">{thread.comments.map(comment => <li key={comment.id}>
            <div className="notebook-workspace-actions"><strong>{comment.authorDisplay}</strong><time>{comment.createdAt}</time>{comment.editedAt && <span>{t('edited')} · {comment.editedAt}</span>}</div>
            <p className="notebook-review-text">{comment.text}</p>
            {!readonly && <Button variant="ghost" disabled={disabled} onClick={() => open('edit-comment', { id: thread.id, version: thread.version, revision: thread.anchor.revision, commentId: comment.id, text: comment.text })}>{t('edit')}</Button>}
          </li>)}</ol>
          {!readonly && <div className="notebook-workspace-actions">
            {thread.status === 'open' && <Button variant="ghost" disabled={disabled} onClick={() => open('reply', { id: thread.id, version: thread.version, revision: thread.anchor.revision })}>{t('reply')}</Button>}
            <Button variant="ghost" disabled={disabled} onClick={() => void run({ action: thread.status === 'open' ? 'resolve-thread' : 'reopen-thread', id: thread.id, expectedVersion: thread.version })}>{t(thread.status === 'open' ? 'resolve' : 'reopen')}</Button>
            <Button variant="ghost" disabled={disabled} onClick={() => open('task', { revision: thread.anchor.revision, blockId: thread.anchor.blockId ?? '', quote: thread.anchor.quote, description: thread.comments[0]?.text ?? '' })}>{t('addTask')}</Button>
          </div>}
        </li>)}</ul>
      </TabsContent>
      <TabsContent value="tasks" forceMount>
        <p className="notebook-workspace-hint">{t('taskHint')}</p>
        {!readonly && <Button disabled={disabled || !saved} onClick={() => open('task')}>{t('addTask')}</Button>}
        {!readonly && data && <ReviewBulk kind="tasks" items={data.tasks.map(item => ({ ...item, label: `${item.title} · ${t(item.status)}` }))} actor={actor} disabled={disabled} error={error} mutate={run} reload={reload} />}
        {data && !data.tasks.length && <EmptyState title={t('noTasks')} />}
        <ul className="notebook-review-list">{data?.tasks.map(task => <li key={task.id}>
          <div className="notebook-workspace-actions"><strong>{task.title}</strong><Badge>{t(task.status)}</Badge>
            {task.deadline && task.deadline < localDate && !['done', 'cancelled'].includes(task.status) && <Badge>{t('overdue')}</Badge>}</div>
          <p>{t('owner')}: {task.ownerDisplay}{task.deadline && ` · ${t('deadline')}: ${task.deadline}`}</p>
          {task.description && <p className="notebook-review-text">{task.description}</p>}{anchorView(task)}
          {!readonly && <Button variant="ghost" disabled={disabled} onClick={() => open('task', { id: task.id, version: task.version, revision: task.anchor.revision,
            title: task.title, description: task.description, owner: task.ownerDisplay, deadline: task.deadline, status: task.status })}>{t('edit')}</Button>}
        </li>)}</ul>
      </TabsContent>
      <TabsContent value="reviews" forceMount>
        <p className="notebook-workspace-hint">{t('reviewHint')}</p>
        {!readonly && <Button disabled={disabled || !saved} onClick={() => open('review')}>{t('requestReview')} · r{revision}</Button>}
        {!readonly && data && <ReviewBulk kind="reviews" items={data.reviews.filter(item => item.status !== 'retracted').map(item => ({ ...item, label: `${item.reviewerDisplay} · r${item.anchor.revision} · ${t(item.status)}` }))} actor={actor} disabled={disabled} error={error} mutate={run} reload={reload} />}
        {data && <ReviewWorkflows data={data} revision={revision} actor={actor} disabled={disabled || !saved} readonly={readonly} mutate={run} error={error} reload={reload} snapshot={(number, onLoaded) => <SavedRevision entryId={entryId} revision={number} onLoaded={onLoaded} />} />}
        {data && !data.reviews.length && <EmptyState title={t('noReviews')} />}
        <ul className="notebook-review-list">{data?.reviews.map(review => <li key={review.id}>
          <div className="notebook-workspace-actions"><Badge>{t(review.status)}</Badge><strong>{review.reviewerDisplay}</strong><time>{review.updatedAt}</time></div>
          {review.stale && <Feedback kind="warning">{t('stale')}</Feedback>}{anchorView(review)}
          {review.note && <p className="notebook-review-text">{review.note}</p>}
          {review.previousReviewId && <small>{t('previous')}: {review.previousReviewId}</small>}
          {review.decisionStatus && <p className="notebook-review-text">{t('previousDecision')}: {t(review.decisionStatus)} · {review.decisionBy} · {review.decisionAt}<br />{review.decisionReason}</p>}
          {!readonly && <div className="notebook-workspace-actions">
            {(['requested', 'in_progress'].includes(review.status) ? [
              ...(review.status === 'requested' ? [{ status: 'in_progress', label: 'begin' }] : []),
              { status: 'approved', label: 'approve' }, { status: 'changes_requested', label: 'requestChanges' }, { status: 'rejected', label: 'reject' },
            ] : []).concat(review.status !== 'retracted' ? [{ status: 'retracted', label: 'retract' }] : []).map(action =>
              <Button key={action.status} variant="ghost" disabled={disabled} onClick={() => open('decision', { id: review.id, version: review.version, revision: review.anchor.revision, status: action.status, reviewer: review.reviewerDisplay, confirmed: false })}>{t(action.label as MessageKey)}</Button>)}
            <Button variant="ghost" disabled={disabled || !saved} onClick={() => open('review', { previousReviewId: review.id })}>{t('fresh')} · r{revision}</Button>
          </div>}
        </li>)}</ul>
      </TabsContent>
      <TabsContent value="history" forceMount>
        {historyError && <Feedback kind="error">{historyError}</Feedback>}
        {!revisions && !historyError && <p role="status">{t('loading')}</p>}
        {revisions && <HistoryComparison entryId={entryId} revisions={revisions} />}
        <h3>{t('timeline')}</h3>{data && !data.activity.length && <EmptyState title={t('noActivity')} />}
        {data?.activityLimited && <p className="notebook-workspace-hint">{t('activityLimit')}</p>}
        <ol className="notebook-review-list">{data?.activity.map(item => <li key={item.id}>
          <div className="notebook-workspace-actions"><time>{item.at}</time><strong>{item.actorDisplay}</strong><span>{item.action in messages ? t(item.action as MessageKey) : item.action}</span><Badge>r{item.revision} · v{item.version}</Badge></div>
          <ReviewEventDetail action={item.action} detail={item.detail} />
        </li>)}</ol>
      </TabsContent>
    </Tabs>
    {formOpen && form && <Dialog title={formTitle} closeLabel={t('close')} onClose={close} size="lg"
      footer={<><Button variant="ghost" onClick={close}>{t('cancel')}</Button><Button disabled={disabled || !validForm} onClick={submit}>{pending ? t('pending') : t(form.kind === 'decision' ? 'confirmAction' : 'save')}</Button></>}>
      <div className="notebook-workspace-form">
        <p>{t('savedRevision', { revision: form.revision })}</p>
        {error && <Feedback kind="error">{error}<Button variant="ghost" disabled={pending} onClick={() => setRefresh(value => value + 1)}>{t('refresh')}</Button></Feedback>}
        {(form.kind === 'comment' || form.kind === 'task' && !form.id) && <>
          <Select label={t('anchor')} value={form.blockId} disabled={pending || form.revision !== revision} onChange={blockId => change({ blockId, quote: '' })} options={[{ value: '', label: t('wholeEntry') }, ...(form.revision === revision ? blocks : form.blockId ? [{ value: form.blockId, label: form.blockId }] : [])]} />
          {form.blockId && <Field label={t('quote')} description={t('quoteHint')}>{control => <Textarea {...control} value={form.quote} maxLength={2000} disabled={pending} onChange={event => change({ quote: event.target.value })} />}</Field>}
        </>}
        {form.kind === 'task' ? <>
          <Field label={t('title')}>{control => <Input {...control} value={form.title} maxLength={200} disabled={pending} onChange={event => change({ title: event.target.value })} />}</Field>
          <Field label={t('description')}>{control => <Textarea {...control} value={form.description} maxLength={8000} disabled={pending} onChange={event => change({ description: event.target.value })} />}</Field>
          <Field label={t('owner')}>{control => <Input {...control} value={form.owner} maxLength={120} disabled={pending} onChange={event => change({ owner: event.target.value })} />}</Field>
          <Field label={t('deadline')}>{control => <Input {...control} type="date" value={form.deadline} disabled={pending} onChange={event => change({ deadline: event.target.value })} />}</Field>
          {form.id && <Select label={t('status')} value={form.status} options={taskOptions} disabled={pending} onChange={status => change({ status })} />}
        </> : <Field label={t(['review', 'decision'].includes(form.kind) ? 'note' : 'body')}>{control => <Textarea {...control} value={form.text} rows={4} maxLength={8000} disabled={pending} onChange={event => change({ text: event.target.value })} />}</Field>}
        {(form.kind === 'review' || form.kind === 'decision') && <>
          <p>{t('reviewer')}: <strong>{form.reviewer ?? actor}</strong></p><p className="notebook-workspace-hint">{t('reviewHint')}</p>
          <SavedRevision entryId={entryId} revision={form.revision} onLoaded={setSnapshotReady} />
        </>}
        {form.kind === 'decision' && <>
          {actor.trim() !== form.reviewer && <Feedback kind="warning">{t('ownLabel', { name: form.reviewer ?? '' })}</Feedback>}
          <label className="notebook-checkbox"><Checkbox checked={form.confirmed} disabled={pending} onCheckedChange={value => change({ confirmed: value === true })} />{t('confirm')}</label>
        </>}
      </div>
    </Dialog>}
    {snapshot !== null && <Dialog title={t('viewSource')} closeLabel={t('close')} onClose={() => setSnapshot(null)} size="lg"><SavedRevision entryId={entryId} revision={snapshot} /></Dialog>}
  </div>;
}
