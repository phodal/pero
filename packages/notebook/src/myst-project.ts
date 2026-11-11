import { expandMystEmbeds, isMystEmbedImage } from './myst-embeds.ts';
import { createMystNumberingState, type MystNumberingState } from './myst-numbering.ts';
import { expandMystCsvTables } from './myst-csv-table.ts';
import { parseIpynb, type IpynbDocument } from './ipynb.ts';
import { ipynbCellVisibility } from './ipynb-visibility.ts';
import { resolveMystProjectReferences } from './myst-project-references.ts';
import { expandMystIncludes } from './myst-includes.ts';
import { parseMystSource, parseMystYamlMapping, resolveMystDocument, type MystDocument, type MystDiagnostic, type MystNode, type MystParsedDocument } from './myst.ts';
import { inheritMystMetadata, validateMystProjectMetadata, validateMystMetadata, mystNotebookMetadata, type MystScholarlyMetadata } from './myst-metadata.ts';
import { resolveMystBibliography, type MystBibliographyRecord } from './myst-bibliography.ts';
import { resolveMystResource, type MystProjectSnapshot, type MystTextResource } from './myst-project-snapshot.ts';

export interface MystProjectPage { path: string; document: MystDocument; bibliography: MystBibliographyRecord[] }
export interface MystProjectNotebookCell { index: number; namespace: string; document: MystDocument; bibliography: MystBibliographyRecord[] }
export type MystProjectNotebookPage =
  | { kind: 'ipynb'; path: string; document: IpynbDocument; scholarly: MystScholarlyMetadata; citationRendering?: MystDocument['citationRendering']; markdownCells: MystProjectNotebookCell[] }
  | { kind: 'invalid'; path: string; source: string; diagnostics: MystDiagnostic[] };
export type MystProjectEntry = { kind: 'myst'; path: string; document: MystDocument } | MystProjectNotebookPage;
export interface MystProjectProjection {
  entry: MystProjectEntry;
  notebookPages: MystProjectNotebookPage[];
  pages: MystProjectPage[];
  rawConfig: Record<string, unknown>;
  diagnostics: MystDiagnostic[];
}
const mapping = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Compile only explicitly provided resources, including bounded includes and
 * project references. No filesystem discovery, network, plugins or execution. */
