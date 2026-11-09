import { spreadsheetLimits } from './document.ts';
import { cellAddress } from './spreadsheet.ts';
import type { NotebookWorksheet } from './worksheet.ts';
import { cellPosition, type WorksheetGrid } from './grid-presentation.ts';
import type { CellPosition, CellRange } from './spreadsheet-range.ts';

export interface StructuredWorksheet extends NotebookWorksheet, WorksheetGrid {}
export type AxisChange = { axis: 'row' | 'column' } & (
  | { kind: 'insert'; index: number }
  | { kind: 'delete'; index: number }
  | { kind: 'move'; index: number; to: number }
);
export type StructureResult = { status: 'ok'; worksheets: StructuredWorksheet[] } |
  { status: 'invalid' | 'limit' | 'ambiguous' | 'unsupported-formula' | 'split-range'; detail?: string };
type IndexMap = (index: number) => number | null;
function axisMap(change: AxisChange): IndexMap {
  return value => {
    if (change.kind === 'insert') return value >= change.index ? value + 1 : value;
    if (change.kind === 'delete') return value === change.index ? null : value > change.index ? value - 1 : value;
    if (value === change.index) return change.to;
    if (change.index < change.to && value > change.index && value <= change.to) return value - 1;
    if (change.index > change.to && value >= change.to && value < change.index) return value + 1;
    return value;
  };
}
/** Keep UI anchors on the same cells after a successful structure transition.
 * Deleted anchors fall on the next cell; the caller clamps to the new grid. */
export function mapWorksheetPosition(position: CellPosition, change: AxisChange): CellPosition {
  return { ...position, [change.axis]: axisMap(change)(position[change.axis]) ?? change.index };
}
/** A range must still be representable as one contiguous rectangle after a move. */
function mapInterval(start: number, end: number, change: AxisChange): [number, number] | null | 'split' {
  const map = axisMap(change);
  if (change.kind === 'insert') return [map(start)!, map(end)!];
  if (change.kind === 'delete') {
    const first = start === change.index ? start + 1 : start;
    const last = end === change.index ? end - 1 : end;
    return first > last ? null : [map(first)!, map(last)!];
  }
  // Only the moved row/column can change membership; endpoints plus the affected
  // indices suffice even for Excel's million-row whole-column references.
  const probes = new Set([start, end]);
  for (const index of [change.index - 1, change.index, change.index + 1, change.to - 1, change.to, change.to + 1]) {
    if (index >= start && index <= end) probes.add(index);
  }
  const mapped = [...probes].map(index => map(index)!);
  const low = Math.min(...mapped), high = Math.max(...mapped);
  return high - low === end - start ? [low, high] : 'split';
}
const endpoint = /^(\$?)([A-Z]{1,3})?(\$?)([1-9]\d*)?$/i;
function referenceEndpoint(value: string) {
  const parts = endpoint.exec(value);
  if (!parts || (!parts[2] && !parts[4])) return null;
  let column = 0;
  for (const letter of (parts[2] ?? '').toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column: parts[2] ? column - 1 : null, row: parts[4] ? Number(parts[4]) - 1 : null,
    columnAbsolute: parts[2] ? parts[1] : '', rowAbsolute: parts[2] ? parts[3] : parts[1] };
}
function rewriteReference(reference: string, change: AxisChange): string | null {
  if (reference === '#REF!') return reference;
  const parts = reference.split(/\s*:\s*/);
  const start = referenceEndpoint(parts[0]), end = referenceEndpoint(parts[1] ?? parts[0]);
  if (!start || !end) return null;
  const axis = change.axis;
  if (start[axis] === null && end[axis] === null) return reference;
  if (start[axis] === null || end[axis] === null) return null;
  if (start[axis]! > end[axis]!) return null;
  const result = mapInterval(start[axis]!, end[axis]!, change);
  if (result === 'split') return null;
  if (!result) return '#REF!';
  const encode = (point: NonNullable<typeof start>, index: number) => {
    const changed = { ...point, [axis]: index };
    if ((changed.column !== null && changed.column >= 16_384) || (changed.row !== null && changed.row >= 1_048_576)) return '#REF!';
    return (changed.column === null ? '' : changed.columnAbsolute + cellAddress(changed.column, 0).slice(0, -1)) +
      (changed.row === null ? '' : changed.rowAbsolute + (changed.row + 1));
  };
  const a = encode(start, result[0]), b = encode(end, result[1]);
  return a === '#REF!' || b === '#REF!' ? '#REF!' : parts.length === 1 ? a : `${a}:${b}`;
}
const qualifier = String.raw`(?:'(?:[^']|'')+'|[\p{L}\p{N}_.]+)!`;
const cell = String.raw`\$?[A-Z]{1,3}\$?[1-9]\d*`;
const reference = new RegExp(`^(?:(${qualifier}))?(#REF!|${cell}(?:\\s*:\\s*${cell})?|\\$?[A-Z]{1,3}\\s*:\\s*\\$?[A-Z]{1,3}|\\$?[1-9]\\d*\\s*:\\s*\\$?[1-9]\\d*)(?![\\p{L}\\p{N}_.$!])`, 'iu');
/** Conservative lexer: reject dynamic, named, external, structured and 3-D references.
 * Structural edits must never silently corrupt a formula we cannot rewrite. */
