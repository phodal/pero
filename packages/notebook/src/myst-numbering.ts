import { fillNumbering, type Numbering } from 'myst-frontmatter';
import { normalizeMystIdentifier, type MystNode, type MystReferenceTarget } from './myst.ts';

/** Static target enumeration and reference text have one owner. This is the
 * bounded projection of upstream enumerate.ts at 50e8220, not its compiler. */
const defaults: Numbering = {
  equation: { enabled: true, template: '(%s)' },
  subequation: { enabled: true, template: '(%s)' },
  figure: { enabled: true, template: 'Figure %s' },
  subfigure: { enabled: true, template: 'Figure %s' },
  table: { enabled: true, template: 'Table %s' },
  code: { enabled: true, template: 'Program %s' },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(depth => [`heading_${depth}`, { template: 'Section %s' }])),
};
export interface MystNumberingState {
  numbering: Numbering;
  headings: (number | null)[];
  counts: Record<string, { main: number; sub: number }>;
}
type Report = (code: string, message: string, node?: MystNode) => void;
const string = (value: unknown) => typeof value === 'string' ? value : undefined;
export const mystNodeText = (node: MystNode): string => node.value ?? (node.children ?? []).map(mystNodeText).join('');
const kindName = (kind: string) => { const name = kind === 'code' ? 'program' : kind.split(':').at(-1)!; return name[0].toUpperCase() + name.slice(1); };

/** A notebook passes the SAME state through its visible cells. Separate pages
 * start fresh; an explicit ordered caller may supply previous counts, in which
 * case only the upstream `continue` settings inherit them. */
export function createMystNumberingState(settings?: Numbering, previous?: MystNumberingState): MystNumberingState {
  const numbering = fillNumbering(settings, defaults);
  const headings = [1, 2, 3, 4, 5, 6].map((depth, index) => {
    const item = numbering[`heading_${depth}`];
    if (item?.enabled === false) return null;
    if (item?.start) return item.start - 1;
    if ((item?.continue ?? numbering.all?.continue) && previous) return previous.headings[index];
    return 0;
  });
  const counts: MystNumberingState['counts'] = Object.create(null);
  for (const [kind, count] of Object.entries(previous?.counts ?? {})) {
    if (numbering[kind]?.continue ?? numbering.all?.continue) counts[kind] = { ...count };
  }
  for (const [kind, item] of Object.entries(numbering)) {
    if (!kind.startsWith('heading_') && item.start) counts[kind] = { main: item.start - 1, sub: 0 };
  }
  return { numbering, headings, counts };
}
const kindFor = (node: MystNode) => node.type === 'container' ? string(node.kind) ?? 'figure'
  : node.type === 'math' || node.type === 'mathGroup' ? node.kind === 'subequation' ? 'subequation' : 'equation'
  : node.type === 'heading' ? 'section' : node.kind ? `${node.type}:${node.kind}` : node.type;
const headingDepth = (node: MystNode, numbering: Numbering) => Number(node.depth) - (numbering.title?.enabled ? 0 : 1) + (numbering.title?.offset ?? 0);
const numberedTemplate = (kind: string) => kind === 'section' ? 'Section %s' : `${kindName(kind)} %s`;
const first = (node: MystNode, type: string): MystNode | undefined => node.type === type ? node : node.children?.map(child => first(child, type)).find(Boolean);
function targetName(node: MystNode): MystNode[] | undefined {
  if (node.type === 'heading') return node.children;
  // The parser emits figure body paragraphs before the caption transform.
  const caption = first(node, 'caption') ?? first(node, 'admonitionTitle') ?? first(node, 'definitionTerm')
    ?? (node.type === 'container' ? node.children?.find(child => child.type === 'paragraph') : undefined);
  return caption ? (first(caption, 'paragraph') ?? caption).children : undefined;
}

/** Attach explicit block labels before any implicit heading identifiers. */
export function attachMystTargets(node: MystNode): void {
  const children = node.children ?? [];
  children.forEach((child, index) => {
    if (child.type === 'mystTarget' && typeof child.label === 'string') {
      const next = children[index + 1];
      if (next && !next.identifier) { next.identifier = normalizeMystIdentifier(child.label); next.label = child.label; child.type = 'comment'; }
    }
  });
  children.forEach(attachMystTargets);
}

