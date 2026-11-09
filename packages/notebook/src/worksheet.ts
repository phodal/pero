import { evaluateSpreadsheet, evaluateWorkbook, renameWorksheetReferences, type CellValue, type Spreadsheet } from "./spreadsheet.ts";

export interface NamedWorksheet {
  name: string;
  sheet: Spreadsheet;
}

/** Stable Notebook block identity is separate from the formula-visible name. */
export interface NotebookWorksheet extends NamedWorksheet {
  id: string;
}

/** Unnamed blocks receive formula-visible names without changing saved labels or IDs. */
export function resolveWorksheetNames(worksheets: readonly NotebookWorksheet[]): NotebookWorksheet[] {
  const used = new Set(worksheets.filter(sheet => sheet.name.trim()).map(sheet => sheet.name.toLowerCase()));
  let next = 1;
  return worksheets.map(sheet => {
    if (sheet.name.trim()) return sheet;
    while (used.has(`sheet${next}`)) next++;
    const name = `Sheet${next++}`;
    used.add(name.toLowerCase());
    return { ...sheet, name };
  });
}

export interface CalculatedWorksheet { name: string; ambiguous: boolean; values: Record<string, CellValue> }
/** Calculation results belong to stable block IDs, never to potentially duplicate
 * display names. Ambiguous sheets retain local-cell calculations; qualified
 * references remain unresolved, matching the editor's existing semantics. */
export function calculateNotebookWorksheets(worksheets: readonly NotebookWorksheet[]): Map<string, CalculatedWorksheet> {
  const sheets = resolveWorksheetNames(worksheets);
  const counts = new Map<string, number>();
  for (const { name } of sheets) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  const workbook = evaluateWorkbook(sheets);
  return new Map(sheets.map(({ id, name, sheet }) => {
    const ambiguous = counts.get(name.toLowerCase())! > 1;
    return [id, { name, ambiguous, values: ambiguous ? evaluateSpreadsheet(sheet) : workbook[name] }];
  }));
}

export function isExcelWorksheetName(name: string): boolean {
  return !!name.trim() && name.length <= 31 && !/[\\/*?:[\]\u0000-\u001f]/.test(name) &&
    !name.startsWith("'") && !name.endsWith("'") && name.toLowerCase() !== "history";
}

export type WorksheetRename =
  | { status: "ok"; worksheets: readonly NotebookWorksheet[] }
  | { status: "invalid" | "duplicate" };

/** Rename one worksheet and its unambiguous formula references as one value change. */
export function renameWorksheet(
  worksheets: readonly NotebookWorksheet[], id: string, name: string,
): WorksheetRename {
  if (!isExcelWorksheetName(name)) return { status: "invalid" };
  const current = worksheets.find(worksheet => worksheet.id === id);
  if (!current || name === current.name) return { status: "ok", worksheets };
  const others = worksheets.filter(worksheet => worksheet.id !== id);
  if (others.some(worksheet => worksheet.name.toLowerCase() === name.toLowerCase())) return { status: "duplicate" };
  // An ambiguous old name cannot identify which worksheet a formula meant.
  const unambiguous = !others.some(worksheet => worksheet.name.toLowerCase() === current.name.toLowerCase());
  return {
    status: "ok",
    worksheets: worksheets.map(worksheet => {
      let sheet = worksheet.sheet;
      if (unambiguous) {
        const cells = { ...sheet.cells };
        for (const [address, value] of Object.entries(cells)) {
          const renamed = renameWorksheetReferences(value, current.name, name);
          if (renamed !== value) {
            cells[address] = renamed;
            sheet = { ...worksheet.sheet, cells };
          }
        }
      }
      const nextName = worksheet.id === id ? name : worksheet.name;
      return nextName === worksheet.name && sheet === worksheet.sheet ? worksheet : { ...worksheet, name: nextName, sheet };
    }),
  };
}
