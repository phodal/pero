// @ts-expect-error fast-formula-parser publishes JavaScript without TypeScript declarations.
import FastFormulaParser from "fast-formula-parser";

export interface Spreadsheet {
  rows: number;
  columns: number;
  cells: Record<string, string>;
}

export type CellValue = string | number | boolean;
type FormulaFailure = Error & { error: string; details?: unknown };
type FormulaValue = CellValue | FormulaFailure | null;

interface Coordinate {
  row: number;
  col: number;
}

interface CellReference extends Coordinate {
  sheet?: string;
}

interface RangeReference {
  sheet?: string;
  from: Coordinate;
  to: Coordinate;
}

interface Worksheet {
  name: string;
  sheet: Spreadsheet;
  calculated: Map<string, FormulaValue>;
  active: Map<string, number>;
  cycleMembers: Set<string>;
}

interface FormulaArgument {
  value: FormulaValue | FormulaValue[][];
  omitted?: boolean;
}

type FormulaFunction = (...args: FormulaArgument[]) => FormulaValue;

interface FormulaParser {
  parse(source: string, position: CellReference): unknown;
}

const Engine: {
  new (options?: {
    functions?: Record<string, FormulaFunction>;
    onCell?: (reference: CellReference) => FormulaValue;
    onRange?: (reference: RangeReference) => FormulaValue[][];
  }): FormulaParser;
  FormulaError: (new (code: string) => FormulaFailure) &
    Record<"DIV0" | "NA" | "NAME" | "NULL" | "NUM" | "REF" | "VALUE", FormulaFailure>;
  FormulaHelpers: {
    flattenParams(
      args: FormulaArgument[],
      type: number | null,
      allowUnion: boolean,
      onValue: (value: FormulaValue) => void,
    ): void;
  };
  Types: { NUMBER: number };
} = FastFormulaParser;

const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
const MAX_RANGE_CELLS = 100_000;
const MAX_FORMULA_DEPTH = 256;
const SHEET_NAME = "Sheet1";
const { FormulaError } = Engine;
const circular = new FormulaError("#CIRC!");
const parseError = new FormulaError("#ERROR!");
const errorLiterals = new Map(
  [
    FormulaError.DIV0, FormulaError.NA, FormulaError.NAME, FormulaError.NULL,
    FormulaError.NUM, FormulaError.REF, FormulaError.VALUE,
  ].map((error) => [error.error, error]),
);

const columnReference = String.raw`\$?[A-Z]{1,3}`;
const rowReference = String.raw`\$?[1-9]\d*`;
const cellReference = `(?:${columnReference}${rowReference}|#REF!)`;
const formulaReferenceTokens = new RegExp([
  String.raw`"(?:[^"]|"")*(?:"|$)|'(?:[^']|'')*(?:'|$)|\[[^\]]*\]`,
  String.raw`(?<![\p{L}\p{N}_.$])(?:${columnReference}\s*:\s*${columnReference}|${rowReference}\s*:\s*${rowReference}|${cellReference}(?:\s*:\s*${cellReference})?)(?![\p{L}\p{N}_.$]|\s*[(!])`,
].join("|"), "giu");

function mapFormulaReferences(formula: string, rewrite: (reference: string) => string): string {
  return formula.replace(formulaReferenceTokens, (token) =>
    ['"', "'", "["].includes(token[0]) ? token : rewrite(token),
  );
}

function columnNumber(column: string): number {
  let result = 0;
  for (const letter of column.toUpperCase()) {
    result = result * 26 + letter.charCodeAt(0) - 64;
  }
  return result;
}

function columnLabel(column: number): string {
  let label = "";
  for (let index = column; index > 0; index = Math.floor((index - 1) / 26)) {
    label = String.fromCharCode(65 + (index - 1) % 26) + label;
  }
  return label;
}

export function cellAddress(column: number, row: number): string {
  if (!Number.isInteger(column) || !Number.isInteger(row) ||
      column < 0 || row < 0 || column >= MAX_COLUMNS || row >= MAX_ROWS) {
    return "#REF!";
  }
  return columnLabel(column + 1) + (row + 1);
}

function literalValue(source: string): FormulaValue {
  if (source === "") return null;
  if (source.startsWith("'")) return source.slice(1);

  const text = source.trim();
  const upper = text.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") return upper === "TRUE";
  const error = errorLiterals.get(upper);
  if (error) return error;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(text)) {
    const value = text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
    return Number.isFinite(value) ? value : FormulaError.NUM;
  }
  return source;
}

