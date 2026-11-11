import { expandMystIncludes } from './myst-includes.ts';
import { parseMystSource, parseMystYamlMapping, resolveMystDocument, type MystDocument, type MystDiagnostic, type MystNode } from './myst.ts';
import { inheritMystMetadata, validateMystProjectMetadata } from './myst-metadata.ts';
import { resolveMystBibliography, type MystBibliographyRecord } from './myst-bibliography.ts';
import { resolveMystResource, type MystProjectSnapshot, type MystTextResource } from './myst-project-snapshot.ts';

export interface MystProjectPage { path: string; document: MystDocument; bibliography: MystBibliographyRecord[] }
export interface MystProjectProjection {
  entry: MystDocument;
  pages: MystProjectPage[];
  rawConfig: Record<string, unknown>;
  diagnostics: MystDiagnostic[];
}
const mapping = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Compile only text explicitly present in the snapshot. No filesystem, network,
 * plugin loading, include expansion, execution or cross-document target search. */
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
  for (const resource of snapshot.files.filter(file => /\.(md|myst)$/i.test(file.path))) {
    used.add(resource.path);
    const expansion = expandMystIncludes(snapshot, resource.path, parseMystSource(resource.text));
    const parsed = expansion.parsed;
    expansion.resources.forEach(path => used.add(path));
    const inherited = inheritMystMetadata(parsed.scholarly, validated.normalized);
    const resources = [...projectBibliography, ...bibliographyResources(parsed.metadata.bibliography, resource.path)];
    // Repeated declarations of one physical resource are one input, not two copies
    // of every key. Distinct resources with equal keys remain ambiguous.
    const bibliography = resolveMystBibliography([...new Map(resources.map(file => [file.path, file])).values()], parsed.metadata, resource.path);
    const visit = (node: MystNode) => {
      if (node.type === 'image' || node.type === 'link') {
        const url = typeof node.url === 'string' ? node.url : '';
        if (url && !url.startsWith('#')) {
          const resolution = resolveMystResource(snapshot, resource.path, url);
          if (resolution.status === 'resolved') used.add(resolution.path);
          report(`resource-${resolution.status}`, `${node.type} ${url}: ${resolution.status === 'resolved' ? 'provided; not embedded or linked as a compiled project page' : resolution.status === 'missing' ? 'not provided' : resolution.reason}`, resource.path, node.position?.start.line);
        }
      }
      node.children?.forEach(visit);
    };
    visit(parsed.ast);
    const document = resolveMystDocument(parsed, { scholarly: inherited.normalized, bibliography: bibliography.entries, diagnostics: [...inherited.diagnostics, ...bibliography.diagnostics] });
    document.diagnostics = document.diagnostics.map(item => ({ ...item, path: item.path ?? resource.path }));
    diagnostics.push(...document.diagnostics);
    pages.push({ path: resource.path, document, bibliography: bibliography.records });
  }
  for (const file of snapshot.files) if (!used.has(file.path)) report('resource-unused', 'Provided text resource is retained but not used by the compiled entry/pages.', file.path);
  // Snapshot admission guarantees that entry names a provided Markdown resource.
  return { entry: pages.find(page => page.path === snapshot.entry)!.document, pages, rawConfig, diagnostics };
}
