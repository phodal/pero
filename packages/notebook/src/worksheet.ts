import { renameWorksheetReferences, type Spreadsheet } from "./spreadsheet.ts";

export interface NamedWorksheet {
  name: string;
  sheet: Spreadsheet;
}

/** Stable Notebook block identity is separate from the formula-visible name. */
export interface NotebookWorksheet extends NamedWorksheet {
  id: string;
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
