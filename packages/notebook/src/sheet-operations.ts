import { cellPosition, type WorksheetGrid } from './grid-presentation.ts';
import { cellAddress, evaluateSpreadsheet, type CellValue, type Spreadsheet } from './spreadsheet.ts';

/** Short researcher text stored on a cell. It is not a unit, an evidence id, or a link. */
export const sheetOperationLimits = { note: 500, query: 200 } as const;

export type SortDirection = 'asc' | 'desc';

/** A contains-filter over one column. Hidden rows stay in the sheet. */
export interface RowFilter {
  column: number;
  query: string;
}

export interface OperableGrid extends WorksheetGrid {
  notes: Record<string, string>;
  rowFilter: RowFilter | null;
}

export interface SortOptions {
  /** Formulas qualified with this sheet pin local rows. Other sheets do not. */
  sheetName?: string;
}

export type SortFailure =
  | { status: 'invalid' }
  | { status: 'formula'; address: string; reason: 'sort-key' | 'reference' | 'opaque' }
  | { status: 'split-merge' };

export type SortResult = { status: 'ok'; grid: OperableGrid } | SortFailure;

export type NoteResult = { status: 'ok'; grid: OperableGrid } | { status: 'invalid' | 'limit' };

export type FilterResult = { status: 'ok'; grid: OperableGrid } | { status: 'invalid' | 'limit' };

type SortKind = 'number' | 'boolean' | 'text' | 'blank';

interface SortKey {
  kind: SortKind;
  number: number;
  boolean: boolean;
  text: string;
  index: number;
}

const kindRank: Record<Exclude<SortKind, 'blank'>, number> = { number: 0, boolean: 1, text: 2 };
const numberLiteral = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i;
const qualifierPattern = String.raw`(?:'(?:[^']|'')+'|[\p{L}\p{N}_.]+)!`;
const cellPattern = String.raw`\$?[A-Z]{1,3}\$?[1-9]\d*`;
const referencePattern = new RegExp(
  `^(?:(${qualifierPattern}))?(#REF!|${cellPattern}(?:\\s*:\\s*${cellPattern})?|\\$?[A-Z]{1,3}\\s*:\\s*\\$?[A-Z]{1,3}|\\$?[1-9]\\d*\\s*:\\s*\\$?[1-9]\\d*)(?![\\p{L}\\p{N}_.$!])`,
  'iu',
);

function codePoints(text: string): string[] {
  return [...text];
}

