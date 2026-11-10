/** Typed input drafts and immutable local-catalog snapshots, independent of transport. */
export const structuredTableLimits = { rows: 200, columns: 50, cell: 4096, options: 100, receipts: 100 } as const;
export const columnTypes = ['text', 'decimal', 'quantity', 'boolean', 'date', 'object', 'missing'] as const;
export type ColumnType = typeof columnTypes[number];
export interface StructuredColumn { id: string; name: string; type: ColumnType; required: boolean; options: string[]; units: string[] }
export interface TableSchema { id: string; revision: number; columns: StructuredColumn[] }
export interface StructuredRow { id: string; cells: Record<string, string> }
export interface StructuredTableDraft { id: string; name: string; schema: TableSchema; rows: StructuredRow[] }
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type TypedCell =
  | { type: 'missing' }
  | { type: 'text' | 'decimal' | 'date'; value: string }
  | { type: 'quantity'; value: string; unit: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'object'; value: { [key: string]: JsonValue } };
export type TableIssueCode = 'required' | 'decimal' | 'quantity' | 'unit' | 'boolean' | 'date' | 'object' | 'missing' | 'option' | 'name' | 'duplicateName' | 'columnRules' | 'rows';
export interface TableIssue { code: TableIssueCode; rowId?: string; columnId?: string }
export interface RegistrationWaiver {
  policy: 'required-missing-v1'; inputHash: string; reason: string; attribution: string;
  issues: { code: 'required'; rowId: string; columnId: string }[];
}
export interface RegistrationReceipt {
  waiver?: RegistrationWaiver;
  source: 'notebook-local-catalog'; catalogId: string; submissionId: string; inputHash: string; tableId: string;
  schemaId: string; schemaRevision: number; registeredAt: string;
  records: { rowId: string; recordId: string; version: number }[];
}
export interface CatalogRecord {
  waiver?: RegistrationWaiver;
  id: string; version: number; schemaId: string; schemaRevision: number; tableId: string; rowId: string;
  name: string; registeredAt: string; values: Record<string, TypedCell>; columns: StructuredColumn[];
}
export interface CatalogQuery { schemaId: string; text: string; limit: number }
export interface CatalogSnapshot {
  source: 'notebook-local-catalog'; catalogId: string; query: CatalogQuery; refreshedAt: string; total: number; records: CatalogRecord[];
}
export interface StructuredTableAttributes { table: StructuredTableDraft; receipts: RegistrationReceipt[] }
export interface LookupTableAttributes { query: CatalogQuery; snapshot: CatalogSnapshot | null }
/** A frozen identity observed from the local catalog, not an inventory reservation. */
export interface CatalogEntityReference {
  source: 'notebook-local-catalog'; catalogId: string; recordId: string; version: number;
  schemaId: string; schemaRevision: number;
}
export type CatalogCellSelection = { type: 'reference' } | { type: 'field'; columnId: string };
export interface RegistrationInput {
  waiver?: RegistrationWaiver;
  table: StructuredTableDraft; inputHash: string; submissionId: string; referenceColumnId: string;
}

const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && [...value].length <= max;
const integer = (value: unknown, min = 1, max = 2147483647): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const distinct = (values: unknown[]) => new Set(values).size === values.length;
const decimal = (value: string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
const list = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(item => text(item, 200) && item.trim() === item && !!item) && distinct(value);
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown): value is string => text(value, 40) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value));

/** A local, self-attributed exception, not authenticated approval or a compliance signature. */
export function createRegistrationWaiver(table: StructuredTableDraft, inputHash: string, reason: string, attribution: string): RegistrationWaiver {
  const issues = validateStructuredTable(table);
  if (!issues.length || issues.some(issue => issue.code !== 'required' || !issue.rowId || !issue.columnId)) throw new Error('Only missing required cells can be waived.');
  const waiver: RegistrationWaiver = { policy: 'required-missing-v1', inputHash, reason, attribution,
    issues: issues as RegistrationWaiver['issues'] };
  if (!isRegistrationWaiver(waiver)) throw new Error('Provide a reason and local attribution for this input.');
  return waiver;
}
export function isRegistrationWaiver(value: unknown): value is RegistrationWaiver {
  return object(value) && fields(value, ['policy', 'inputHash', 'reason', 'attribution', 'issues']) && value.policy === 'required-missing-v1' && digest(value.inputHash) &&
    text(value.reason, 500) && !!value.reason.trim() && text(value.attribution, 200) && !!value.attribution.trim() && Array.isArray(value.issues) && value.issues.length > 0 && value.issues.length <= 10000 &&
    value.issues.every(issue => object(issue) && fields(issue, ['code', 'rowId', 'columnId']) && issue.code === 'required' && id(issue.rowId) && id(issue.columnId)) &&
    distinct(value.issues.map(issue => `${issue.rowId}:${issue.columnId}`));
}
const auditFields = (value: Record<string, unknown>, keys: string[]) => fields(value, Object.hasOwn(value, 'waiver') ? [...keys, 'waiver'] : keys) &&
  (!Object.hasOwn(value, 'waiver') || isRegistrationWaiver(value.waiver));