export function rewriteStructuralFormula(source: string, currentName: string, changedName: string, change: AxisChange): string | null {
  if (!source.startsWith('=')) return source;
  let output = '=', offset = 1;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const literal = /^(?:"(?:[^"]|"")*"|#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|NULL!|CIRC!|ERROR!))/.exec(rest);
    const fn = /^([A-Z_][A-Z_0-9.]*)\s*(?=\()/i.exec(rest);
    const ref = reference.exec(rest);
    const ordinary = /^(?:\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|TRUE\b|FALSE\b|[\s+\-*/^&%=<>,();])/i.exec(rest);
    if (literal) { output += literal[0]; offset += literal[0].length; }
    else if (fn) {
      if (['INDIRECT', 'OFFSET'].includes(fn[1].toUpperCase())) return null;
      output += fn[0]; offset += fn[0].length;
    } else if (ref) {
      const prefix = ref[1] ?? '';
      const name = prefix ? prefix.startsWith("'") ? prefix.slice(1, -2).replaceAll("''", "'") : prefix.slice(0, -1) : currentName;
      if (/[\[\]:]/.test(name)) return null;
      const next = name.toLowerCase() === changedName.toLowerCase() ? rewriteReference(ref[2], change) : ref[2];
      if (next === null) return null;
      output += prefix + next; offset += ref[0].length;
    } else if (ordinary) { output += ordinary[0]; offset += ordinary[0].length; }
    else return null;
  }
  return output;
}
function moveAddressMap<T>(values: Record<string, T>, change: AxisChange): Record<string, T> {
  const mapped: Record<string, T> = {}, map = axisMap(change);
  for (const [address, value] of Object.entries(values)) {
    const position = cellPosition(address)!;
    const index = map(position[change.axis]);
    if (index !== null) {
      position[change.axis] = index;
      mapped[cellAddress(position.column, position.row)] = value;
    }
  }
  return mapped;
}
/** One pure workbook transition. The UI applies every changed worksheet in one undo step. */
export function changeWorksheetStructure(worksheets: readonly StructuredWorksheet[], id: string, change: AxisChange): StructureResult {
  const target = worksheets.find(sheet => sheet.id === id);
  if (!target) return { status: 'invalid' };
  const size = change.axis === 'row' ? target.sheet.rows : target.sheet.columns;
  if (!Number.isInteger(change.index) || change.index < 0 || change.index > size || (change.index === size && change.kind !== 'insert') ||
      (change.kind === 'move' && (!Number.isInteger(change.to) || change.to < 0 || change.to >= size)) ||
      (change.kind === 'delete' && size <= 1)) return { status: 'invalid' };
  if (change.kind === 'insert' && size >= (change.axis === 'row' ? spreadsheetLimits.rows : spreadsheetLimits.columns)) return { status: 'limit' };
  if (worksheets.some(sheet => sheet.id !== id && sheet.name.toLowerCase() === target.name.toLowerCase())) return { status: 'ambiguous' };
  const next: StructuredWorksheet[] = [];
  for (const worksheet of worksheets) {
    const cells: Record<string, string> = {};
    for (const [address, source] of Object.entries(worksheet.sheet.cells)) {
      // Formulas in the explicitly deleted row/column do not need rewriting.
      if (worksheet.id === id && change.kind === 'delete' && cellPosition(address)![change.axis] === change.index) continue;
      const value = rewriteStructuralFormula(source, worksheet.name, target.name, change);
      if (value === null || value.length > spreadsheetLimits.cellLength) return { status: 'unsupported-formula', detail: `${worksheet.name}!${address}` };
      cells[address] = value;
    }
    let updated = { ...worksheet, sheet: { ...worksheet.sheet, cells } };
    if (worksheet.id === id) {
      const merges: CellRange[] = [];
      for (const merge of worksheet.merges) {
        const span = mapInterval(merge.start[change.axis], merge.end[change.axis], change);
        if (span === 'split') return { status: 'split-range' };
        if (!span) continue;
        const moved = { start: { ...merge.start, [change.axis]: span[0] }, end: { ...merge.end, [change.axis]: span[1] } };
        if (moved.start.row !== moved.end.row || moved.start.column !== moved.end.column) merges.push(moved);
      }
      const dimensions = change.axis === 'row' ? worksheet.rowHeights : worksheet.columnWidths;
      const movedDimensions: Record<string, number> = {};
      const map = axisMap(change);
      for (const [key, value] of Object.entries(dimensions)) {
        const index = map(Number(key));
        if (index !== null) movedDimensions[index] = value;
      }
      updated = { ...updated, merges, formats: moveAddressMap(worksheet.formats, change), annotations: moveAddressMap(worksheet.annotations, change),
        ...(change.axis === 'row' ? { rowHeights: movedDimensions } : { columnWidths: movedDimensions }),
        sheet: { ...updated.sheet, cells: moveAddressMap(cells, change),
          [change.axis === 'row' ? 'rows' : 'columns']: size + (change.kind === 'insert' ? 1 : change.kind === 'delete' ? -1 : 0) } };
    }
    next.push(updated);
  }
  return { status: 'ok', worksheets: next };
}
