import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';

type LocatedBlock = { node: ProseMirrorNode; start: number; index: number };
const focusedWidgets = new WeakMap<Editor, string>();

export function rememberWidgetFocus(editor: Editor, id?: string) {
  if (id) focusedWidgets.set(editor, id);
  else focusedWidgets.delete(editor);
}

export function topLevelBlock(editor: Editor, position = editor.state.selection.from): LocatedBlock | null {
  let current: LocatedBlock | null = null;
  editor.state.doc.forEach((node, start, index) => {
    if (!current && position >= start && position < start + node.nodeSize) current = { node, start, index };
  });
  return current;
}

export function activeNotebookBlock(editor: Editor): LocatedBlock | null {
  const widget = focusedWidgets.get(editor);
  let located: LocatedBlock | null = null;
  if (widget) editor.state.doc.forEach((node, start, index) => {
    if (node.attrs.blockId === widget) located = { node, start, index };
  });
  return located ?? topLevelBlock(editor);
}

export function moveBlock(editor: Editor, direction: -1 | 1, position?: number) {
  const current = position === undefined ? activeNotebookBlock(editor) : topLevelBlock(editor, position);
  if (!current) return;
  const { doc, tr } = editor.state;
  const next = doc.maybeChild(current.index + direction);
  if (!next) return;
  const start = direction < 0 ? current.start - next.nodeSize : current.start;
  const first = direction < 0 ? current.node : next;
  const second = direction < 0 ? next : current.node;
  const moved = tr.replaceWith(start, start + current.node.nodeSize + next.nodeSize, [first, second]);
  const destination = direction < 0 ? start : start + next.nodeSize;
  moved.setSelection(Selection.near(moved.doc.resolve(destination + (current.node.isAtom ? 0 : 1)), 1));
  editor.view.dispatch(moved);
  editor.commands.focus();
}
