import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';

type LocatedBlock = { node: ProseMirrorNode; start: number; index: number; parent: ProseMirrorNode; parentStart: number };
const focusedWidgets = new WeakMap<Editor, string>();

export function rememberWidgetFocus(editor: Editor, id?: string) {
  if (id) focusedWidgets.set(editor, id);
  else focusedWidgets.delete(editor);
}

export function topLevelBlock(editor: Editor, position = editor.state.selection.from): LocatedBlock | null {
  let current: LocatedBlock | null = null;
  editor.state.doc.forEach((node, start, index) => {
    if (!current && position >= start && position < start + node.nodeSize) current = { node, start, index, parent: editor.state.doc, parentStart: 0 };
  });
  return current;
}

/** Structural editing stays in the nearest document/section, not a sibling section. */
export function notebookBlockAt(editor: Editor, position = editor.state.selection.from): LocatedBlock | null {
  const point = editor.state.doc.resolve(position);
  for (let depth = point.depth; depth >= 0; depth--) {
    const parent = point.node(depth);
    if (parent.type.name !== 'doc' && parent.type.name !== 'section') continue;
    const index = point.index(depth), node = parent.maybeChild(index);
    if (!node) continue;
    const parentStart = point.start(depth);
    let start = parentStart;
    for (let i = 0; i < index; i++) start += parent.child(i).nodeSize;
    return { node, start, index, parent, parentStart };
  }
  return null;
}

export function activeNotebookBlock(editor: Editor): LocatedBlock | null {
  const widget = focusedWidgets.get(editor);
  let located: LocatedBlock | null = null;
  if (widget) editor.state.doc.descendants((node, start) => {
    if (node.attrs.blockId === widget) located = notebookBlockAt(editor, start);
  });
  return located ?? notebookBlockAt(editor);
}

export function moveBlock(editor: Editor, direction: -1 | 1, position?: number) {
  const current = position === undefined ? activeNotebookBlock(editor) : notebookBlockAt(editor, position);
  if (!current) return;
  const { tr } = editor.state;
  const next = current.parent.maybeChild(current.index + direction);
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
