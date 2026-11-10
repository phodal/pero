import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Dialog, Feedback, Field, Input, Select } from '@pero/app-sdk/ui';
import { canonicalStructuredTable, type RegistrationReceipt, type StructuredTableDraft } from '@pero/notebook/structured-table';
import { projectTableView, type TableWorkflow, type TableViewDefinition, type TableWorkflowChange, type TableResyncResult } from '@pero/notebook/table-workflows';
import { TableSourcePanel } from './table-source';
import { CatalogArchivePanel } from './catalog-archive';
import { templateError } from './template-tools';
import { useNotebookContext } from './notebook-context';

const messages = {
  title: { en: 'Views, sources and archive', zh: '视图、来源和归档' }, close: { en: 'Close', zh: '关闭' },
  views: { en: 'Saved views', zh: '已保存视图' }, source: { en: 'Source mapping and resync', zh: '来源映射和同步' }, archive: { en: 'Archive registered results', zh: '归档已登记结果' },
  unavailable: { en: 'Open a saved Notebook entry to use table workflows.', zh: '请打开已保存的 Notebook 记录以使用表格工作流。' },
  loading: { en: 'Loading table workflows…', zh: '正在加载表格工作流…' }, reload: { en: 'Reload saved settings', zh: '重新加载已保存设置' },
  view: { en: 'View', zh: '视图' }, all: { en: 'All rows and columns', zh: '全部行和列' }, name: { en: 'View name', zh: '视图名称' }, filter: { en: 'Filter cell text', zh: '筛选单元格文本' },
  sort: { en: 'Sort by column', zh: '排序列' }, noSort: { en: 'Original row order', zh: '原始行顺序' }, descending: { en: 'Descending', zh: '降序' },
  columns: { en: 'Visible columns', zh: '显示的列' }, save: { en: 'Save view', zh: '保存视图' }, saveNew: { en: 'Save as new view', zh: '另存为新视图' }, remove: { en: 'Delete selected view', zh: '删除所选视图' },
  confirmDelete: { en: 'Confirm deleting the saved view', zh: '确认删除已保存视图' }, cancel: { en: 'Cancel', zh: '取消' },
  preview: { en: 'Preview view', zh: '预览视图' }, scope: { en: 'Views change the display only. Hidden rows and columns remain in the table and registration always uses the full table.', zh: '视图仅更改显示。隐藏的行列仍保留在表中，登记始终使用完整表格。' },
  changed: { en: 'The table changed after preview. Preview again before applying.', zh: '预览后表格已更改，请重新预览后应用。' },
};

export function TableWorkflowTools({ table, receipts, editable, onApplyTable, onViewChange, activeView }: {
  table: StructuredTableDraft; receipts: RegistrationReceipt[]; editable: boolean;
  onApplyTable(table: StructuredTableDraft): void; onViewChange(view: TableViewDefinition | null): void; activeView: TableViewDefinition | null;
}) {
  const { t } = useAppI18n(messages), context = useNotebookContext(), [open, setOpen] = useState('');
  const owner = context?.entryId ? `${context.entryId}:${table.id}:${context.readonly ? 'readonly' : 'editable'}` : '';
  const canEdit = editable && !context?.readonly;
  useEffect(() => { setOpen(''); }, [owner]);
  return <>
    <Button variant="ghost" disabled={!owner} onClick={() => setOpen(owner)}>{t('title')}</Button>
    {!owner && <p className="notebook-note">{t('unavailable')}</p>}
    {activeView && <Button variant="ghost" onClick={() => onViewChange(null)}>{t('all')}</Button>}
    {owner && open === owner && context && <TableWorkflowDialog key={owner} entryId={context.entryId} {...{ table, receipts, onApplyTable, onViewChange, activeView }} editable={canEdit} onClose={() => setOpen('')} />}
  </>;
}

