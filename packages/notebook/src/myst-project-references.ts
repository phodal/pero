import { MystProjectionBudget } from './myst-projection-budget.ts';
import { resolveMystReferenceContent } from './myst-numbering.ts';
import { normalizeMystIdentifier, type MystDocument, type MystNode, type MystReferenceTarget } from './myst.ts';
import { resolveMystResource, type MystProjectSnapshot } from './myst-project-snapshot.ts';
export interface MystProjectReferenceTarget { path: string; identifier: string; label: string; reference?: MystReferenceTarget }
export interface MystReferencePage { path: string; namespace?: string; document: MystDocument }
export const mystAnchor = (identifier: string, namespace = '') => `myst-${(namespace ? [namespace, identifier] : [identifier]).map(value => value.replace(/[^a-zA-Z0-9_-]/gu, char => `~${char.codePointAt(0)!.toString(16)}~`)).join(':')}`;
/** Unqualified targets must be unique project-wide; path#label disambiguates. */
export function resolveMystProjectReferences(snapshot: MystProjectSnapshot, pages: readonly MystReferencePage[], notebookDestinations: readonly MystProjectReferenceTarget[] = []): void {
  const targets = new Map<string, { sourcePath: string; target: MystProjectReferenceTarget }[]>();
  const walk = (node: MystNode, fn: (node: MystNode) => void) => { fn(node); node.children?.forEach(child => walk(child, fn)); };
  for (const page of pages) {
    const counts = new Map<string, number>();
    walk(page.document.ast, node => {
      if (typeof node.identifier === 'string' && !['crossReference','cite','footnoteReference','comment'].includes(node.type)) counts.set(node.identifier, (counts.get(node.identifier) ?? 0) + 1);
    });
    walk(page.document.ast, node => {
      if (typeof node.identifier === 'string' && (counts.get(node.identifier) ?? 0) > 1 && !['crossReference','cite','footnoteReference'].includes(node.type)) delete node.identifier;
    });
    for (const [identifier, reference] of Object.entries(page.document.references)) {
      for (let i = 0; i < (counts.get(identifier) ?? 1); i++) targets.set(identifier, [...(targets.get(identifier) ?? []), { sourcePath: page.path, target: { path: page.namespace ?? page.path, identifier, label: reference.label, reference } }]);
    }
  }
  for (const page of pages) {
    page.document.diagnostics = page.document.diagnostics.filter(item => item.code !== 'reference-unresolved' && item.code !== 'reference-number-unavailable');
    walk(page.document.ast, node => {
      const key = normalizeMystIdentifier(String(node.identifier ?? node.label ?? ''));
      if (node.type === 'cite' && node.citationShorthand && !page.document.bibliography[key] && targets.has(key)) {
        node.type = 'crossReference';
        const diagnostic = page.document.diagnostics.findIndex(item => item.code === 'citation-unresolved' && item.message === `Unresolved citation: ${key}` && item.line === node.position?.start.line);
        if (diagnostic >= 0) page.document.diagnostics.splice(diagnostic, 1);
      }
      const isRef = node.type === 'crossReference';
      if (!isRef && node.type !== 'link') return;
      if (node.projectTarget) return;
      const authored = isRef ? String(node.kind === 'term' ? node.identifier : node.label ?? node.identifier ?? '') : String(node.url ?? '');
      if (!isRef && /^(?:https?:|mailto:)/i.test(authored)) return;
      const report = (code: string, message: string) => page.document.diagnostics.push({ severity: 'warning', code, message, path: page.path, line: node.position?.start.line });
      let candidates: MystProjectReferenceTarget[] = [];
      const hash = authored.indexOf('#');
      if (hash >= 0 || (!isRef && /\.(?:md|myst|ipynb)$/i.test(authored))) {
        const path = hash < 0 ? authored : authored.slice(0, hash);
        let label = hash < 0 ? '' : authored.slice(hash + 1);
        try { label = decodeURIComponent(label); } catch { /* Keep invalid authored escapes unmatched. */ }
        const sourcePath = node.provenance?.path ?? page.path;
        const resolution = path ? resolveMystResource(snapshot, sourcePath, path) : { status: 'resolved' as const, path: page.path };
        if (resolution.status !== 'resolved') { node.resolved = false; report(`reference-${resolution.status}`, `Project reference ${authored}: ${resolution.status === 'missing' ? 'resource not provided' : resolution.reason}`); return; }
        const destination = pages.find(item => item.path === resolution.path);
        if (label) candidates = (targets.get(normalizeMystIdentifier(label)) ?? []).filter(item => !path || item.sourcePath === resolution.path).map(item => item.target);
        else candidates = notebookDestinations.filter(item => item.path === resolution.path);
        if (!label && !candidates.length && destination) candidates = [{ path: destination.path, identifier: '', label: destination.document.scholarly.title ?? destination.path }];
      } else if (isRef) candidates = (targets.get(normalizeMystIdentifier(authored)) ?? []).map(item => item.target);
      else return;
      if (candidates.length === 1) { node.projectTarget = candidates[0]; node.resolved = true; delete node.error; if (candidates[0].reference) resolveMystReferenceContent(node, candidates[0].reference, report, (page.document.projectionBudget ??= new MystProjectionBudget())); }
      else { node.resolved = false; delete node.target; report(candidates.length ? 'reference-ambiguous' : 'reference-unresolved', `${candidates.length ? 'Ambiguous' : 'Unresolved'} project reference: ${authored}`); }
    });
  }
}
