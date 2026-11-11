import { EntryIdentity } from './entry-identity';
import { EntryMentionDialog } from './entry-mention-dialog';
import { EntryNotices } from './entry-notices';
import { EntryWorkspaceActions } from './entry-workspace-actions';
import { messages as notebookMessages } from './messages';
import { NamedReferenceTools, NotebookReplacementTools, NotebookStatusBar } from './notebook-reference-controls';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ProcedureRichEditor, ProcedureStepEditor, ProcedureTimerView } from './procedure-step-editor';
import { ProcedureParameters } from './procedure-parameters';
import { NOTEBOOK_OPEN_TARGET_EVENT } from './notebook-context';
import { ProcedureMaterials } from './procedure-materials';
import { ReviewerPanel } from './review-panel';
import type { Editor } from '@tiptap/core';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { writeWorkbook } from '@pero/notebook/workbook';
import { worksheetBlocks } from './worksheet-model';
import { Badge, Button, Checkbox, Dialog, EmptyState, Feedback, Field, Icon, IconButton, Input, SearchField, Select, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import type { NotebookDocument } from '@pero/notebook';
import { changeMetadata, changeProcedures, notebookLinkHash, parseNotebookLink, notebookTarget, procedureKinds, procedurePlannedMinutes, notebookMarkdown, notebookRelevantItems, notebookSearchItems, searchNotebook, workspaceLimits,
  type MetadataChange, type NotebookMetadata, type NotebookProcedure, type NotebookProcedureStep, type ProcedureChange } from '@pero/notebook/workspace';

const messages = {
  namedReference: { en: 'Named reference', zh: '命名引用' }, authored: { en: 'Human-authored entry', zh: '手写条目' },
  parameter: { en: 'Parameter', zh: '参数' },
  procedure: { en: 'Procedure', zh: '流程' }, material: { en: 'Material', zh: '材料' },
  copyLink: { en: 'Copy link', zh: '复制链接' }, copied: { en: 'Link copied', zh: '链接已复制' }, copyFailed: { en: 'Could not copy the link. Check clipboard access and try again.', zh: '无法复制链接，请检查剪贴板访问后重试。' },
  header: { en: 'Header', zh: '标题' }, description: { en: 'Description', zh: '说明' }, image: { en: 'Image', zh: '图片' }, table: { en: 'Table', zh: '表格' }, timer: { en: 'Timer', zh: '计时器' },
  stepKind: { en: 'Step kind', zh: '步骤类型' }, plannedTotal: { en: 'Total planned: {minutes} minutes', zh: '计划总时长：{minutes} 分钟' },
  review: { en: 'Review and activity', zh: '审阅与活动' },
  views: { en: 'Notebook views', zh: '笔记视图' },
  notes: { en: 'Notes', zh: '笔记' }, procedures: { en: 'Procedures', zh: '实验步骤' },
  relevant: { en: 'Relevant items', zh: '相关条目' }, metadata: { en: 'Metadata', zh: '元数据' },
  search: { en: 'Search and outline', zh: '搜索与大纲' }, searchLabel: { en: 'Search notebook content', zh: '搜索笔记内容' },
  searchHint: { en: 'Search Notes, procedure introductions, materials, steps, worksheet cells and reference identities. Leave empty for the outline.', zh: '可搜索笔记、流程简介、材料、步骤、单元格和引用身份。留空显示大纲。' },
  noMatches: { en: 'No matching blocks', zh: '没有匹配的内容块' }, noOutline: { en: 'No outline entries yet', zh: '暂无大纲条目' },
  noOutlineHint: { en: 'Add headings, sections or research blocks in Notes.', zh: '在笔记中添加标题、章节或科研块。' },
  resultCount: { en: '{count} blocks', zh: '{count} 个内容块' }, resultLimit: { en: 'Showing the first 100 matches. Refine your search to see others.', zh: '显示前 100 个匹配项，可缩小搜索范围查看其他结果。' },
  unavailable: { en: 'This block is no longer in the document.', zh: '此内容块已不在文档中。' },
  close: { en: 'Close', zh: '关闭' },   tools: { en: 'Notebook tools', zh: '笔记工具' },
  file: { en: 'File', zh: '文件' }, edit: { en: 'Edit', zh: '编辑' }, viewMenu: { en: 'View', zh: '视图' },
  insertMenu: { en: 'Insert', zh: '插入' }, helpMenu: { en: 'Help', zh: '帮助' },
  documentActions: { en: 'Replace or restore document', zh: '替换或恢复文档' },
  export: { en: 'Export current JSON', zh: '导出当前 JSON' }, print: { en: 'Print current view', zh: '打印当前视图' },
  markdown: { en: 'Export Markdown', zh: '导出 Markdown' },
  help: { en: 'Shortcuts and local limits', zh: '快捷键与本地限制' },
  keyboardShortcuts: { en: 'Keyboard shortcuts', zh: '快捷键' },
  exportHint: { en: 'JSON export is a snapshot of the shown document, including unsaved edits. Markdown includes raw cell inputs and recorded provenance, but omits file bytes and some formatting. Exporting and printing do not save a revision.', zh: 'JSON 导出包含当前显示的文档及未保存的更改。Markdown 包含单元格原始输入与已记录的来源，但不包含文件字节及部分格式。导出和打印不会保存修订。' },
  shortcutHint: { en: 'Ctrl/Cmd + Shift + F opens search here. Escape closes a dialog. Arrow keys move between tabs. Document undo/redo includes Notes, procedures and metadata. Dialog and review fields keep their own undo behavior.', zh: '在此处按 Ctrl/Cmd + Shift + F 打开搜索，Esc 关闭对话框，方向键切换标签页。文档撤销/重做包含笔记、步骤和元数据。对话框及审阅字段保留各自的撤销行为。' },
  limitsHint: { en: 'A notebook supports 50 procedures, 100 materials (including components, up to 4 levels) and 500 steps per procedure, and 50 tags. Planned durations are 0–10,080 minutes. Files and the complete document have separate size limits.', zh: '每本笔记最多包含 50 个流程、每个流程 100 项材料（含组分，最多 4 层）与 500 个步骤，以及 50 个标签。计划时长为 0–10,080 分钟。文件和整本文档另有大小限制。' },
  persistenceHint: { en: 'Local drafts are saved automatically and recovered after restart when storage succeeds. Use Save revision to create a permanent revision; check the draft status for storage errors.', zh: '本地草稿会自动保存，存储成功后可在重启时恢复。使用「保存修订」创建永久修订；请留意草稿状态中的存储错误。' },
  project: { en: 'Project label', zh: '项目标签' }, author: { en: 'Author label', zh: '作者标签' },
  metadataHint: { en: 'These are display labels only. They do not link a Host project, change membership, or verify the author’s identity.', zh: '这些仅为显示标签，不会关联 Host 项目、变更成员权限或验证作者身份。' },
  tags: { en: 'Tags', zh: '标签' }, tag: { en: 'New tag', zh: '新标签' }, addTag: { en: 'Add tag', zh: '添加标签' },
  removeTag: { en: 'Remove tag {name}', zh: '移除标签 {name}' }, noTags: { en: 'No tags', zh: '暂无标签' },
  duplicate: { en: 'That tag already exists.', zh: '该标签已存在。' }, invalid: { en: 'Check the field value and its stated limit.', zh: '请检查字段值及其限制。' },
  stale: { en: 'This parameter changed. Reopen it and review the latest version.', zh: '此参数已更改，请重新打开并审阅最新版本。' },
  limit: { en: 'This list has reached its size limit.', zh: '此列表已达到数量上限。' },
  procedureHint: { en: 'Write methods and record completion manually. Critical and pause flags are annotations. Timers measure manually started wall-clock time, not equipment execution.', zh: '编写方法并手动记录完成情况。「关键」与「暂停点」是注释。计时器测量手动开始的墙钟时长，不代表设备执行。' },
  addProcedure: { en: 'Add procedure', zh: '添加流程' }, newProcedure: { en: 'Untitled procedure', zh: '未命名流程' },
  chooseProcedure: { en: 'Choose procedure', zh: '选择流程' }, procedureTitle: { en: 'Procedure title', zh: '流程标题' },
  introduction: { en: 'Introduction', zh: '简介' }, removeProcedure: { en: 'Remove procedure', zh: '移除流程' },
  removeProcedureHint: { en: 'Remove this procedure and its materials and steps from the current draft? Existing saved revisions remain unchanged.', zh: '从当前草稿中移除此流程及其材料和步骤？已保存的修订不受影响。' },
  cancel: { en: 'Cancel', zh: '取消' }, noProcedures: { en: 'No procedures yet', zh: '暂无流程' },
  noProceduresHint: { en: 'Add a procedure to record materials and step-by-step instructions.', zh: '添加流程以记录材料和逐步操作说明。' },
  materials: { en: 'Materials', zh: '材料' }, addMaterial: { en: 'Add material', zh: '添加材料' },
  materialName: { en: 'Material {number}', zh: '材料 {number}' }, quantity: { en: 'Quantity {number}', zh: '用量 {number}' },
  removeMaterial: { en: 'Remove material {number}', zh: '移除材料 {number}' }, noMaterials: { en: 'No materials recorded', zh: '未记录材料' },
  steps: { en: 'Steps', zh: '步骤' }, addStep: { en: 'Add step', zh: '添加步骤' },
  stepText: { en: 'Step text {number}', zh: '步骤内容 {number}' }, stepLevel: { en: 'Step level {number}', zh: '步骤层级 {number}' },
  step: { en: 'Step', zh: '步骤' }, section: { en: 'Section', zh: '章节' }, substep: { en: 'Substep', zh: '子步骤' },
  critical: { en: 'Critical', zh: '关键' }, pause: { en: 'Pause point', zh: '暂停点' }, completed: { en: 'Completed (manual)', zh: '已完成（手动记录）' },
  completedCount: { en: '{done} of {total} checked', zh: '{done}/{total} 项已勾选' },
  duration: { en: 'Planned minutes {number}', zh: '计划分钟数 {number}' },
  durationLimit: { en: 'Enter 0–10,080 minutes, or leave blank.', zh: '请输入 0–10,080 分钟，或留空。' },
  removeStep: { en: 'Remove step {number}', zh: '移除步骤 {number}' },
  up: { en: 'Move step {number} up', zh: '向上移动步骤 {number}' }, down: { en: 'Move step {number} down', zh: '向下移动步骤 {number}' },
  noSteps: { en: 'No steps recorded', zh: '未记录步骤' },
  relevantHint: { en: 'These items come from actual blocks in Notes. A pinned identity records a version; it is not owner verification.', zh: '这些条目来自笔记中的实际内容块。固定身份仅表示已记录版本，不代表来源应用已验证。' },
  noRelevant: { en: 'No relevant items yet', zh: '暂无相关条目' },
  noRelevantHint: { en: 'Add a named entry reference here, or insert scientific evidence, an experiment reference or an attachment in Notes.', zh: '可在此添加命名条目引用，或在笔记中插入科学证据、实验引用或附件。' },
  evidence: { en: 'Evidence', zh: '证据' }, experiment: { en: 'Experiment reference', zh: '实验引用' }, attachment: { en: 'Attachment', zh: '附件' },
  spreadsheet: { en: 'Spreadsheet', zh: '电子表格' }, finding: { en: 'Finding', zh: '研究发现' },
  paragraph: { en: 'Paragraph', zh: '段落' }, heading: { en: 'Heading', zh: '标题' }, codeBlock: { en: 'Code block', zh: '代码块' },
  missing: { en: 'No source', zh: '无来源' }, partial: { en: 'Incomplete source', zh: '来源不完整' },
  unpinned: { en: 'Unpinned reference', zh: '未固定版本' }, pinned: { en: 'Pinned reference', zh: '已固定版本' },
  embedded: { en: 'Embedded file snapshot', zh: '内嵌文件快照' }, imported: { en: 'Imported snapshot', zh: '已导入快照' },
  goToBlock: { en: 'Open block in Notes', zh: '在笔记中打开内容块' },
} as const;
type MessageKey = keyof typeof messages;

/** Route history only from controls that edit the document, never local forms. */
export function documentHistoryShortcut(event: {
  target: EventTarget | null; key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
}): 'undo' | 'redo' | null {
  const target = event.target;
  if (!(target instanceof Element) || target.closest('[role="dialog"], [role="alertdialog"]')
    || !target.closest('[data-notebook-document-edit], .notebook-editor')
    || !(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  return key === 'z' || key === 'y' ? event.shiftKey || key === 'y' ? 'redo' : 'undo' : null;
}

function MetadataView({ metadata, readonly, onChange }: {
  metadata: NotebookMetadata; readonly: boolean; onChange: (metadata: NotebookMetadata) => void;
}) {
  const { t } = useAppI18n(messages);
  const [tag, setTag] = useState(''), [error, setError] = useState('');
  const apply = (change: MetadataChange) => {
    if (readonly) return;
    const result = changeMetadata(metadata, change);
    if (result.status !== 'ok') { setError(t(result.status)); return; }
    setError(''); onChange(result.metadata);
    if (change.type === 'addTag') setTag('');
  };
  return <div className="notebook-workspace-form">
    <p className="notebook-workspace-hint">{t('metadataHint')}</p>
    {(['project', 'author'] as const).map(key => <Field key={key} label={t(key)}>{control =>
      <Input {...control} data-notebook-document-edit value={metadata[key]} readOnly={readonly} maxLength={workspaceLimits.label}
        onChange={event => apply({ type: key, value: event.target.value })} />}</Field>)}
    <section aria-label={t('tags')}>
      <h3>{t('tags')}</h3>
      <ul className="notebook-tag-list">{metadata.tags.map((value, index) => <li key={`${index}:${value}`}>
        <Badge>{value}</Badge>{!readonly && <IconButton label={t('removeTag', { name: value })}
          onClick={() => apply({ type: 'removeTag', index })}><Icon name="close" /></IconButton>}
      </li>)}</ul>
      {!metadata.tags.length && <p className="notebook-workspace-hint">{t('noTags')}</p>}
      {!readonly && <form className="notebook-workspace-actions" onSubmit={event => { event.preventDefault(); apply({ type: 'addTag', value: tag }); }}>
        <Field label={t('tag')}>{control => <Input {...control} maxLength={workspaceLimits.tagLength} value={tag} onChange={event => setTag(event.target.value)} />}</Field>
        <Button type="submit" disabled={!tag.trim() || metadata.tags.length >= workspaceLimits.tags}>{t('addTag')}</Button>
      </form>}
    </section>
    {error && <Feedback kind="error">{error}</Feedback>}
  </div>;
}

function DurationField({ minutes, number, readonly, onChange }: { minutes: number | null; number: number; readonly: boolean; onChange: (minutes: number | null) => void }) {
  const { t } = useAppI18n(messages);
  const [raw, setRaw] = useState(minutes === null ? '' : String(minutes));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setRaw(minutes === null ? '' : String(minutes)); setInvalid(false); }, [minutes]);
  return <Field label={t('duration', { number })} error={invalid ? t('durationLimit') : undefined}>{control =>
    <Input {...control} type="number" min={0} max={workspaceLimits.minutes} step="any" value={raw} readOnly={readonly}
      onChange={event => {
        const value = event.target.value; setRaw(value);
        const valid = !event.target.validity.badInput && (value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= workspaceLimits.minutes));
        setInvalid(!valid);
        if (valid) onChange(value === '' ? null : Number(value));
      }} />}</Field>;
}

