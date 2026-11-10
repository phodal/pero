import { useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Feedback, Field, Input, Select } from '@pero/app-sdk/ui';
import { canonicalStructuredTable, type CatalogSnapshot, type StructuredTableDraft } from '@pero/notebook/structured-table';
import { sameTableSourcePolicy, type TableSourcePolicy, type TableWorkflow, type TableResyncPreview, type TableResyncResult } from '@pero/notebook/table-workflows';

const messages = {
  scope: { en: 'Source: Notebook local catalog. Importing changes only this table draft, never the source records or prior receipts. Manual edits and unmapped cells are preserved.', zh: '来源为 Notebook 本地目录。导入只更改此表草稿，不更改源记录或原回执；保留手动编辑及未映射单元格。' },
  schema: { en: 'Source schema ID', zh: '来源结构 ID' }, query: { en: 'Source search', zh: '来源搜索' }, inspect: { en: 'Preview source records', zh: '预览来源记录' },
  source: { en: 'Source field for {name}', zh: '{name} 的来源字段' }, none: { en: 'Not mapped', zh: '不映射' }, records: { en: '{count} of {total} catalog records', zh: '{total} 条目录记录中的 {count} 条' },
  add: { en: 'Add new source rows', zh: '添加新来源行' }, update: { en: 'Update unchanged imported cells', zh: '更新未被手动编辑的导入单元格' }, missing: { en: 'Rows no longer in source', zh: '来源中已不存在的行' },
  keep: { en: 'Keep in draft', zh: '保留在草稿中' }, remove: { en: 'Remove only unedited imported rows', zh: '仅移除未经编辑的导入行' },
  save: { en: 'Save source and resync options', zh: '保存来源和同步选项' }, preview: { en: 'Preview resync', zh: '预览重新同步' },
  confirm: { en: 'Confirm changes to draft', zh: '确认更改草稿' }, cancel: { en: 'Cancel preview', zh: '取消预览' }, disconnect: { en: 'Disconnect source; keep cells', zh: '断开来源并保留单元格' },
  saved: { en: 'Save the source configuration before previewing a resync.', zh: '预览同步之前请保存来源配置。' },
  preserved: { en: 'Preserved manual edits are shown alongside the proposed source values; they will not be overwritten.', zh: '手动编辑与提议的来源值并列显示，不会被覆盖。' },
  noChanges: { en: 'No cell changes. Confirming records the observed source versions.', zh: '没有单元格更改。确认后会记录已观察到的来源版本。' },
  changed: { en: 'The table changed after preview. Preview again before applying.', zh: '预览后表格已更改，请重新预览后应用。' },
  applied: { en: 'Resync applied to the table draft. Save the entry to keep these cells in its next revision.', zh: '同步已应用到表格草稿。请保存记录以将这些单元格保留到下一版本。' },
  recover: { en: 'Recover last confirmed resync into this unchanged draft', zh: '将上次确认的同步恢复到此未更改的草稿' },
  action: { en: 'Action', zh: '操作' }, row: { en: 'Row / column', zh: '行 / 列' }, before: { en: 'Draft value', zh: '草稿值' }, after: { en: 'Source value', zh: '来源值' },
  'add-row': { en: 'Add row', zh: '添加行' }, 'update-cell': { en: 'Update cell', zh: '更新单元格' }, 'remove-row': { en: 'Remove row', zh: '移除行' },
  'preserve-manual': { en: 'Keep manual value', zh: '保留手动值' }, 'preserve-manual-row': { en: 'Keep edited row', zh: '保留已编辑行' },
  'preserve-deleted-row': { en: 'Keep manual deletion', zh: '保留手动删除' }, 'retain-missing-source': { en: 'Keep missing source row', zh: '保留缺失来源行' },
};

