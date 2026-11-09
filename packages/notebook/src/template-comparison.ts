import { compareNotebookRevisions, type RevisionComparison, type RevisionDifference } from './review.ts';
import type { PublishedTemplate } from './templates.ts';

/** Compare immutable definitions, not instantiated copies or current archive state. */
export function compareTemplateRevisions(before: PublishedTemplate, after: PublishedTemplate, limit = 100): RevisionComparison {
  if (before.id !== after.id || before.kind !== after.kind) throw new Error('Compare revisions of the same template and scope.');
  const maximum = Math.max(1, Math.min(200, Math.floor(limit) || 100));
  const changes: RevisionDifference[] = [];
  let total = 0;
  const preview = (value: unknown) => {
    if (value === undefined) return '(absent)';
    const text = JSON.stringify(value);
    return text.length > 280 ? `${text.slice(0, 280)}… [${text.length} characters]` : text;
  };
  const add = (path: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    total++;
    if (changes.length < maximum) changes.push({ path, kind: left === undefined ? 'added' : right === undefined ? 'removed' : 'changed', before: preview(left), after: preview(right) });
  };
  for (const field of ['name', 'description', 'collections'] as const) add(`template.${field}`, before[field], after[field]);
  const left = new Map(before.parameters.map(item => [item.key, item])), right = new Map(after.parameters.map(item => [item.key, item]));
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key), b = right.get(key);
    if (!a || !b) add(`parameters[${key}]`, a, b);
    else for (const field of ['label', 'type', 'required', 'target', 'default'] as const) add(`parameters[${key}].${field}`, a[field], b[field]);
  }
  const content = compareNotebookRevisions(before.document, after.document, maximum);
  total += content.total;
  changes.push(...content.changes.slice(0, maximum - changes.length));
  return { changes, total, limited: total > changes.length };
}