function TableWorkflowDialog({ entryId, table, receipts, editable, onApplyTable, onViewChange, activeView, onClose }: {
  entryId: string; table: StructuredTableDraft; receipts: RegistrationReceipt[]; editable: boolean; onApplyTable(table: StructuredTableDraft): void;
  onViewChange(view: TableViewDefinition | null): void; activeView: TableViewDefinition | null; onClose(): void;
}) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [workflow, setWorkflow] = useState<TableWorkflow | null>(null), [tab, setTab] = useState<'views' | 'source' | 'archive'>('views');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState(false);
  const [view, setView] = useState<TableViewDefinition>(activeView ?? { id: '', name: '', columns: table.schema.columns.map(column => column.id), text: '', sortColumn: '', descending: false });
  const alive = useRef(true), pending = useRef(false), current = useRef(table); current.current = table;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await work(); } catch (cause) { if (alive.current) setError(templateError(cause)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const reload = () => run(async () => { const result = await api.get<TableWorkflow>(`/api/entries/${entryId}/table-workflows/${table.id}`); if (alive.current) setWorkflow(result); });
  useEffect(() => { void reload(); }, [api, entryId, table.id]);
  const configure = async (change: TableWorkflowChange) => {
    if (!workflow) return;
    const result = await api.post<TableWorkflow>(`/api/entries/${entryId}/table-workflows/${table.id}`, { expectedRevision: workflow.revision, table: current.current, change });
    if (alive.current) setWorkflow(result);
  };
  const apply = (result: TableResyncResult) => {
    if (!alive.current) return;
    if (!editable || result.entryId !== entryId || canonicalStructuredTable(current.current) !== canonicalStructuredTable(result.inputTable)) throw new Error(t('changed'));
    onApplyTable(result.table); setWorkflow(previous => previous && previous.revision > result.workflow.revision ? { ...previous, lastApplied: result } : { ...result.workflow, lastApplied: result });
  };
  const save = (fresh: boolean) => run(async () => {
    projectTableView(table, view);
    const next = { ...view, id: fresh || !view.id ? crypto.randomUUID() : view.id };
    await configure({ type: 'save-view', view: next });
    if (alive.current) { setView(next); onViewChange(next); }
  });
  return <Dialog title={t('title')} closeLabel={t('close')} size="lg" onClose={onClose}>
    <nav className="notebook-structured-actions">{(['views', 'source', 'archive'] as const).map(value => <Button key={value} disabled={busy} aria-pressed={tab === value} onClick={() => { setTab(value); setError(''); }}>{t(value)}</Button>)}</nav>
    {error && <Feedback kind="error">{error}<Button disabled={busy} onClick={() => void reload()}>{t('reload')}</Button></Feedback>}
    {!workflow && !error && <p role="status">{t('loading')}</p>}
    {workflow && tab === 'views' && <section>
      <p>{t('scope')}</p>
      <Select label={t('view')} value={view.id} disabled={busy} options={[{ value: '', label: t('all') }, ...workflow.views.map(item => ({ value: item.id, label: item.name }))]} onChange={id => {
        const next = workflow.views.find(item => item.id === id) ?? null; setDeleting(false);
        if (next) { setView(structuredClone(next)); try { projectTableView(table, next); onViewChange(next); setError(''); } catch (cause) { setError(templateError(cause)); } }
        else { setView({ id: '', name: '', columns: table.schema.columns.map(column => column.id), text: '', sortColumn: '', descending: false }); onViewChange(null); }
      }} />
      <Field label={t('name')}>{control => <Input {...control} maxLength={200} disabled={busy || !editable} value={view.name} onChange={event => setView({ ...view, name: event.target.value })} />}</Field>
      <Field label={t('filter')}>{control => <Input {...control} maxLength={200} disabled={busy} value={view.text} onChange={event => setView({ ...view, text: event.target.value })} />}</Field>
      <fieldset><legend>{t('columns')}</legend>{table.schema.columns.map(column => <label key={column.id}><Checkbox disabled={busy} checked={view.columns.includes(column.id)} onCheckedChange={checked => setView({ ...view, columns: checked ? [...view.columns, column.id] : view.columns.filter(id => id !== column.id) })} />{column.name}</label>)}</fieldset>
      <Select label={t('sort')} disabled={busy} value={view.sortColumn} options={[{ value: '', label: t('noSort') }, ...table.schema.columns.map(column => ({ value: column.id, label: column.name }))]} onChange={sortColumn => setView({ ...view, sortColumn })} />
      <label><Checkbox disabled={busy} checked={view.descending} onCheckedChange={value => setView({ ...view, descending: value === true })} />{t('descending')}</label>
      <div className="notebook-structured-actions">
        <Button disabled={busy || !view.columns.length} onClick={() => { try { projectTableView(table, view); onViewChange(view); setError(''); } catch (cause) { setError(templateError(cause)); } }}>{t('preview')}</Button>
        <Button disabled={!editable || !view.name.trim() || !view.columns.length} busy={busy} onClick={() => void save(false)}>{t('save')}</Button>
        {!!view.id && <><Button disabled={!editable || !view.name.trim() || !view.columns.length} busy={busy} onClick={() => void save(true)}>{t('saveNew')}</Button><Button disabled={!editable || busy} onClick={() => setDeleting(true)}>{t('remove')}</Button></>}
      </div>
      {deleting && <><p>{t('confirmDelete')}: {view.name}</p><Button disabled={busy} onClick={() => setDeleting(false)}>{t('cancel')}</Button><Button disabled={!editable} busy={busy} onClick={() => void run(async () => { await configure({ type: 'delete-view', id: view.id }); if (alive.current) { setDeleting(false); setView({ ...view, id: '' }); onViewChange(null); } })}>{t('confirmDelete')}</Button></>}
    </section>}
    {workflow && tab === 'source' && <TableSourcePanel {...{ entryId, table, workflow, editable, busy, run }} onSave={source => configure({ type: 'source', source })} onApplied={apply} />}
    {workflow && tab === 'archive' && <CatalogArchivePanel {...{ receipts, editable }} />}
  </Dialog>;
}
