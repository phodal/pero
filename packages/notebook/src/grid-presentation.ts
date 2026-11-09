import { spreadsheetLimits, type CellAnnotation } from './document.ts';
import { cellAddress, type CellValue, type Spreadsheet } from './spreadsheet.ts';
import { normalizeCellRange, rangeContains, type CellPosition, type CellRange } from './spreadsheet-range.ts';

export type CellColor = 'default' | 'blue' | 'green' | 'rose';
export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  foreground?: CellColor;
  background?: CellColor;
  align?: 'left' | 'center' | 'right';
  precision?: number;
}
export interface GridPresentation {
  formats: Record<string, CellFormat>;
  rowHeights: Record<string, number>;
  columnWidths: Record<string, number>;
  merges: CellRange[];
}
export interface WorksheetGrid extends GridPresentation {
  sheet: Spreadsheet;
  annotations: Record<string, CellAnnotation>;
}
export const gridDimensionLimits = { row: { min: 24, max: 240, default: 32 }, column: { min: 64, max: 640, default: 120 } } as const;
export const emptyGridPresentation = (): GridPresentation => ({ formats: {}, rowHeights: {}, columnWidths: {}, merges: [] });

export function cellPosition(address: string): CellPosition | null {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(address);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column: column - 1, row: Number(match[2]) - 1 };
}
export function rangeInGrid(sheet: Spreadsheet, range: CellRange): boolean {
  return [range.start.column, range.start.row, range.end.column, range.end.row].every(Number.isInteger) &&
    range.start.column >= 0 && range.start.row >= 0 && range.end.column < sheet.columns && range.end.row < sheet.rows &&
    range.start.column <= range.end.column && range.start.row <= range.end.row;
}
export function rangesIntersect(a: CellRange, b: CellRange): boolean {
  return a.start.column <= b.end.column && a.end.column >= b.start.column && a.start.row <= b.end.row && a.end.row >= b.start.row;
}
export function mergedCell(merges: readonly CellRange[], position: CellPosition): CellRange | undefined {
  return merges.find(range => rangeContains(range, position));
}
/** Presentation never changes formula inputs, values or scientific annotations. */
export function formatCellRange(grid: WorksheetGrid, range: CellRange, patch: CellFormat | null): WorksheetGrid {
  if (!rangeInGrid(grid.sheet, range) || (patch?.precision !== undefined && (!Number.isInteger(patch.precision) || patch.precision < 0 || patch.precision > 12))) return grid;
  const formats = { ...grid.formats };
  for (let row = range.start.row; row <= range.end.row; row++) {
    for (let column = range.start.column; column <= range.end.column; column++) {
      const address = cellAddress(column, row);
      if (patch === null) delete formats[address];
      else {
        formats[address] = { ...formats[address], ...patch };
        for (const key of Object.keys(formats[address]) as (keyof CellFormat)[]) {
          if (formats[address][key] === undefined) delete formats[address][key];
        }
        if (!Object.keys(formats[address]).length) delete formats[address];
      }
    }
  }
  return { ...grid, formats };
}
export function resizeGridAxis(grid: WorksheetGrid, axis: 'row' | 'column', index: number, pixels: number): WorksheetGrid | null {
  const limit = gridDimensionLimits[axis];
  if (!Number.isInteger(index) || index < 0 || index >= (axis === 'row' ? grid.sheet.rows : grid.sheet.columns) ||
      !Number.isInteger(pixels) || pixels < limit.min || pixels > limit.max) return null;
  return axis === 'row' ? { ...grid, rowHeights: { ...grid.rowHeights, [index]: pixels } } :
    { ...grid, columnWidths: { ...grid.columnWidths, [index]: pixels } };
}
export type MergeResult = { status: 'ok'; grid: WorksheetGrid } | { status: 'invalid' | 'overlap' | 'confirmation-required' };
/** Merges only hide covered cells. Every input and annotation is retained and reappears on unmerge. */
export function mergeCellRange(grid: WorksheetGrid, range: CellRange, confirmed = false): MergeResult {
  if (!rangeInGrid(grid.sheet, range) || (range.start.column === range.end.column && range.start.row === range.end.row)) return { status: 'invalid' };
  if (grid.merges.some(existing => rangesIntersect(existing, range))) return { status: 'overlap' };
  if (!confirmed) return { status: 'confirmation-required' };
  return { status: 'ok', grid: { ...grid, merges: [...grid.merges, structuredClone(range)] } };
}
export function unmergeCellRange(grid: WorksheetGrid, range: CellRange): WorksheetGrid {
  return { ...grid, merges: grid.merges.filter(existing => !rangesIntersect(existing, range)) };
}
/** Multi-cell writes into merged regions must be explicit: unmerge first. */
export function gridWriteConflicts(grid: WorksheetGrid, range: CellRange): boolean {
  return grid.merges.some(merge => rangesIntersect(merge, range));
}
/** Display-only. A long tail of 0s or 9s is binary residue; exact integers and other long values stay. */
function displayNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const text = String(value);
  if (Number.isInteger(value)) return text;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return text;
  const [, sign, whole, fraction = '', exponent = ''] = match;
  const digits = `${whole}${fraction}`;
  const run = /([09])\1{7,}/.exec(digits);
  if (!run || (run.index === 0 && run[1] === '0')) return text;
  const tail = digits.slice(run.index);
  if (!/^([09])\1{7,}\d{0,2}$/.test(tail)) return text;
  const keep = digits.slice(0, run.index);
  let rounded = keep;
  if (run[1] === '9') {
    const chars = [...keep];
    let index = chars.length - 1;
    while (index >= 0 && chars[index] === '9') { chars[index] = '0'; index -= 1; }
    if (index < 0) chars.unshift('1');
    else chars[index] = String(Number(chars[index]) + 1);
    rounded = chars.join('');
  }
  const point = whole.length + rounded.length - keep.length;
  const coefficient = (point <= 0 ? `0.${'0'.repeat(-point)}${rounded}`
    : point >= rounded.length ? `${rounded}${'0'.repeat(point - rounded.length)}`
    : `${rounded.slice(0, point)}.${rounded.slice(point).replace(/0+$/, '')}`).replace(/\.$/, '');
  const parsed = Number(`${sign}${coefficient}${exponent ? `e${exponent.replace(/^\+/, '')}` : ''}`);
  const scale = Math.max(Math.abs(value), Math.abs(parsed));
  if (!Number.isFinite(parsed) || (scale !== 0 && Math.abs(parsed - value) / scale > 1e-12)) return text;
  return String(parsed);
}
export function formatCellValue(value: CellValue | undefined, format?: CellFormat): string {
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value !== 'number') return String(value);
  return format?.precision !== undefined ? value.toFixed(format.precision) : displayNumber(value);
}
/** CSV contains evaluated values, not source formulas. Protect text from formula injection on spreadsheet import. */
export function exportWorksheetCsv(sheet: Spreadsheet, values: Record<string, CellValue>): string {
  return Array.from({ length: sheet.rows }, (_, row) => Array.from({ length: sheet.columns }, (_, column) => {
    const value = values[cellAddress(column, row)] ?? '';
    const text = typeof value === 'string' && /^[\s]*[=+\-@]/.test(value) ? `'${value}` : formatCellValue(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n');
}
export function clipboardTarget(target: CellPosition, rows: readonly (readonly string[])[]): CellRange | null {
  const width = Math.max(0, ...rows.map(row => row.length));
  if (!width || !rows.length || target.column < 0 || target.row < 0 ||
      target.column + width > spreadsheetLimits.columns || target.row + rows.length > spreadsheetLimits.rows) return null;
  return normalizeCellRange(target, { column: target.column + width - 1, row: target.row + rows.length - 1 });
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
/** Persisted/imported presentation boundary. Missing fields are legacy defaults. */
export function isGridPresentation(value: unknown, sheet: Spreadsheet): boolean {
  if (!record(value)) return false;
  const formats = value.formats === undefined ? {} : value.formats;
  if (!record(formats) || Object.keys(formats).length > sheet.rows * sheet.columns) return false;
  for (const [address, format] of Object.entries(formats)) {
    const position = cellPosition(address);
    if (!position || position.column >= sheet.columns || position.row >= sheet.rows || !record(format)) return false;
    for (const [key, setting] of Object.entries(format)) {
      if (['bold', 'italic', 'underline'].includes(key)) { if (typeof setting !== 'boolean') return false; }
      else if (key === 'foreground' || key === 'background') { if (!['default', 'blue', 'green', 'rose'].includes(setting as string)) return false; }
      else if (key === 'align') { if (!['left', 'center', 'right'].includes(setting as string)) return false; }
      else if (key === 'precision') { if (typeof setting !== 'number' || !Number.isInteger(setting) || setting < 0 || setting > 12) return false; }
      else return false;
    }
  }
  for (const [key, axis, count] of [['rowHeights', 'row', sheet.rows], ['columnWidths', 'column', sheet.columns]] as const) {
    const dimensions = value[key] === undefined ? {} : value[key];
    if (!record(dimensions) || Object.keys(dimensions).length > count) return false;
    const limit = gridDimensionLimits[axis];
    if (Object.entries(dimensions).some(([index, pixels]) => !/^(?:0|[1-9]\d*)$/.test(index) || Number(index) >= count ||
      typeof pixels !== 'number' || !Number.isInteger(pixels) || pixels < limit.min || pixels > limit.max)) return false;
  }
  const merges = value.merges === undefined ? [] : value.merges;
  if (!Array.isArray(merges) || merges.length > Math.floor(sheet.rows * sheet.columns / 2)) return false;
  const occupied = new Set<string>();
  for (const merge of merges) {
    if (!record(merge) || Object.keys(merge).some(key => key !== 'start' && key !== 'end') ||
        !record(merge.start) || !record(merge.end)) return false;
    for (const point of [merge.start, merge.end]) {
      if (Object.keys(point).length !== 2 || Object.keys(point).some(key => key !== 'column' && key !== 'row') ||
          typeof point.column !== 'number' || typeof point.row !== 'number') return false;
    }
    const range = merge as unknown as CellRange;
    if (!rangeInGrid(sheet, range) || (range.start.row === range.end.row && range.start.column === range.end.column)) return false;
    for (let row = range.start.row; row <= range.end.row; row++) for (let column = range.start.column; column <= range.end.column; column++) {
      const address = cellAddress(column, row);
      if (occupied.has(address)) return false;
      occupied.add(address);
    }
  }
  return true;
}
