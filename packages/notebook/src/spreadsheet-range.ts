import { spreadsheetLimits } from "./document.ts";
import { cellAddress, shiftFormula, type Spreadsheet } from "./spreadsheet.ts";

export interface CellPosition {
  column: number;
  row: number;
}

export interface CellRange {
  start: CellPosition;
  end: CellPosition;
}

export function normalizeCellRange(anchor: CellPosition, active: CellPosition): CellRange {
  return {
    start: { column: Math.min(anchor.column, active.column), row: Math.min(anchor.row, active.row) },
    end: { column: Math.max(anchor.column, active.column), row: Math.max(anchor.row, active.row) },
  };
}

export function cellRangeLabel(range: CellRange): string {
  const start = cellAddress(range.start.column, range.start.row);
  const end = cellAddress(range.end.column, range.end.row);
  return start === end ? start : `${start}:${end}`;
}

export function rangeContains(range: CellRange, { column, row }: CellPosition): boolean {
  return column >= range.start.column && column <= range.end.column &&
    row >= range.start.row && row <= range.end.row;
}

function positionInSheet({ column, row }: CellPosition, columns: number, rows: number): boolean {
  return Number.isInteger(column) && Number.isInteger(row) &&
    column >= 0 && column < columns && row >= 0 && row < rows;
}

function rangeInSheet(sheet: Spreadsheet, range: CellRange): boolean {
  const { start, end } = range;
  return positionInSheet(start, sheet.columns, sheet.rows) &&
    positionInSheet(end, sheet.columns, sheet.rows) &&
    start.column <= end.column && start.row <= end.row;
}

export function encodeCellRange(sheet: Spreadsheet, range: CellRange): string {
  if (!rangeInSheet(sheet, range)) return "";

  const { start, end } = range;
  const lines: string[] = [];
  for (let row = start.row; row <= end.row; row++) {
    const fields: string[] = [];
    for (let column = start.column; column <= end.column; column++) {
      const source = sheet.cells[cellAddress(column, row)] ?? "";
      // Quote commas for a single-column selection so clipboard format detection preserves it.
      fields.push(/[\t,\r\n"]/.test(source) ? `"${source.replaceAll('"', '""')}"` : source);
    }
    lines.push(fields.join("\t"));
  }
  // Keep an explicitly selected blank last row distinguishable from a line terminator.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines[lines.length - 1] = '""';
  return lines.join("\n");
}

type CellDelimiter = "\t" | ",";

function clipboardDelimiter(text: string): CellDelimiter {
  let delimiter: CellDelimiter = "\t";
  let fieldStart = true;
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') index++;
        else quoted = false;
      }
      continue;
    }
    if (char === "\t") return "\t";
    if (char === ",") delimiter = ",";
    if (char === '"' && fieldStart) quoted = true;
    fieldStart = char === "," || char === "\r" || char === "\n";
  }
  return delimiter;
}

export function parseCellClipboard(text: string, delimiter = clipboardDelimiter(text)): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: "start" | "text" | "quoted" | "closed" = "start";

  function finishField(): boolean {
    if (row.length >= spreadsheetLimits.columns || field.length > spreadsheetLimits.cellLength) return false;
    row.push(field);
    field = "";
    state = "start";
    return true;
  }

  for (let index = 0; index < text.length; index++) {
    if (field.length > spreadsheetLimits.cellLength || rows.length >= spreadsheetLimits.rows) return null;
    const char = text[index];
    if (state === "quoted") {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') {
        field += char;
        index++;
      } else state = "closed";
    } else if (char === delimiter || char === "\r" || char === "\n") {
      if (!finishField()) return null;
      if (char !== delimiter) {
        rows.push(row);
        row = [];
        if (char === "\r" && text[index + 1] === "\n") index++;
      }
    } else if (state === "closed") {
      return null;
    } else if (char === '"' && state === "start") {
      state = "quoted";
    } else {
      field += char;
      state = "text";
    }
  }

  if (state === "quoted") return null;
  if (rows.length === 0 || row.length > 0 || state !== "start") {
    if (rows.length >= spreadsheetLimits.rows || !finishField()) return null;
    rows.push(row);
  }
  return rows;
}

function editSheet(sheet: Spreadsheet) {
  let cells = sheet.cells;
  return {
    set(column: number, row: number, value: string) {
      const address = cellAddress(column, row);
      if (value === "" ? !Object.hasOwn(cells, address) : cells[address] === value) return;
      if (cells === sheet.cells) cells = { ...cells };
      if (value === "") delete cells[address];
      else cells[address] = value;
    },
    finish(rows = sheet.rows, columns = sheet.columns): Spreadsheet {
      return cells === sheet.cells && rows === sheet.rows && columns === sheet.columns
        ? sheet
        : { ...sheet, rows, columns, cells };
    },
  };
}

export function pasteCellGrid(sheet: Spreadsheet, target: CellPosition, rows: readonly (readonly string[])[]): Spreadsheet | null {
  const limits = spreadsheetLimits;
  if (!positionInSheet(target, limits.columns, limits.rows) || target.row + rows.length > limits.rows) return null;

  const edit = editSheet(sheet);
  let width = 0;
  for (let row = 0; row < rows.length; row++) {
    const values = rows[row];
    if (target.column + values.length > limits.columns) return null;
    width = Math.max(width, values.length);
    for (let column = 0; column < values.length; column++) {
      const value = values[column];
      if (value.length > limits.cellLength) return null;
      edit.set(target.column + column, target.row + row, value);
    }
  }
  if (width === 0) return sheet;
  return edit.finish(Math.max(sheet.rows, target.row + rows.length), Math.max(sheet.columns, target.column + width));
}

export function clearCellRange(sheet: Spreadsheet, range: CellRange): Spreadsheet {
  if (!rangeInSheet(sheet, range)) return sheet;

  const edit = editSheet(sheet);
  const { start, end } = range;
  for (let row = start.row; row <= end.row; row++) {
    for (let column = start.column; column <= end.column; column++) edit.set(column, row, "");
  }
  return edit.finish();
}

export function fillCellRange(sheet: Spreadsheet, range: CellRange, direction: "down" | "right"): Spreadsheet | null {
  if (!rangeInSheet(sheet, range)) return null;

  const edit = editSheet(sheet);
  const { start, end } = range;
  const firstRow = start.row + (direction === "down" ? 1 : 0);
  const firstColumn = start.column + (direction === "right" ? 1 : 0);
  for (let row = firstRow; row <= end.row; row++) {
    for (let column = firstColumn; column <= end.column; column++) {
      const sourceColumn = direction === "right" ? start.column : column;
      const sourceRow = direction === "down" ? start.row : row;
      const source = sheet.cells[cellAddress(sourceColumn, sourceRow)] ?? "";
      const value = shiftFormula(source, column - sourceColumn, row - sourceRow);
      if (value.length > spreadsheetLimits.cellLength) return null;
      edit.set(column, row, value);
    }
  }
  return edit.finish();
}
