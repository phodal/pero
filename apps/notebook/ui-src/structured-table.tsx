import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Checkbox, Dialog, Disclosure, Feedback, Field, Input, NativeSelect, Select, Textarea } from '@pero/app-sdk/ui';
import {
  createRegistrationWaiver, applyCatalogCellSelection, applyRegistrationReceipt, canonicalStructuredTable, changeStructuredTable, columnTypes, isCatalogSnapshot, isRegistrationReceipt,
  isStructuredColumn, lookupTableDefaults, parseTypedCell, structuredTableLimits, validateStructuredTable,
  type RegistrationWaiver, type CatalogQuery, type CatalogSnapshot, type ColumnType, type LookupTableAttributes, type RegistrationReceipt,
  type StructuredColumn, type StructuredTableAttributes, type StructuredTableDraft, type TableChange, type TableIssueCode, type TypedCell,
} from '@pero/notebook/structured-table';
import { BlockFrame } from './block-frame';
import { projectTableView, type TableViewDefinition } from '@pero/notebook/table-workflows';
import { TableWorkflowTools } from './table-workflows';
import { useNotebookContext } from './notebook-context';
import { CatalogCellPicker, QuantityCellEditor } from './structured-field-picker';

export const structuredTableMessages = {
  waiver: { en: 'Local validation waiver', zh: '本地验证豁免' },
  waiverScope: { en: 'Policy required-missing-v1: only absent required values may be waived. Supplied values must remain valid. Attribution is self-declared, not authenticated approval. Review the listed cells before submitting.', zh: '规则 required-missing-v1：仅可豁免必填缺失值。已填值仍须有效。署名为自行声明，不代表身份验证审批。提交前请复核所列单元格。' },
  waiverReason: { en: 'Waiver reason', zh: '豁免原因' },
  waiverActor: { en: 'Local attribution', zh: '本地署名' },
  waiverSubmit: { en: 'Submit with explicit waiver', zh: '明确豁免并提交' },
  projected: { en: 'View: {name} · {visible} of {total} rows', zh: '视图：{name} · {total} 行中的 {visible} 行' },
  pickCatalog: { en: 'Choose catalog value for {cell}', zh: '为 {cell} 选择目录值' },
  autofill: { en: 'After registration, fill references into', zh: '登记后将引用填入' },
  autofillNone: { en: 'Do not autofill', zh: '不自动填充' },
  autofillHint: { en: 'Choose an optional object column to fill empty cells with committed catalog, record and version identities. Existing values stay unchanged. Filled references are draft edits, not a second registration.', zh: '选择可选对象列，将已提交的目录、记录和版本身份填入空单元格。保留已有值。填入的引用属于草稿编辑，不会再次登记。' },
  committed: { en: 'The local catalog committed {count} records. Any filled references belong to this draft; save the entry to retain them.', zh: '本地目录已提交 {count} 条记录。填入的引用属于当前草稿，请保存笔记以保留这些引用。' },
  receiptUnapplied: { en: 'The catalog committed this snapshot, but the notebook is now read-only. The draft was not changed.', zh: '目录已提交此快照，但笔记现为只读。草稿未更改。' },
  filteredEmpty: { en: 'No rows match this view. Show all rows or edit its filter.', zh: '没有匹配此视图的行。请显示全部行或修改筛选条件。' },
  inputTable: { en: 'Input table', zh: '输入表' },
  registrationTable: { en: 'Registration table', zh: '登记表' },
  lookupTable: { en: 'Lookup table', zh: '查询表' },
  tableName: { en: 'Table name', zh: '表名' },
  schema: { en: 'Schema', zh: '数据结构' },
  revision: { en: 'Revision {number}', zh: '修订 {number}' },
  catalogId: { en: 'Catalog ID', zh: '目录 ID' },
  hashUnavailable: { en: 'Secure hashing is unavailable. Open Notebook in a secure browser context to submit; your editable draft is retained.', zh: '当前无法进行安全摘要计算。请在安全的浏览器环境中打开 Notebook 后提交；可编辑草稿仍已保留。' },
  resubmit: { en: 'Confirm snapshot in this catalog', zh: '在当前目录中确认此快照' },
  localCatalog: { en: 'Notebook local catalog', zh: 'Notebook 本地目录' },
  catalogScope: { en: 'Records are stored in this Notebook installation, not an external inventory or registry. Saving a notebook does not register rows.', zh: '记录保存于当前 Notebook 安装的本地目录，不会写入外部库存或注册系统。保存笔记不会登记行。' },
  inputDraft: { en: 'Input draft', zh: '输入草稿' },
  submitted: { en: 'Submitted snapshot', zh: '已提交快照' },
  changed: { en: 'Unsubmitted changes', zh: '有尚未提交的更改' },
  submit: { en: 'Submit rows to local catalog', zh: '将行提交到本地目录' },
  retrySubmit: { en: 'Retry this submission', zh: '重试本次提交' },
  submitError: { en: 'Submission was not applied to this draft. Existing cells and receipts are retained; a catalog commit is not rolled back. Retry uses the same submission ID for unchanged input.', zh: '提交未应用到当前草稿。已有单元格和回执均已保留；已提交的目录记录不会回滚。输入不变时，重试将使用相同提交 ID。' },
  invalidResponse: { en: 'The catalog returned an invalid response.', zh: '目录返回了无效响应。' },
  validation: { en: 'Resolve {count} validation issues before submitting.', zh: '请先修正 {count} 项验证问题再提交。' },
  addRow: { en: 'Add row', zh: '添加行' },
  removeRow: { en: 'Remove row {number}', zh: '移除第 {number} 行' },
  addColumn: { en: 'Add column', zh: '添加列' },
  column: { en: 'Column {number}', zh: '第 {number} 列' },
  columnSettings: { en: 'Column settings', zh: '列设置' },
  columnName: { en: 'Column name', zh: '列名' },
  columnType: { en: 'Value type', zh: '值类型' },
  requiredLabel: { en: 'Required', zh: '必填' },
  controlledOptions: { en: 'Allowed text values, one per line (empty permits any text)', zh: '允许的文本值，每行一个（留空表示不限）' },
  allowedUnits: { en: 'Allowed units, one per line', zh: '允许的单位，每行一个' },
  quantityHint: { en: 'Enter an amount and select its unit. Allowed: {units}. Changing units does not convert the amount.', zh: '请输入数值并选择单位。允许单位：{units}。更改单位不会换算数值。' },
  objectHint: { en: 'JSON object', zh: 'JSON 对象' },
  removeColumn: { en: 'Remove column', zh: '移除此列' },
  removeColumnNote: { en: 'Removing a column also removes its draft cells. Notebook Undo restores them; submitted versions stay unchanged.', zh: '移除列会同时移除草稿中的对应单元格；可通过笔记撤销恢复。已提交版本不会改变。' },
  saveSettings: { en: 'Save settings', zh: '保存设置' },
  cancel: { en: 'Cancel', zh: '取消' },
  close: { en: 'Close', zh: '关闭' },
  invalidColumn: { en: 'Use a name of up to 200 characters and distinct, nonempty options or units. Quantity columns need at least one unit.', zh: '列名最多 200 个字符，选项或单位必须非空且不重复。数量列至少需要一个单位。' },
  receiptHistory: { en: 'Submission receipts ({count})', zh: '提交回执（{count}）' },
  receiptScope: { en: 'Immutable saved submission snapshots. Editing this draft does not edit earlier records. Imported receipts are not independently verified against this catalog.', zh: '不可变的已保存提交快照。编辑当前草稿不会更改早期记录。导入的回执尚未与当前目录独立核验。' },
  receiptLimit: { en: 'This block has 100 retained receipts. Create a new registration table to continue; existing catalog records are preserved.', zh: '此块已保留 100 份回执。请新建登记表继续提交，已有目录记录会保留。' },
  submissionId: { en: 'Submission ID', zh: '提交 ID' },
  inputHash: { en: 'Input SHA-256', zh: '输入 SHA-256' },
  record: { en: 'Record', zh: '记录' },
  row: { en: 'Row', zh: '行' },
  version: { en: 'Version', zh: '版本' },
  noRows: { en: 'No draft rows. Add a row to enter values.', zh: '尚无草稿行，请添加行输入数据。' },
  lookupSchema: { en: 'Schema ID (empty searches all schemas)', zh: '数据结构 ID（留空查询全部）' },
  lookupText: { en: 'Search catalog records', zh: '搜索目录记录' },
  lookupLimit: { en: 'Maximum records', zh: '最多显示的记录数' },
  refresh: { en: 'Refresh from local catalog', zh: '从本地目录刷新' },
  notQueried: { en: 'Configure the query, then refresh to capture actual catalog records.', zh: '设置查询条件后刷新，获取目录中的实际记录。' },
  noMatches: { en: 'No registered records match this query.', zh: '没有符合此查询条件的已登记记录。' },
  lookupError: { en: 'Catalog refresh failed. The previous snapshot, if any, is still shown.', zh: '目录刷新失败；如有上次快照，仍会继续显示。' },
  queryChanged: { en: 'The query changed. Showing the previous query snapshot until you refresh.', zh: '查询条件已更改。刷新前仍显示上次查询的快照。' },
  snapshot: { en: 'Catalog snapshot', zh: '目录快照' },
  refreshed: { en: 'Retrieved {time}; showing {count} of {total} records.', zh: '获取时间 {time}；显示 {total} 条中的 {count} 条记录。' },
  snapshotQuery: { en: 'Snapshot query', zh: '快照查询条件' },
  recordValues: { en: 'Recorded values', zh: '已记录的值' },
  text: { en: 'Text', zh: '文本' },
  decimal: { en: 'Decimal', zh: '小数' },
  quantity: { en: 'Quantity with unit', zh: '带单位数量' },
  boolean: { en: 'Boolean', zh: '布尔值' },
  date: { en: 'Date', zh: '日期' },
  object: { en: 'JSON object', zh: 'JSON 对象' },
  missing: { en: 'Missing', zh: '缺失值' },
  true: { en: 'True', zh: '真' },
  false: { en: 'False', zh: '假' },
  error_required: { en: 'A value is required.', zh: '此值必填。' },
  error_decimal: { en: 'Enter a finite decimal.', zh: '请输入有限的小数。' },
  error_quantity: { en: 'Enter a decimal followed by its unit.', zh: '请输入小数并在后面添加单位。' },
  error_unit: { en: 'Choose an allowed unit.', zh: '请选择允许的单位。' },
  error_boolean: { en: 'Choose true or false.', zh: '请选择真或假。' },
  error_date: { en: 'Enter a real date in YYYY-MM-DD format.', zh: '请输入 YYYY-MM-DD 格式的有效日期。' },
  error_object: { en: 'Enter a JSON object with finite values (maximum nesting: 16).', zh: '请输入包含有限数值的 JSON 对象（最多嵌套 16 层）。' },
  error_missing: { en: 'This column accepts only missing values.', zh: '此列只接受缺失值。' },
  error_option: { en: 'Choose one of the allowed options.', zh: '请选择允许的选项。' },
  error_name: { en: 'Enter a nonempty name.', zh: '请输入非空名称。' },
  error_duplicateName: { en: 'Column names must be distinct.', zh: '列名不能重复。' },
  error_columnRules: { en: 'Check the column settings: quantities need units; only text supports options; missing cannot be required.', zh: '请检查列设置：数量需要单位，仅文本支持选项，缺失值不能设为必填。' },
  error_rows: { en: 'Add at least one row.', zh: '请至少添加一行。' },
} as const;

