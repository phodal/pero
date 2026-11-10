import { emptyMixturePreparation, mixtureQSEstimate, saveMixtureRecipe, type MixturePreparation } from './mixture.ts';
import { inspectWorksheetCell, type FormulaInspection } from './formula-inspection.ts';
import { evaluateWorkbook } from './spreadsheet.ts';
import type { NamedWorksheet } from './worksheet.ts';

export interface MasterMixInput { reactions: number; excessPercent: number; volumePerReaction: number; stockPerReaction: number }
export const masterMixDefaults: MasterMixInput = { reactions: 80, excessPercent: 10, volumePerReaction: 20, stockPerReaction: 5 };
/** An original arithmetic example, not a biological protocol or measured preparation. */
export function masterMixExample(input: MasterMixInput): { worksheet: NamedWorksheet; mixture: MixturePreparation; total: number; diluent: number } {
  if (!Number.isInteger(input.reactions) || input.reactions < 1 || input.reactions > 10000 ||
      !Number.isFinite(input.excessPercent) || input.excessPercent < 0 || input.excessPercent > 100 ||
      !Number.isFinite(input.volumePerReaction) || input.volumePerReaction <= 0 || input.volumePerReaction > 10000 ||
      !Number.isFinite(input.stockPerReaction) || input.stockPerReaction <= 0 || input.stockPerReaction >= input.volumePerReaction) {
    throw new Error('Use 1–10,000 reactions, 0–100% excess, and a positive stock volume below the final volume (at most 10,000 µL).');
  }
  const worksheet: NamedWorksheet = { name: 'Master mix', sheet: { rows: 8, columns: 3, cells: {
    A1: 'Reactions', B1: String(input.reactions), A2: 'Excess (%)', B2: String(input.excessPercent),
    A3: 'Component', B3: 'µL per reaction', C3: 'Planned batch µL',
    A4: 'Example stock', B4: String(input.stockPerReaction), C4: '=B4*$B$1*(1+$B$2/100)',
    A5: 'Diluent (additive estimate)', B5: '=B7-B4', C5: '=B5*$B$1*(1+$B$2/100)',
    A6: 'Total planned volume', C6: '=SUM(C4:C5)', A7: 'Final µL per reaction', B7: String(input.volumePerReaction),
    A8: 'Planning example only; no actual quantities recorded',
  } } };
  const values = evaluateWorkbook([worksheet])[worksheet.name];
  const mixture = emptyMixturePreparation();
  mixture.draft = { name: 'Master mix arithmetic example', output: '', notes: 'Original Pero example. Additive volumes are an explicit planning assumption; verify the method before actual preparation.',
    target: { value: Number(values.C6), unit: 'µL' }, additiveVolumes: true,
    ingredients: [
      { id: 'example_stock', reference: 'Example stock (not a registered material)', source: 'Master mix!C4', mode: 'quantity', target: { value: Number(values.C4), unit: 'µL' } },
      { id: 'example_diluent', reference: 'Diluent (not a registered material)', source: 'Master mix!C5', mode: 'qs', target: { value: null, unit: 'µL' } },
    ] };
  const planned = saveMixtureRecipe(mixture);
  return { worksheet, mixture: planned, total: Number(values.C6), diluent: mixtureQSEstimate(planned.draft)!.value! };
}

export interface CellEvidence { worksheet: string; address: string; inspection: FormulaInspection; inputs: NamedWorksheet[] }
/** Freeze the actual source workbook and observed evaluator reads together. */
export function inspectCellEvidence(worksheets: readonly NamedWorksheet[], worksheet: string, address: string): CellEvidence {
  const sheet = worksheets.find(item => item.name === worksheet);
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(address);
  const column = match?.[1].split('').reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) ?? 0;
  if (!sheet || !match || column > sheet.sheet.columns || Number(match[2]) > sheet.sheet.rows) throw new Error('Choose a cell inside an existing worksheet.');
  if (worksheets.filter(item => item.name.toLowerCase() === worksheet.toLowerCase()).length !== 1) throw new Error('The worksheet name is ambiguous. Rename it before comparing evidence.');
  return { worksheet, address, inspection: inspectWorksheetCell(worksheets, worksheet, address), inputs: structuredClone([...worksheets]) };
}
export function compareCellEvidence(left: CellEvidence, right: CellEvidence) {
  return { sameSource: left.inspection.source === right.inspection.source,
    sameResult: left.inspection.type === right.inspection.type && left.inspection.value === right.inspection.value,
    sameDependencies: JSON.stringify(left.inspection.dependencies) === JSON.stringify(right.inspection.dependencies),
    sameWorkbook: JSON.stringify(left.inputs) === JSON.stringify(right.inputs),
    limitation: 'Equal results are not independent validation. Dependencies are observed evaluator reads, not a claim about every possible execution path.' };
}
