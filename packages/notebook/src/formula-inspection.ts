import { evaluateWorkbook, type CellValue, type FormulaDependency } from './spreadsheet.ts';
import { inspectFormulaSyntax, type FormulaSyntax } from './formula-syntax.ts';
import type { NamedWorksheet } from './worksheet.ts';

export interface FormulaInspection {
  source: string;
  syntax: FormulaSyntax;
  value: CellValue;
  type: 'blank' | 'number' | 'boolean' | 'text' | 'error';
  dependencies: FormulaDependency[];
}
/** Dependencies are observed from the evaluator, never fabricated from an AST. */
export function inspectWorksheetCell(worksheets: readonly NamedWorksheet[], name: string, address: string): FormulaInspection {
  const source = worksheets.find(sheet => sheet.name === name)?.sheet.cells[address] ?? '';
  const inspection: FormulaInspection = { source, syntax: inspectFormulaSyntax(source), value: '', type: 'blank', dependencies: [] };
  evaluateWorkbook(worksheets, {
    reference(cell, dependency) {
      if (cell.sheet === name && cell.address === address && !inspection.dependencies.some(item => JSON.stringify(item) === JSON.stringify(dependency))) {
        inspection.dependencies.push(dependency);
      }
    },
    result(cell, value, error) {
      if (cell.sheet !== name || cell.address !== address) return;
      inspection.value = value;
      inspection.type = error ? 'error' : !source ? 'blank' : typeof value === 'string' ? 'text' : typeof value as 'number' | 'boolean';
    },
  });
  return inspection;
}

/** A concise help catalog for the supported menu, not a claim of a full Excel catalog. */
export const formulaHelp: Record<string, { syntax: string; description: string }> = {
  SUM: { syntax: 'SUM(number1, [number2], …)', description: 'Adds numbers and referenced numeric cells.' },
  AVERAGE: { syntax: 'AVERAGE(number1, …)', description: 'Arithmetic mean of numeric inputs.' },
  MIN: { syntax: 'MIN(number1, …)', description: 'Smallest numeric value.' },
  MAX: { syntax: 'MAX(number1, …)', description: 'Largest numeric value.' },
  MEDIAN: { syntax: 'MEDIAN(number1, …)', description: 'Middle value of the numeric inputs.' },
  COUNT: { syntax: 'COUNT(value1, …)', description: 'Counts numeric cells.' },
  COUNTBLANK: { syntax: 'COUNTBLANK(range)', description: 'Counts blank cells.' },
  COUNTIF: { syntax: 'COUNTIF(range, criteria)', description: 'Counts cells matching criteria.' },
  SUMIF: { syntax: 'SUMIF(range, criteria, [sum_range])', description: 'Adds cells matching criteria.' },
  AVERAGEIF: { syntax: 'AVERAGEIF(range, criteria, [average_range])', description: 'Mean of cells matching criteria.' },
  SUMPRODUCT: { syntax: 'SUMPRODUCT(array1, …)', description: 'Sum of corresponding array products.' },
  IF: { syntax: 'IF(test, if_true, if_false)', description: 'Chooses a result using a logical test.' },
  IFERROR: { syntax: 'IFERROR(value, fallback)', description: 'Returns fallback when value is an error.' },
  AND: { syntax: 'AND(test1, …)', description: 'True when every test is true.' },
  OR: { syntax: 'OR(test1, …)', description: 'True when any test is true.' },
  NOT: { syntax: 'NOT(test)', description: 'Reverses a logical value.' },
  ROUND: { syntax: 'ROUND(number, digits)', description: 'Rounds the calculated result; display precision does not.' },
  ABS: { syntax: 'ABS(number)', description: 'Absolute value.' },
  SQRT: { syntax: 'SQRT(number)', description: 'Non-negative square root.' },
  LOG10: { syntax: 'LOG10(number)', description: 'Base-ten logarithm.' },
  EXP: { syntax: 'EXP(number)', description: 'Exponential with base e.' },
  POWER: { syntax: 'POWER(number, power)', description: 'Raises a number to a power.' },
  ISNUMBER: { syntax: 'ISNUMBER(value)', description: 'Tests whether a value is numeric.' },
  DAYS: { syntax: 'DAYS(end_date, start_date)', description: 'Days between two dates.' },
  CONCAT: { syntax: 'CONCAT(text1, …)', description: 'Joins text.' },
  LEFT: { syntax: 'LEFT(text, [count])', description: 'Characters from the beginning of text.' },
  RIGHT: { syntax: 'RIGHT(text, [count])', description: 'Characters from the end of text.' },
  LEN: { syntax: 'LEN(text)', description: 'Number of Unicode characters.' },
  INDEX: { syntax: 'INDEX(array, row, [column])', description: 'Value at a position in a range.' },
  VLOOKUP: { syntax: 'VLOOKUP(value, table, column, [approximate])', description: 'Looks up a row by its first column.' },
  XLOOKUP: { syntax: 'XLOOKUP(value, keys, results, [fallback], [match], [search])', description: 'Looks up corresponding values; exact or nearest numeric match.' },
  REVERSECOMPLEMENT: { syntax: 'REVERSECOMPLEMENT(sequence, [alphabet])', description: 'Reverse complement of IUPAC DNA (default) or RNA. Invalid symbols return #VALUE!.' },
  CORREL: { syntax: 'CORREL(array1, array2)', description: 'Pearson correlation coefficient.' },
  SLOPE: { syntax: 'SLOPE(known_y, known_x)', description: 'Least-squares line slope.' },
  INTERCEPT: { syntax: 'INTERCEPT(known_y, known_x)', description: 'Least-squares line intercept.' },
  RSQ: { syntax: 'RSQ(known_y, known_x)', description: 'Squared Pearson correlation.' },
};

/** Preview at an explicit virtual cell without changing any worksheet. The
 * selected cell is replaced only in this calculation, including self-reference.
 */
export function inspectFormulaSandbox(worksheets: readonly NamedWorksheet[], name: string, address: string, source: string): FormulaInspection {
  const sheet = worksheets.find(item => item.name === name);
  if (!sheet) throw new Error('Choose an existing worksheet.');
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(address);
  const column = match?.[1].split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) ?? 0;
  if (!match || column > sheet.sheet.columns || Number(match[2]) > sheet.sheet.rows) throw new Error('Choose a cell inside the selected worksheet.');
  if (!source.startsWith('=') || source.length > 8192) throw new Error('Enter a formula starting with =, up to 8,192 characters.');
  return inspectWorksheetCell(worksheets.map(item => item === sheet ? { ...item, sheet: { ...item.sheet, cells: { ...item.sheet.cells, [address]: source } } } : item), name, address);
}