function ProcedureFields({ procedure, readonly, apply, onCopyLink }: { procedure: NotebookProcedure; readonly: boolean; apply: (change: ProcedureChange) => void; onCopyLink: (id: string) => void }) {
  const { t } = useAppI18n(messages);
  const id = procedure.id;
  const editStep = (stepId: string, patch: Partial<Omit<NotebookProcedureStep, 'id'>>) => apply({ type: 'editStep', id, stepId, patch });
  return <div className="notebook-workspace-form" data-notebook-document-edit id={`notebook-target-${procedure.id}`} tabIndex={-1}>
    <Field label={t('procedureTitle')}>{control => <Input {...control} value={procedure.title} maxLength={workspaceLimits.label} readOnly={readonly}
      onChange={event => apply({ type: 'edit', id, patch: { title: event.target.value } })} />}</Field>
    <section aria-label={t('introduction')}><h3>{t('introduction')}</h3>
      <ProcedureRichEditor content={procedure.introduction} text={procedure.description} label={t('introduction')} readonly={readonly}
        onChange={introduction => apply({ type: 'edit', id, patch: { introduction } })} />
    </section>
    <ProcedureParameters procedure={procedure} readonly={readonly} apply={apply} />
    <ProcedureMaterials procedure={procedure} readonly={readonly} apply={apply} onCopyLink={onCopyLink} />
    <section aria-label={t('steps')}>
      <div className="notebook-workspace-actions"><h3>{t('steps')}</h3>
        <Badge>{t('plannedTotal', { minutes: procedurePlannedMinutes(procedure) })}</Badge>
        <Badge>{t('completedCount', { done: procedure.steps.filter(step => step.completed).length, total: procedure.steps.length })}</Badge>
        {!readonly && <Button variant="ghost" disabled={procedure.steps.length >= workspaceLimits.steps} onClick={() => apply({ type: 'addStep', id, stepId: crypto.randomUUID() })}><Icon name="plus" />{t('addStep')}</Button>}
      </div>
      {!procedure.steps.length && <p className="notebook-workspace-hint">{t('noSteps')}</p>}
      <ol className="notebook-procedure-steps">{procedure.steps.map((step, index) => <li key={step.id} id={`notebook-target-${step.id}`} tabIndex={-1} data-level={step.level} data-critical={step.critical || undefined}>
        <div className="notebook-workspace-actions"><strong>{index + 1}.</strong><Button variant="ghost" onClick={() => onCopyLink(step.id)}>{t('copyLink')}</Button>
          <Select label={t('stepLevel', { number: index + 1 })} value={step.level} disabled={readonly}
            options={(['step', 'section', 'substep'] as const).map(level => ({ value: level, label: t(level) }))}
            onChange={value => editStep(step.id, { level: value as NotebookProcedureStep['level'] })} />
          {!readonly && <>
            <IconButton label={t('up', { number: index + 1 })} disabled={index === 0} onClick={() => apply({ type: 'moveStep', id, stepId: step.id, direction: -1 })}><Icon name="up" /></IconButton>
            <IconButton label={t('down', { number: index + 1 })} disabled={index === procedure.steps.length - 1} onClick={() => apply({ type: 'moveStep', id, stepId: step.id, direction: 1 })}><Icon name="down" /></IconButton>
            <IconButton label={t('removeStep', { number: index + 1 })} onClick={() => apply({ type: 'removeStep', id, stepId: step.id })}><Icon name="close" /></IconButton>
          </>}
        </div>
        <Select label={t('stepKind')} value={step.kind ?? 'step'} disabled={readonly}
          options={procedureKinds.map(kind => ({ value: kind, label: t(kind) }))}
          onChange={kind => editStep(step.id, { kind: kind as NotebookProcedureStep['kind'], ...(kind !== 'timer' ? { timer: undefined } : {}) })} />
        <ProcedureStepEditor step={step} readonly={readonly} onChange={patch => editStep(step.id, patch)} />
        {step.kind === 'timer' && <ProcedureTimerView step={step} readonly={readonly}
          onAction={(action, now) => apply({ type: 'timer', id, stepId: step.id, action, now })} />}
        <div className="notebook-workspace-actions">
          {(['critical', 'pause', 'completed'] as const).map(key => <label key={key} className="notebook-checkbox">
            <Checkbox checked={step[key]} disabled={readonly} onCheckedChange={checked => editStep(step.id, { [key]: checked === true })} />{t(key)}
          </label>)}
          <DurationField minutes={step.minutes} number={index + 1} readonly={readonly} onChange={minutes => editStep(step.id, { minutes })} />
        </div>
      </li>)}</ol>
    </section>
  </div>;
}

