import { useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Feedback, FilePicker, Input, Select, Textarea } from '@pero/app-sdk/ui';
import { bindIntake, intakeModes, intakeRequests, resolveIntake, type IntakeMode, type IntakeResult, type SampleIntake } from '@pero/notebook/sample-intake';
import { isCatalogSnapshot, type StructuredTableAttributes } from '@pero/notebook/structured-table';
import { BlockFrame } from './block-frame';
const messages = {
  title: { en: 'Sample intake', zh: '样品来源选择' }, name: { en: 'Batch name', zh: '批次名称' },
  scope: { en: 'Select existing Notebook local-catalog records. No physical inventory, movement or instrument operation. Saved bindings retain the selected version and original input; imported snapshots are not owner verification.', zh: '选择 Notebook 本地目录中已有的记录。不操作物理库存、移液或仪器。保存所选版本与原始输入；导入快照不代表目录所有者核验。' },
  mode: { en: 'Input source', zh: '输入来源' }, manual: { en: 'Manual identifiers', zh: '手工标识符' }, barcode: { en: 'Keyboard barcode scanner', zh: '键盘条码扫描器' }, worklist: { en: 'Worklist', zh: '工作清单' }, table: { en: 'Structured table', zh: '结构化表格' }, plate: { en: 'Plate mapping', zh: '孔板映射' },
  field: { en: 'Exact-match field: $id or a text column ID', zh: '精确匹配字段：$id 或文本列 ID' }, schema: { en: 'Schema ID (optional)', zh: '数据结构 ID（可选）' },
  help: { en: 'One ID per line for manual/scanner/worklist. Table: header id. Plate: headers well and id. Paste TSV or choose CSV/TSV. Barcode values match the explicitly named text column, not an assumed barcode field.', zh: '手工、扫描器或工作清单每行一个 ID。表格表头为 id，孔板表头为 well 和 id。可粘贴 TSV 或选择 CSV/TSV。条码按明确指定的文本列匹配，不假定存在条码字段。' },
  input: { en: 'Source identifiers / delimited table', zh: '来源标识符 / 分隔表格' }, file: { en: 'Read local CSV/TSV (100 KB maximum)', zh: '读取本地 CSV/TSV（最多 100 KB）' },
  resolve: { en: 'Find matching records', zh: '查找匹配记录' }, busy: { en: 'Looking up records…', zh: '正在查找记录…' }, select: { en: 'Select this version', zh: '选择此版本' }, all: { en: 'Select all unique matches', zh: '选择全部唯一匹配项' }, remove: { en: 'Remove binding', zh: '移除绑定' },
  missing: { en: 'No exact match', zh: '没有精确匹配' }, unique: { en: 'Unique match (select to bind)', zh: '唯一匹配（请选择以绑定）' }, ambiguous: { en: 'Multiple exact matches: select explicitly', zh: '多个精确匹配：请明确选择' }, duplicate: { en: 'Duplicate input', zh: '重复输入' }, incomplete: { en: 'Search truncated: narrow schema/field before selecting', zh: '搜索结果被截断：请缩小数据结构或字段范围后选择' },
  notebookTable: { en: 'Use a registered table in this entry', zh: '使用当前记录中的已登记表格' }, chooseTable: { en: 'Choose a source table', zh: '选择来源表格' },
  size: { en: 'Plate size', zh: '孔板尺寸' }, saved: { en: 'Saved source bindings', zh: '已保存的来源绑定' }, empty: { en: 'No selected records yet.', zh: '尚未选择记录。' }, failed: { en: 'Lookup failed; saved bindings are retained.', zh: '查询失败，已有绑定保留。' }, invalid: { en: 'Invalid catalog response.', zh: '目录响应无效。' },
} as const;
export function SampleIntakeView(view: NodeViewProps) {
  const { t } = useAppI18n(messages), api = useAppApi();
  const intake = view.node.attrs.intake as SampleIntake, editable = view.editor.isEditable;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [resolution, setResolution] = useState<{ key: string; results: IntakeResult[] } | null>(null);
  const key = JSON.stringify([intake.mode, intake.field, intake.schemaId, intake.input, intake.fileName, intake.plateSize]);
  const results = resolution?.key === key ? resolution.results : [];
  const sourceTables: StructuredTableAttributes[] = [];
  view.editor.state.doc.descendants(node => {
    if (node.type.name === 'registrationTable' && node.attrs.receipts?.length) sourceTables.push(node.attrs as StructuredTableAttributes);
  });
  const edit = (patch: Partial<SampleIntake>) => view.updateAttributes({ intake: { ...intake, ...patch } });
  async function resolve() {
    setBusy(true); setError(''); setResolution(null);
    try {
      const requests = intakeRequests(intake), results: IntakeResult[] = [];
      const cache = new Map<string, Awaited<ReturnType<typeof api.get>>>();
      for (const [index, request] of requests.entries()) {
        const params = new URLSearchParams({ schemaId: intake.schemaId, text: JSON.stringify(request.input).slice(1, -1).slice(0, 200), limit: '200' });
        let snapshot = cache.get(request.input);
        if (!snapshot) { snapshot = await api.get<unknown>(`/api/catalog/lookup?${params}`); cache.set(request.input, snapshot); }
        if (!isCatalogSnapshot(snapshot)) throw new Error(t('invalid'));
        results.push(resolveIntake(request, snapshot, intake.field, requests.slice(0, index)));
      }
      setResolution({ key, results });
    } catch (err) { setError(err instanceof Error ? err.message : t('failed')); }
    finally { setBusy(false); }
  }
  function select(chosen: { result: IntakeResult; id: string }[]) {
    try { let next = intake; for (const item of chosen) next = bindIntake(next, item.result, item.id); view.updateAttributes({ intake: next }); setError(''); }
    catch (err) { setError(String(err instanceof Error ? err.message : err)); }
  }
  return <BlockFrame view={view} kind="sampleIntake" title={<strong>{t('title')}</strong>} caption={<Badge>{intake.bindings.length}</Badge>}>
    <p>{t('scope')}</p>
    <Input aria-label={t('name')} placeholder={t('name')} value={intake.name} maxLength={200} readOnly={!editable} onChange={e => edit({ name: e.target.value })} />
    <Select label={t('mode')} value={intake.mode} disabled={!editable || busy} options={intakeModes.map(mode => ({ value: mode, label: t(mode) }))} onChange={mode => edit({ mode: mode as IntakeMode, fileName: '' })} />
    <label>{t('field')}<Input value={intake.field} disabled={!editable || busy} maxLength={128} onChange={e => { if (/^[A-Za-z0-9_-]*$/.test(e.target.value) || e.target.value === '$id') edit({ field: e.target.value || '$id' }); }} /></label>
    <label>{t('schema')}<Input value={intake.schemaId} disabled={!editable || busy} maxLength={128} onChange={e => { if (/^[A-Za-z0-9_-]*$/.test(e.target.value)) edit({ schemaId: e.target.value }); }} /></label>
    {intake.mode === 'plate' && <Select label={t('size')} value={`${intake.plateSize.rows}x${intake.plateSize.columns}`} disabled={!editable || busy || intake.bindings.some(b => b.source.well)} options={[['8x12', '96 (8 × 12)'], ['16x24', '384 (16 × 24)'], ['4x6', '24 (4 × 6)']].map(([value, label]) => ({ value, label }))} onChange={v => { const [rows, columns] = v.split('x').map(Number); edit({ plateSize: { rows, columns } }); }} />}
    {sourceTables.length > 0 && <Select label={t('notebookTable')} value="" disabled={!editable || busy} options={[{ value: '', label: t('chooseTable') }, ...sourceTables.map((source, index) => ({ value: String(index), label: source.table.name || source.table.id }))]} onChange={value => {
      if (value === '') return;
      const source = sourceTables[Number(value)], receipt = source.receipts[source.receipts.length - 1];
      edit({ mode: 'table', field: '$id', schemaId: receipt.schemaId, input: 'id\n' + receipt.records.map(record => record.recordId).join('\n'), fileName: `Notebook table ${source.table.id}` });
    }} />}
    <p>{t('help')}</p>
    <Textarea aria-label={t('input')} value={intake.input} maxLength={100000} disabled={!editable || busy} onChange={e => edit({ input: e.target.value })} />
    <FilePicker label={t('file')} emptyLabel="CSV / TSV" accept=".csv,.tsv" disabled={!editable || busy} onFile={async file => {
      if (file.size > 100000 || !/\.(csv|tsv)$/i.test(file.name) || file.name.length > 200) { setError(t('file')); return; }
      setBusy(true);
      try { const input = await file.text(); edit({ input, fileName: file.name, mode: intake.mode === 'plate' ? 'plate' : 'table' }); setError(''); } catch { setError(t('file')); } finally { setBusy(false); }
    }} />
    {intake.fileName && <p>{intake.fileName}</p>}
    <Button disabled={!editable || busy} onClick={() => void resolve()}>{busy ? t('busy') : t('resolve')}</Button>
    {error && <Feedback kind="error">{error}</Feedback>}
    {results.length > 0 && <div aria-live="polite">
      <Button disabled={!editable || !results.some(r => r.status === 'unique' && !intake.bindings.some(b => b.snapshot.catalogId === r.snapshot.catalogId && b.snapshot.records[0].id === r.candidates[0].id && b.source.well === r.request.well))} onClick={() => select(results.filter(r => r.status === 'unique' && !intake.bindings.some(b => b.snapshot.catalogId === r.snapshot.catalogId && b.snapshot.records[0].id === r.candidates[0].id && b.source.well === r.request.well)).map(result => ({ result, id: result.candidates[0].id })))}>{t('all')}</Button>
      {results.map((result, i) => <div key={i}><p>{result.request.well} {result.request.input}: {t(result.status)}</p>{result.candidates.map(record => <p key={record.id}>{record.name} / {record.id} / v{record.version} <Button disabled={!editable || result.status === 'duplicate' || result.status === 'incomplete' || intake.bindings.some(b => b.snapshot.catalogId === result.snapshot.catalogId && b.snapshot.records[0].id === record.id && b.source.well === result.request.well)} onClick={() => select([{ result, id: record.id }])}>{t('select')}</Button></p>)}</div>)}
    </div>}
    <strong>{t('saved')}</strong>{!intake.bindings.length && <p>{t('empty')}</p>}
    <ul>{intake.bindings.map((binding, index) => <li key={index}>{binding.source.well} {binding.snapshot.records[0].name} / {binding.snapshot.records[0].id} / v{binding.snapshot.records[0].version}<br />{t(binding.source.mode)}: {binding.source.input} ({binding.source.field}) · {binding.source.fileName} #{binding.source.row}<br />{binding.snapshot.catalogId} · {binding.snapshot.refreshedAt} <Button disabled={!editable} onClick={() => edit({ bindings: intake.bindings.filter((_, i) => i !== index) })}>{t('remove')}</Button></li>)}</ul>
  </BlockFrame>;
}
