import type { NotebookDocument, NotebookNode } from './document.ts';

export interface RevisionDifference {
  path: string;
  kind: 'added' | 'removed' | 'changed' | 'reordered';
  before: string;
  after: string;
}
export interface RevisionComparison { changes: RevisionDifference[]; total: number; limited: boolean }

/** Only display previews are bounded. Equality always compares the actual saved values. */
export function compareNotebookRevisions(before: NotebookDocument, after: NotebookDocument, limit = 100): RevisionComparison {
  const changes: RevisionDifference[] = [];
  let total = 0;
  const missing = Symbol('missing');
  const preview = (value: unknown, path: string): string => {
    if (value === missing) return '(absent)';
    if (typeof value === 'string') {
      if (/(?:^|\.)(?:data|dataBase64|base64|bytes)$/.test(path) || /^data:[^,]+;base64,/.test(value)) return `[embedded data: ${value.length} characters; bytes omitted]`;
      return JSON.stringify(value.length > 280 ? `${value.slice(0, 280)}… [${value.length} characters]` : value);
    }
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (value !== null && typeof value === 'object') return `{${Object.keys(value).slice(0, 12).join(', ')}${Object.keys(value).length > 12 ? ', …' : ''}}`;
    return String(value);
  };
  const add = (path: string, old: unknown, next: unknown, kind: RevisionDifference['kind'] = old === missing ? 'added' : next === missing ? 'removed' : 'changed') => {
    total++;
    if (changes.length < Math.max(1, Math.min(limit, 200))) changes.push({ path, kind, before: preview(old, path), after: preview(next, path) });
  };
  const identity = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') return;
    const item = value as { id?: unknown; attrs?: { blockId?: unknown } };
    const id = item.attrs?.blockId ?? item.id;
    return typeof id === 'string' ? id : undefined;
  };
  const walk = (old: unknown, next: unknown, path: string) => {
    if (old === next) return;
    if (Array.isArray(old) && Array.isArray(next)) {
      const leftIds = old.map(identity), rightIds = next.map(identity);
      const stable = leftIds.every(Boolean) && rightIds.every(Boolean) && new Set(leftIds).size === old.length && new Set(rightIds).size === next.length;
      if (stable) {
        const left = new Map(old.map((item, index) => [leftIds[index]!, item]));
        const right = new Map(next.map((item, index) => [rightIds[index]!, item]));
        const sharedLeft = leftIds.filter(id => right.has(id!)), sharedRight = rightIds.filter(id => left.has(id!));
        if (sharedLeft.join('\0') !== sharedRight.join('\0')) add(`${path}.order`, sharedLeft.join(', '), sharedRight.join(', '), 'reordered');
        for (const key of new Set([...left.keys(), ...right.keys()])) walk(left.has(key) ? left.get(key) : missing, right.has(key) ? right.get(key) : missing, `${path}[${key}]`);
      } else {
        for (let index = 0; index < Math.max(old.length, next.length); index++) walk(index < old.length ? old[index] : missing, index < next.length ? next[index] : missing, `${path}[${index}]`);
      }
    } else if (old !== null && next !== null && typeof old === 'object' && typeof next === 'object' && !Array.isArray(old) && !Array.isArray(next)) {
      const left = old as Record<string, unknown>, right = next as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(Object.hasOwn(left, key) ? left[key] : missing, Object.hasOwn(right, key) ? right[key] : missing, `${path}.${key}`);
    } else add(path, old, next);
  };
  walk(before, after, 'entry');
  return { changes, total, limited: total > changes.length };
}

/** Stable block choices, including nested paragraphs, sections and table blocks. */
export function reviewAnchorBlocks(document: NotebookDocument): { value: string; label: string }[] {
  const items: { value: string; label: string }[] = [];
  const text = (node: NotebookNode): string => `${node.text ?? ''}${(node.content ?? []).map(text).join('')}`;
  const visit = (node: NotebookNode) => {
    if (typeof node.attrs?.blockId === 'string') items.push({ value: node.attrs.blockId,
      label: `${node.type}: ${String(node.attrs.label ?? node.attrs.title ?? text(node)).trim().slice(0, 72) || node.attrs.blockId}` });
    for (const child of node.content ?? []) visit(child);
  };
  visit(document.content);
  return items;
}