export function compileMystProject(snapshot: MystProjectSnapshot): MystProjectProjection {
  const diagnostics: MystDiagnostic[] = [];
  const report = (code: string, message: string, path: string, line?: number) => diagnostics.push({ severity: 'warning' as const, code, message, path, ...(line ? { line } : {}) });
  const used = new Set<string>();
  let rawConfig: Record<string, unknown> = {};
  const config = snapshot.files.find(file => file.path === 'myst.yml');
  if (config) {
    used.add(config.path);
    try { rawConfig = parseMystYamlMapping(config.text); }
    catch (error) { diagnostics.push({ severity: 'error', code: 'project-config-invalid', path: config.path, message: error instanceof Error ? error.message : 'Invalid myst.yml' }); }
  }
  const supportedConfig = rawConfig.version === undefined || rawConfig.version === 1;
  const rawProject = supportedConfig && mapping(rawConfig.project) ? rawConfig.project : {};
  if (rawConfig.project !== undefined && !mapping(rawConfig.project)) report('project-config-invalid', 'myst.yml project must be a mapping.', 'myst.yml');
  for (const key of Object.keys(rawConfig)) if (!['version', 'project'].includes(key)) report('project-config-unsupported', `Configuration field ${key} is retained but not applied.`, 'myst.yml');
  if (rawConfig.version !== undefined && rawConfig.version !== 1) report('project-config-version', 'Only myst.yml version 1 is supported; configuration is retained but not applied.', 'myst.yml');
  const validated = validateMystProjectMetadata(rawProject);
  diagnostics.push(...validated.diagnostics.map(item => ({ ...item, path: 'myst.yml' })));
  for (const key of ['plugins', 'references', 'exports', 'downloads', 'resources', 'toc', 'requirements']) {
    if (rawProject[key] !== undefined) report('project-feature-inert', `Project ${key} is retained but not loaded or executed by this text snapshot compiler.`, 'myst.yml');
  }
  const bibliographyResources = (declaration: unknown, base: string): MystTextResource[] => {
    if (declaration === undefined) return [];
    const paths = typeof declaration === 'string' ? [declaration] : Array.isArray(declaration) ? declaration : [];
    if (!paths.length) report('bibliography-declaration-invalid', 'Bibliography must declare a path or list of paths.', base);
    const result: MystTextResource[] = [];
    for (const path of paths) {
      if (typeof path !== 'string') { report('bibliography-declaration-invalid', 'Bibliography paths must be strings.', base); continue; }
      const resolution = resolveMystResource(snapshot, base, path);
      if (resolution.status === 'resolved') { used.add(resolution.path); result.push(resolution.resource); }
      else report(`resource-${resolution.status}`, `Bibliography ${path}: ${resolution.status === 'missing' ? 'not provided in this snapshot' : resolution.reason}`, base);
    }
    return result;
  };
  const projectBibliography = bibliographyResources(rawProject.bibliography, 'myst.yml');
  const pages: MystProjectPage[] = [];
  const compilePage = (resource: MystTextResource, supplied?: MystParsedDocument, notebookScholarly?: MystScholarlyMetadata, numberingState?: MystNumberingState): MystProjectPage => {
    used.add(resource.path);
    const expansion = expandMystIncludes(snapshot, resource.path, supplied ?? parseMystSource(resource.text));
    const tables = expandMystCsvTables(snapshot, resource.path, expansion.parsed);
    const parsed = tables.parsed;
    tables.resources.forEach(path => used.add(path));
    expansion.resources.forEach(path => used.add(path));
    const inherited = inheritMystMetadata(parsed.scholarly, notebookScholarly ?? validated.normalized, notebookScholarly ? 'notebook' : 'project');
    const resources = [...projectBibliography, ...bibliographyResources(parsed.metadata.bibliography, resource.path)];
    // Repeated declarations of one physical resource are one input, not two copies
    // of every key. Distinct resources with equal keys remain ambiguous.
    const bibliography = resolveMystBibliography([...new Map(resources.map(file => [file.path, file])).values()], parsed.metadata, resource.path);
    const visit = (node: MystNode) => {
      if (node.type === 'image' && !isMystEmbedImage(node)) {
        const url = typeof node.url === 'string' ? node.url : '';
        if (notebookScholarly && url.startsWith('attachment:')) return;
        const resolution = resolveMystResource(snapshot, node.provenance?.path ?? resource.path, url);
        const asset = resolution.status !== 'unsupported' ? snapshot.assets?.find(asset => asset.path === resolution.path) : undefined;
        if (asset) {
          used.add(asset.path); node.imageData = asset; node.url = asset.path;
          if (!asset.renderable) report('asset-unsupported', `Image ${url}: ${asset.mediaType} is preserved but not embedded.`, resource.path, node.position?.start.line);
        } else report(`resource-${resolution.status === 'resolved' ? 'unsupported' : resolution.status}`, `Image ${url}: ${resolution.status === 'unsupported' ? resolution.reason : resolution.status === 'resolved' ? 'provided text is not a binary image' : 'not provided'}`, resource.path, node.position?.start.line);
      }
      node.children?.forEach(visit);
    };
    visit(parsed.ast);
    const document = resolveMystDocument(parsed, { numberingState, scholarly: inherited.normalized, bibliography: bibliography.entries, diagnostics: [...inherited.diagnostics, ...bibliography.diagnostics] });
    document.diagnostics = document.diagnostics.map(item => ({ ...item, path: item.path ?? resource.path }));
    return { path: resource.path, document, bibliography: bibliography.records };
  };
  for (const resource of snapshot.files.filter(file => /\.(md|myst)$/i.test(file.path))) pages.push(compilePage(resource));
  const notebookPages: MystProjectNotebookPage[] = [];
  for (const resource of snapshot.files.filter(file => /\.ipynb$/i.test(file.path))) {
    used.add(resource.path);
    try {
      const document = parseIpynb(resource.text);
      const raw = mapping(document.raw.metadata) ? document.raw.metadata : {};
      const notebookMetadata = mystNotebookMetadata(raw);
      const normalized = validateMystMetadata(notebookMetadata);
      const first = document.cells[0]?.kind === 'markdown' ? parseMystSource(document.cells[0].source) : undefined;
      const merged = inheritMystMetadata(first?.scholarly ?? {}, normalized.normalized, 'notebook');
      const inherited = inheritMystMetadata(merged.normalized, validated.normalized);
      diagnostics.push(...[...normalized.diagnostics, ...merged.diagnostics, ...inherited.diagnostics].map(item => ({ ...item, path: resource.path })));
      const metadata = { ...notebookMetadata, ...(raw.pero ? { pero: raw.pero } : {}), ...(first?.metadata ?? {}), ...(merged.normalized.bibliography ? { bibliography: merged.normalized.bibliography } : {}) };
      const numberingState = createMystNumberingState(inherited.normalized.numbering);
      const markdownCells = document.cells.filter(cell => cell.kind === 'markdown').map(cell => {
        const source = cell.index === 0 ? first! : parseMystSource(cell.source, { frontmatter: false });
        const compiled = compilePage({ path: resource.path, text: cell.source }, { ...source, metadata }, inherited.normalized, ipynbCellVisibility(cell).input ? numberingState : undefined);
        return { index: cell.index, namespace: `${resource.path}:cell-${cell.index}`, document: compiled.document, bibliography: compiled.bibliography };
      });
      notebookPages.push({ kind: 'ipynb', path: resource.path, document, scholarly: inherited.normalized, markdownCells });
      if (raw.myst !== undefined) report('notebook-metadata-inert', 'Nonstandard metadata.myst is retained; direct notebook metadata and first-cell frontmatter provide publication metadata.', resource.path);
    } catch (error) {
      const item: MystDiagnostic = { severity: 'error', code: 'notebook-invalid', path: resource.path, message: error instanceof Error ? error.message : 'Invalid notebook source' };
      notebookPages.push({ kind: 'invalid', path: resource.path, source: resource.text, diagnostics: [item] }); diagnostics.push(item);
    }
  }
  const referencePages = [...pages, ...notebookPages.flatMap(page => page.kind === 'ipynb' ? page.markdownCells.filter(cell => ipynbCellVisibility(page.document.cells[cell.index]).input).map(cell => ({ path: page.path, namespace: cell.namespace, document: cell.document })) : [])];
  expandMystEmbeds(referencePages, snapshot);
  resolveMystProjectReferences(snapshot, referencePages, notebookPages.filter(page => page.kind === 'ipynb').map(page => ({ path: page.path, identifier: '', label: page.path })));
  diagnostics.push(...referencePages.flatMap(page => page.document.diagnostics));
  for (const asset of snapshot.assets ?? []) if (!used.has(asset.path)) report('asset-unused', 'Provided binary resource is retained but not used by compiled pages.', asset.path);
  for (const file of snapshot.files) if (!used.has(file.path)) report('resource-unused', 'Provided text resource is retained but not used by the compiled entry/pages.', file.path);
  // Snapshot admission guarantees a provided Markdown or notebook entry.
  const markdownEntry = pages.find(page => page.path === snapshot.entry);
  const entry: MystProjectEntry = markdownEntry ? { kind: 'myst', path: markdownEntry.path, document: markdownEntry.document } : notebookPages.find(page => page.path === snapshot.entry)!;
  return { entry, pages, notebookPages, rawConfig, diagnostics };
}
