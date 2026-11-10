/** Local-catalog source selection. Bindings are frozen evidence, not physical inventory. */
import { isCatalogSnapshot, type CatalogSnapshot, type CatalogRecord } from './structured-table.ts';
import { createPlate, plateWellIndex, plateWellName, type PlateSize } from './science-plate.ts';
export const intakeModes = ['manual', 'barcode', 'worklist', 'table', 'plate'] as const;
export type IntakeMode = typeof intakeModes[number];
export interface IntakeSource { mode: IntakeMode; input: string; fileName: string; row: number; well: string; field: string }
export interface IntakeBinding { source: IntakeSource; snapshot: CatalogSnapshot }
export interface SampleIntake { name: string; mode: IntakeMode; field: string; schemaId: string; input: string; fileName: string; plateSize: PlateSize; bindings: IntakeBinding[] }
export interface IntakeRequest { input: string; row: number; well: string }
export interface IntakeResult { request: IntakeRequest; snapshot: CatalogSnapshot; candidates: CatalogRecord[]; status: 'missing' | 'unique' | 'ambiguous' | 'incomplete' | 'duplicate' }
export const sampleIntakeDefaults = { intake: { name: '', mode: 'manual', field: '$id', schemaId: '', input: '', fileName: '', plateSize: { rows: 8, columns: 12 }, bindings: [] } as SampleIntake };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, n: number): v is string => typeof v === 'string' && [...v].length <= n;
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const mode = (v: unknown): v is IntakeMode => intakeModes.includes(v as IntakeMode);
const identifier = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const field = (v: unknown) => v === '$id' || identifier(v);
function validSource(v: unknown, size: PlateSize): v is IntakeSource {
  if (!object(v) || !keys(v, ['mode', 'input', 'fileName', 'row', 'well', 'field']) || !mode(v.mode) || !text(v.input, 200) || !v.input.trim() || !text(v.fileName, 200) || !field(v.field) || !Number.isInteger(v.row) || Number(v.row) < 1 || Number(v.row) > 200 || !text(v.well, 5)) return false;
  if (v.mode !== 'plate') return v.well === '';
  try { return plateWellName(plateWellIndex(v.well, size), size) === v.well; } catch { return false; }
}
export function exactIntakeMatch(record: CatalogRecord, input: string, column: string): boolean {
  if (column === '$id') return record.id === input;
  const cell = record.values[column];
  return cell?.type === 'text' && cell.value === input;
}
export function isSampleIntake(v: unknown): v is SampleIntake {
  if (!object(v) || !keys(v, ['name', 'mode', 'field', 'schemaId', 'input', 'fileName', 'plateSize', 'bindings']) || !text(v.name, 200) || !mode(v.mode) || !field(v.field) || !(v.schemaId === '' || identifier(v.schemaId)) || !text(v.input, 100000) || !text(v.fileName, 200) || !object(v.plateSize) || !keys(v.plateSize, ['rows', 'columns'])) return false;
  try { createPlate(Number(v.plateSize.rows), Number(v.plateSize.columns)); } catch { return false; }
  if (typeof v.plateSize.rows !== 'number' || typeof v.plateSize.columns !== 'number' || !Array.isArray(v.bindings) || v.bindings.length > 200) return false;
  const size = v.plateSize as unknown as PlateSize;
  if (!v.bindings.every(b => object(b) && keys(b, ['source', 'snapshot']) && validSource(b.source, size) && isCatalogSnapshot(b.snapshot) && b.snapshot.records.length === 1 && exactIntakeMatch(b.snapshot.records[0], b.source.input, b.source.field))) return false;
  const bindings = v.bindings as IntakeBinding[];
  return new Set(bindings.map(b => `${b.snapshot.catalogId}:${b.snapshot.records[0].id}:${b.source.well}`)).size === bindings.length &&
    new Set(bindings.filter(b => b.source.well).map(b => b.source.well)).size === bindings.filter(b => b.source.well).length;
}
export function isSampleIntakeAttributes(attrs: Record<string, unknown>): boolean { return isSampleIntake(attrs.intake); }

