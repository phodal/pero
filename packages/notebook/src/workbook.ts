import ExcelJS from "exceljs";
import type { Cell, CellErrorValue, CellValue } from "exceljs";
import { spreadsheetLimits } from "./document.ts";
import { cellAddress } from "./spreadsheet.ts";
import { isExcelWorksheetName, type NamedWorksheet } from "./worksheet.ts";

export { isExcelWorksheetName, type NamedWorksheet } from "./worksheet.ts";

const excelErrors = new Set(["#N/A", "#REF!", "#NAME?", "#DIV/0!", "#NULL!", "#VALUE!", "#NUM!"]);
const numberInput = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i;
const booleanInput = /^(?:true|false)$/i;
const maxWorkbookBytes = 8 * 1024 * 1024;
const maxWorksheets = 20;
const excelEpoch = Date.UTC(1899, 11, 30);

function textInput(text: string): string {
  const trimmed = text.trim();
  // Preserve a workbook's typed string, including leading zeroes and formula-like text.
  return trimmed.startsWith("=") || text.startsWith("'") || numberInput.test(trimmed)
    || booleanInput.test(trimmed) || excelErrors.has(trimmed.toUpperCase()) ? "'" + text : text;
}

function readCell(cell: Cell, date1904: boolean): string {
  const formula = cell.formula;
  if (typeof formula === "string") return "=" + formula;
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "string") return textInput(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  // Keep the workbook's serial, since formulas may compare dates with numeric inputs.
  if (value instanceof Date) return String((value.getTime() - excelEpoch) / 86400000 - (date1904 ? 1462 : 0));
  if ("error" in value) return value.error;
  return textInput(cell.text);
}

/** Read values and formula source. Layout, styles and macro content are outside this format. */
export async function readWorkbook(buffer: ArrayBuffer): Promise<NamedWorksheet[]> {
  if (buffer.byteLength > maxWorkbookBytes) throw new Error("Excel file exceeds 8 MB.");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (workbook.worksheets.length === 0) throw new Error("The Excel file has no worksheets.");
  if (workbook.worksheets.length > maxWorksheets) throw new Error("An Excel file can contain up to 20 worksheets.");

  return workbook.worksheets.map(worksheet => {
    const cells: Record<string, string> = {};
    let rows = 1;
    let columns = 1;
    worksheet.eachRow(row => row.eachCell((cell, column) => {
      if (cell.isMerged && cell.master !== cell) return;
      const raw = readCell(cell, workbook.properties.date1904 === true);
      if (raw === "") return;
      if (row.number > spreadsheetLimits.rows || column > spreadsheetLimits.columns) {
        throw new Error(`Worksheet "${worksheet.name}" exceeds ${spreadsheetLimits.rows} rows or ${spreadsheetLimits.columns} columns.`);
      }
      if (raw.length > spreadsheetLimits.cellLength) {
        throw new Error(`Cell ${worksheet.name}!${cell.address} exceeds ${spreadsheetLimits.cellLength} characters.`);
      }
      rows = Math.max(rows, row.number);
      columns = Math.max(columns, column);
      cells[cellAddress(column - 1, row.number - 1)] = raw;
    }));
    return { name: worksheet.name, sheet: { rows, columns, cells } };
  });
}

function writeCell(raw: string): CellValue {
  if (raw.startsWith("'")) return raw.slice(1);
  const trimmed = raw.trim();
  if (raw.startsWith("=") && raw.length > 1) return { formula: raw.slice(1) };
  if (booleanInput.test(trimmed)) return trimmed.toUpperCase() === "TRUE";
  if (numberInput.test(trimmed)) {
    const number = trimmed.endsWith("%") ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  if (excelErrors.has(trimmed.toUpperCase())) return { error: trimmed.toUpperCase() as CellErrorValue["error"] };
  return raw;
}

/** Export the original expressions and ask Excel to compute its own cached results. */
export async function writeWorkbook(sheets: NamedWorksheet[]): Promise<ArrayBuffer> {
  if (sheets.length === 0) throw new Error("There are no worksheets to export.");
  if (sheets.length > maxWorksheets) throw new Error("An Excel file can contain up to 20 worksheets.");
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  for (const { name, sheet } of sheets) {
    // Renaming or truncating a worksheet would change cross-sheet references.
    if (!isExcelWorksheetName(name)) throw new Error(`Invalid Excel worksheet name: ${name}`);
    const worksheet = workbook.addWorksheet(name);
    for (const [address, raw] of Object.entries(sheet.cells)) {
      if (raw !== "") worksheet.getCell(address).value = writeCell(raw);
    }
  }
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return bytes.buffer;
}
