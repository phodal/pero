import type { MystNode } from './myst.ts';
import { normalizeMystIdentifier } from './myst.ts';
import type { MystScholarlyMetadata } from './myst-metadata.ts';
import { mystNodeText } from './myst-numbering.ts';

/** Bounded static counterparts of myst-transforms glossary/abbreviations at
 * 50e8220. Parser roles and validated frontmatter remain the syntax owners. */
export const MYST_TERMS_MAX_BYTES = 1024 * 1024;
export const MYST_TERMS_MAX_NODES = 10000;
type Report = (code: string, message: string, node?: MystNode) => void;

// Measure escaped UTF-8 without first allocating an escaped title. Repeated
// title attributes are the amplification risk, even when JS shares strings.
function escapedBytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    bytes += char === '&' ? 5 : char === '"' ? 6 : char === "'" ? 5
      : char === '<' || char === '>' ? 4 : cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
  }
  return bytes;
}

/** One budget per resolved document, including all its expanded includes.
 * A skipped match stays literal; source and raw frontmatter are never edited. */
export function projectMystTerms(ast: MystNode, metadata: MystScholarlyMetadata, report: Report): void {
  let bytes = 0, nodes = 0, exhausted = false;
  const reserve = (size: number, count: number, node: MystNode): boolean => {
    if (exhausted) return false;
    if (bytes + size > MYST_TERMS_MAX_BYTES || nodes + count > MYST_TERMS_MAX_NODES) {
      exhausted = true;
      report('terms-budget', 'Glossary/abbreviation projection exceeds 1 MiB escaped bytes or 10000 generated nodes; remaining text is literal. Original source is retained.', node);
      return false;
    }
    bytes += size; nodes += count; return true;
  };
  const abbreviations = metadata.abbreviations ?? {};
  const replacements = Object.entries(abbreviations).filter(([key]) => key.length > 1)
    .sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .map(([key, title]) => ({ key, title, size: escapedBytes(title ?? '') + escapedBytes(key) + 128 }));
  const skipped = new Set(['link', 'crossReference', 'cite', 'citeGroup', 'code', 'inlineCode', 'math', 'inlineMath', 'html', 'comment', 'mystDirective', 'mystRole', 'mystUnsupported']);
  const prepare = (node: MystNode): void => {
    if (node.type === 'glossary') {
      for (const list of node.children ?? []) {
        if (list.type !== 'definitionList') { report('glossary-definition-list', 'Glossary children must be definition lists; original content is retained.', list); continue; }
        for (const term of list.children ?? []) {
          if (term.type !== 'definitionTerm') continue;
          const label = mystNodeText(term), identifier = `term-${normalizeMystIdentifier(label)}`;
          if (!label.trim()) { report('glossary-empty-term', 'Glossary term has no text; original content is retained.', term); continue; }
          if (reserve(escapedBytes(label) + escapedBytes(identifier), 0, term)) { term.label = label; term.identifier = identifier; }
        }
      }
    }
    if (node.type === 'abbreviation') {
      const title = node.title || abbreviations[mystNodeText(node)];
      if (typeof title === 'string' && reserve(escapedBytes(title) + 128, 0, node)) node.title = title;
      else if (typeof title === 'string') delete node.title;
      return;
    }
    node.children?.forEach(prepare);
  };
  prepare(ast);
  const visit = (node: MystNode): void => {
    if (node.type === 'abbreviation' || skipped.has(node.type) || !node.children) return;
    node.children = node.children.flatMap(child => {
      if (child.type !== 'text' || !child.value || exhausted) { visit(child); return [child]; }
      // SDK applies longest keys first to remaining text, rather than a single
      // leftmost-first regex. Null matches protect a phrase from shorter keys.
      let parts: MystNode[] = [child];
      for (const { key, title, size } of replacements) {
        if (exhausted) break;
        parts = parts.flatMap(part => {
          if (part.type !== 'text' || !part.value || exhausted) return [part];
          const result: MystNode[] = [];
          let start = 0, offset = part.value.indexOf(key);
          while (offset >= 0) {
            if (!reserve(size, 4, child)) break;
            if (offset > start) result.push({ ...part, value: part.value.slice(start, offset) });
            result.push(title ? { type: 'abbreviation', title, children: [{ type: 'text', value: key }] }
              : { type: 'skippedAbbreviation', value: key });
            start = offset + key.length;
            offset = part.value.indexOf(key, start);
          }
          if (start === 0) return [part];
          if (start < part.value.length) result.push({ ...part, value: part.value.slice(start) });
          return result;
        });
      }
      for (const part of parts) if (part.type === 'skippedAbbreviation') part.type = 'text';
      return parts;
    });
  };
  visit(ast);
}
