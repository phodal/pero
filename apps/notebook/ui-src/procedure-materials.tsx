import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Dialog, Feedback, Field, Icon, IconButton, Input, SearchField } from '@pero/app-sdk/ui';
import { isCatalogSnapshot, type CatalogSnapshot } from '@pero/notebook/structured-table';
import { materialItems, workspaceLimits, type MaterialSource, type NotebookMaterial, type NotebookProcedure, type ProcedureChange } from '@pero/notebook/workspace';
import { ProcedureRichEditor } from './procedure-step-editor';

const messages = {
  materials: { en: 'Materials', zh: '材料' }, add: { en: 'Add material', zh: '添加材料' }, empty: { en: 'No materials recorded', zh: '未记录材料' },
  name: { en: 'Material {number}', zh: '材料 {number}' }, quantity: { en: 'Quantity {number}', zh: '用量 {number}' },
  notes: { en: 'Material notes {number}', zh: '材料说明 {number}' }, addNotes: { en: 'Add material notes', zh: '添加材料说明' },
  child: { en: 'Add component', zh: '添加组分' }, remove: { en: 'Remove material {number}', zh: '移除材料 {number}' },
  up: { en: 'Move material {number} up', zh: '向上移动材料 {number}' }, down: { en: 'Move material {number} down', zh: '向下移动材料 {number}' },
  select: { en: 'Select registered material', zh: '选择已登记材料' }, unlink: { en: 'Clear catalog reference', zh: '清除目录引用' },
  local: { en: 'Pinned local catalog record', zh: '已固定的本地目录记录' },
  hint: { en: 'Select an existing local registered record. This pins its catalog, record and schema version; it does not reserve stock or connect external inventory. Enter the amount needed separately.', zh: '选择已有本地登记记录，固定其目录、记录与结构版本。这不会预留库存或连接外部库存，请单独填写所需用量。' },
  search: { en: 'Search registered materials', zh: '搜索已登记材料' }, schema: { en: 'Schema ID (optional)', zh: '结构 ID（可选）' },
  find: { en: 'Find records', zh: '查找记录' }, none: { en: 'No registered records match. Register a table in Notes first, or change the search.', zh: '没有匹配的登记记录。请先在笔记中登记表格，或更改搜索条件。' },
  results: { en: 'Showing {count} of {total} records. Refine the search if needed.', zh: '显示 {total} 条记录中的 {count} 条，可缩小搜索范围。' },
  choose: { en: 'Use {name} · v{version}', zh: '使用 {name} · v{version}' }, invalid: { en: 'The catalog returned an invalid response.', zh: '目录返回了无效响应。' },
  close: { en: 'Close', zh: '关闭' }, copy: { en: 'Copy material link', zh: '复制材料链接' },
} as const;

