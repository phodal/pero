import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { evaluateSpreadsheet, evaluateWorkbook, renameWorksheetReferences, type CellValue, type Spreadsheet } from '../../../packages/notebook/src/spreadsheet';
import { isExcelWorksheetName } from '../../../packages/notebook/src/workbook';

interface WorksheetBlock {
  id: string;
  name: string;
  sheet: Spreadsheet;
}

export function worksheetBlocks(document: Node): WorksheetBlock[] {
  const blocks: WorksheetBlock[] = [];
  document.descendants(node => {
    if (node.type.name !== 'spreadsheet') return;
    const { blockId, label, sheet } = node.attrs as { blockId: string; label: string; sheet: Spreadsheet };
    blocks.push({ id: blockId, name: label.trim() ? label : '', sheet });
  });
  const names = new Set(blocks.filter(block => block.name).map(block => block.name.toLowerCase()));
  let next = 1;
  for (const block of blocks) {
    if (block.name) continue;
    while (names.has(`sheet${next}`)) next++;
    block.name = `Sheet${next++}`;
    names.add(block.name.toLowerCase());
  }
  return blocks;
}

export function nextWorksheetName(document: Node): string {
  const names = new Set(worksheetBlocks(document).map(block => block.name.toLowerCase()));
  let next = 1;
  while (names.has(`sheet${next}`)) next++;
  return `Sheet${next}`;
}

export function renameWorksheet(editor: Editor, blockId: string, name: string): 'invalid' | 'duplicate' | undefined {
  if (!isExcelWorksheetName(name)) return 'invalid';
  const worksheets = worksheetBlocks(editor.state.doc);
  const current = worksheets.find(sheet => sheet.id === blockId);
  if (!current || name === current.name) return;
  const otherSheets = worksheets.filter(sheet => sheet.id !== blockId);
  if (otherSheets.some(sheet => sheet.name.toLowerCase() === name.toLowerCase())) return 'duplicate';
  const unambiguous = !otherSheets.some(sheet => sheet.name.toLowerCase() === current.name.toLowerCase());
  editor.commands.command(({ tr }) => {
    tr.doc.descendants((node, position) => {
      if (node.type.name !== 'spreadsheet') return;
      const attrs = { ...node.attrs };
      if (attrs.blockId === blockId) attrs.label = name;
      const sheet = attrs.sheet as Spreadsheet;
      const cells = { ...sheet.cells };
      if (unambiguous) for (const [address, value] of Object.entries(cells)) {
        const renamed = renameWorksheetReferences(value, current.name, name);
        if (renamed !== value) {
          cells[address] = renamed;
          attrs.sheet = { ...sheet, cells };
        }
      }
      if (attrs.label !== node.attrs.label || attrs.sheet !== node.attrs.sheet) tr.setNodeMarkup(position, undefined, attrs);
    });
    return true;
  });
}

type CalculatedWorksheet = { name: string; ambiguous: boolean; values: Record<string, CellValue> };
const calculationCache = new WeakMap<Node, Map<string, CalculatedWorksheet>>();

export function worksheetCalculation(document: Node, id: string): CalculatedWorksheet | undefined {
  let calculated = calculationCache.get(document);
  if (!calculated) {
    const sheets = worksheetBlocks(document);
    const counts = new Map<string, number>();
    for (const { name } of sheets) {
      const key = name.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const workbook = evaluateWorkbook(sheets);
    calculated = new Map(sheets.map(({ id: blockId, name, sheet }) => {
      const ambiguous = counts.get(name.toLowerCase())! > 1;
      return [blockId, { name, ambiguous, values: ambiguous ? evaluateSpreadsheet(sheet) : workbook[name] }];
    }));
    calculationCache.set(document, calculated);
  }
  return calculated.get(id);
}
