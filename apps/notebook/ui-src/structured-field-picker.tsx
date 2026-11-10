import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback, Field, Input, NativeSelect } from '@pero/app-sdk/ui';
import { catalogCellValue, isCatalogSnapshot, type CatalogCellSelection, type CatalogSnapshot, type StructuredColumn } from '@pero/notebook/structured-table';

const messages = {
  title: { en: 'Choose catalog value for {cell}', zh: '为 {cell} 选择目录值' },
  scope: { en: 'Choose one registered local record, then a pinned reference or a compatible source field. Only this cell changes. Values are copied from the displayed version, with no implicit unit conversion or live link.', zh: '选择一条已登记的本地记录，再选择固定引用或兼容的来源字段。仅更改此单元格。值复制自显示的版本，不自动换算单位，也不是实时链接。' },
  schema: { en: 'Catalog schema filter', zh: '目录结构筛选' }, search: { en: 'Catalog text filter', zh: '目录文本筛选' },
  load: { en: 'Load matching records', zh: '加载匹配记录' }, loading: { en: 'Loading records…', zh: '正在加载记录…' },
  record: { en: 'Catalog record', zh: '目录记录' }, choose: { en: 'Choose a record', zh: '选择记录' },
  field: { en: 'Value to insert', zh: '要插入的值' }, chooseField: { en: 'Choose a source field', zh: '选择来源字段' },
  reference: { en: 'Pinned catalog / record / version reference', zh: '固定目录 / 记录 / 版本引用' },
  loaded: { en: '{count} of {total} records from {catalog}, observed {time}.', zh: '来自 {catalog} 的 {total} 条记录中的 {count} 条，观察时间为 {time}。' },
  partial: { en: 'More records match. Narrow the filters to find a record not shown.', zh: '还有更多匹配记录，请缩小筛选范围以查找未显示的记录。' },
  empty: { en: 'No matching active records. Register a table or change the filters.', zh: '没有匹配的有效记录。请登记表格或更改筛选条件。' },
  preview: { en: 'Cell preview', zh: '单元格预览' }, apply: { en: 'Apply selected value', zh: '应用所选值' },
  cancel: { en: 'Cancel', zh: '取消' }, close: { en: 'Close', zh: '关闭' },
  invalid: { en: 'The catalog response does not match this query.', zh: '目录响应与此查询不符。' },
  readonly: { en: 'The notebook is now read-only. Close this picker without changing the cell.', zh: '笔记现为只读，请关闭选择器，不更改单元格。' },
  unit: { en: '{cell} unit', zh: '{cell} 单位' }, unitEmpty: { en: 'Choose an allowed unit', zh: '选择允许的单位' },
} as const;

/** A raw draft remains editable even after its configured unit was removed. */
export function QuantityCellEditor({ column, raw, label, disabled, invalid, onChange }: {
  column: StructuredColumn; raw: string; label: string; disabled: boolean; invalid: boolean; onChange(value: string): void;
}) {
  const { t } = useAppI18n(messages);
  const trimmed = raw.trim(), unitOnly = /^\s/.test(raw) && column.units.includes(trimmed);
  const parts = /^(\S+)\s+(.+)$/.exec(trimmed);
  const amount = unitOnly ? '' : parts ? parts[1] : trimmed;
  const unit = unitOnly ? trimmed : parts ? parts[2] : trimmed ? '' : column.units[0] ?? '';
  const units = unit && !column.units.includes(unit) ? [unit, ...column.units] : column.units;
  return <>
    <Input aria-label={label} readOnly={disabled} value={amount} maxLength={Math.max(0, 4095 - unit.length)} aria-invalid={invalid} placeholder="2.5"
      onChange={event => onChange(event.target.value ? `${event.target.value} ${unit}` : '')} />
    <NativeSelect aria-label={t('unit', { cell: label })} disabled={disabled} value={unit} aria-invalid={invalid}
      onChange={event => onChange(`${amount} ${event.target.value}`)}>
      {!unit && <option value="">{t('unitEmpty')}</option>}{units.map(value => <option key={value} value={value}>{value}</option>)}
    </NativeSelect>
  </>;
}