export function TableSourcePanel({ entryId, table, workflow, editable, busy, run, onSave, onApplied }: {
  entryId: string; table: StructuredTableDraft; workflow: TableWorkflow; editable: boolean; busy: boolean;
  run(work: () => Promise<void>): Promise<void>;
  onSave(policy: TableSourcePolicy | null): Promise<void>;
  onApplied(result: TableResyncResult): void;
}) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [policy, setPolicy] = useState<TableSourcePolicy>(() => structuredClone(workflow.source ?? { query: { schemaId: '', text: '', limit: 200 }, mappings: [], addNew: true, updateExisting: true, missing: 'keep' }));
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null), [preview, setPreview] = useState<TableResyncPreview | null>(null), [notice, setNotice] = useState(false);
  const current = useRef(table); current.current = table;
  const dirty = !sameTableSourcePolicy(policy, workflow.source);
  const sourceFields = [...new Map((snapshot?.records ?? []).flatMap(record => record.columns.map(column => [column.id, column] as const))).values()];
  const change = (next: TableSourcePolicy) => { setPolicy(next); setPreview(null); setNotice(false); };
  const inspect = () => run(async () => {
    const params = new URLSearchParams({ schemaId: policy.query.schemaId, text: policy.query.text, limit: String(policy.query.limit) });
    setSnapshot(await api.get<CatalogSnapshot>(`/api/catalog/lookup?${params}`)); setPreview(null);
  });
  const confirm = () => run(async () => {
    if (!preview) return;
    if (preview.entryId !== entryId || canonicalStructuredTable(current.current) !== canonicalStructuredTable(preview.inputTable)) throw new Error(t('changed'));
    const result = await api.post<TableResyncResult>(`/api/entries/${entryId}/table-workflows/${table.id}/apply`, { previewId: preview.id, table: current.current });
    if (result.entryId !== entryId || canonicalStructuredTable(current.current) !== canonicalStructuredTable(result.inputTable)) throw new Error(t('changed'));
    onApplied(result); setPreview(null); setNotice(true);
  });
  return <section>
    <p>{t('scope')}</p>
    <Field label={t('schema')}>{control => <Input {...control} maxLength={128} value={policy.query.schemaId} disabled={busy || !editable} onChange={event => { change({ ...policy, query: { ...policy.query, schemaId: event.target.value } }); setSnapshot(null); }} />}</Field>
    <Field label={t('query')}>{control => <Input {...control} maxLength={200} value={policy.query.text} disabled={busy || !editable} onChange={event => { change({ ...policy, query: { ...policy.query, text: event.target.value } }); setSnapshot(null); }} />}</Field>
    <Button disabled={!policy.query.schemaId} busy={busy} onClick={() => void inspect()}>{t('inspect')}</Button>
    {snapshot && <><p>{t('records', { count: snapshot.records.length, total: snapshot.total })}</p><ul>{snapshot.records.map(record => <li key={record.id}>{record.name} · {record.id} · v{record.version}</li>)}</ul></>}
    {table.schema.columns.map(column => {
      const currentSource = policy.mappings.find(mapping => mapping.targetColumnId === column.id)?.sourceColumnId ?? '';
      const choices = sourceFields.filter(source => source.type === column.type).map(source => ({ value: source.id, label: `${source.name} (${source.type})` }));
      if (currentSource && !choices.some(choice => choice.value === currentSource)) choices.push({ value: currentSource, label: currentSource });
      return <Select key={column.id} label={t('source', { name: column.name })} value={currentSource} disabled={busy || !editable} options={[{ value: '', label: t('none') }, ...choices]}
        onChange={value => change({ ...policy, mappings: [...policy.mappings.filter(mapping => mapping.targetColumnId !== column.id), ...(value ? [{ targetColumnId: column.id, sourceColumnId: value }] : [])] })} />;
    })}
    <label><Checkbox disabled={busy || !editable} checked={policy.addNew} onCheckedChange={value => change({ ...policy, addNew: value === true })} />{t('add')}</label>
    <label><Checkbox disabled={busy || !editable} checked={policy.updateExisting} onCheckedChange={value => change({ ...policy, updateExisting: value === true })} />{t('update')}</label>
    <Select label={t('missing')} value={policy.missing} disabled={busy || !editable} options={[{ value: 'keep', label: t('keep') }, { value: 'remove-unedited', label: t('remove') }]} onChange={value => change({ ...policy, missing: value as TableSourcePolicy['missing'] })} />
    <div className="notebook-structured-actions">
      <Button disabled={!editable || !policy.query.schemaId || !policy.mappings.length || !dirty} busy={busy} onClick={() => void run(async () => { await onSave(policy); setPreview(null); })}>{t('save')}</Button>
      {workflow.source && <Button disabled={!editable} busy={busy} onClick={() => void run(async () => { await onSave(null); setPreview(null); })}>{t('disconnect')}</Button>}
      <Button disabled={!editable || dirty || !workflow.source} busy={busy} onClick={() => void run(async () => { setNotice(false); setPreview(await api.post<TableResyncPreview>(`/api/entries/${entryId}/table-workflows/${table.id}/preview`, { expectedRevision: workflow.revision, table: current.current })); })}>{t('preview')}</Button>
    </div>
    {dirty && <p>{t('saved')}</p>}
    {notice && <Feedback kind="success">{t('applied')}</Feedback>}
    {workflow.lastApplied?.entryId === entryId && canonicalStructuredTable(table) === canonicalStructuredTable(workflow.lastApplied.inputTable) && canonicalStructuredTable(table) !== canonicalStructuredTable(workflow.lastApplied.table) && <Button disabled={busy || !editable} onClick={() => { onApplied(workflow.lastApplied!); setNotice(true); }}>{t('recover')}</Button>}
    {preview && <>
      <p>{t('records', { count: preview.snapshot.records.length, total: preview.snapshot.total })} · {preview.snapshot.refreshedAt}</p><p>{t('preserved')}</p>
      {!preview.changes.length ? <p>{t('noChanges')}</p> : <div className="notebook-structured-scroll"><table className="notebook-catalog-records"><thead><tr><th>{t('action')}</th><th>{t('row')}</th><th>{t('before')}</th><th>{t('after')}</th></tr></thead><tbody>{preview.changes.map((change, index) => <tr key={index}><td>{t(change.type)}</td><td>{change.rowId} / {change.columnId}</td><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody></table></div>}
      {preview.changes.some(change => change.type === 'add-row') && <div className="notebook-structured-scroll"><table className="notebook-catalog-records"><thead><tr><th>{t('row')}</th>{table.schema.columns.map(column => <th key={column.id}>{column.name}</th>)}</tr></thead><tbody>{preview.table.rows.filter(row => !table.rows.some(current => current.id === row.id)).map(row => <tr key={row.id}><td>{row.id}</td>{table.schema.columns.map(column => <td key={column.id}>{row.cells[column.id] ?? ''}</td>)}</tr>)}</tbody></table></div>}
      <Button disabled={busy} onClick={() => setPreview(null)}>{t('cancel')}</Button><Button variant="primary" disabled={!editable} busy={busy} onClick={() => void confirm()}>{t('confirm')}</Button>
    </>}
  </section>;
}