function MaterialPicker({ onClose, onSelect }: { onClose: () => void; onSelect: (name: string, source: MaterialSource) => void }) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [query, setQuery] = useState(''), [schema, setSchema] = useState('');
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const search = async () => {
    if (busy) return;
    setBusy(true); setError(''); setSnapshot(null);
    const params = { schemaId: schema.trim(), text: query.trim(), limit: '100' };
    try {
      const value = await api.get<unknown>(`/api/catalog/lookup?${new URLSearchParams(params)}`);
      if (!isCatalogSnapshot(value) || value.query.text !== params.text || value.query.schemaId !== params.schemaId) throw new Error(t('invalid'));
      if (mounted.current) setSnapshot(value);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <Dialog title={t('select')} closeLabel={t('close')} onClose={onClose} size="lg">
    <p>{t('hint')}</p>
    <Field label={t('search')}>{control => <SearchField {...control} value={query} disabled={busy} maxLength={200} onChange={event => { setQuery(event.target.value); setSnapshot(null); }} />}</Field>
    <Field label={t('schema')}>{control => <Input {...control} value={schema} disabled={busy} maxLength={128} onChange={event => { setSchema(event.target.value); setSnapshot(null); }} />}</Field>
    <Button busy={busy} onClick={() => void search()}>{t('find')}</Button>
    {error && <Feedback kind="error">{error}</Feedback>}
    {snapshot && <><p>{t('results', { count: snapshot.records.length, total: snapshot.total })}</p>
      {!snapshot.records.length && <p>{t('none')}</p>}
      <ul className="notebook-relevant-list">{snapshot.records.map(record => <li key={`${record.id}:${record.version}`}>
        <strong>{record.name}</strong><p>{record.id} · v{record.version} · {record.schemaId} v{record.schemaRevision}</p>
        <dl>{record.columns.map(column => { const value = record.values[column.id]; return <div key={column.id}><dt>{column.name}</dt><dd>{value.type === 'missing' ? '—' : value.type === 'quantity' ? `${value.value} ${value.unit}` : value.type === 'object' ? JSON.stringify(value.value) : String(value.value)}</dd></div>; })}</dl>
        <Button onClick={() => onSelect(record.name, { source: 'notebook-local-catalog', catalogId: snapshot.catalogId, recordId: record.id,
          version: record.version, schemaId: record.schemaId, schemaRevision: record.schemaRevision })}>{t('choose', { name: record.name || record.id, version: record.version })}</Button>
      </li>)}</ul>
    </>}
  </Dialog>;
}

export function ProcedureMaterials({ procedure, readonly, apply, onCopyLink }: {
  procedure: NotebookProcedure; readonly: boolean; apply: (change: ProcedureChange) => void; onCopyLink: (id: string) => void;
}) {
  const { t } = useAppI18n(messages);
  const [selecting, setSelecting] = useState<string | null>(null);
  const all = materialItems(procedure.materials), full = all.length >= workspaceLimits.materials;
  useEffect(() => { if (readonly || !all.some(item => item.id === selecting)) setSelecting(null); }, [readonly, selecting, procedure.materials]);
  const edit = (materialId: string, patch: Partial<NotebookMaterial>) => apply({ type: 'editMaterial', id: procedure.id, materialId, patch });
  const rows = (items: NotebookMaterial[], path = '', depth = 1) => <ol className="notebook-procedure-steps">{items.map((material, index) => {
    const number = `${path}${index + 1}`;
    return <li key={material.id} id={`notebook-target-${material.id}`} tabIndex={-1} data-material-id={material.id}>
      <Field label={t('name', { number })}>{control => <Input {...control} value={material.name} readOnly={readonly} maxLength={workspaceLimits.label} onChange={event => edit(material.id, { name: event.target.value })} />}</Field>
      <Field label={t('quantity', { number })}>{control => <Input {...control} value={material.quantity} readOnly={readonly} maxLength={workspaceLimits.label} onChange={event => edit(material.id, { quantity: event.target.value })} />}</Field>
      {material.source && <p><Badge>{t('local')}</Badge> {material.source.catalogId} / {material.source.recordId} · v{material.source.version} · {material.source.schemaId} v{material.source.schemaRevision}</p>}
      <div className="notebook-workspace-actions">
        <Button variant="ghost" onClick={() => onCopyLink(material.id)}>{t('copy')}</Button>
        {!readonly && <><Button variant="ghost" onClick={() => setSelecting(material.id)}>{t('select')}</Button>
          {material.source && <Button variant="ghost" onClick={() => edit(material.id, { source: undefined })}>{t('unlink')}</Button>}
          {!material.content && <Button variant="ghost" onClick={() => edit(material.id, { content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: crypto.randomUUID() } }] } })}>{t('addNotes')}</Button>}
          <Button variant="ghost" disabled={full || depth >= workspaceLimits.materialDepth} onClick={() => apply({ type: 'addMaterial', id: procedure.id, materialId: crypto.randomUUID(), parentId: material.id })}>{t('child')}</Button>
          <IconButton label={t('up', { number })} disabled={index === 0} onClick={() => apply({ type: 'moveMaterial', id: procedure.id, materialId: material.id, direction: -1 })}><Icon name="up" /></IconButton>
          <IconButton label={t('down', { number })} disabled={index === items.length - 1} onClick={() => apply({ type: 'moveMaterial', id: procedure.id, materialId: material.id, direction: 1 })}><Icon name="down" /></IconButton>
          <IconButton label={t('remove', { number })} onClick={() => apply({ type: 'removeMaterial', id: procedure.id, materialId: material.id })}><Icon name="close" /></IconButton>
        </>}
      </div>
      {material.content && <ProcedureRichEditor content={material.content} label={t('notes', { number })} readonly={readonly} onChange={content => edit(material.id, { content })} />}
      {!!material.children?.length && rows(material.children, `${number}.`, depth + 1)}
    </li>;
  })}</ol>;
  return <section aria-label={t('materials')}>
    <div className="notebook-workspace-actions"><h3>{t('materials')}</h3>{!readonly && <Button variant="ghost" disabled={full} onClick={() => apply({ type: 'addMaterial', id: procedure.id, materialId: crypto.randomUUID() })}><Icon name="plus" />{t('add')}</Button>}</div>
    {!all.length && <p className="notebook-workspace-hint">{t('empty')}</p>}
    {rows(procedure.materials)}
    {selecting && !readonly && <MaterialPicker onClose={() => setSelecting(null)} onSelect={(name, source) => { edit(selecting, { name, source }); setSelecting(null); }} />}
  </section>;
}
