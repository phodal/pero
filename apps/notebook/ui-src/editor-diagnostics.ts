/** Read-only diagnostics of the actual editor. Nothing is persisted or transmitted. */
import type { Editor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { columnTypes, structuredTableLimits } from '@pero/notebook/structured-table';
import { formulaFunctions } from '@pero/notebook/spreadsheet';
import { procedureKinds } from '@pero/notebook/workspace';
import { intakeModes } from '@pero/notebook/sample-intake';

export const diagnosticLimits = { text: 20000, spans: 200, events: 30, timings: 200 } as const;
export interface DiagnosticText { text: string; length: number; truncated: boolean }
export function diagnosticText(text: string): DiagnosticText {
  return { text: text.slice(0, diagnosticLimits.text), length: text.length, truncated: text.length > diagnosticLimits.text };
}
export interface EditorDiagnostic {
  selection: { type: string; from: number; to: number; anchor: number; head: number; empty: boolean; ancestors: string[]; marks: string[] };
  before: DiagnosticText; selected: DiagnosticText; after: DiagnosticText; html: DiagnosticText; selectionHtml: DiagnosticText;
  spans: { from: number; to: number; text: DiagnosticText; marks: { type: string; attrs: Record<string, unknown> }[] }[];
  spansTruncated: boolean; nodeCount: number; documentSize: number;
}
export function inspectEditor(editor: Editor): EditorDiagnostic {
  const { doc, selection, storedMarks } = editor.state;
  const selected = doc.textBetween(selection.from, selection.to, '\n', '\uFFFC');
  const spans: EditorDiagnostic['spans'] = []; let nodeCount = 0, spansTruncated = false;
  doc.descendants((node, pos) => {
    nodeCount++;
    if (node.isText && pos < selection.to && pos + node.nodeSize > selection.from) {
      if (spans.length >= diagnosticLimits.spans) { spansTruncated = true; return; }
      const from = Math.max(pos, selection.from), to = Math.min(pos + node.nodeSize, selection.to);
      spans.push({ from, to, text: diagnosticText(node.text!.slice(from - pos, to - pos)), marks: node.marks.map(mark => ({ type: mark.type.name, attrs: { ...mark.attrs } })) });
    }
  });
  const container = editor.view.dom.ownerDocument.createElement('div');
  container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(selection.content().content, { document: editor.view.dom.ownerDocument }));
  return {
    selection: { type: selection.toJSON().type, from: selection.from, to: selection.to, anchor: selection.anchor, head: selection.head, empty: selection.empty,
      ancestors: Array.from({ length: selection.$from.depth + 1 }, (_, depth) => selection.$from.node(depth).type.name),
      marks: (storedMarks ?? selection.$from.marks()).map(mark => mark.type.name) },
    before: diagnosticText(doc.textBetween(0, selection.from, '\n', '\uFFFC')), selected: diagnosticText(selected),
    after: diagnosticText(doc.textBetween(selection.to, doc.content.size, '\n', '\uFFFC')), html: diagnosticText(editor.getHTML()),
    selectionHtml: diagnosticText(container.innerHTML), spans, spansTruncated, nodeCount, documentSize: doc.content.size,
  };
}
export interface PasteDiagnostic {
  id: number; target: 'editor' | 'tray'; types: string[]; text: DiagnosticText; html: DiagnosticText;
  fileCount: number; selection: { from: number; to: number }; documentChanged: boolean | null; prevented: boolean | null;
}
export function inspectPaste(event: ClipboardEvent, editor: Editor, target: PasteDiagnostic['target'], id: number): PasteDiagnostic {
  const clipboard = event.clipboardData;
  return { id, target, types: [...(clipboard?.types ?? [])], text: diagnosticText(clipboard?.getData('text/plain') ?? ''),
    html: diagnosticText(clipboard?.getData('text/html') ?? ''), fileCount: clipboard?.files.length ?? 0,
    selection: { from: editor.state.selection.from, to: editor.state.selection.to }, documentChanged: null, prevented: null };
}
export interface EditorTiming { milliseconds: number; changed: boolean; steps: number; appended: number }
export function timingSummary(samples: readonly EditorTiming[]) {
  const values = samples.map(sample => sample.milliseconds).sort((a, b) => a - b);
  return { count: values.length, changes: samples.filter(sample => sample.changed).length,
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    p95: values.length ? values[Math.ceil(values.length * .95) - 1] : null, max: values.length ? values.at(-1)! : null };
}
/** Measures Tiptap beforeTransaction -> transaction (view update), not applyTransaction or paint. */
export function observeEditor(editor: Editor, changed: (sample: EditorTiming) => void, paste: (event: ClipboardEvent) => void, now = () => performance.now()): () => void {
  const starts = new WeakMap<Transaction, number>();
  const before = ({ transaction }: { transaction: Transaction }) => { starts.set(transaction, now()); };
  const after = ({ transaction, appendedTransactions }: { transaction: Transaction; appendedTransactions: Transaction[] }) => {
    const start = starts.get(transaction); if (start === undefined) return;
    starts.delete(transaction);
    changed({ milliseconds: Math.max(0, now() - start), changed: transaction.docChanged || appendedTransactions.some(item => item.docChanged),
      steps: transaction.steps.length + appendedTransactions.reduce((sum, item) => sum + item.steps.length, 0), appended: appendedTransactions.length });
  };
  editor.on('beforeTransaction', before); editor.on('transaction', after);
  const dom = editor.view.dom; dom.addEventListener('paste', paste, true);
  return () => { editor.off('beforeTransaction', before); editor.off('transaction', after); dom.removeEventListener('paste', paste, true); };
}
export interface NotebookCapability { kind: 'node' | 'mark' | 'extension' | 'field' | 'formula' | 'procedure' | 'intake'; name: string; owner: string; contract: string }
/** Generated from this editor's runtime schema and Pero's exported domain contracts, not a recovered source index. */
export function notebookCapabilities(editor: Editor): NotebookCapability[] {
  return [
    ...Object.entries(editor.schema.nodes).map(([name, type]) => ({ kind: 'node' as const, name, owner: '@tiptap/core · active editor schema', contract: JSON.stringify({ group: type.spec.group ?? '', content: type.spec.content ?? '', atom: type.isAtom, attributes: Object.keys(type.spec.attrs ?? {}) }) })),
    ...Object.entries(editor.schema.marks).map(([name, type]) => ({ kind: 'mark' as const, name, owner: '@tiptap/core · active editor schema', contract: JSON.stringify({ excludes: type.spec.excludes ?? '', attributes: Object.keys(type.spec.attrs ?? {}) }) })),
    ...editor.extensionManager.extensions.filter(extension => extension.type === 'extension').map(extension => ({ kind: 'extension' as const, name: extension.name, owner: '@tiptap/core · registered extension', contract: 'Registered in this editor / 已注册到当前编辑器' })),
    ...columnTypes.map(name => ({ kind: 'field' as const, name, owner: '@pero/notebook/structured-table', contract: JSON.stringify(structuredTableLimits) })),
    ...formulaFunctions.map(name => ({ kind: 'formula' as const, name, owner: '@pero/notebook/spreadsheet', contract: 'Curated function menu, not the entire engine / 常用函数菜单，非完整引擎列表' })),
    ...procedureKinds.map(name => ({ kind: 'procedure' as const, name, owner: '@pero/notebook/workspace', contract: 'Local procedure kind, not instrument execution / 本地步骤类型，非仪器执行' })),
    ...intakeModes.map(name => ({ kind: 'intake' as const, name, owner: '@pero/notebook/sample-intake', contract: 'Pinned local-catalog selection, not physical stock / 固定本地目录版本，非实物库存' })),
  ];
}
export function searchCapabilities(capabilities: readonly NotebookCapability[], query: string, kind = ''): NotebookCapability[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return capabilities.filter(item => (!kind || item.kind === kind) && words.every(word => `${item.name} ${item.owner} ${item.contract}`.toLocaleLowerCase().includes(word)));
}
