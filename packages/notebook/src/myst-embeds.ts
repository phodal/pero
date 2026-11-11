import { normalizeMystIdentifier, type MystDocument, type MystNode } from './myst.ts';
import { MYST_INCLUDE_MAX_BYTES, MYST_INCLUDE_MAX_COUNT, MYST_INCLUDE_MAX_DEPTH } from './myst-includes.ts';
import { resolveMystResource, type MystProjectSnapshot } from './myst-project-snapshot.ts';

export interface MystEmbedPage { path: string; document: MystDocument }
interface MystEmbedTarget { page: MystEmbedPage; nodes: MystNode[]; identifier: string }
const references = new Set(['crossReference', 'cite', 'citeGroup', 'footnoteReference']);
export const isMystEmbedImage = (node: MystNode): boolean => node.type === 'image' && typeof node.url === 'string' && (node.url.startsWith('#') || /\.(?:md|myst|ipynb)#/i.test(node.url) || /^(?:xref|myst):/.test(node.url));
const walk = (node: MystNode, visit: (node: MystNode) => void) => { visit(node); node.children?.forEach(child => walk(child, visit)); };

/** A derived copy of explicitly supplied, labelled content. No resource discovery. */
export function expandMystEmbeds(pages: readonly MystEmbedPage[], snapshot?: MystProjectSnapshot): void {
  const targets = new Map<string, MystEmbedTarget[]>();
  for (const page of pages) {
    const index = (siblings: MystNode[]) => siblings.forEach((node, offset) => {
      if (typeof node.identifier === 'string' && !references.has(node.type) && node.type !== 'comment') {
        let end = offset + 1;
        // A section includes its body and subsections, stopping at its next peer.
        if (node.type === 'heading') while (end < siblings.length && !(siblings[end].type === 'heading' && Number(siblings[end].depth) <= Number(node.depth))) end++;
        const identifier = normalizeMystIdentifier(node.identifier);
        targets.set(identifier, [...(targets.get(identifier) ?? []), { page, identifier, nodes: siblings.slice(offset, end) }]);
      }
      if (node.children) index(node.children);
    });
    index(page.document.ast.children ?? []);
  }
  for (const page of pages) {
    let count = 0, bytes = 0;
    const expand = (node: MystNode, origin: MystEmbedPage, stack: MystEmbedTarget[], parent?: MystNode): MystNode => {
      const directive = node.type === 'mystDirective' && node.name === 'embed';
      const image = isMystEmbedImage(node);
      if (!directive && !image) return { ...node, ...(node.children ? { children: node.children.map(child => expand(child, origin, stack, node)).flatMap(child => {
        if (node.type === 'container' && child.embedSource && child.type === 'block') {
          const content = child.children ?? [];
          return content.length === 1 && content[0].type === 'container' ? (content[0].children ?? []).filter(item => item.type !== 'caption' && item.type !== 'legend') : content;
        }
        return [child];
      }) } : {}) };
      const authored = String(directive ? node.args ?? '' : node.url ?? '').trim();
      const report = (code: string, message: string) => {
        page.document.diagnostics.push({ severity: 'warning', code: `embed-${code}`, message, path: node.provenance?.path ?? origin.path, line: node.position?.start.line });
        return { ...node, type: 'mystUnsupported', children: undefined, value: directive ? node.value : `![${String(node.alt ?? '')}](${authored})` };
      };
      if (parent && !['root', 'block', 'container', 'admonition', 'blockquote', 'listItem'].includes(parent.type)) return report('inline-unsupported', 'Block embeds inside inline content are not supported; source is retained.');
      const options = directive ? (node.options ?? {}) as Record<string, unknown> : {};
      if (Object.keys(options).some(key => !['remove-input', 'remove-output', 'name', 'label'].includes(key)) || (typeof node.directiveBody === 'string' && node.directiveBody.trim())) return report('options', 'Unsupported embed options or body; source is retained.');
      if (['remove-input', 'remove-output'].some(key => key in options && ![true, false, '', 'true', 'false'].includes(options[key] as string | boolean))) return report('options', 'Embed remove-input/remove-output must be Boolean flags.');
      const hash = authored.indexOf('#');
      const path = hash >= 0 ? authored.slice(0, hash) : '';
      let label = hash >= 0 ? authored.slice(hash + 1) : authored;
      try { label = decodeURIComponent(label); } catch { return report('unsupported', 'Invalid escape in embed label; source is retained.'); }
      let targetPath: string | undefined;
      if (path) {
        if (!snapshot) return report('unsupported', 'Cross-page embeds require an explicit project snapshot.');
        const resolution = resolveMystResource(snapshot, node.provenance?.path ?? origin.path, path);
        if (resolution.status !== 'resolved') return report(resolution.status, `Embed ${authored}: ${resolution.status === 'missing' ? 'resource not provided' : resolution.reason}`);
        targetPath = resolution.path;
      }
      if (!label || /^(?:https?:|xref:|myst:|\/)/i.test(authored) && hash < 0) return report('unsupported', 'A local labelled target is required; remote embeds are not loaded.');
      const candidates = (targets.get(normalizeMystIdentifier(label)) ?? []).filter(target => targetPath === undefined || target.page.path === targetPath);
      if (candidates.length !== 1) return report(candidates.length ? 'ambiguous' : 'missing', `${candidates.length ? 'Ambiguous' : 'Missing'} embed target: ${authored}`);
      const target = candidates[0];
      if (stack.includes(target)) return report('cycle', `Cyclic embed target: ${authored}`);
      if (stack.length >= MYST_INCLUDE_MAX_DEPTH) return report('depth', `Embed depth exceeds ${MYST_INCLUDE_MAX_DEPTH}.`);
      if (++count > MYST_INCLUDE_MAX_COUNT) return report('budget', 'Embed count budget exceeded.');
      const size = new TextEncoder().encode(JSON.stringify(target.nodes)).length;
      if (size > MYST_INCLUDE_MAX_BYTES - bytes) return report('budget', 'Embed expansion exceeds 1 MiB.');
      bytes += size;
      let unsupported = false;
      target.nodes.forEach(node => walk(node, item => { if (['cite', 'citeGroup', 'footnoteDefinition', 'footnoteReference'].includes(item.type)) unsupported = true; }));
      if (unsupported && target.page !== origin) return report('context-unsupported', 'Cross-page citation and footnote context is not copied by embeds; source is retained.');
      const enabled = (key: string) => key in options && options[key] !== false && options[key] !== 'false';
      const select = (item: MystNode): MystNode[] => {
        if (item.recordedPart === 'input' && enabled('remove-input') || item.recordedPart === 'output' && enabled('remove-output')) return [];
        return [{ ...item, ...(item.children ? { children: item.children.flatMap(select) } : {}) }];
      };
      const children = structuredClone(target.nodes).flatMap(select).map(child => expand(child, target.page, [...stack, target]));
      children.forEach(child => walk(child, item => {
        if (!references.has(item.type)) { delete item.identifier; delete item.label; delete item.html_id; }
        item.provenance ??= { path: target.page.path, lines: item.position ? Array.from({ length: item.position.end.line - item.position.start.line + 1 }, (_, i) => item.position!.start.line + i) : [], stack: [page.path, ...stack.map(item => item.page.path), target.page.path] };
        if (image && item.type === 'image' && typeof node.alt === 'string' && node.alt) item.alt = node.alt;
      }));
      return { type: 'block', identifier: node.identifier, label: node.label, position: node.position, provenance: node.provenance, embedSource: { path: target.page.path, identifier: target.identifier }, children };
    };
    page.document.ast = expand(page.document.ast, page, []);
  }
}