function numericAggregate(calculate: (values: number[]) => number | FormulaFailure): FormulaFunction {
  return (...args) => {
    const values: number[] = [];
    Engine.FormulaHelpers.flattenParams(args, Engine.Types.NUMBER, true, (value) => {
      if (value instanceof FormulaError) throw value;
      if (typeof value === "number") values.push(value);
    });
    return calculate(values);
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function vector(argument?: FormulaArgument): FormulaValue[] | undefined {
  if (!argument || argument.omitted) return undefined;
  const value = argument.value;
  if (!Array.isArray(value)) return [value];
  if (value.length === 1) return value[0];
  if (value.every((row) => row.length === 1)) return value.map((row) => row[0]);
  return undefined;
}

function xlookup(
  lookup?: FormulaArgument,
  lookupArray?: FormulaArgument,
  returnArray?: FormulaArgument,
  fallback?: FormulaArgument,
  matchMode?: FormulaArgument,
  searchMode?: FormulaArgument,
): FormulaValue {
  const sought = vector(lookup);
  const keys = vector(lookupArray);
  const values = vector(returnArray);
  if (sought?.length !== 1 || !keys || !values || keys.length !== values.length) {
    return FormulaError.VALUE;
  }

  const match = matchMode?.omitted ? 0 : matchMode?.value ?? 0;
  const search = searchMode?.omitted ? 1 : searchMode?.value ?? 1;
  if ((match !== 0 && match !== -1 && match !== 1) || (search !== 1 && search !== -1)) {
    return FormulaError.VALUE;
  }

  const needle = sought[0];
  if (needle instanceof FormulaError) return needle;
  let nearest: number | undefined;
  for (let step = 0; step < keys.length; step++) {
    const index = search === -1 ? keys.length - step - 1 : step;
    const key = keys[index];
    if (key instanceof FormulaError) return key;
    if (key === needle ||
        (typeof key === "string" && typeof needle === "string" && key.toLowerCase() === needle.toLowerCase())) {
      return values[index] ?? 0;
    }
    if (match && typeof key === "number" && typeof needle === "number" &&
        (key - needle) * match > 0 &&
        (nearest === undefined || Math.abs(key - needle) < Math.abs(Number(keys[nearest]) - needle))) {
      nearest = index;
    }
  }

  if (nearest !== undefined) return values[nearest] ?? 0;
  const alternative = vector(fallback);
  return alternative ? alternative[0] ?? 0 : FormulaError.NA;
}

function linearStatistic(calculate: (xx: number, xy: number, yy: number, xMean: number, yMean: number) => number): FormulaFunction {
  return (dependent, independent) => {
    const ys = vector(dependent);
    const xs = vector(independent);
    if (!xs || !ys || xs.length !== ys.length || xs.length === 0) return FormulaError.NA;

    const pairs: [number, number][] = [];
    for (const [index, x] of xs.entries()) {
      const y = ys[index];
      if (x instanceof FormulaError) return x;
      if (y instanceof FormulaError) return y;
      if (typeof x === "number" && typeof y === "number") pairs.push([x, y]);
    }
    if (pairs.length < 2) return FormulaError.DIV0;

    const xMean = sum(pairs.map(([x]) => x)) / pairs.length;
    const yMean = sum(pairs.map(([, y]) => y)) / pairs.length;
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (const [x, y] of pairs) {
      xx += (x - xMean) ** 2;
      xy += (x - xMean) * (y - yMean);
      yy += (y - yMean) ** 2;
    }
    if (xx === 0) return FormulaError.DIV0;
    const result = calculate(xx, xy, yy, xMean, yMean);
    return Number.isNaN(result) ? FormulaError.DIV0 : result;
  };
}

const disabledFunctions = ["WEBSERVICE", "NOW", "TODAY", "RAND", "RANDBETWEEN"];
const functions: Record<string, FormulaFunction> = {
  ...Object.fromEntries(disabledFunctions.map((name) => [name, () => FormulaError.NAME])),
  // The upstream numeric aggregations can skip errors from references.
  SUM: numericAggregate(sum),
  AVERAGE: numericAggregate((values) => values.length ? sum(values) / values.length : FormulaError.DIV0),
  MIN: numericAggregate((values) => values.length ? values.reduce((a, b) => Math.min(a, b)) : 0),
  MAX: numericAggregate((values) => values.length ? values.reduce((a, b) => Math.max(a, b)) : 0),
  MEDIAN: numericAggregate((values) => {
    if (!values.length) return FormulaError.NUM;
    values.sort((a, b) => a - b);
    return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
  }),
  COUNTBLANK: (...args) => {
    let count = 0;
    Engine.FormulaHelpers.flattenParams(args, null, false, (value) => {
      if (value === null || value === "") count++;
    });
    return count;
  },
  LEN: (argument) => {
    const values = vector(argument);
    if (values?.length !== 1) return FormulaError.VALUE;
    const value = values[0];
    if (value instanceof FormulaError) return value;
    return Array.from(String(value ?? "")).length;
  },
  XLOOKUP: xlookup,
  SLOPE: linearStatistic((xx, xy) => xy / xx),
  INTERCEPT: linearStatistic((xx, xy, _yy, xMean, yMean) => yMean - xy / xx * xMean),
  RSQ: linearStatistic((xx, xy, yy) => xy ** 2 / (xx * yy)),
};

// A curated menu; the evaluator also accepts functions implemented by the engine.
export const formulaFunctions = [
  "SUM", "AVERAGE", "MIN", "MAX", "MEDIAN", "COUNT", "COUNTBLANK", "COUNTIF",
  "SUMIF", "AVERAGEIF", "SUMPRODUCT", "IF", "IFERROR", "AND", "OR", "NOT",
  "ROUND", "ABS", "SQRT", "LOG10", "EXP", "POWER", "ISNUMBER", "DAYS",
  "CONCAT", "LEFT", "RIGHT", "LEN", "INDEX", "VLOOKUP", "XLOOKUP",
  "CORREL", "SLOPE", "INTERCEPT", "RSQ",
] as const;

export function evaluateSpreadsheet(sheet: Spreadsheet): Record<string, CellValue> {
  return evaluateWorkbook([{ name: SHEET_NAME, sheet }])[SHEET_NAME];
}

export function evaluateWorkbook(sheets: readonly { name: string; sheet: Spreadsheet }[]): Record<string, Record<string, CellValue>> {
  const worksheets: Worksheet[] = sheets.map(({ name, sheet }) => ({
    name, sheet, calculated: new Map(), active: new Map(), cycleMembers: new Set(),
  }));
  const byName = new Map<string, Worksheet | null>();
  for (const worksheet of worksheets) {
    const key = worksheet.name.toLowerCase();
    byName.set(key, byName.has(key) ? null : worksheet);
  }
  const stack: { worksheet: Worksheet; address: string }[] = [];
  // A parser holds mutable parse state, so nested references need another instance.
  const parsers: FormulaParser[] = [];

  const onCell = ({ sheet: name, col, row }: CellReference): FormulaValue => {
    const worksheet = name && byName.get(name.toLowerCase());
    return worksheet ? evaluate(worksheet, { row, col }) : FormulaError.REF;
  };

  const onRange = ({ sheet: name, from, to }: RangeReference): FormulaValue[][] => {
    const worksheet = name && byName.get(name.toLowerCase());
    if (!worksheet) return [[FormulaError.REF]];
    const { sheet } = worksheet;
    // Whole-row/column references are bounded by this table's dimensions.
    const rows = to.row === MAX_ROWS && from.row === 1 ? Math.max(1, sheet.rows) : to.row;
    const columns = to.col === MAX_COLUMNS && from.col === 1 ? Math.max(1, sheet.columns) : to.col;
    const height = rows - from.row + 1;
    const width = columns - from.col + 1;
    if (height < 1 || width < 1 || rows > MAX_ROWS || columns > MAX_COLUMNS) return [[FormulaError.REF]];
    if (height * width > MAX_RANGE_CELLS) throw FormulaError.NUM;
    return Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, col) => evaluate(worksheet, { row: from.row + row, col: from.col + col })),
    );
  };

  function evaluate(worksheet: Worksheet, position: Coordinate): FormulaValue {
    const address = cellAddress(position.col - 1, position.row - 1);
    if (address === "#REF!") return FormulaError.REF;
    const { sheet, calculated, active, cycleMembers } = worksheet;
    const cached = calculated.get(address);
    if (cached !== undefined) return cached;
    const source = sheet.cells[address];
    if (source === undefined) return null;
    if (!source.startsWith("=")) {
      const value = literalValue(source);
      calculated.set(address, value);
      return value;
    }

    const previous = active.get(address);
    if (previous !== undefined) {
      for (const member of stack.slice(previous)) member.worksheet.cycleMembers.add(member.address);
      return circular;
    }
    const depth = stack.length;
    if (depth >= MAX_FORMULA_DEPTH) return FormulaError.NUM;

    active.set(address, depth);
    stack.push({ worksheet, address });
    let result: FormulaValue;
    try {
      const parser = parsers[depth] ??= new Engine({ functions, onCell, onRange });
      const formula = source.slice(1).trim();
      // Excel can save a range with a deleted endpoint. The engine otherwise ignores it.
      const normalized = /#REF!/i.test(formula)
        ? mapFormulaReferences(formula, (reference) => /#REF!/i.test(reference) ? "#REF!" : reference)
        : formula;
      const value = parser.parse(normalized, { ...position, sheet: worksheet.name });
      if (value instanceof FormulaError || typeof value === "string" || typeof value === "boolean") {
        result = value;
      } else if (typeof value === "number") {
        result = Number.isFinite(value) ? value : FormulaError.NUM;
      } else {
        result = value === null ? 0 : FormulaError.VALUE;
      }
    } catch (error) {
      // The parser may wrap a function's spreadsheet error in a parse error.
      result = error instanceof FormulaError
        ? error.details instanceof FormulaError ? error.details : error
        : parseError;
    } finally {
      stack.pop();
      active.delete(address);
    }
    if (cycleMembers.has(address)) result = circular;
    calculated.set(address, result);
    return result;
  }

  return Object.fromEntries(worksheets.map((worksheet) => {
    const values = Object.keys(worksheet.sheet.cells).map((address): [string, CellValue] => {
      const reference = /^([A-Z]{1,3})([1-9]\d*)$/.exec(address);
      if (!reference) return [address, FormulaError.REF.error];
      const col = columnNumber(reference[1]);
      const row = Number(reference[2]);
      const result = evaluate(worksheet, { row, col });
      return [address, typeof result === "object" && result !== null ? result.error : result ?? ""];
    });
    return [worksheet.name, Object.fromEntries(values)];
  }));
}