export function isStructuredColumn(value: unknown): value is StructuredColumn {
  return object(value) && fields(value, ['id', 'name', 'type', 'required', 'options', 'units']) && id(value.id) && text(value.name, 200) &&
    columnTypes.includes(value.type as ColumnType) && typeof value.required === 'boolean' && list(value.options) && list(value.units);
}

/** Shape validation deliberately accepts unfinished names and invalid cell text, preserving drafts. */
export function isStructuredTable(value: unknown): value is StructuredTableDraft {
  if (!object(value) || !fields(value, ['id', 'name', 'schema', 'rows']) || !id(value.id) || !text(value.name, 200) ||
      !object(value.schema) || !fields(value.schema, ['id', 'revision', 'columns']) || !id(value.schema.id) || !integer(value.schema.revision)) return false;
  const columns = value.schema.columns;
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > structuredTableLimits.columns || !columns.every(isStructuredColumn) || !distinct(columns.map(col => col.id))) return false;
  const ids = new Set(columns.map(col => col.id));
  return Array.isArray(value.rows) && value.rows.length <= structuredTableLimits.rows && value.rows.every(row => object(row) &&
    fields(row, ['id', 'cells']) && id(row.id) && object(row.cells) && Object.entries(row.cells).every(([key, cell]) => ids.has(key) && text(cell, structuredTableLimits.cell))) && distinct(value.rows.map(row => row.id));
}

function validJson(value: unknown, depth = 0): value is JsonValue {
  return depth <= 16 && (value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every(item => validJson(item, depth + 1))) ||
    (object(value) && Object.values(value).every(item => validJson(item, depth + 1))));
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseTypedCell(column: StructuredColumn, raw: string): { value: TypedCell } | { error: TableIssueCode } {
  const value = raw.trim();
  if (!value) return column.required ? { error: 'required' } : { value: { type: 'missing' } };
  if (column.type === 'missing') return { error: 'missing' };
  if (column.options.length && !column.options.includes(value)) return { error: 'option' };
  switch (column.type) {
    case 'text': return { value: { type: 'text', value: raw } };
    case 'decimal': return decimal(value) ? { value: { type: 'decimal', value } } : { error: 'decimal' };
    case 'quantity': {
      const match = /^(\S+)\s+(.+)$/.exec(value);
      if (!match || !decimal(match[1])) return { error: 'quantity' };
      return column.units.includes(match[2]) ? { value: { type: 'quantity', value: match[1], unit: match[2] } } : { error: 'unit' };
    }
    case 'boolean': return value === 'true' || value === 'false' ? { value: { type: 'boolean', value: value === 'true' } } : { error: 'boolean' };
    case 'date': return validDate(value) ? { value: { type: 'date', value } } : { error: 'date' };
    case 'object': {
      let parsed: unknown;
      try { parsed = JSON.parse(value); } catch { return { error: 'object' }; }
      return object(parsed) && validJson(parsed) ? { value: { type: 'object', value: parsed as Record<string, JsonValue> } } : { error: 'object' };
    }
  }
}

export function validateStructuredColumn(column: StructuredColumn): TableIssueCode[] {
  const issues: TableIssueCode[] = [];
  if (!column.name.trim()) issues.push('name');
  if ((column.type !== 'text' && column.options.length) || (column.type === 'quantity' ? !column.units.length : column.units.length > 0) || (column.type === 'missing' && column.required)) issues.push('columnRules');
  return issues;
}

