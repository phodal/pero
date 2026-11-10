import type { NotebookDocument } from './document.ts';

/** One history owns the entire document, including nested widgets and metadata. */
export interface DocumentHistory {
  past: NotebookDocument[];
  present: NotebookDocument;
  future: NotebookDocument[];
  group: string | null;
  editedAt: number;
}
export function documentHistory(document: NotebookDocument): DocumentHistory {
  return { past: [], present: document, future: [], group: null, editedAt: 0 };
}
export type DocumentEdit =
  | { type: 'edit'; document: NotebookDocument; group: string | null; at: number }
  | { type: 'restore'; document: NotebookDocument }
  | { type: 'undo' }
  | { type: 'redo' };
export function transitionDocument(state: DocumentHistory, edit: DocumentEdit): DocumentHistory {
  if (edit.type === 'undo' || edit.type === 'redo') {
    const from = edit.type === 'undo' ? state.past : state.future;
    if (!from.length) return state;
    const present = from[from.length - 1];
    return edit.type === 'undo'
      ? { past: from.slice(0, -1), present, future: [...state.future, state.present], group: null, editedAt: 0 }
      : { past: [...state.past, state.present], present, future: from.slice(0, -1), group: null, editedAt: 0 };
  }
  if (JSON.stringify(edit.document) === JSON.stringify(state.present)) return state;
  if (edit.type === 'restore' && JSON.stringify(edit.document.templateOrigin) !== JSON.stringify(state.present.templateOrigin)) {
    throw new Error('This revision has different template provenance. Export it or create a separate entry instead.');
  }
  const grouped = edit.type === 'edit' && edit.group !== null && state.group === edit.group && edit.at >= state.editedAt && edit.at - state.editedAt < 750;
  return { past: grouped ? state.past : [...state.past, state.present].slice(-50), present: edit.document,
    future: [], group: edit.type === 'edit' ? edit.group : null, editedAt: edit.type === 'edit' ? edit.at : 0 };
}