const identity = () => crypto.randomUUID();
const sameQuery = (a: CatalogQuery, b: CatalogQuery) => a.schemaId === b.schemaId && a.text === b.text && a.limit === b.limit;
const issueKey = (code: TableIssueCode) => `error_${code}` as const;
const typedText = (value: TypedCell) => value.type === 'missing' ? '—' : value.type === 'quantity' ? `${value.value} ${value.unit}` : value.type === 'object' ? JSON.stringify(value.value) : String(value.value);
async function inputHash(canonical: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function ColumnSettings({ column, removable, onSave, onRemove, onClose }: {
  column: StructuredColumn; removable: boolean; onSave(value: StructuredColumn): void; onRemove(): void; onClose(): void;
}) {
  const { t } = useAppI18n(structuredTableMessages);
  const [draft, setDraft] = useState(column), [options, setOptions] = useState(column.options.join('\n')), [units, setUnits] = useState(column.units.join('\n'));
  const [error, setError] = useState(false);
  const save = () => {
    const lines = (value: string) => value.trim() ? value.split('\n').map(line => line.trim()).filter(Boolean) : [];
    const next = { ...draft, options: draft.type === 'text' ? lines(options) : [], units: draft.type === 'quantity' ? lines(units) : [] };
    if (!isStructuredColumn(next) || !next.name.trim() || (next.type === 'quantity' && !next.units.length)) { setError(true); return; }
    onSave(next);
  };
  return <Dialog title={t('columnSettings')} closeLabel={t('close')} onClose={onClose} onSubmit={event => { event.preventDefault(); save(); }}
    footer={<><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button variant="primary" type="submit">{t('saveSettings')}</Button></>}>
    <div className="notebook-structured-settings">
      <label className="notebook-field">{t('columnName')}<Input value={draft.name} maxLength={200} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <Select label={t('columnType')} value={draft.type} options={columnTypes.map(type => ({ value: type, label: t(type) }))}
        onChange={type => setDraft({ ...draft, type: type as ColumnType, required: type === 'missing' ? false : draft.required })} />
      <label className="notebook-checkbox"><Checkbox checked={draft.required} disabled={draft.type === 'missing'} onCheckedChange={checked => setDraft({ ...draft, required: checked === true })} />{t('requiredLabel')}</label>
      {draft.type === 'text' && <label className="notebook-field">{t('controlledOptions')}<Textarea rows={3} maxLength={20100} value={options} onChange={event => setOptions(event.target.value)} /></label>}
      {draft.type === 'quantity' && <label className="notebook-field">{t('allowedUnits')}<Textarea rows={3} maxLength={20100} value={units} onChange={event => setUnits(event.target.value)} /></label>}
      {error && <Feedback kind="error">{t('invalidColumn')}</Feedback>}
      {removable && <><p className="notebook-note">{t('removeColumnNote')}</p><Button variant="ghost" onClick={onRemove}>{t('removeColumn')}</Button></>}
    </div>
  </Dialog>;
}

function TypedCellEditor({ column, raw, label, disabled, onChange }: {
  column: StructuredColumn; raw: string; label: string; disabled: boolean; onChange(value: string): void;
}) {
  const { t } = useAppI18n(structuredTableMessages);
  const parsed = parseTypedCell(column, raw);
  const error = 'error' in parsed ? parsed.error : null;
  const choices = column.type === 'boolean' ? [{ value: 'true', label: t('true') }, { value: 'false', label: t('false') }]
    : column.options.map(value => ({ value, label: value }));
  // A value invalidated by a schema edit remains visible and editable, never silently discarded.
  if (raw && choices.length && !choices.some(choice => choice.value === raw)) choices.unshift({ value: raw, label: raw });
  return <div className="notebook-typed-cell">
    {column.type === 'missing' ? <Input aria-label={label} value={raw} disabled={disabled} maxLength={4096} placeholder="—" onChange={event => onChange(event.target.value)} />
      : column.type === 'quantity' ? <QuantityCellEditor column={column} raw={raw} label={label} disabled={disabled} invalid={!!error} onChange={onChange} />
      : column.type === 'object' ? <Textarea aria-label={label} rows={2} maxLength={4096} readOnly={disabled} value={raw} placeholder="{}" aria-invalid={!!error} onChange={event => onChange(event.target.value)} />
      : choices.length ? <Select label={label} value={raw} disabled={disabled} aria-invalid={!!error} options={[{ value: '', label: t('missing') }, ...choices]} onChange={onChange} />
      : <Input aria-label={label} readOnly={disabled} value={raw} maxLength={4096} aria-invalid={!!error} placeholder={column.type === 'date' ? 'YYYY-MM-DD' : ''} onChange={event => onChange(event.target.value)} />}
    {error && <span className="notebook-cell-error">{t(issueKey(error))}</span>}
  </div>;
}

function WaiverAudit({ waiver }: { waiver: RegistrationWaiver }) {
  const { t } = useAppI18n(structuredTableMessages);
  return <Feedback kind="warning"><strong>{t('waiver')} · {waiver.policy}</strong><p>{waiver.reason} · {waiver.attribution}</p>
    <ul>{waiver.issues.map(issue => <li key={`${issue.rowId}:${issue.columnId}`}>{issue.rowId} / {issue.columnId}: {t('error_required')}</li>)}</ul></Feedback>;
}

function ReceiptHistory({ receipts }: { receipts: RegistrationReceipt[] }) {
  const { t } = useAppI18n(structuredTableMessages);
  if (!receipts.length) return null;
  return <Disclosure variant="inline" summary={t('receiptHistory', { count: receipts.length })}>
    <p className="notebook-note">{t('receiptScope')}</p>
    {[...receipts].reverse().map(receipt => <Disclosure key={`${receipt.catalogId}:${receipt.submissionId}`} variant="inline" summary={`${receipt.registeredAt} · ${receipt.records.length}`}>
      {receipt.waiver && <WaiverAudit waiver={receipt.waiver} />}
      <dl className="notebook-reference-details">
        <div><dt>{t('catalogId')}</dt><dd><code>{receipt.catalogId}</code></dd></div>
        <div><dt>{t('submissionId')}</dt><dd><code>{receipt.submissionId}</code></dd></div>
        <div><dt>{t('inputHash')}</dt><dd><code>{receipt.inputHash}</code></dd></div>
        <div><dt>{t('schema')}</dt><dd>{receipt.schemaId} · {t('revision', { number: receipt.schemaRevision })}</dd></div>
      </dl>
      <table className="notebook-catalog-records"><thead><tr><th>{t('row')}</th><th>{t('record')}</th><th>{t('version')}</th></tr></thead>
        <tbody>{receipt.records.map(record => <tr key={record.recordId}><td>{record.rowId}</td><td><code>{record.recordId}</code></td><td>{record.version}</td></tr>)}</tbody></table>
    </Disclosure>)}
  </Disclosure>;
}

function StructuredTableView({ view, registration }: { view: NodeViewProps; registration: boolean }) {
  const { t } = useAppI18n(structuredTableMessages), api = useAppApi();
  const attrs = view.node.attrs as StructuredTableAttributes;
  const { table, receipts } = attrs;
  const entryContext = useNotebookContext();
  const viewScope = `${entryContext?.entryId ?? ''}:${table.id}`;
  const [selectedView, setSelectedView] = useState<{ scope: string; view: TableViewDefinition | null }>({ scope: viewScope, view: null });
  const activeView = selectedView.scope === viewScope ? selectedView.view : null;
  const setActiveView = (value: TableViewDefinition | null) => setSelectedView({ scope: viewScope, view: value });
  let projected = { columns: table.schema.columns, rows: table.rows }, viewError = '';
  try { projected = projectTableView(table, activeView); } catch (cause) { viewError = cause instanceof Error ? cause.message : String(cause); }
  const current = useRef(attrs); current.current = attrs;
  const scope = useRef({ key: viewScope });
  if (scope.current.key !== viewScope) scope.current = { key: viewScope };
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [column, setColumn] = useState<StructuredColumn | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [picker, setPicker] = useState<{ scope: string; table: StructuredTableDraft; rowId: string; column: StructuredColumn; label: string } | null>(null);
  const [autofill, setAutofill] = useState({ scope: viewScope, columnId: '' });
  const autofillColumns = table.schema.columns.filter(column => column.type === 'object' && !column.required);
  const referenceColumnId = autofill.scope === viewScope && autofillColumns.some(column => column.id === autofill.columnId) ? autofill.columnId : '';
  const [confirmation, setConfirmation] = useState<{ scope: string; receipt: RegistrationReceipt; applied: boolean } | null>(null);
  useEffect(() => { setPicker(null); setColumn(null); setError(''); setConfirmation(null); }, [viewScope]);
  const [waiverForm, setWaiverForm] = useState({ canonical: '', reason: '', attribution: '' });
  const [hashed, setHashed] = useState({ canonical: '', hash: '', failed: false });
  const canonical = canonicalStructuredTable(table);
  useEffect(() => { setWaiverForm({ canonical: '', reason: '', attribution: '' }); }, [canonical, viewScope]);
  const hash = hashed.canonical === canonical ? hashed.hash : '';
  const hashFailed = hashed.canonical === canonical && hashed.failed;
  useEffect(() => {
    let active = true;
    void inputHash(canonical).then(hash => { if (active) setHashed({ canonical, hash, failed: false }); }).catch(() => { if (active) setHashed({ canonical, hash: '', failed: true }); });
    return () => { active = false; };
  }, [canonical]);
  const editorEditable = useEditorState({ editor: view.editor, selector: ({ editor }) => editor.isEditable });
  const editable = editorEditable && !busy;
  const issues = validateStructuredTable(table);
  const submitted = receipts.some(receipt => receipt.tableId === table.id && receipt.inputHash === hash);
  const edit = (change: TableChange) => { if (!view.editor.isEditable || inFlight.current) return; view.updateAttributes({ table: changeStructuredTable(current.current.table, change) }); setError(''); };
  const submit = async (waive = false) => {
    if (inFlight.current || !view.editor.isEditable || !hash || (issues.length && !waive)) return;
    const submittedScope = scope.current;
    if (waive && waiverForm.canonical !== canonical) return;
    const waiver = waive ? createRegistrationWaiver(table, hash, waiverForm.reason, waiverForm.attribution) : undefined;
    const input = { table, inputHash: hash, submissionId: hash, referenceColumnId, waiver };
    inFlight.current = true; setBusy(true); setError(''); setConfirmation(null);
    try {
      if (waiver) input.submissionId = await inputHash(JSON.stringify(waiver));
      const receipt = await api.post<unknown>('/api/catalog/register', { submissionId: input.submissionId, table: input.table, ...(waiver ? { waiver } : {}) });
      if (!isRegistrationReceipt(receipt)) throw new Error(t('invalidResponse'));
      if (!mounted.current || scope.current !== submittedScope) return;
      const next = applyRegistrationReceipt(current.current, input, receipt);
      if (!view.editor.isEditable) { setConfirmation({ scope: submittedScope.key, receipt, applied: false }); return; }
      view.updateAttributes(next);
      setConfirmation({ scope: submittedScope.key, receipt, applied: true });
    } catch (cause) { if (mounted.current && scope.current === submittedScope) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const kind = registration ? 'registrationTable' : 'inputTable';
  return <BlockFrame view={view} kind={kind} title={<Input className="notebook-block-name" unstyled aria-label={t('tableName')} placeholder={t(kind)} maxLength={200} readOnly={!editable} value={table.name} onChange={event => edit({ type: 'name', value: event.target.value })} />}
    caption={<Badge tone={submitted ? 'info' : 'neutral'}>{t(submitted ? 'submitted' : receipts.length ? 'changed' : 'inputDraft')}</Badge>}>
    <div className="notebook-structured-metadata"><span>{t('schema')}: <code>{table.schema.id}</code></span><span>{t('revision', { number: table.schema.revision })}</span></div>
    {registration && <p className="notebook-note">{t('catalogScope')}</p>}
    <TableWorkflowTools table={table} receipts={receipts} editable={editable} activeView={activeView} onViewChange={setActiveView} onApplyTable={next => { if (mounted.current && view.editor.isEditable) view.updateAttributes({ table: next }); }} />
    {activeView && !viewError && <p className="notebook-note">{t('projected', { name: activeView.name, visible: projected.rows.length, total: table.rows.length })}</p>}
    {viewError && <Feedback kind="warning">{viewError}</Feedback>}
    {issues.length > 0 && <Feedback kind="warning">{t('validation', { count: issues.length })}
      <ul>{issues.filter(issue => !issue.rowId).map((issue, index) => <li key={index}>{issue.columnId ? `${table.schema.columns.find(col => col.id === issue.columnId)?.name || issue.columnId}: ` : ''}{t(issueKey(issue.code))}</li>)}</ul>
    </Feedback>}
    <div className="notebook-structured-scroll"><table className="notebook-structured-grid"><thead><tr><th>{t('row')}</th>
      {projected.columns.map(col => <th key={col.id}>
        {editable ? <Button variant="ghost" title={t('columnSettings')} onClick={() => setColumn(col)}>{col.name || t('columnSettings')}{col.required ? ' *' : ''}</Button> : <strong>{col.name}{col.required ? ' *' : ''}</strong>}
        <div className="notebook-note">{t(col.type)}</div>
        {col.type === 'quantity' && <small>{t('quantityHint', { units: col.units.join(', ') })}</small>}
      </th>)}{editable && <th />}</tr></thead>
      <tbody>{projected.rows.map(row => { const index = table.rows.findIndex(item => item.id === row.id); return <tr key={row.id}><th scope="row" title={row.id}>{index + 1}</th>
        {projected.columns.map(col => { const label = `${col.name}, ${t('row')} ${index + 1}`; return <td key={col.id}>
          <TypedCellEditor column={col} raw={row.cells[col.id] ?? ''} label={label} disabled={!editable} onChange={value => edit({ type: 'cell', rowId: row.id, columnId: col.id, value })} />
          {editable && col.type !== 'missing' && <Button variant="ghost" onClick={() => setPicker({ scope: viewScope, table: structuredClone(table), rowId: row.id, column: col, label })}>{t('pickCatalog', { cell: label })}</Button>}
        </td>; })}
        {editable && <td><Button variant="ghost" onClick={() => edit({ type: 'removeRow', id: row.id })}>{t('removeRow', { number: index + 1 })}</Button></td>}
      </tr>; })}</tbody></table></div>
    {!!table.rows.length && !projected.rows.length && <p>{t('filteredEmpty')}</p>}
    {!table.rows.length && <p className="notebook-note">{t('noRows')}</p>}
    {editable && <div className="notebook-structured-actions">
      <Button variant="ghost" disabled={table.rows.length >= structuredTableLimits.rows} onClick={() => edit({ type: 'addRow', id: identity() })}>{t('addRow')}</Button>
      <Button variant="ghost" disabled={table.schema.columns.length >= structuredTableLimits.columns} onClick={() => setColumn({ id: identity(), name: t('column', { number: table.schema.columns.length + 1 }), type: 'text', required: false, options: [], units: [] })}>{t('addColumn')}</Button>
    </div>}
    {registration && editorEditable && <>
      {issues.length > 0 && issues.every(issue => issue.code === 'required') && <Disclosure variant="inline" summary={t('waiver')}>
        <p>{t('waiverScope')}</p>
        <ul>{issues.map(issue => <li key={`${issue.rowId}:${issue.columnId}`}>{issue.rowId} / {issue.columnId}: {t('error_required')}</li>)}</ul>
        <Field label={t('waiverReason')}>{control => <Textarea {...control} disabled={!editable} maxLength={500} value={waiverForm.canonical === canonical ? waiverForm.reason : ''} onChange={event => setWaiverForm({ canonical, reason: event.target.value, attribution: waiverForm.canonical === canonical ? waiverForm.attribution : '' })} />}</Field>
        <Field label={t('waiverActor')}>{control => <Input {...control} disabled={!editable} maxLength={200} value={waiverForm.canonical === canonical ? waiverForm.attribution : ''} onChange={event => setWaiverForm({ canonical, attribution: event.target.value, reason: waiverForm.canonical === canonical ? waiverForm.reason : '' })} />}</Field>
        <Button disabled={!editable || !hash || waiverForm.canonical !== canonical || !waiverForm.reason.trim() || !waiverForm.attribution.trim() || receipts.length >= structuredTableLimits.receipts} onClick={() => void submit(true)}>{t('waiverSubmit')}</Button>
      </Disclosure>}
      <Field label={t('autofill')}>{control => <NativeSelect {...control} value={referenceColumnId} disabled={!editable} onChange={event => setAutofill({ scope: viewScope, columnId: event.target.value })}>
        <option value="">{t('autofillNone')}</option>{autofillColumns.map(column => <option key={column.id} value={column.id}>{column.name}</option>)}
      </NativeSelect>}</Field><p className="notebook-note">{t('autofillHint')}</p>
      <Button variant="primary" busy={busy} disabled={!!issues.length || !hash || receipts.length >= structuredTableLimits.receipts} onClick={() => void submit()}>{t(error ? 'retrySubmit' : submitted ? 'resubmit' : 'submit')}</Button>
    </>}
    {confirmation?.scope === viewScope && <Feedback kind={confirmation.applied ? 'success' : 'warning'}>{t(confirmation.applied ? 'committed' : 'receiptUnapplied', { count: confirmation.receipt.records.length })}</Feedback>}
    {registration && hashFailed && <Feedback kind="error">{t('hashUnavailable')}</Feedback>}
    {receipts.length >= structuredTableLimits.receipts && <Feedback kind="warning">{t('receiptLimit')}</Feedback>}
    {error && <Feedback kind="error">{t('submitError')} {error}</Feedback>}
    <ReceiptHistory receipts={receipts} />
    {picker?.scope === viewScope && <CatalogCellPicker column={picker.column} label={picker.label} editable={editable} onClose={() => setPicker(null)}
      onApply={(snapshot, recordId, selection) => {
        if (!view.editor.isEditable || inFlight.current) return;
        view.updateAttributes({ table: applyCatalogCellSelection(current.current.table, picker.table, picker.rowId, picker.column.id, snapshot, recordId, selection) });
        setPicker(null);
      }} />}
    {column && <ColumnSettings column={column} removable={table.schema.columns.some(col => col.id === column.id) && table.schema.columns.length > 1} onClose={() => setColumn(null)}
      onRemove={() => { edit({ type: 'removeColumn', id: column.id }); setColumn(null); }}
      onSave={next => { edit({ type: table.schema.columns.some(col => col.id === column.id) ? 'configureColumn' : 'addColumn', column: next }); setColumn(null); }} />}
  </BlockFrame>;
}

export function InputTableView(view: NodeViewProps) { return <StructuredTableView view={view} registration={false} />; }
export function RegistrationTableView(view: NodeViewProps) { return <StructuredTableView view={view} registration />; }

export function LookupTableView(view: NodeViewProps) {
  const { t } = useAppI18n(structuredTableMessages), api = useAppApi();
  const { query, snapshot } = view.node.attrs as LookupTableAttributes;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const editable = view.editor.isEditable;
  const changed = snapshot && !sameQuery(query, snapshot.query);
  const update = (patch: Partial<CatalogQuery>) => view.updateAttributes({ query: { ...query, ...patch } });
  const refresh = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ schemaId: query.schemaId, text: query.text, limit: String(query.limit) });
      const response = await api.get<unknown>(`/api/catalog/lookup?${params}`);
      if (!isCatalogSnapshot(response) || !sameQuery(response.query, query)) throw new Error(t('invalidResponse'));
      if (mounted.current) view.updateAttributes({ snapshot: response });
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <BlockFrame view={view} kind="lookupTable" title={<strong>{t('lookupTable')}</strong>} caption={<Badge>{t('localCatalog')}</Badge>}>
    <div className="notebook-structured-query">
      <label className="notebook-field">{t('lookupSchema')}<Input maxLength={128} value={query.schemaId} readOnly={!editable || busy} onChange={event => update({ schemaId: event.target.value })} /></label>
      <label className="notebook-field">{t('lookupText')}<Input maxLength={200} value={query.text} readOnly={!editable || busy} onChange={event => update({ text: event.target.value })} /></label>
      <Select label={t('lookupLimit')} disabled={!editable || busy} value={String(query.limit)} options={[...new Set([10, 50, 100, 200, query.limit])].sort((a, b) => a - b).map(limit => ({ value: String(limit), label: String(limit) }))} onChange={limit => update({ limit: Number(limit) })} />
      {editable && <Button variant="primary" busy={busy} onClick={() => void refresh()}>{t('refresh')}</Button>}
    </div>
    {error && <Feedback kind="error">{t('lookupError')} {error}</Feedback>}
    {changed && <Feedback kind="warning">{t('queryChanged')}</Feedback>}
    {!snapshot && <p className="notebook-note">{t('notQueried')}</p>}
    {snapshot && <CatalogResults snapshot={snapshot} />}
  </BlockFrame>;
}

function CatalogResults({ snapshot }: { snapshot: CatalogSnapshot }) {
  const { t } = useAppI18n(structuredTableMessages);
  return <div className="notebook-catalog-snapshot">
    <p className="notebook-note">{t('refreshed', { time: snapshot.refreshedAt, count: snapshot.records.length, total: snapshot.total })}</p>
    <Disclosure variant="inline" summary={t('snapshotQuery')}><p>{t('catalogId')}: <code>{snapshot.catalogId}</code><br />{t('schema')}: {snapshot.query.schemaId || '*'}<br />{t('lookupText')}: {snapshot.query.text || '*'}</p></Disclosure>
    {!snapshot.records.length ? <p>{t('noMatches')}</p> : <div className="notebook-structured-scroll"><table className="notebook-catalog-records">
      <thead><tr><th>{t('record')}</th><th>{t('version')}</th><th>{t('schema')}</th><th>{t('recordValues')}</th></tr></thead>
      <tbody>{snapshot.records.map(record => <tr key={record.id}>
        <td><strong>{record.name}</strong><br /><code>{record.id}</code><br /><small>{record.registeredAt}</small></td><td>{record.version}</td>
        <td><code>{record.schemaId}</code><br />{t('revision', { number: record.schemaRevision })}</td>
        <td>{record.waiver && <WaiverAudit waiver={record.waiver} />}<dl>{record.columns.map(column => <div key={column.id}><dt>{column.name}</dt><dd>{typedText(record.values[column.id])}</dd></div>)}</dl></td>
      </tr>)}</tbody></table></div>}
  </div>;
}

export { lookupTableDefaults };