export function validateStructuredTable(table: StructuredTableDraft): TableIssue[] {
  const errors: TableIssue[] = [];
  if (!table.name.trim()) errors.push({ code: 'name' });
  if (!table.rows.length) errors.push({ code: 'rows' });
  const names = table.schema.columns.map(col => col.name.trim().toLowerCase());
  for (const column of table.schema.columns) {
    errors.push(...validateStructuredColumn(column).map(code => ({ code, columnId: column.id })));
    if (names.filter(name => name === column.name.trim().toLowerCase()).length > 1) errors.push({ code: 'duplicateName', columnId: column.id });
    for (const row of table.rows) {
      const parsed = parseTypedCell(column, row.cells[column.id] ?? '');
      if ('error' in parsed) errors.push({ code: parsed.error, rowId: row.id, columnId: column.id });
    }
  }
  return errors;
}

export type TableChange =
  | { type: 'name'; value: string }
  | { type: 'cell'; rowId: string; columnId: string; value: string }
  | { type: 'addRow'; id: string }
  | { type: 'removeRow'; id: string }
  | { type: 'addColumn'; column: StructuredColumn }
  | { type: 'configureColumn'; column: StructuredColumn }
  | { type: 'removeColumn'; id: string };

export function changeStructuredTable(table: StructuredTableDraft, change: TableChange): StructuredTableDraft {
  let next = table;
  switch (change.type) {
    case 'name': next = { ...table, name: change.value }; break;
    case 'cell':
      if (!table.rows.some(row => row.id === change.rowId) || !table.schema.columns.some(col => col.id === change.columnId)) throw new Error('Unknown cell');
      next = { ...table, rows: table.rows.map(row => row.id === change.rowId ? { ...row, cells: { ...row.cells, [change.columnId]: change.value } } : row) }; break;
    case 'addRow': next = { ...table, rows: [...table.rows, { id: change.id, cells: {} }] }; break;
    case 'removeRow': next = { ...table, rows: table.rows.filter(row => row.id !== change.id) }; break;
    case 'addColumn': next = { ...table, schema: { ...table.schema, revision: table.schema.revision + 1, columns: [...table.schema.columns, change.column] } }; break;
    case 'configureColumn':
      if (!table.schema.columns.some(col => col.id === change.column.id)) throw new Error('Unknown column');
      next = { ...table, schema: { ...table.schema, revision: table.schema.revision + 1, columns: table.schema.columns.map(col => col.id === change.column.id ? change.column : col) } }; break;
    case 'removeColumn': next = { ...table, schema: { ...table.schema, revision: table.schema.revision + 1, columns: table.schema.columns.filter(col => col.id !== change.id) },
      rows: table.rows.map(row => ({ ...row, cells: Object.fromEntries(Object.entries(row.cells).filter(([key]) => key !== change.id)) })) }; break;
  }
  if (!isStructuredTable(next)) throw new Error('Invalid table change or table limit exceeded');
  return next;
}

/** IDs are supplied by the shell, never generated by the domain. */
export function createStructuredTable(tableId: string, schemaId: string, rowId: string, columnId: string): StructuredTableDraft {
  return { id: tableId, name: '', schema: { id: schemaId, revision: 1, columns: [
    { id: columnId, name: 'Name', type: 'text', required: true, options: [], units: [] },
  ] }, rows: [{ id: rowId, cells: {} }] };
}
export const structuredTableDefaults: StructuredTableAttributes = { table: createStructuredTable('table', 'schema', 'row', 'name'), receipts: [] };
export const lookupTableDefaults: LookupTableAttributes = { query: { schemaId: '', text: '', limit: 100 }, snapshot: null };

/** Stable UTF-8 JSON shared with the catalog. Raw draft text, not rounded floats, is hashed. */
export function canonicalStructuredTable(table: StructuredTableDraft): string {
  return canonicalStructuredValue(table);
}

/** The picker only writes one explicitly selected cell; it never converts units or coerces types. */
export function catalogCellValue(column: StructuredColumn, snapshot: CatalogSnapshot, recordId: string, selection: CatalogCellSelection): string {
  const record = snapshot.records.find(record => record.id === recordId);
  if (!record) throw new Error('Select a record from the loaded catalog snapshot.');
  let raw: string;
  if (selection.type === 'reference') {
    if (column.type !== 'object') throw new Error('Pinned catalog references require an object column.');
    const reference: CatalogEntityReference = { source: snapshot.source, catalogId: snapshot.catalogId, recordId: record.id,
      version: record.version, schemaId: record.schemaId, schemaRevision: record.schemaRevision };
    raw = JSON.stringify(reference);
  } else {
    const value = record.values[selection.columnId];
    if (!value || (value.type !== 'missing' && value.type !== column.type)) throw new Error('Choose a source field with the same value type.');
    raw = value.type === 'missing' ? '' : value.type === 'quantity' ? `${value.value} ${value.unit}`
      : value.type === 'object' ? JSON.stringify(value.value) : String(value.value);
  }
  const parsed = parseTypedCell(column, raw);
  if ('error' in parsed) throw new Error(`The selected value does not meet the target column rules (${parsed.error}).`);
  return raw;
}

