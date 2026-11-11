import type { ProjectFrontmatter } from 'myst-frontmatter';
import type { MystDiagnostic, MystDocument, MystNode } from './myst.ts';
import { resolveMystResource, type MystProjectSnapshot } from './myst-project-snapshot.ts';

/** Navigation is a projection of admitted files, never a second document owner. */
export interface MystProjectTocEntry {
  path?: string;
  title: string;
  hidden: boolean;
  children: MystProjectTocEntry[];
}
export interface MystProjectToc {
  toc: MystProjectTocEntry[];
  /** All supplied pages in publication order, including hidden and unlisted pages. */
  pageOrder: string[];
  /** Only visible TOC pages contribute to continuous project numbering. */
  numberingOrder: string[];
}
export interface MystTocPage { path: string; title: string }
export const mystNodeText = (node: MystNode): string => node.value ?? node.children?.map(mystNodeText).join('') ?? '';

/** The existing frontmatter boundary already validates the upstream TOC schema. */
export function buildMystProjectToc(snapshot: MystProjectSnapshot, supplied: ProjectFrontmatter['toc'], pages: MystTocPage[], diagnostics: MystDiagnostic[]): MystProjectToc {
  const destinations = new Map(pages.map(page => [page.path, page]));
  const pageOrder: string[] = [], numberingOrder: string[] = [];
  const report = (code: string, message: string) => diagnostics.push({ severity: 'warning', code, message, path: 'myst.yml' });
  const entries = (items: NonNullable<ProjectFrontmatter['toc']>, ancestorHidden = false): MystProjectTocEntry[] => items.flatMap(item => {
    if ('pattern' in item || 'url' in item) {
      report('toc-unsupported', 'Only explicit supplied-file and title-group TOC entries are compiled; URL and glob entries are retained but not expanded.');
      return [];
    }
    const hidden = ancestorHidden || item.hidden === true;
    let path: string | undefined, title = item.title ?? '';
    if ('file' in item) {
      const resolution = resolveMystResource(snapshot, 'myst.yml', item.file);
      if (resolution.status !== 'resolved') {
        report(`toc-${resolution.status}`, `TOC file ${item.file}: ${resolution.status === 'missing' ? 'not provided in this snapshot' : resolution.reason}`);
        return [];
      }
      path = resolution.path;
      const page = destinations.get(path);
      if (!page) { report('toc-unsupported', `TOC file ${item.file} is not a supplied Markdown or notebook page.`); return []; }
      if (pageOrder.includes(path)) { report('toc-duplicate', `Duplicate TOC file: ${path}; only its first occurrence is used.`); return []; }
      title ||= page.title;
      pageOrder.push(path);
      if (!hidden) numberingOrder.push(path);
    }
    return [{ ...(path ? { path } : {}), title, hidden, children: entries(item.children ?? [], hidden) }];
  });
  const fallback = snapshot.files.filter(file => destinations.has(file.path)).map(file => ({ file: file.path }));
  const toc = entries(supplied ?? fallback);
  for (const page of fallback) if (!pageOrder.includes(page.file)) pageOrder.push(page.file);
  return { toc, pageOrder, numberingOrder };
}

/** Shared ordinary list/link AST for project navigation and `{toc}` directives. */
export function mystProjectTocList(entries: readonly MystProjectTocEntry[], depth = Infinity): MystNode {
  return { type: 'list', ordered: false, children: depth <= 0 ? [] : entries.filter(item => !item.hidden).map(item => ({
    type: 'listItem', children: [item.path ? { type: 'link', url: item.path, projectTarget: { path: item.path, identifier: '', label: item.title }, children: [{ type: 'text', value: item.title }] } : { type: 'text', value: item.title },
      ...(item.children.some(child => !child.hidden) && depth > 1 ? [mystProjectTocList(item.children, depth - 1)] : [])],
  })) };
}

