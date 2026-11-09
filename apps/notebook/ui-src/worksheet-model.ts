import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { type Spreadsheet } from '@pero/notebook/spreadsheet';
import { calculateNotebookWorksheets, resolveWorksheetNames, renameWorksheet as renameNotebookWorksheet, type CalculatedWorksheet, type NotebookWorksheet } from '@pero/notebook/worksheet';

export function worksheetBlocks(document: Node): NotebookWorksheet[] {
  const blocks: NotebookWorksheet[] = [];
  document.descendants(node => {
    if (node.type.name !== 'spreadsheet') return;
    const { blockId, label, sheet } = node.attrs as { blockId: string; label: string; sheet: Spreadsheet };
    blocks.push({ id: blockId, name: label, sheet });
  });
  return resolveWorksheetNames(blocks);
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

const calculationCache = new WeakMap<Node, Map<string, CalculatedWorksheet>>();

export function worksheetCalculation(document: Node, id: string): CalculatedWorksheet | undefined {
  let calculated = calculationCache.get(document);
  if (!calculated) {
    calculated = calculateNotebookWorksheets(worksheetBlocks(document));
    calculationCache.set(document, calculated);
  }
  return calculated.get(id);
}