export function applyCatalogCellSelection(table: StructuredTableDraft, expected: StructuredTableDraft, rowId: string, columnId: string,
  snapshot: CatalogSnapshot, recordId: string, selection: CatalogCellSelection): StructuredTableDraft {
  if (canonicalStructuredTable(table) !== canonicalStructuredTable(expected)) throw new Error('The table changed while the picker was open. Close it and select again.');
  const column = table.schema.columns.find(column => column.id === columnId);
  if (!column) throw new Error('The selected column no longer exists.');
  return changeStructuredTable(table, { type: 'cell', rowId, columnId, value: catalogCellValue(column, snapshot, recordId, selection) });
}

/** A committed receipt and optional blank-only autofill enter the draft in one transaction. */
export function applyRegistrationReceipt(current: StructuredTableAttributes, input: RegistrationInput, receipt: RegistrationReceipt): StructuredTableAttributes {
  if (canonicalStructuredValue(receipt.waiver ?? null) !== canonicalStructuredValue(input.waiver ?? null)) throw new Error('The catalog receipt does not match the approved waiver.');
  if (input.waiver && canonicalStructuredValue(createRegistrationWaiver(input.table, input.inputHash, input.waiver.reason, input.waiver.attribution)) !== canonicalStructuredValue(input.waiver)) throw new Error('The waiver is stale.');
  if (receipt.inputHash !== input.inputHash || receipt.submissionId !== input.submissionId || receipt.tableId !== input.table.id ||
      receipt.schemaId !== input.table.schema.id || receipt.schemaRevision !== input.table.schema.revision ||
      receipt.records.length !== input.table.rows.length || !input.table.rows.every(row => receipt.records.some(record => record.rowId === row.id))) {
    throw new Error('The catalog receipt does not match the submitted table and rows.');
  }
  if (canonicalStructuredTable(current.table) !== canonicalStructuredTable(input.table)) {
    throw new Error('The catalog committed the submitted snapshot, but this draft changed. No cells or receipts were replaced. Restore that input and retry to recover its receipt.');
  }
  let table = current.table;
  if (input.referenceColumnId) {
    const column = table.schema.columns.find(column => column.id === input.referenceColumnId);
    if (!column || column.type !== 'object' || column.required || validateStructuredColumn(column).length) throw new Error('Autofill requires an optional object column.');
    table = { ...table, rows: table.rows.map(row => {
      if ((row.cells[column.id] ?? '').trim()) return row;
      const record = receipt.records.find(record => record.rowId === row.id)!;
      const reference: CatalogEntityReference = { source: receipt.source, catalogId: receipt.catalogId, recordId: record.recordId,
        version: record.version, schemaId: receipt.schemaId, schemaRevision: receipt.schemaRevision };
      return { ...row, cells: { ...row.cells, [column.id]: JSON.stringify(reference) } };
    }) };
  }
  const known = current.receipts.find(item => item.catalogId === receipt.catalogId && item.submissionId === receipt.submissionId);
  if (known && canonicalStructuredValue(known) !== canonicalStructuredValue(receipt)) throw new Error('The catalog returned a conflicting receipt for this submission.');
  if (!known && current.receipts.length >= structuredTableLimits.receipts) throw new Error('This table has reached its retained receipt limit.');
  return { table, receipts: known ? current.receipts : [...current.receipts, receipt] };
}

function canonicalStructuredValue(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered) : object(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])])) : item;
  return JSON.stringify(ordered(value));
}