export function enumerateMystTargets(ast: MystNode, state: MystNumberingState, report: Report): Record<string, MystReferenceTarget> {
  attachMystTargets(ast);
  const references: Record<string, MystReferenceTarget> = Object.create(null);
  const { numbering } = state;
  const visit = (node: MystNode) => {
    if (['crossReference', 'cite', 'link', 'footnoteReference', 'footnoteDefinition', 'comment'].includes(node.type)) { node.children?.forEach(visit); return; }
    const rawId = string(node.identifier) ?? (node.type === 'mystTarget' ? string(node.label) : undefined);
    const kind = kindFor(node), depth = headingDepth(node, numbering);
    const key = node.type === 'heading' ? `heading_${depth}` : node.subcontainer ? 'subfigure' : kind;
    const eligible = rawId || node.enumerated || ['container', 'math', 'mathGroup', 'heading', 'proof'].includes(node.type);
    const enabled = typeof node.enumerated === 'boolean' ? node.enumerated : numbering[key]?.enabled ?? numbering.all?.enabled ?? false;
    if (eligible && enabled && !node.enumerator) {
      const prefix = numbering[key]?.enumerator ?? numbering.enumerator?.enumerator;
      let value: string;
      if (node.type === 'heading') {
        state.headings = state.headings.map((count, index) => count === null || index < depth - 1 ? count : index === depth - 1 ? count + 1 : 0);
        const parts = state.headings.filter(count => count !== null);
        while (parts.at(-1) === 0) parts.pop();
        value = parts.join('.');
      } else {
        const countKind = kind === 'subequation' ? 'equation' : kind;
        const count = state.counts[countKind] ??= { main: 0, sub: 0 };
        if (node.subcontainer || kind === 'subequation') {
          const letter = String.fromCharCode((count.sub++ % 26) + 97);
          value = node.subcontainer ? letter : `${count.main}${letter}`;
          if (node.subcontainer) node.parentEnumerator = (numbering[countKind]?.enumerator ?? numbering.enumerator?.enumerator ?? '%s').replaceAll('%s', String(count.main));
        } else { value = String(++count.main); count.sub = 0; }
      }
      if (value) node.enumerator = prefix ? prefix.replaceAll('%s', value) : value;
    }
    if (eligible) {
      const number = string(node.enumerator);
      const title = targetName(node);
      const name = title?.length ? structuredClone(title) : undefined;
      const template = number ? numbering[key]?.template ?? numberedTemplate(kind)
        : node.type === 'proof' || kind === 'exercise' ? `${kindName(kind)}${name ? ' ({name})' : ''}`
        : name ? '{name}' : kindName(kind);
      // Display numbering does not require an authored target label.
      node.numberingLabel = number ? template.replaceAll('%s', `${node.parentEnumerator ?? ''}${number}`).replaceAll('{number}', `${node.parentEnumerator ?? ''}${number}`).replaceAll('{name}', name?.map(mystNodeText).join('') ?? rawId ?? '') : '';
      if (rawId) {
        const id = normalizeMystIdentifier(rawId);
        node.identifier = id;
        const target: MystReferenceTarget = { identifier: id, kind, ...(number ? { number: `${node.parentEnumerator ?? ''}${number}` } : {}), template, ...(name ? { name } : {}), label: '' };
        target.label = mystReferenceContent({ type: 'crossReference', identifier: id }, target).map(mystNodeText).join('');
        if (references[id]) report('reference-duplicate', `Duplicate label: ${rawId}`, node);
        else references[id] = target;
      }
    }
    node.children?.forEach(visit);
  };
  visit(ast);
  return references;
}

/** Substitutions apply only to text nodes; code/math are literal. Cloned title
 * links are flattened so inserting {name} never nests active links. */
export function mystReferenceContent(node: MystNode, target: MystReferenceTarget, report?: Report): MystNode[] {
  const source = node.referenceContent ?? node.children ?? [];
  const name = target.name?.length ? target.name : [{ type: 'text', value: String(node.label ?? target.identifier) }];
  const template = !source.length && node.kind === 'ref' && target.name?.length && target.kind !== 'section'
    ? target.name : source.length ? source : [{ type: 'text', value: target.template }];
  let missing = false;
  const cleanName = (child: MystNode): MystNode[] => ['link', 'crossReference'].includes(child.type) ? (child.children ?? []).flatMap(cleanName)
    : [{ ...child, identifier: undefined, ...(child.children ? { children: child.children.flatMap(cleanName) } : {}) }];
  const fill = (child: MystNode): MystNode[] => {
    if (child.type === 'text') return (child.value ?? '').split(/(%s|\{number\}|\{name\})/).filter(Boolean).flatMap(part => {
      if (part === '{name}') return structuredClone(name).flatMap(cleanName);
      if (part === '%s' || part === '{number}') { if (!target.number) missing = true; return [{ type: 'text', value: target.number ?? '??' }]; }
      return [{ ...child, value: part }];
    });
    return [{ ...child, ...(child.children ? { children: child.children.flatMap(fill) } : {}) }];
  };
  const children = template.flatMap(fill);
  if (missing) report?.('reference-number-unavailable', `Reference ${target.identifier} requests a number, but its target is not numbered; filled with ??.`, node);
  return children;
}
export function resolveMystReferenceContent(node: MystNode, target: MystReferenceTarget, report?: Report): void {
  node.referenceContent ??= structuredClone(node.children ?? []);
  node.children = mystReferenceContent(node, target, report);
}