/** Bounded RFC-style quoted CSV/TSV parser; malformed quotes are errors, never silently split. */
export function parseIntakeFile(raw: string, delimiter: ',' | '\t'): string[][] {
  if (raw.length > 100000) throw new Error('File exceeds 100,000 characters.');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const finishCell = () => { if (cell.length > 4096 || row.length >= 50) throw new Error('Cell or column limit exceeded.'); row.push(cell); cell = ''; closed = false; };
  const finishRow = () => { finishCell(); if (row.some(v => v !== '')) rows.push(row); row = []; if (rows.length > 201) throw new Error('Use at most 200 data rows.'); };
  raw = raw.replace(/^\uFEFF/, '');
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) { if (c === '"') { if (raw[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += c; }
    else if (c === delimiter) finishCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && raw[i + 1] === '\n') i++; finishRow(); }
    else if (c === '"' && !cell && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('Malformed quoted field.'); cell += c; }
  }
  if (quoted) throw new Error('Unclosed quoted field.');
  if (cell || row.length || closed) finishRow();
  return rows;
}
export function intakeRequests(intake: SampleIntake): IntakeRequest[] {
  let requests: IntakeRequest[];
  if (intake.mode === 'table' || intake.mode === 'plate') {
    const rows = parseIntakeFile(intake.input, intake.fileName.toLowerCase().endsWith('.csv') ? ',' : '\t');
    const header = rows.shift();
    if (!header || header[0] !== (intake.mode === 'plate' ? 'well' : 'id') || (intake.mode === 'plate' && header[1] !== 'id')) throw new Error('Expected headers: id (table) or well and id (plate).');
    requests = rows.map((r, i) => {
      if (r.length !== (intake.mode === 'plate' ? 2 : 1)) throw new Error('Unexpected number of columns.');
      return { input: r[intake.mode === 'plate' ? 1 : 0], row: i + 1, well: intake.mode === 'plate' ? plateWellName(plateWellIndex(r[0], intake.plateSize), intake.plateSize) : '' };
    });
  } else requests = intake.input.split(/\r?\n/).filter(v => v.trim()).map((input, i) => ({ input: input.trim(), row: i + 1, well: '' }));
  if (!requests.length || requests.length > 200 || requests.some(r => !r.input.trim() || r.input.length > 200)) throw new Error('Enter 1–200 identifiers, at most 200 characters each.');
  if (new Set(requests.filter(r => r.well).map(r => r.well)).size !== requests.filter(r => r.well).length) throw new Error('Each plate well must occur only once.');
  return requests;
}
export function resolveIntake(request: IntakeRequest, snapshot: CatalogSnapshot, column: string, prior: readonly IntakeRequest[] = []): IntakeResult {
  const candidates = snapshot.records.filter(r => exactIntakeMatch(r, request.input, column));
  const status = prior.some(r => r.input === request.input && r.well === request.well) ? 'duplicate' : snapshot.total > snapshot.records.length ? 'incomplete' : candidates.length === 0 ? 'missing' : candidates.length === 1 ? 'unique' : 'ambiguous';
  return { request, snapshot, candidates, status };
}
export function bindIntake(intake: SampleIntake, result: IntakeResult, recordId: string): SampleIntake {
  if (result.status === 'incomplete' || result.status === 'duplicate') throw new Error('Resolve incomplete or duplicate input first.');
  const record = result.candidates.find(r => r.id === recordId);
  if (!record || !exactIntakeMatch(record, result.request.input, intake.field)) throw new Error('Select a matching catalog record.');
  const source = { mode: intake.mode, input: result.request.input, fileName: intake.fileName, row: result.request.row, well: result.request.well, field: intake.field };
  const snapshot = { ...result.snapshot, records: [record] };
  const next = { ...intake, bindings: [...intake.bindings, structuredClone({ source, snapshot })] };
  if (!isSampleIntake(next)) throw new Error('Duplicate record, occupied well, or binding limit reached.');
  return next;
}