function ProceduresView({ procedures, readonly, onChange, selected, setSelected, onCopyLink }: {
  procedures: NotebookProcedure[]; readonly: boolean; onChange: (procedures: NotebookProcedure[]) => void;
  selected: string; setSelected: (id: string) => void; onCopyLink: (id: string) => void;
}) {
  const { t } = useAppI18n(messages);
  const [removing, setRemoving] = useState<string | null>(null), [error, setError] = useState('');
  const procedure = procedures.find(item => item.id === selected) ?? procedures[0];
  const removingProcedure = procedures.find(item => item.id === removing);
  const apply = (change: ProcedureChange) => {
    if (readonly) return;
    const result = changeProcedures(procedures, change);
    if (result.status !== 'ok') { setError(t(result.status === 'missing' ? 'unavailable' : result.status)); return; }
    setError(''); onChange(result.procedures);
    if (change.type === 'add') setSelected(change.id);
  };
  return <>
    <p className="notebook-workspace-hint">{t('procedureHint')}</p>
    <div className="notebook-workspace-actions">
      {procedure && <Select label={t('chooseProcedure')} value={procedure.id}
        options={procedures.map(item => ({ value: item.id, label: item.title || t('newProcedure') }))} onChange={setSelected} />}
      {!readonly && <Button disabled={procedures.length >= workspaceLimits.procedures} onClick={() => apply({ type: 'add', id: crypto.randomUUID(), title: t('newProcedure') })}><Icon name="plus" />{t('addProcedure')}</Button>}
      {procedure && <Button variant="ghost" onClick={() => onCopyLink(procedure.id)}>{t('copyLink')}</Button>}
      {!readonly && procedure && <Button variant="ghost" onClick={() => setRemoving(procedure.id)}>{t('removeProcedure')}</Button>}
    </div>
    {error && <Feedback kind="error">{error}</Feedback>}
    {!procedure ? <EmptyState heading={t('noProcedures')} description={t('noProceduresHint')} /> : <ProcedureFields key={procedure.id} procedure={procedure} readonly={readonly} apply={apply} onCopyLink={onCopyLink} />}
    {!readonly && removingProcedure && <Dialog title={t('removeProcedure')} closeLabel={t('close')} onClose={() => setRemoving(null)}
      footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>{t('cancel')}</Button><Button onClick={() => { apply({ type: 'remove', id: removingProcedure.id }); setRemoving(null); }}>{t('removeProcedure')}</Button></>}>
      <p>{t('removeProcedureHint')}</p><strong>{removingProcedure.title || t('newProcedure')}</strong>
    </Dialog>}
  </>;
}

