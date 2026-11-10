import { useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, Input, NativeSelect } from '@pero/app-sdk/ui';
import { bindCatalogSelection, catalogBoxes, type SampleIntake } from '@pero/notebook/sample-intake';
import { isCatalogSnapshot, type CatalogSnapshot } from '@pero/notebook/structured-table';

const messages = {
  title: { en: 'Browse local samples and boxes', zh: '浏览本地样品与存储盒' },
  search: { en: 'Search catalog', zh: '搜索目录' }, refresh: { en: 'Load catalog records', zh: '加载目录记录' }, busy: { en: 'Loading catalog…', zh: '正在加载目录…' },
  grouping: { en: 'Box / location text column', zh: '存储盒 / 位置文本字段' }, none: { en: 'All loaded samples', zh: '所有已加载样品' },
  box: { en: 'Box / location value', zh: '存储盒 / 位置值' }, choose: { en: 'Choose a box / location', zh: '选择存储盒 / 位置' },
  select: { en: 'Select catalog record', zh: '选择目录记录' }, all: { en: 'Select displayed samples', zh: '选择显示的样品' },
  empty: { en: 'No matching registered samples. Register a table or adjust the search and schema.', zh: '没有匹配的已登记样品，请登记表格或调整搜索和数据结构。' },
  missing: { en: 'No text fields with box labels in these records.', zh: '这些记录中没有带位置标签的文本字段。' },
  partial: { en: 'Showing {count} of {total} records. Narrow the search before selecting the entire group.', zh: '显示 {total} 条记录中的 {count} 条。选择整个组前请缩小搜索范围。' },
  invalid: { en: 'Invalid catalog response.', zh: '目录响应无效。' },
  query: { en: 'Loaded query: {query}', zh: '已加载查询：{query}' },
  snapshot: { en: 'Loaded {count} records from {catalog} at {time}. Selections keep these versions.', zh: '于 {time} 从 {catalog} 加载 {count} 条记录。选择后保留这些版本。' },
} as const;

export function SampleCatalogBrowser({ intake, editable, onChange }: { intake: SampleIntake; editable: boolean; onChange(intake: SampleIntake): void }) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [search, setSearch] = useState(''), [field, setField] = useState(''), [box, setBox] = useState('');
  const [loaded, setLoaded] = useState<{ schemaId: string; snapshot: CatalogSnapshot } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const snapshot = loaded?.schemaId === intake.schemaId ? loaded.snapshot : null;
  const columns = new Map<string, string>();
  for (const record of snapshot?.records ?? []) for (const column of record.columns) if (column.type === 'text') columns.set(column.id, column.name);
  const boxes = snapshot && field ? catalogBoxes(snapshot, field) : [];
  const records = snapshot ? field ? boxes.find(group => group.label === box)?.records ?? [] : snapshot.records : [];
  const selected = (id: string) => intake.bindings.some(binding => binding.snapshot.catalogId === snapshot?.catalogId && binding.snapshot.records[0].id === id && !binding.source.well);
  const available = records.filter(record => !selected(record.id));
  async function load() {
    setBusy(true); setError('');
    try {
      const response = await api.get<unknown>(`/api/catalog/lookup?${new URLSearchParams({ schemaId: intake.schemaId, text: search, limit: '200' })}`);
      if (!isCatalogSnapshot(response)) throw new Error(t('invalid'));
      setLoaded({ schemaId: intake.schemaId, snapshot: response }); setField(''); setBox('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  function select(ids: string[]) {
    if (!snapshot) return;
    try { onChange(bindCatalogSelection(intake, snapshot, ids)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <details><summary>{t('title')}</summary>
    <Input aria-label={t('search')} value={search} maxLength={200} disabled={busy} onChange={event => setSearch(event.target.value)} />
    <Button variant="ghost" disabled={busy} onClick={() => void load()}>{t(busy ? 'busy' : 'refresh')}</Button>
    {error && <Feedback kind="error">{error}</Feedback>}
    {snapshot && <>
      <p>{t('query', { query: JSON.stringify(snapshot.query) })}</p>
      <p>{t('snapshot', { count: snapshot.records.length, catalog: snapshot.catalogId, time: snapshot.refreshedAt })}</p>
      {snapshot.total > snapshot.records.length && <Feedback kind="warning">{t('partial', { count: snapshot.records.length, total: snapshot.total })}</Feedback>}
      {!snapshot.records.length ? <p>{t('empty')}</p> : <>
        <Field label={t('grouping')}>{control => <NativeSelect {...control} value={field} onChange={event => { setField(event.target.value); setBox(''); }}>
          <option value="">{t('none')}</option>{[...columns].map(([id, name]) => <option key={id} value={id}>{name} ({id})</option>)}
        </NativeSelect>}</Field>
        {field && <Field label={t('box')}>{control => <NativeSelect {...control} value={box} onChange={event => setBox(event.target.value)}>
          <option value="">{t('choose')}</option>{boxes.map(group => <option key={group.label} value={group.label}>{group.label} ({group.records.length})</option>)}
        </NativeSelect>}</Field>}
        {field && !boxes.length && <p>{t('missing')}</p>}
        <Button variant="ghost" disabled={!editable || busy || !available.length || snapshot.total > snapshot.records.length} onClick={() => select(available.map(record => record.id))}>{t('all')}</Button>
        <ul>{records.map(record => <li key={record.id}>{record.name} / {record.id} / v{record.version}
          <Button variant="ghost" disabled={!editable || busy || selected(record.id)} onClick={() => select([record.id])}>{t('select')}</Button></li>)}</ul>
      </>}
    </>}
  </details>;
}
