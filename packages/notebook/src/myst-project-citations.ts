import { renderMystCitations } from './myst-citations.ts';
import { resolveMystResource, type MystProjectSnapshot, type MystTextResource } from './myst-project-snapshot.ts';
import type { MystProjectProjection, MystProjectNotebookPage } from './myst-project.ts';
import type { MystDocument, MystDiagnostic } from './myst.ts';
import type { MystBibliographyRecord } from './myst-bibliography.ts';
import { ipynbCellVisibility } from './ipynb-visibility.ts';

const mapping = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
interface CitationLayer { metadata: Record<string, unknown>; path: string }

/** One async enrichment seam for previews and every publication codec. The shell
 * initializes the bundled engine first; this stage does no I/O and mutates no input. */
export async function compileMystProjectCitations(snapshot: MystProjectSnapshot, base: MystProjectProjection): Promise<MystProjectProjection> {
  const added: MystDiagnostic[] = [];
  const usedStyles = new Set<string>();
  const supported = base.rawConfig.version === undefined || base.rawConfig.version === 1;
  const project: CitationLayer = { metadata: supported && mapping(base.rawConfig.project) ? base.rawConfig.project : {}, path: 'myst.yml' };
  const format = (document: MystDocument, records: readonly MystBibliographyRecord[], layers: CitationLayer[], namespace: string): MystDocument => {
    try {
      let stylePath: { value: string; base: string } | undefined;
      let locale: string | undefined;
      for (const layer of layers) {
        const pero = layer.metadata.pero;
        if (pero === undefined) continue;
        if (!mapping(pero)) throw new TypeError('pero must be a mapping');
        const citation = pero.citation;
        if (citation === undefined) continue;
        if (!mapping(citation)) throw new TypeError('pero.citation must be a mapping');
        for (const [key, value] of Object.entries(citation)) {
          if (!['style', 'locale'].includes(key)) throw new TypeError(`Unknown pero.citation field: ${key}`);
          if (typeof value !== 'string' || !value.trim()) throw new TypeError(`pero.citation.${key} must be a nonempty string`);
          if (key === 'style') stylePath = { value, base: layer.path }; else locale = value;
        }
      }
      let resource: MystTextResource | undefined;
      if (stylePath) {
        if (!/\.csl$/i.test(stylePath.value)) throw new TypeError('CSL style must name a provided .csl text resource');
        const result = resolveMystResource(snapshot, stylePath.base, stylePath.value);
        if (result.status !== 'resolved') throw new TypeError(`CSL style ${stylePath.value}: ${result.status === 'missing' ? 'not provided in this snapshot' : result.reason}`);
        resource = result.resource;
        usedStyles.add(resource.path);
      }
      const result = renderMystCitations(document, records, resource, { namespace, locale });
      added.push(...result.diagnostics.slice(document.diagnostics.length).map(item => ({ ...item, path: namespace })));
      return result;
    } catch (error) {
      const diagnostic: MystDiagnostic = { severity: 'warning', code: 'citation-settings-invalid', path: namespace, message: `${error instanceof Error ? error.message : String(error)}. Original source and unstyled citations retained.` };
      added.push(diagnostic);
      return { ...document, diagnostics: [...document.diagnostics, diagnostic] };
    }
  };
  const pages = base.pages.map(page => ({ ...page, document: format(page.document, page.bibliography, [project, { metadata: page.document.metadata, path: page.path }], page.path) }));
  const notebookPages = base.notebookPages.map((page): MystProjectNotebookPage => {
    if (page.kind === 'invalid') return page;
    const cells = page.markdownCells.filter(cell => ipynbCellVisibility(page.document.cells[cell.index]).cell);
    if (!cells.length) return page;
    const first = page.markdownCells.find(cell => cell.index === 0);
    const rawMetadata = mapping(page.document.raw.metadata) ? page.document.raw.metadata : {};
    const layers = [project, { metadata: rawMetadata, path: page.path }, ...(first ? [{ metadata: first.document.metadata, path: page.path }] : [])];
    // One citation context spans all visible Markdown cells. Source/cell metadata
    // stay untouched; only the derived ASTs and formatting are distributed back.
    const combined: MystDocument = { ...cells[0].document, source: '', ast: { type: 'root', children: cells.map(cell => cell.document.ast) }, bibliography: Object.assign(Object.create(null), ...cells.map(cell => cell.document.bibliography)), diagnostics: [] };
    const records = [...new Map(cells.flatMap(cell => cell.bibliography).map(record => [`${record.path}\0${record.id}`, record])).values()];
    const result = format(combined, records, layers, page.path);
    const documents = new Map(cells.map((cell, index) => [cell.index, { ...cell.document, ast: result.ast.children![index], ...(result.citationRendering ? { citationRendering: result.citationRendering } : {}), diagnostics: [...cell.document.diagnostics, ...result.diagnostics] }]));
    return { ...page, citationRendering: result.citationRendering, markdownCells: page.markdownCells.map(cell => ({ ...cell, document: documents.get(cell.index) ?? cell.document })) };
  });
  const entry = base.entry.kind === 'myst' ? { ...base.entry, document: pages.find(page => page.path === base.entry.path)!.document } : notebookPages.find(page => page.path === base.entry.path)!;
  return { ...base, pages, notebookPages, entry, diagnostics: [...base.diagnostics.filter(item => !(item.code === 'resource-unused' && item.path && usedStyles.has(item.path))), ...added] };
}