export function isRegistrationReceipt(value: unknown): value is RegistrationReceipt {
  return object(value) && auditFields(value, ['source', 'catalogId', 'submissionId', 'inputHash', 'tableId', 'schemaId', 'schemaRevision', 'registeredAt', 'records']) &&
    (!value.waiver || (value.waiver as RegistrationWaiver).inputHash === value.inputHash) && value.source === 'notebook-local-catalog' && id(value.catalogId) && id(value.submissionId) && digest(value.inputHash) && id(value.tableId) && id(value.schemaId) && integer(value.schemaRevision) && timestamp(value.registeredAt) &&
    Array.isArray(value.records) && value.records.length > 0 && value.records.length <= 200 && value.records.every(record => object(record) && fields(record, ['rowId', 'recordId', 'version']) &&
      id(record.rowId) && id(record.recordId) && integer(record.version)) &&
    (!value.waiver || (value.waiver as RegistrationWaiver).issues.every(issue => (value.records as { rowId: string }[]).some(row => row.rowId === issue.rowId))) && distinct(value.records.map(record => record.rowId)) && distinct(value.records.map(record => record.recordId));
}
export function isCatalogQuery(value: unknown): value is CatalogQuery {
  return object(value) && fields(value, ['schemaId', 'text', 'limit']) && (value.schemaId === '' || id(value.schemaId)) && text(value.text, 200) && integer(value.limit, 1, 200);
}
function isTypedCell(value: unknown): value is TypedCell {
  if (!object(value) || typeof value.type !== 'string') return false;
  if (value.type === 'missing') return fields(value, ['type']);
  if (value.type === 'quantity') return fields(value, ['type', 'value', 'unit']) && text(value.value, 4096) && decimal(value.value) && text(value.unit, 200) && !!value.unit.trim();
  if (!fields(value, ['type', 'value'])) return false;
  if (value.type === 'boolean') return typeof value.value === 'boolean';
  if (value.type === 'object') return object(value.value) && validJson(value.value) && JSON.stringify(value.value).length <= 4096;
  return text(value.value, 4096) && (value.type === 'text' || (value.type === 'decimal' && decimal(value.value)) || (value.type === 'date' && validDate(value.value)));
}
export function isCatalogSnapshot(value: unknown): value is CatalogSnapshot {
  if (!object(value) || !fields(value, ['source', 'catalogId', 'query', 'refreshedAt', 'total', 'records']) || value.source !== 'notebook-local-catalog' || !id(value.catalogId) || !isCatalogQuery(value.query) ||
      !timestamp(value.refreshedAt) || !integer(value.total, 0) || !Array.isArray(value.records) || value.records.length > value.query.limit || value.records.length > value.total) return false;
  return value.records.every(record => object(record) && auditFields(record, ['id', 'version', 'schemaId', 'schemaRevision', 'tableId', 'rowId', 'name', 'registeredAt', 'values', 'columns']) &&
    id(record.id) && integer(record.version) && id(record.schemaId) && integer(record.schemaRevision) && id(record.tableId) && id(record.rowId) && text(record.name, 200) && timestamp(record.registeredAt) &&
    Array.isArray(record.columns) && record.columns.length > 0 && record.columns.length <= 50 && record.columns.every(isStructuredColumn) && distinct(record.columns.map(column => column.id)) &&
    object(record.values) && fields(record.values, record.columns.map(column => column.id)) && Object.values(record.values).every(isTypedCell) &&
    (!(record.waiver as RegistrationWaiver | undefined)?.issues.some(issue => issue.rowId === record.rowId && !(record.columns as StructuredColumn[]).some(column => column.id === issue.columnId))) &&
    record.columns.every(column => {
      const value = (record.values as Record<string, TypedCell>)[column.id];
      if (validateStructuredColumn(column).length) return false;
      const waived = (record.waiver as RegistrationWaiver | undefined)?.issues.some(issue => issue.rowId === record.rowId && issue.columnId === column.id) ?? false;
      if (waived && (value.type !== 'missing' || !column.required)) return false;
      if (value.type === 'missing') return !column.required || waived;
      return value.type === column.type && (value.type !== 'quantity' || column.units.includes(value.unit)) &&
        (value.type !== 'text' || !column.options.length || column.options.includes(value.value.trim()));
    })) && distinct(value.records.map(record => record.id));
}

/** Clipboard and persisted-document boundary. Imported receipts are snapshots, not owner verification. */
export function isStructuredTableAttributes(kind: string, attrs: Record<string, unknown>): boolean {
  if (kind === 'lookupTable') return isCatalogQuery(attrs.query) && (attrs.snapshot === null || isCatalogSnapshot(attrs.snapshot));
  return (kind === 'inputTable' || kind === 'registrationTable') && isStructuredTable(attrs.table) && Array.isArray(attrs.receipts) && attrs.receipts.length <= structuredTableLimits.receipts &&
    attrs.receipts.every(isRegistrationReceipt) && distinct(attrs.receipts.map(receipt => `${receipt.catalogId}:${receipt.submissionId}`));
}