export function CatalogCellPicker({ column, label, editable, onApply, onClose }: {
  column: StructuredColumn; label: string; editable: boolean;
  onApply(snapshot: CatalogSnapshot, recordId: string, selection: CatalogCellSelection): void;
  onClose(): void;
}) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [schema, setSchema] = useState(''), [search, setSearch] = useState('');
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null), [recordId, setRecordId] = useState(''), [field, setField] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  const cancel = () => { request.current++; onClose(); };
  const clear = () => { request.current++; setBusy(false); setSnapshot(null); setRecordId(''); setField(''); setError(''); };
  const record = snapshot?.records.find(record => record.id === recordId);
  const selection: CatalogCellSelection = field === 'reference' ? { type: 'reference' } : { type: 'field', columnId: field.slice(6) };
  let preview: string | null = null, issue = '';
  if (snapshot && record && field) {
    try { preview = catalogCellValue(column, snapshot, record.id, selection); }
    catch (cause) { issue = cause instanceof Error ? cause.message : String(cause); }
  }
  async function load() {
    if (busy) return;
    const token = ++request.current, query = { schemaId: schema.trim(), text: search, limit: 200 };
    setBusy(true); setError('');
    try {
      const response = await api.get<unknown>(`/api/catalog/lookup?${new URLSearchParams({ ...query, limit: String(query.limit) })}`);
      if (!isCatalogSnapshot(response) || response.query.schemaId !== query.schemaId || response.query.text !== query.text || response.query.limit !== query.limit) throw new Error(t('invalid'));
      if (mounted.current && token === request.current) { setSnapshot(response); setRecordId(''); setField(''); }
    } catch (cause) { if (mounted.current && token === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current && token === request.current) setBusy(false); }
  }
  function apply() {
    if (!editable || busy || !snapshot || !record || preview === null) return;
    try { onApply(snapshot, record.id, selection); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <Dialog title={t('title', { cell: label })} closeLabel={t('close')} onClose={cancel}
    footer={<><Button variant="ghost" onClick={cancel}>{t('cancel')}</Button><Button variant="primary" disabled={!editable || busy || preview === null} onClick={apply}>{t('apply')}</Button></>}>
    <p>{t('scope')}</p>
    <Field label={t('schema')}>{control => <Input {...control} value={schema} maxLength={128} onChange={event => { clear(); setSchema(event.target.value); }} />}</Field>
    <Field label={t('search')}>{control => <Input {...control} value={search} maxLength={200} onChange={event => { clear(); setSearch(event.target.value); }} />}</Field>
    <Button disabled={busy} onClick={() => void load()}>{t(busy ? 'loading' : 'load')}</Button>
    {!editable && <Feedback kind="warning">{t('readonly')}</Feedback>}
    {error && <Feedback kind="error">{error}</Feedback>}
    {snapshot && <>
      <p>{t('loaded', { count: snapshot.records.length, total: snapshot.total, catalog: snapshot.catalogId, time: snapshot.refreshedAt })}</p>
      {snapshot.total > snapshot.records.length && <p>{t('partial')}</p>}
      {!snapshot.records.length ? <p>{t('empty')}</p> : <Field label={t('record')}>{control => <NativeSelect {...control} value={recordId} disabled={busy}
        onChange={event => { setRecordId(event.target.value); setField(column.type === 'object' ? 'reference' : ''); setError(''); }}>
        <option value="">{t('choose')}</option>{snapshot.records.map(record => <option key={record.id} value={record.id}>{record.name} · {record.id} · v{record.version}</option>)}
      </NativeSelect>}</Field>}
    </>}
    {record && <>
      <p>{record.schemaId} · v{record.schemaRevision} · {record.registeredAt}</p>
      <Field label={t('field')}>{control => <NativeSelect {...control} value={field} disabled={busy} onChange={event => { setField(event.target.value); setError(''); }}>
        <option value="">{t('chooseField')}</option>{column.type === 'object' && <option value="reference">{t('reference')}</option>}
        {record.columns.filter(source => source.type === column.type).map(source => <option key={source.id} value={`field:${source.id}`}>{source.name} ({source.id})</option>)}
      </NativeSelect>}</Field>
      {preview !== null && <p>{t('preview')}: <code>{preview || '—'}</code></p>}
      {issue && <Feedback kind="warning">{issue}</Feedback>}
    </>}
  </Dialog>;
}