export type NotebookChrome = {
  status: string;
  onSave?: () => void;
  saveDisabled?: boolean;
  saveBusy?: boolean;
  onHistory?: () => void;
  onBack?: () => void;
  onRestore?: () => void;
  restoreDisabled?: boolean;
  snapshot?: boolean;
  fileTools?: ReactNode;
  /** Stored document used for export when the editor is showing a placeholder. */
  retainedContent?: NotebookDocument['content'];
};

export function NotebookMenu({ name, menu, children, closeOnSelect = false, caret = false, label, icon }: {
  name: string; menu: string; children: ReactNode; closeOnSelect?: boolean; caret?: boolean; label?: string; icon?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const node = ref.current;
      const target = event.target;
      if (!node?.open || !(target instanceof Node) || node.contains(target)) return;
      if (target instanceof Element && target.closest('dialog')) return;
      node.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return <details ref={ref} className="notebook-menu" data-menu={menu} data-icon={icon || undefined} onToggle={event => {
    const node = event.currentTarget;
    if (!node.open) return;
    node.ownerDocument.querySelectorAll('details.notebook-menu[open]').forEach(other => { if (other !== node) other.removeAttribute('open'); });
  }}>
    <summary>
      {label && <span className="notebook-visually-hidden">{label} </span>}
      {icon ? <><Icon name={icon} size={16} /><span className="notebook-visually-hidden">{name}</span></> : name}
      {caret && <Icon name="chevron-down" size={12} />}
    </summary>
    <div className="notebook-menu-panel" onClick={event => {
      if (!closeOnSelect || !(event.target instanceof Element) || !event.target.closest('button, [role="tab"]')) return;
      ref.current?.removeAttribute('open');
    }}>{children}</div>
  </details>;
}

export function NotebookWorkspace({ editor, entryId, revision, document, readonly, onChange, onReplaceDocument, chrome, tools, helpTools, children }: {
  editor: Editor; entryId: string; revision: number; document: NotebookDocument; readonly: boolean;
  onChange: (partial: Partial<NotebookDocument>) => void; children: ReactNode;
  chrome?: NotebookChrome; tools?: ReactNode; helpTools?: ReactNode;
  historyControls?: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  onReplaceDocument?(document: NotebookDocument): void;
}) {
  const { t } = useAppI18n(messages);
  const { t: notebook } = useAppI18n(notebookMessages);
  const [tab, setTab] = useState('notes'), [dialog, setDialog] = useState<'search' | 'help' | 'replace' | null>(null);
  const [query, setQuery] = useState(''), [pendingBlock, setPendingBlock] = useState<string | null>(null), [error, setError] = useState('');
  const navigated = useRef(false);
  const [selectedProcedure, setSelectedProcedure] = useState('');
  const [procedureTarget, setProcedureTarget] = useState<{ id: string; ownerId: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [split, setSplit] = useState(false);
  const [mention, setMention] = useState<{ name: string; note: string } | null>(null);
  const items = useMemo(() => notebookSearchItems(document.content, document.procedures), [document.content, document.procedures]);
  const relevant = useMemo(() => notebookRelevantItems(document.content), [document.content]);
  const results = useMemo(() => searchNotebook(items, query), [items, query]);
  const metadata = document.metadata ?? { project: '', author: '', tags: [] };
  const sheetCount = useEditorState({ editor, selector: ({ editor: instance }) => worksheetBlocks(instance.state.doc).length });
  const views = ['notes', 'procedures', 'relevant', 'metadata', 'review'] as const;
  const view = views.find(item => item === tab) ?? 'notes';
  const openBlock = (id: string) => {
    const target = notebookTarget(document, id);
    if (!target) { setError(t('unavailable')); return; }
    navigated.current = true; setDialog(null); setError(''); setTab(target.tab);
    if (target.tab === 'notes') { setProcedureTarget(null); setPendingBlock(id); }
    else { setPendingBlock(null); setSelectedProcedure(target.procedureId!); setProcedureTarget({ id, ownerId: target.ownerId }); }
  };
  const navigate = useRef(openBlock); navigate.current = openBlock;
  useEffect(() => {
    const element = editor.view.dom;
    const open = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id === 'string') navigate.current(id);
    };
    element.addEventListener(NOTEBOOK_OPEN_TARGET_EVENT, open);
    return () => element.removeEventListener(NOTEBOOK_OPEN_TARGET_EVENT, open);
  }, [editor]);
  useEffect(() => {
    const fromHash = () => { const target = parseNotebookLink(window.location.hash); if (target?.entryId === entryId && target.targetId) navigate.current(target.targetId); };
    fromHash(); window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [entryId]);
  const copyLink = async (id: string) => {
    const url = new URL(window.location.href); url.hash = notebookLinkHash(entryId, id);
    try { await navigator.clipboard.writeText(url.href); setNotice(t('copied')); }
    catch { setError(t('copyFailed')); }
  };
  useEffect(() => {
    if (!procedureTarget || tab !== 'procedures') return;
    let frame = 0, attempts = 0;
    const reveal = () => {
      const owner = window.document.getElementById(`notebook-target-${procedureTarget.ownerId}`);
      if (!owner) { setError(t('unavailable')); setProcedureTarget(null); return; }
      const editors = [...owner.querySelectorAll<HTMLElement>('.notebook-procedure-content')];
      if (procedureTarget.id !== procedureTarget.ownerId && editors.some(element => !element.querySelector('.tiptap')) && attempts++ < 20) { frame = requestAnimationFrame(reveal); return; }
      owner.focus(); owner.scrollIntoView({ block: 'center' });
      for (const element of editors) element.dispatchEvent(new CustomEvent('notebook-focus-rich', { detail: procedureTarget.id }));
      setProcedureTarget(null);
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [procedureTarget, tab, selectedProcedure, t]);
  useEffect(() => {
    if (!pendingBlock || tab !== 'notes' || editor.isDestroyed) return;
    let position: number | null = null;
    editor.state.doc.descendants((node, pos) => { if (node.attrs.blockId === pendingBlock) { position = pos; return false; } });
    if (position === null) { setError(t('unavailable')); setPendingBlock(null); return; }
    const pos: number = position;
    const node = editor.state.doc.nodeAt(pos)!;
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) dom.dispatchEvent(new CustomEvent('notebook-reveal', { bubbles: true }));
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const selection = NodeSelection.isSelectable(node) ? NodeSelection.create(editor.state.doc, pos) : Selection.near(editor.state.doc.resolve(pos));
      editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
      editor.view.focus();
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'center' });
      setPendingBlock(null); setError('');
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingBlock, tab, editor, t]);
  const openSearch = () => { navigated.current = false; setDialog('search'); };
  const exportContent = () => chrome?.retainedContent ?? editor.getJSON() as NotebookDocument['content'];
  const downloadJson = () => downloadFile('Notebook.json', JSON.stringify({ ...document, content: exportContent() }, null, 2), 'application/json');
  const protocolPane = <ProceduresView procedures={document.procedures ?? []} readonly={readonly} selected={selectedProcedure} setSelected={setSelectedProcedure} onCopyLink={id => void copyLink(id)} onChange={procedures => onChange({ procedures })} />;
  return <Tabs className="notebook-workspace" data-notebook-entry-id={entryId} data-notebook-view={view} value={tab} onValueChange={setTab} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); openSearch(); }
  }}>
    <div className="notebook-jupyter">
      <div className="notebook-command-row">
      {chrome?.snapshot ? <div className="notebook-toolbar-end">
        <Button variant="ghost" onClick={chrome.onBack}>{notebook('backToDraft')}</Button>
        <Button variant="ghost" disabled={chrome.restoreDisabled} onClick={chrome.onRestore}>{notebook('restoreDraft')}</Button>
      </div> : tools}
        <TabsList className="notebook-view-tabs" aria-label={t('views')} variant="navigation">
          <NotebookMenu name={t('viewMenu')} menu="view" icon="chevron-down">
            {views.map(value => <TabsTrigger key={value} value={value} {...(value === 'notes' ? { 'data-view': 'notes', 'aria-label': t('notes') } : {})}>{t(value)}</TabsTrigger>)}
            <EntryWorkspaceActions readonly={readonly} split={split} procedures={document.procedures ?? []}
              onToggleSplit={() => setSplit(value => !value)}
              onAdded={(procedures, id) => { onChange({ procedures }); setSelectedProcedure(id); setSplit(true); setError(''); }}
              onError={setError} onMention={() => setMention({ name: '', note: '' })} />
          </NotebookMenu>
        </TabsList>
      </div>
      <div className="notebook-diagnostics-host" />
    </div>
    {error && <Feedback kind="error">{error}</Feedback>}
    {notice && <Feedback kind="success">{notice}</Feedback>}
    <TabsContent className="notebook-notes-panel" value="notes" forceMount data-split={split || undefined}>
      <div className="notebook-notes-main">
      <div className="notebook-entry-head">
        <div className="notebook-entry-title">
          <Icon size={26} glyph={{ viewBox: '0 0 24 24', children: <>
            <path fill="currentColor" stroke="none" d="M5 0.6h9.2v6.2H20.4V21.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V2.6A2 2 0 0 1 5 .6z" />
            <path fill="currentColor" stroke="none" d="M15 0.8 20.2 6.2H15z" />
          </> }} />
          {readonly ? <h1 className="notebook-title">{document.title}</h1> : <Input unstyled data-notebook-document-edit className="notebook-title" aria-label={notebook('title')} placeholder={notebook('untitled')}
            value={document.title} maxLength={200} onChange={event => onChange({ title: event.target.value })} />}
          <EntryIdentity entryId={entryId} stored={document.identity} readonly={readonly} onChange={onChange} />
        </div>
      </div>
      {children}
      </div>
      {split && tab === 'notes' && <aside className="notebook-split-pane" aria-label={t('procedures')}>{protocolPane}</aside>}
    </TabsContent>
    <TabsContent className="notebook-workspace-panel" value="procedures" forceMount>
      {split && tab === 'notes' ? null : protocolPane}
    </TabsContent>
    <TabsContent className="notebook-workspace-panel" value="relevant" forceMount>
      <p className="notebook-workspace-hint">{t('relevantHint')}</p>
      {!readonly && <NamedReferenceTools onInsert={nodes => { editor.commands.insertContentAt(editor.state.doc.content.size, [...nodes, { type: 'paragraph' }]); }} />}
      {!relevant.length && <EmptyState heading={t('noRelevant')} description={t('noRelevantHint')} />}
      <ul className="notebook-relevant-list">{relevant.map(item => <li key={item.id}>
        <div className="notebook-workspace-actions"><strong>{item.label || t(item.kind)}</strong><Badge>{t(item.kind)}</Badge><Badge>{t(item.state)}</Badge>{item.imported && <Badge>{t('imported')}</Badge>}</div>
        {item.notes && <p>{item.notes}</p>}
        {item.source && <p className="notebook-workspace-hint">{[item.source.app, item.source.kind, item.source.id, item.source.version].filter(Boolean).join(' · ')}</p>}
        <Button variant="ghost" onClick={() => openBlock(item.id)}>{t('goToBlock')}</Button>
      </li>)}</ul>
    </TabsContent>
    <TabsContent className="notebook-workspace-panel" value="metadata" forceMount>
      <MetadataView metadata={metadata} readonly={readonly} onChange={value => onChange({ metadata: value })} />
    </TabsContent>
    <TabsContent className="notebook-workspace-panel" value="review">
      <EntryNotices notices={document.notices ?? []} />
      <ReviewerPanel entryId={entryId} revision={revision} document={document} readonly={readonly} onRevealBlock={openBlock} />
    </TabsContent>
    {mention && <EntryMentionDialog draft={mention} notices={document.notices ?? []} editor={editor}
      onDraft={setMention} onClose={() => setMention(null)}
      onSaved={notices => { onChange({ notices }); setError(''); }} onInvalid={setError} />}
    <div className="notebook-statusbar">
      <NotebookStatusBar editor={editor} variant="output" />
      <Button variant="ghost" onClick={() => window.document.dispatchEvent(new CustomEvent('pero:notebook-shortcuts'))}>{t('keyboardShortcuts')}</Button>
      <div className="notebook-view-actions">
        {chrome && <span className="notebook-status" role="status">{chrome.status}</span>}
        {chrome?.onSave && <IconButton className="notebook-save" label={notebook('save')} busy={chrome.saveBusy} disabled={chrome.saveDisabled} onClick={chrome.onSave}><Icon name="save" /></IconButton>}
        <IconButton label={t('search')} onClick={openSearch}><Icon name="search" /></IconButton>
        <NotebookMenu name={t('file')} menu="file" icon="more">
          {!chrome?.snapshot && chrome?.onHistory && <Button variant="ghost" onClick={event => { chrome.onHistory?.(); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{notebook('history')}</Button>}
          {chrome?.fileTools}
          {!readonly && onReplaceDocument && <Button variant="ghost" onClick={() => setDialog('replace')}>{t('documentActions')}</Button>}
          <div className="notebook-menu-rule" role="separator" />
          <Button variant="ghost" onClick={downloadJson}>{t('export')}</Button>
          <Button variant="ghost" onClick={() => downloadFile('Notebook.md', notebookMarkdown({ ...document, content: exportContent() }), 'text/markdown;charset=utf-8')}>{t('markdown')}</Button>
          {sheetCount > 0 && <Button variant="ghost" onClick={() => void writeWorkbook(worksheetBlocks(editor.state.doc)).then(body => downloadFile('Notebook.xlsx', body, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))}>{notebook('exportWorkbook')}</Button>}
        </NotebookMenu>
        <NotebookMenu name={t('helpMenu')} menu="help" icon="info">
          <Button variant="ghost" onClick={() => setDialog('help')}>{t('help')}</Button>
          {helpTools}
        </NotebookMenu>
      </div>
    </div>
    {dialog === 'search' && <Dialog title={t('search')} closeLabel={t('close')} size="lg" onClose={() => setDialog(null)} restoreFocus={!navigated.current}>
      <Field label={t('searchLabel')} description={t('searchHint')}>{control => <SearchField {...control} value={query} onChange={event => setQuery(event.target.value)} />}</Field>
      <p className="notebook-workspace-hint" role="status">{t('resultCount', { count: results.length })}</p>
      {!results.length && <EmptyState heading={t(query.trim() ? 'noMatches' : 'noOutline')} description={query.trim() ? undefined : t('noOutlineHint')} />}
      <ul className="notebook-search-results">{results.slice(0, 100).map(item => <li key={item.id} data-nested={item.depth > 0 || undefined}>
        <Button variant="ghost" onClick={() => openBlock(item.id)}>
          <span><strong>{item.label.trim().slice(0, 160) || t(item.kind as MessageKey)}</strong><small>{t(item.kind as MessageKey)}</small>
            {query.trim() && <span className="notebook-search-excerpt">{item.text.slice(Math.max(0, item.text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) - 40), Math.max(0, item.text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) - 40) + 220)}</span>}
          </span>
        </Button><Button variant="ghost" onClick={() => void copyLink(item.id)}>{t('copyLink')}</Button>
      </li>)}</ul>
      {results.length > 100 && <p className="notebook-workspace-hint">{t('resultLimit')}</p>}
    </Dialog>}
    {dialog === 'replace' && onReplaceDocument && <Dialog title={t('documentActions')} closeLabel={t('close')} onClose={() => setDialog(null)}>
      <div className="notebook-document-actions">
        <NotebookReplacementTools layout="menu" getDocument={() => ({ ...document, content: editor.getJSON() as NotebookDocument['content'] })} onReplace={onReplaceDocument} />
      </div>
    </Dialog>}
    {dialog === 'help' && <Dialog title={t('help')} closeLabel={t('close')} onClose={() => setDialog(null)}>
      <p>{t('shortcutHint')}</p><p>{t('exportHint')}</p><p>{t('procedureHint')}</p><p>{t('limitsHint')}</p><p>{t('persistenceHint')}</p>
    </Dialog>}
  </Tabs>;
}