/** Headings used by TOCs need deterministic anchors before reference indexing. */
export function prepareMystTocHeadings(ast: MystNode): void {
  const nodes: MystNode[] = [], explicit = new Set<MystNode>();
  const collect = (node: MystNode) => {
    nodes.push(node);
    if (node.type !== 'toc') node.children?.forEach((child, index, siblings) => {
      if (siblings[index - 1]?.type === 'mystTarget') explicit.add(child);
      collect(child);
    });
  };
  collect(ast);
  if (!nodes.some(node => node.type === 'toc')) return;
  const ids = new Set(nodes.flatMap(node => typeof node.identifier === 'string' ? [node.identifier] : node.type === 'mystTarget' && typeof node.label === 'string' ? [node.label] : []));
  for (const node of nodes) if (node.type === 'heading' && !node.identifier && !explicit.has(node)) {
    const base = mystNodeText(node).trim().toLowerCase().replace(/\s+/gu, '-').replace(/[^\p{L}\p{N}_-]/gu, '') || 'section';
    let identifier = base, suffix = 1;
    while (ids.has(identifier)) identifier = `${base}-${suffix++}`;
    node.identifier = identifier; ids.add(identifier);
  }
}

/** Expand inert TOC placeholders after target indexing; source remains untouched. */
export function expandMystTocs(document: MystDocument, project?: { toc: readonly MystProjectTocEntry[]; path: string; namespace?: string }, deferProject = false): void {
  const nodes: MystNode[] = [];
  const collect = (node: MystNode) => { if (node.type === 'toc' || node.type === 'heading') nodes.push(node); if (node.type !== 'toc') node.children?.forEach(collect); };
  collect(document.ast);
  const allHeadings = nodes.filter(node => node.type === 'heading');
  const findPage = (entries: readonly MystProjectTocEntry[]): MystProjectTocEntry | undefined => {
    for (const entry of entries) { if (entry.path === project?.path) return entry; const child = findPage(entry.children); if (child) return child; }
  };
  const headingList = (headings: MystNode[]): MystNode => {
    const root: MystNode = { type: 'list', ordered: false, children: [] };
    const stack: { depth: number; list: MystNode; item?: MystNode }[] = [{ depth: -1, list: root }];
    for (const heading of headings) {
      const depth = Number(heading.depth);
      while (stack.length > 1 && depth < stack.at(-1)!.depth) stack.pop();
      let level = stack.at(-1)!;
      if (depth > level.depth && level.item) { const list: MystNode = { type: 'list', ordered: false, children: [] }; level.item.children!.push(list); level = { depth, list }; stack.push(level); }
      else if (level.depth < 0) level.depth = depth;
      const title = mystNodeText(heading), id = typeof heading.identifier === 'string' ? heading.identifier : undefined;
      const text: MystNode = { type: 'text', value: title };
      const item: MystNode = { type: 'listItem', children: [id ? { type: 'link', url: `#${id}`, ...(project ? { projectTarget: { path: project.namespace ?? project.path, identifier: id, label: title } } : {}), children: [text] } : text] };
      level.list.children!.push(item); level.item = item;
    }
    return root;
  };
  for (const [index, toc] of nodes.entries()) {
    if (toc.type !== 'toc') continue;
    const kind = String(toc.kind), depth = typeof toc.depth === 'number' ? toc.depth : Infinity;
    let list: MystNode;
    if (kind === 'project' || kind === 'children') {
      if (!project) {
        if (!deferProject) document.diagnostics.push({ severity: 'warning', code: 'toc-project-unavailable', message: `The ${kind} TOC requires an explicit project snapshot.`, line: toc.position?.start.line });
        continue;
      }
      list = mystProjectTocList(kind === 'project' ? project.toc : findPage(project.toc)?.children ?? [], depth);
    } else {
      let headings = allHeadings;
      if (kind === 'section') {
        const parent = nodes.slice(0, index).reverse().find(node => node.type === 'heading');
        const following = nodes.slice(index + 1).filter(node => node.type === 'heading');
        const end = parent ? following.findIndex(node => Number(node.depth) <= Number(parent.depth)) : -1;
        headings = end < 0 ? following : following.slice(0, end);
      }
      const firstDepth = Number(headings[0]?.depth ?? 1);
      list = headingList(headings.filter(heading => Number(heading.depth) - firstDepth < depth));
    }
    toc.type = 'block'; toc.data = { part: `toc:${kind}` }; delete toc.kind;
    toc.children = [...(toc.children ?? []), list];
  }
}