/** Move the relative A1 references in a copied formula, leaving literal text alone. */
export function shiftFormula(formula: string, columnDelta: number, rowDelta: number): string {
  if (!formula.startsWith("=") || (!columnDelta && !rowDelta)) return formula;

  return mapFormulaReferences(formula, (token) => {
    if (/#REF!/i.test(token)) return "#REF!";
    const shifted = token.replace(/(\$?[A-Z]{1,3})(\$?[1-9]\d*)?|(\$?[1-9]\d*)/gi, (part, column: string | undefined, cellRow: string | undefined, rangeRow: string | undefined) => {
      const row = cellRow ?? rangeRow;
      const originalColumn = column ? columnNumber(column.replace("$", "")) : 1;
      const originalRow = row ? Number(row.replace("$", "")) : 1;
      if (originalColumn > MAX_COLUMNS || originalRow > MAX_ROWS) return part;
      const nextColumn = originalColumn + (column && !column.startsWith("$") ? columnDelta : 0);
      const nextRow = originalRow + (row && !row.startsWith("$") ? rowDelta : 0);
      if (nextColumn < 1 || nextColumn > MAX_COLUMNS || nextRow < 1 || nextRow > MAX_ROWS) return "#REF!";
      const shiftedColumn = column && columnDelta && !column.startsWith("$") ? columnLabel(nextColumn) : column ?? "";
      const shiftedRow = row && rowDelta && !row.startsWith("$") ? String(nextRow) : row ?? "";
      return shiftedColumn + shiftedRow;
    });
    // A range with an invalid endpoint is an invalid reference as a whole.
    return shifted.includes("#REF!") ? "#REF!" : shifted;
  });
}

// Match text and workbook qualifiers first, so sheet-like text within them
// cannot be mistaken for a local reference. Match the parser's bare sheet names.
const sheetReferenceTokens = /"(?:[^"]|"")*(?:"|$)|#[A-Za-z][A-Za-z0-9/]*[!?]|\[[^\]]*\]|'(?:[^']|'')*(?:'!?|$)|(?<![A-Za-z_.\d\u007f-\uffff\]])[A-Za-z_.\d\u007f-\uffff]+!/g;

/** Rewrite explicit local worksheet qualifiers while leaving cell addresses intact. */
export function renameWorksheetReferences(formula: string, previous: string, next: string): string {
  if (!formula.startsWith("=") || !previous || !next || previous === next) return formula;

  const oldName = previous.toLowerCase();
  const quotedNext = "'" + next.replaceAll("'", "''") + "'!";
  const bareNext = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(next) ? next + "!" : quotedNext;
  return formula.replace(sheetReferenceTokens, (token, index: number) => {
    if (!token.endsWith("!") || ['"', "#", "["].includes(token[0]) || formula[index - 1] === "]") return token;
    const quoted = token.startsWith("'");
    if (quoted && !token.endsWith("'!")) return token;
    const name = quoted ? token.slice(1, -2).replaceAll("''", "'") : token.slice(0, -1);
    if (name.includes("[") || name.includes("]") || name.toLowerCase() !== oldName) return token;
    return quoted ? quotedNext : bareNext;
  });
}