function singleLine(text: string, maximum: number): boolean {
  const points = codePoints(text);
  return points.length <= maximum && points.every(character => character.charCodeAt(0) >= 32);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Missing notes and rowFilter are an unfiltered sheet. Invalid records are rejected. */
export function asOperableGrid(grid: WorksheetGrid & Partial<Pick<OperableGrid, 'notes' | 'rowFilter'>>): OperableGrid {
  if (grid.notes && grid.rowFilter !== undefined) return grid as OperableGrid;
  return { ...grid, notes: grid.notes ?? {}, rowFilter: grid.rowFilter ?? null };
}

/** Spreadsheet fields this module owns. Empty notes and a cleared filter are omitted. */
export function sheetOperationRecord(grid: OperableGrid): { notes?: Record<string, string>; rowFilter?: RowFilter } {
  const persisted: { notes?: Record<string, string>; rowFilter?: RowFilter } = {};
  if (Object.keys(grid.notes).length) persisted.notes = grid.notes;
  if (grid.rowFilter) persisted.rowFilter = grid.rowFilter;
  return persisted;
}

/** Entry check for notes and rowFilter on a spreadsheet node. Other attrs are ignored. */
export function parseSheetOperations(value: unknown, sheet: Spreadsheet): { notes: Record<string, string>; rowFilter: RowFilter | null } | null {
  if (!record(value)) return null;
  const notesValue = value.notes === undefined ? {} : value.notes;
  if (!record(notesValue) || Object.keys(notesValue).length > sheet.rows * sheet.columns) return null;
  const notes: Record<string, string> = {};
  for (const [address, note] of Object.entries(notesValue)) {
    const position = cellPosition(address);
    if (!position || position.column >= sheet.columns || position.row >= sheet.rows) return null;
    if (typeof note !== 'string' || note !== note.trim() || !note || !singleLine(note, sheetOperationLimits.note)) return null;
    notes[address] = note;
  }
  if (value.rowFilter === undefined || value.rowFilter === null) return { notes, rowFilter: null };
  const filter = value.rowFilter;
  if (!record(filter) || Object.keys(filter).some(key => key !== 'column' && key !== 'query')) return null;
  const { column, query } = filter;
  if (typeof column !== 'number' || !Number.isInteger(column) || column < 0 || column >= sheet.columns) return null;
  if (typeof query !== 'string' || query !== query.trim() || !query || !singleLine(query, sheetOperationLimits.query)) return null;
  return { notes, rowFilter: { column, query } };
}

function valueKey(source: string | undefined, index: number): SortKey | 'formula' {
  const blank = (): SortKey => ({ kind: 'blank', number: 0, boolean: false, text: '', index });
  if (!source) return blank();
  if (source.startsWith('=')) return 'formula';
  if (source.startsWith("'")) return { kind: 'text', number: 0, boolean: false, text: source.slice(1), index };
  const text = source.trim();
  if (!text) return { kind: 'text', number: 0, boolean: false, text: source, index };
  const upper = text.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') return { kind: 'boolean', number: 0, boolean: upper === 'TRUE', text: '', index };
  if (numberLiteral.test(text)) {
    const value = text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
    if (Number.isFinite(value)) return { kind: 'number', number: value, boolean: false, text: '', index };
  }
  return { kind: 'text', number: 0, boolean: false, text, index };
}

function compareKeys(left: SortKey, right: SortKey, direction: SortDirection): number {
  if (left.kind === 'blank' || right.kind === 'blank') {
    if (left.kind === right.kind) return left.index - right.index;
    return left.kind === 'blank' ? 1 : -1;
  }
  const sign = direction === 'asc' ? 1 : -1;
  if (left.kind !== right.kind) return sign * (kindRank[left.kind] - kindRank[right.kind]);
  if (left.kind === 'number' && left.number !== right.number) return sign * (left.number < right.number ? -1 : 1);
  if (left.kind === 'boolean' && left.boolean !== right.boolean) return sign * (left.boolean ? 1 : -1);
  if (left.kind === 'text') {
    const folded = left.text.toLowerCase();
    const other = right.text.toLowerCase();
    if (folded < other) return sign * -1;
    if (folded > other) return sign * 1;
    if (left.text < right.text) return sign * -1;
    if (left.text > right.text) return sign * 1;
  }
  return left.index - right.index;
}

interface ReferenceEnd { column: number | null; row: number | null }

function referenceEnd(value: string): ReferenceEnd | null {
  const match = /^(\$?)([A-Z]{1,3})?(\$?)([1-9]\d*)?$/i.exec(value);
  if (!match || (!match[2] && !match[4])) return null;
  let column: number | null = null;
  if (match[2]) {
    column = 0;
    for (const letter of match[2].toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
    column -= 1;
  }
  return { column, row: match[4] ? Number(match[4]) - 1 : null };
}

function pinSpan(start: number, end: number, rows: number, into: Set<number>) {
  const low = Math.max(0, Math.min(start, end));
  const high = Math.min(rows - 1, Math.max(start, end));
  for (let row = low; row <= high; row++) into.add(row);
}

function qualifierKind(prefix: string, sheetName: string | undefined): 'local' | 'external' | 'opaque' {
  const quoted = prefix.startsWith("'");
  if (quoted && !prefix.endsWith("'!")) return 'opaque';
  const name = quoted ? prefix.slice(1, -2).replaceAll("''", "'") : prefix.slice(0, -1);
  if (name.includes('[') || name.includes(']') || name.includes(':') || !sheetName) return 'opaque';
  return name.toLowerCase() === sheetName.toLowerCase() ? 'local' : 'external';
}

/** Rows of this sheet named by a formula. Opaque means the formula is not safe to move unchanged. */
function pinnedRows(source: string, rows: number, sheetName: string | undefined): Set<number> | 'opaque' {
  const pins = new Set<number>();
  let offset = 1;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const literal = /^(?:"(?:[^"]|"")*"|#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|NULL!|CIRC!|ERROR!))/.exec(rest);
    const fn = /^([A-Z_][A-Z_0-9.]*)\s*(?=\()/i.exec(rest);
    const reference = referencePattern.exec(rest);
    const ordinary = /^(?:\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|TRUE\b|FALSE\b|[\s+\-*/^&%=<>,();])/i.exec(rest);
    if (literal?.[0]) { offset += literal[0].length; continue; }
    if (fn?.[0]) {
      if (fn[1].toUpperCase() === 'INDIRECT' || fn[1].toUpperCase() === 'OFFSET') return 'opaque';
      offset += fn[0].length;
      continue;
    }
    if (reference?.[0]) {
      const prefix = reference[1];
      if (prefix) {
        const kind = qualifierKind(prefix, sheetName);
        if (kind === 'opaque') return 'opaque';
        if (kind === 'external') { offset += reference[0].length; continue; }
      }
      const body = reference[2];
      if (body !== '#REF!') {
        const parts = body.split(/\s*:\s*/);
        const start = referenceEnd(parts[0]);
        const end = referenceEnd(parts[1] ?? parts[0]);
        if (!start || !end || (start.row === null) !== (end.row === null)) return 'opaque';
        if (start.column !== null && end.column !== null && start.column > end.column) return 'opaque';
        if (start.row !== null && end.row !== null) {
          if (start.row > end.row) return 'opaque';
          pinSpan(start.row, end.row, rows, pins);
        }
      }
      offset += reference[0].length;
      continue;
    }
    if (ordinary?.[0]) { offset += ordinary[0].length; continue; }
    return 'opaque';
  }
  return pins;
}

function formulaBlock(grid: OperableGrid, moved: ReadonlySet<number>, sheetName: string | undefined): SortFailure | null {
  for (let row = 0; row < grid.sheet.rows; row++) {
    for (let column = 0; column < grid.sheet.columns; column++) {
      const address = cellAddress(column, row);
      const source = grid.sheet.cells[address];
      if (!source?.startsWith('=')) continue;
      const pins = pinnedRows(source, grid.sheet.rows, sheetName);
      if (pins === 'opaque') return { status: 'formula', address, reason: 'opaque' };
      for (const pinned of pins) if (moved.has(pinned)) return { status: 'formula', address, reason: 'reference' };
    }
  }
  return null;
}

function remapAddresses<T>(records: Record<string, T>, destination: ReadonlyMap<number, number>): Record<string, T> {
  const mapped: Record<string, T> = {};
  for (const [address, value] of Object.entries(records)) {
    const position = cellPosition(address);
    const row = position ? destination.get(position.row) : undefined;
    mapped[position && row !== undefined ? cellAddress(position.column, row) : address] = value;
  }
  return mapped;
}

function remapIndexes(records: Record<string, number>, destination: ReadonlyMap<number, number>): Record<string, number> {
  const mapped: Record<string, number> = {};
  for (const [key, value] of Object.entries(records)) {
    const next = destination.get(Number(key));
    mapped[next === undefined ? key : String(next)] = value;
  }
  return mapped;
}

function moveMerges(grid: OperableGrid, destination: ReadonlyMap<number, number>): OperableGrid['merges'] | 'split' {
  const mapped: OperableGrid['merges'] = [];
  for (const merge of grid.merges) {
    if (merge.start.row !== merge.end.row) {
      for (let row = merge.start.row; row <= merge.end.row; row++) if (destination.get(row) !== row) return 'split';
      mapped.push({ start: { ...merge.start }, end: { ...merge.end } });
      continue;
    }
    const row = destination.get(merge.start.row);
    if (row === undefined) return 'split';
    mapped.push({ start: { column: merge.start.column, row }, end: { column: merge.end.column, row } });
  }
  return mapped;
}

/**
 * Reorder whole rows by one column's stored values.
 * Formula text is not rewritten. A formula sort key, a formula that names a row
 * which would move, or a formula this module cannot prove is local and static,
 * rejects the sort and leaves the grid unchanged.
 */
export function sortGridColumn(grid: OperableGrid, column: number, direction: SortDirection, options: SortOptions = {}): SortResult {
  if (!Number.isInteger(column) || column < 0 || column >= grid.sheet.columns || (direction !== 'asc' && direction !== 'desc')) {
    return { status: 'invalid' };
  }
  if (grid.sheet.rows < 2) return { status: 'ok', grid };
  const keys: SortKey[] = [];
  for (let row = 0; row < grid.sheet.rows; row++) {
    const key = valueKey(grid.sheet.cells[cellAddress(column, row)], row);
    if (key === 'formula') return { status: 'formula', address: cellAddress(column, row), reason: 'sort-key' };
    keys.push(key);
  }
  const order = keys.map(key => key.index).sort((left, right) => compareKeys(keys[left], keys[right], direction));
  if (order.every((old, index) => old === index)) return { status: 'ok', grid };
  const destination = new Map(order.map((old, next) => [old, next]));
  const moved = new Set([...destination].filter(([old, next]) => old !== next).map(([old]) => old));
  const blocked = formulaBlock(grid, moved, options.sheetName);
  if (blocked) return blocked;
  const merges = moveMerges(grid, destination);
  if (merges === 'split') return { status: 'split-merge' };
  return {
    status: 'ok',
    grid: {
      ...grid,
      sheet: { ...grid.sheet, cells: remapAddresses(grid.sheet.cells, destination) },
      formats: remapAddresses(grid.formats, destination),
      annotations: remapAddresses(grid.annotations, destination),
      notes: remapAddresses(grid.notes, destination),
      rowHeights: remapIndexes(grid.rowHeights, destination),
      merges,
    },
  };
}

function shownValue(value: CellValue | undefined): string {
  if (value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** Rows whose filter column contains the query. No filter returns every row. */
export function matchingRows(grid: OperableGrid): number[] {
  const filter = grid.rowFilter;
  const rows = Array.from({ length: grid.sheet.rows }, (_, row) => row);
  if (!filter || !Number.isInteger(filter.column) || filter.column < 0 || filter.column >= grid.sheet.columns || !filter.query) return rows;
  const values = evaluateSpreadsheet(grid.sheet);
  const needle = filter.query.toLowerCase();
  return rows.filter(row => {
    const address = cellAddress(filter.column, row);
    const stored = grid.sheet.cells[address] ?? '';
    const haystack = stored.startsWith('=') ? `${stored}\n${shownValue(values[address])}` : stored;
    return haystack.toLowerCase().includes(needle);
  });
}

export function hiddenRows(grid: OperableGrid): number[] {
  const visible = new Set(matchingRows(grid));
  return Array.from({ length: grid.sheet.rows }, (_, row) => row).filter(row => !visible.has(row));
}

/** Empty text clears the filter. The sheet cells are not changed. */
export function setRowFilter(grid: OperableGrid, column: number, query: string): FilterResult {
  if (!Number.isInteger(column) || column < 0 || column >= grid.sheet.columns) return { status: 'invalid' };
  const text = query.trim();
  if (!singleLine(text, sheetOperationLimits.query)) return text && codePoints(text).length > sheetOperationLimits.query ? { status: 'limit' } : { status: 'invalid' };
  const rowFilter: RowFilter | null = text ? { column, query: text } : null;
  if ((grid.rowFilter?.column ?? null) === (rowFilter?.column ?? null) && (grid.rowFilter?.query ?? '') === (rowFilter?.query ?? '')) {
    return { status: 'ok', grid };
  }
  return { status: 'ok', grid: { ...grid, rowFilter } };
}

/** Empty text removes the note. Annotations, values, and links are left as they are. */
export function setCellNote(grid: OperableGrid, address: string, text: string): NoteResult {
  const position = cellPosition(address);
  if (!position || position.column >= grid.sheet.columns || position.row >= grid.sheet.rows) return { status: 'invalid' };
  const note = text.trim();
  if (!singleLine(note, sheetOperationLimits.note)) return note && codePoints(note).length > sheetOperationLimits.note ? { status: 'limit' } : { status: 'invalid' };
  if ((grid.notes[address] ?? '') === note) return { status: 'ok', grid };
  const notes = { ...grid.notes };
  if (note) notes[address] = note;
  else delete notes[address];
  return { status: 'ok', grid: { ...grid, notes } };
}
