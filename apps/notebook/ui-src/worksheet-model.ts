import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { evaluateSpreadsheet, evaluateWorkbook, type CellValue, type Spreadsheet } from '@pero/notebook/spreadsheet';
import { renameWorksheet as renameNotebookWorksheet, type NotebookWorksheet } from '@pero/notebook/worksheet';

export function worksheetBlocks(document: Node): NotebookWorksheet[] {
  const blocks: NotebookWorksheet[] = [];
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
  const worksheets = worksheetBlocks(editor.state.doc);
  const result = renameNotebookWorksheet(worksheets, blockId, name);
  if (result.status !== 'ok') return result.status;
  const changes = new Map(result.worksheets
    .filter((worksheet, index) => worksheet !== worksheets[index])
    .map(worksheet => [worksheet.id, worksheet]));
  if (!changes.size) return;
  editor.commands.command(({ tr }) => {
    closeHistory(tr);
    tr.doc.descendants((node, position) => {
      if (node.type.name !== 'spreadsheet') return;
      const changed = changes.get(node.attrs.blockId);
      if (changed) tr.setNodeMarkup(position, undefined, { ...node.attrs, label: changed.name, sheet: changed.sheet });
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