/** The user chooses a real text field as a box/location label. No inventory schema is assumed. */
export interface CatalogBox { label: string; records: CatalogRecord[] }
export function catalogBoxes(snapshot: CatalogSnapshot, fieldId: string): CatalogBox[] {
  const groups = new Map<string, CatalogRecord[]>();
  for (const record of snapshot.records) {
    const cell = record.values[fieldId];
    if (!record.columns.some(column => column.id === fieldId && column.type === 'text') || cell?.type !== 'text' || !cell.value.trim()) continue;
    const group = groups.get(cell.value) ?? []; group.push(record); groups.set(cell.value, group);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, records]) => ({ label, records }));
}
export function bindCatalogSelection(intake: SampleIntake, snapshot: CatalogSnapshot, recordIds: readonly string[]): SampleIntake {
  if (!recordIds.length || new Set(recordIds).size !== recordIds.length) throw new Error('Choose distinct existing catalog records.');
  const bindings = recordIds.map((id, index) => {
    const record = snapshot.records.find(record => record.id === id);
    if (!record) throw new Error('Selected catalog record is no longer in this result.');
    return { source: { mode: 'manual' as const, input: id, fileName: '', row: intake.bindings.length + index + 1, well: '', field: '$id' },
      snapshot: { ...snapshot, records: [record] } };
  });
  const next = { ...intake, bindings: [...intake.bindings, ...structuredClone(bindings)] };
  if (!isSampleIntake(next)) throw new Error('Duplicate record or binding limit reached.');
  return next;
}
export interface IntakePropagation {
  sourceId: string; targetId: string; sourceBefore: string; targetBefore: string; bindingCount: number; targetAfter: SampleIntake;
}
/** Stage immutable associations into another intake block, never inventory movement. */
export function stageIntakePropagation(sourceId: string, source: SampleIntake, targetId: string, target: SampleIntake): IntakePropagation {
  if (!sourceId || !targetId || sourceId === targetId) throw new Error('Choose a different destination intake block.');
  if (!source.bindings.length) throw new Error('Select source records before staging.');
  if (source.bindings.some(binding => binding.source.well) && (source.plateSize.rows !== target.plateSize.rows || source.plateSize.columns !== target.plateSize.columns)) throw new Error('Source and destination plate sizes must match.');
  const targetAfter = { ...target, bindings: structuredClone([...target.bindings, ...source.bindings]) };
  if (!isSampleIntake(targetAfter)) throw new Error('Destination contains duplicate records, occupied wells, or exceeds the binding limit.');
  return { sourceId, targetId, sourceBefore: JSON.stringify(source), targetBefore: JSON.stringify(target), bindingCount: source.bindings.length, targetAfter };
}
export function applyIntakePropagation(plan: IntakePropagation, source: SampleIntake, target: SampleIntake): SampleIntake {
  if (JSON.stringify(source) !== plan.sourceBefore || JSON.stringify(target) !== plan.targetBefore) throw new Error('Source or destination changed. Stage the propagation again.');
  return structuredClone(plan.targetAfter);
}
/** CSV for review, with spreadsheet-formula escaping. JSON export preserves exact values. */
export function intakeWorklistCsv(intake: SampleIntake): string {
  const quote = (value: string | number) => {
    const text = String(value), safe = /^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows: (string | number)[][] = [['recordId', 'version', 'catalogId', 'name', 'sourceMode', 'sourceInput', 'sourceField', 'sourceFile', 'sourceRow', 'well', 'refreshedAt']];
  for (const { source, snapshot } of intake.bindings) {
    const record = snapshot.records[0];
    rows.push([record.id, record.version, snapshot.catalogId, record.name, source.mode, source.input, source.field, source.fileName, source.row, source.well, snapshot.refreshedAt]);
  }
  return rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
