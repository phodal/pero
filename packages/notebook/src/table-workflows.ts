import { parseTypedCell, type CatalogQuery, type CatalogSnapshot, type CatalogRecord, type StructuredTableDraft, type StructuredRow, type StructuredColumn } from './structured-table.ts';

export interface TableViewDefinition { id: string; name: string; columns: string[]; text: string; sortColumn: string; descending: boolean }
export interface TableSourcePolicy {
  query: CatalogQuery; mappings: { sourceColumnId: string; targetColumnId: string }[];
  addNew: boolean; updateExisting: boolean; missing: 'keep' | 'remove-unedited';
}
export interface SourceBaseline { recordId: string; version: number; rowId: string; cells: Record<string, string>; overrides: string[] }
export interface TableWorkflow { revision: number; views: TableViewDefinition[]; source: TableSourcePolicy | null; baseline: SourceBaseline[]; lastApplied?: TableResyncResult | null }
export type TableWorkflowChange = { type: 'save-view'; view: TableViewDefinition } | { type: 'delete-view'; id: string } | { type: 'source'; source: TableSourcePolicy | null };
export interface ResyncChange { type: 'add-row' | 'update-cell' | 'remove-row' | 'preserve-manual' | 'preserve-manual-row' | 'preserve-deleted-row' | 'retain-missing-source'; rowId: string; columnId: string; before: string; after: string }
export interface TableResyncPreview { id: string; entryId: string; workflowRevision: number; inputTable: StructuredTableDraft; table: StructuredTableDraft; baseline: SourceBaseline[]; changes: ResyncChange[]; snapshot: CatalogSnapshot }
export interface TableResyncResult { previewId: string; entryId: string; inputTable: StructuredTableDraft; table: StructuredTableDraft; workflow: TableWorkflow; appliedAt: string }
export interface CatalogArchiveState {
  record: CatalogRecord; catalogId: string; archived: boolean; archiveRevision: number;
  history: { revision: number; recordVersion: number; archived: boolean; reason: string; occurredAt: string }[];
}

/** A saved view is a projection only: stable row IDs and source values are never rewritten. */
export function projectTableView(table: StructuredTableDraft, view: TableViewDefinition | null): { columns: StructuredColumn[]; rows: StructuredRow[] } {
  if (!view) return { columns: table.schema.columns, rows: table.rows };
  const columns = view.columns.map(id => table.schema.columns.find(column => column.id === id));
  if (!columns.length || columns.some(column => !column) || (view.sortColumn && !table.schema.columns.some(column => column.id === view.sortColumn))) throw new Error('This saved view references removed columns. Edit the view before using it.');
  const text = view.text.toLocaleLowerCase();
  const rows = table.rows.filter(row => !text || Object.values(row.cells).some(value => value.toLocaleLowerCase().includes(text)));
  const column = table.schema.columns.find(column => column.id === view.sortColumn);
  if (column) rows.sort((a, b) => {
    const rawA = a.cells[column.id] ?? '', rawB = b.cells[column.id] ?? '';
    const aValue = parseTypedCell(column, rawA), bValue = parseTypedCell(column, rawB);
    let compared = rawA.localeCompare(rawB);
    if ('value' in aValue && 'value' in bValue && aValue.value.type === 'decimal' && bValue.value.type === 'decimal') compared = Number(aValue.value.value) - Number(bValue.value.value);
    if ('value' in aValue && 'value' in bValue && aValue.value.type === 'quantity' && bValue.value.type === 'quantity' && aValue.value.unit === bValue.value.unit) compared = Number(aValue.value.value) - Number(bValue.value.value);
    return view.descending ? -compared : compared;
  });
  return { columns: columns as StructuredColumn[], rows };
}

/** Object property ordering from transport does not make a saved mapping dirty. */
export function sameTableSourcePolicy(left: TableSourcePolicy, right: TableSourcePolicy | null): boolean {
  return !!right && left.query.schemaId === right.query.schemaId && left.query.text === right.query.text && left.query.limit === right.query.limit &&
    left.addNew === right.addNew && left.updateExisting === right.updateExisting && left.missing === right.missing &&
    left.mappings.length === right.mappings.length && left.mappings.every(mapping => right.mappings.some(other => other.targetColumnId === mapping.targetColumnId && other.sourceColumnId === mapping.sourceColumnId));
}
