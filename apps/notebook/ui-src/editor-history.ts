import type { Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';

/** Group only inline typing in one text block. Widget/structure commands stay atomic. */
export function notebookHistoryGroup(transaction: Transaction): string | null {
  if (transaction.getMeta('uiEvent') === 'paste' || transaction.steps.length !== 1) return null;
  const step = transaction.steps[0];
  if (!(step instanceof ReplaceStep)) return null;
  const from = transaction.before.resolve(step.from), to = transaction.before.resolve(step.to);
  if (!from.sameParent(to) || !from.parent.isTextblock) return null;
  let textOnly = true;
  step.slice.content.forEach(node => { if (!node.isText) textOnly = false; });
  if (!textOnly) return null;
  return `text:${from.parent.attrs.blockId ?? from.start()}`;
}
