import { defineDocumentBlock, registerDocumentBlock } from "./scientific-block.ts";
import { validateMystMetadata, type MystScholarlyMetadata } from './myst-metadata.ts';
import { createTokenizer, mystParse } from 'myst-parser';
import { VFile } from 'vfile';
import { parseDocument } from 'yaml';

/** Source is the document. AST, references and diagnostics are disposable projections. */
export interface MystNode {
  type: string;
  children?: MystNode[];
  value?: string;
  position?: { start: { line: number; column: number }; end: { line: number; column: number } };
  [key: string]: unknown;
}
export interface MystDiagnostic { severity: 'warning' | 'error'; code: string; message: string; line?: number }
export interface MystReferenceTarget {
  identifier: string;
  kind: 'figure' | 'table' | 'equation' | 'section' | 'target';
  number: number;
  label: string;
}
export interface MystBibliographyEntry { id: string; title?: string; author?: string; year?: string; url?: string }
export interface MystDocument {
  version: 1;
  source: string;
  ast: MystNode;
  metadata: Record<string, unknown>;
  scholarly: MystScholarlyMetadata;
  diagnostics: MystDiagnostic[];
  references: Record<string, MystReferenceTarget>;
  bibliography: Record<string, MystBibliographyEntry>;
}
export const MYST_SOURCE_MAX_BYTES = 256 * 1024;
const disabledDirectives = new Set(['include', 'literalinclude', 'embed', 'iframe', 'code-cell', 'anywidget', 'raw', 'raw-latex', 'raw-typst', 'mdast', 'myst', 'mermaid', 'csv-table']);
const supportedNodes = new Set(['root', 'block', 'paragraph', 'heading', 'text', 'strong', 'emphasis', 'subscript', 'superscript', 'delete', 'inlineCode', 'code', 'math', 'inlineMath', 'break', 'thematicBreak', 'blockquote', 'list', 'listItem', 'table', 'tableRow', 'tableCell', 'link', 'image', 'container', 'caption', 'admonition', 'admonitionTitle', 'crossReference', 'cite', 'citeGroup', 'mystTarget', 'footnoteDefinition', 'footnoteReference', 'definitionList', 'definitionTerm', 'definitionDescription', 'html', 'comment']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
export const normalizeMystIdentifier = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');
const identifier = normalizeMystIdentifier;

/** No compiler, plugins, execution, file resolution or network access is installed. */
export function parseMystDocument(source: string): MystDocument {
  parseMystAttributes({ schemaVersion: 1, source });
  const diagnostics: MystDiagnostic[] = [];
  const report = (code: string, message: string, node?: MystNode, severity: MystDiagnostic['severity'] = 'warning') => {
    diagnostics.push({ code, message, severity, ...(node?.position ? { line: node.position.start.line } : {}) });
  };
  const file = new VFile();
  let frontmatter = false;
  let ast: MystNode;
  try {
    const tokens = createTokenizer({ extensions: { smartquotes: false } }).parse(source, { vfile: file });
    frontmatter = tokens[0]?.type === 'fence' && tokens[0].info === 'yaml' && source.replace(/^\uFEFF/, '').startsWith('---');
    ast = mystParse(source, { vfile: file, extensions: { smartquotes: false }, mdast: { listItemParagraphs: true } }) as MystNode;
  } catch (error) {
    report('parse-error', error instanceof Error ? error.message : 'Unable to parse MyST', undefined, 'error');
    ast = { type: 'root', children: [{ type: 'mystUnsupported', value: source }] };
  }
  for (const message of file.messages) {
    diagnostics.push({ severity: message.fatal ? 'error' : 'warning', code: message.ruleId ?? 'parser', message: message.reason, ...(message.line ? { line: message.line } : {}) });
  }
  let metadata: Record<string, unknown> = {};
  // MyST's frontmatter plugin emits a yaml code node at line 1. The token
  // provenance distinguishes it from an authored fenced YAML code example.
  const first = ast.children?.[0];
  if (frontmatter && first?.type === 'code' && first.position?.start.line === 1) {
    try {
      const yaml = parseDocument(first.value ?? '', { schema: 'core', uniqueKeys: true });
      if (yaml.errors.length || yaml.warnings.length) throw new Error([...yaml.errors, ...yaml.warnings].map(item => item.message).join('; '));
      const value: unknown = yaml.toJS({ maxAliasCount: 50 });
      if (value != null && !record(value)) throw new Error('Frontmatter must be a mapping');
      // Reject recursive YAML aliases and keep metadata JSON-portable for export.
      metadata = value == null ? {} : JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    } catch (error) {
      report('frontmatter-invalid', error instanceof Error ? error.message : 'Invalid YAML', first, 'error');
    }
    ast.children!.shift();
  }
  const { pero: handledPero, ...standardMetadata } = metadata;
  if (handledPero !== undefined) {
    if (!record(handledPero)) report('frontmatter-validation', 'pero metadata must be a mapping; authored value retained');
    else for (const key of Object.keys(handledPero)) {
      if (key !== 'bibliography') report('frontmatter-validation', `Unknown pero metadata field: ${key}; authored value retained`);
    }
  }
  const scholarly = validateMystMetadata(standardMetadata);
  diagnostics.push(...scholarly.diagnostics);
  const normalize = (node: MystNode): MystNode[] => {
    if (node.type === 'mystDirective' || node.type === 'mystRole') {
      const name = string(node.name) ?? '';
      if (disabledDirectives.has(name)) {
        report('directive-disabled', `Directive ${node.name} is retained but not executed or loaded`, node);
        node.children = undefined;
        node.value = source.split('\n').slice((node.position?.start.line ?? 1) - 1, node.position?.end.line).join('\n');
        return [node];
      }
      if (node.children?.length) return node.children.flatMap(child => normalize({ ...child, position: child.position ?? node.position }));
      report('syntax-unsupported', `Unsupported ${node.type === 'mystRole' ? 'role' : 'directive'}: ${name}`, node);
      if (node.type === 'mystDirective' && node.position) node.value = source.split('\n').slice(node.position.start.line - 1, node.position.end.line).join('\n');
      return [node];
    }
    if (!supportedNodes.has(node.type)) report('node-unsupported', `Unsupported node: ${node.type}`, node);
    if (node.type === 'html') report('html-inert', 'Raw HTML is retained as text, not executed', node);
    if (node.children) node.children = node.children.flatMap(normalize);
    return [node];
  };
  ast = normalize(ast)[0];
  const references: Record<string, MystReferenceTarget> = Object.create(null);
  const bibliography: Record<string, MystBibliographyEntry> = Object.create(null);
  // Pero's local CSL-like metadata extension, not a BibTeX/CSL style engine.
  // Keeping entries in source makes source/bundle roundtrips lossless.
  const localBibliography = record(metadata.pero) ? metadata.pero.bibliography : undefined;
  const entries: unknown[] = Array.isArray(localBibliography) ? localBibliography : [];
  if (localBibliography !== undefined && !Array.isArray(localBibliography)) report('bibliography-invalid', 'pero.bibliography must be a list of local bibliography entries');
  if (metadata.references) report('references-external', 'Cross-project references are retained but not loaded');
  for (const entry of entries) {
    if (!record(entry) || typeof entry.id !== 'string' || !entry.id.trim()) { report('bibliography-invalid', 'Bibliography entries require a nonempty id'); continue; }
    const id = identifier(entry.id);
    if (bibliography[id]) { report('citation-duplicate', `Duplicate bibliography key: ${entry.id}`); continue; }
    const author = Array.isArray(entry.author) ? entry.author.map(person => record(person) ? [person.given, person.family].filter(Boolean).join(' ') || person.literal : '').filter(Boolean).join(', ') : string(entry.author);
    const issued = record(entry.issued) ? entry.issued['date-parts'] : undefined;
    const year = typeof entry.year === 'number' ? String(entry.year) : string(entry.year) ?? (Array.isArray(issued) && Array.isArray(issued[0]) ? String(issued[0][0]) : undefined);
    bibliography[id] = { id: entry.id, title: string(entry.title), author, year, url: string(entry.url) ?? string(entry.URL) };
  }
  if (metadata.bibliography) report('bibliography-external', 'Bibliography files are not loaded. Use authored pero.bibliography metadata for local citation previews.');
  if (metadata.plugins) report('plugins-disabled', 'Document plugins are not loaded');
  const counts = { figure: 0, table: 0, equation: 0, section: 0, target: 0 };
  const walk = (node: MystNode, visit: (node: MystNode) => void) => { visit(node); node.children?.forEach(child => walk(child, visit)); };
  const index = (node: MystNode) => {
    const children = node.children ?? [];
    children.forEach((child, offset) => {
      if (child.type === 'mystTarget' && typeof child.label === 'string') {
        const next = children[offset + 1];
        if (next && !next.identifier) { next.identifier = identifier(child.label); next.label = child.label; child.type = 'comment'; }
      }
    });
    const rawId = string(node.identifier) ?? (node.type === 'mystTarget' ? string(node.label) : undefined);
    if (rawId && node.type !== 'crossReference' && node.type !== 'cite' && node.type !== 'footnoteReference') {
      const id = identifier(rawId);
      const kind = node.type === 'math' ? 'equation' : node.type === 'heading' ? 'section' : node.kind === 'figure' ? 'figure' : node.kind === 'table' || node.type === 'table' ? 'table' : 'target';
      if (references[id]) report('reference-duplicate', `Duplicate label: ${rawId}`, node);
      else { node.identifier = id; references[id] = { identifier: id, kind, number: ++counts[kind], label: kind === 'target' ? rawId : `${kind[0].toUpperCase()}${kind.slice(1)} ${counts[kind]}` }; }
    }
    children.forEach(index);
  };
  index(ast);
  walk(ast, node => {
    if (node.type !== 'crossReference' && node.type !== 'cite') return;
    const id = identifier(string(node.identifier) ?? string(node.label) ?? '');
    const resolved = node.type === 'cite' ? !!bibliography[id] : !!references[id];
    node.identifier = id;
    node.resolved = resolved;
    if (resolved) node.target = id;
    else { node.error = 'not found'; report(node.type === 'cite' ? 'citation-unresolved' : 'reference-unresolved', `Unresolved ${node.type === 'cite' ? 'citation' : 'reference'}: ${id}`, node); }
  });
  return { version: 1, source, ast, metadata, scholarly: scholarly.normalized, diagnostics, references, bibliography };
}

export function exportMystMarkdown(document: { source: string }): string { return document.source; }
/** A portable, deterministic source + diagnostic bundle; no assets are fetched. */
export function exportMystBundle(document: MystDocument): string {
  return JSON.stringify({ format: 'pero-myst', version: 1, source: document.source, metadata: document.metadata, scholarly: document.scholarly, bibliography: document.bibliography, diagnostics: document.diagnostics }, null, 2) + '\n';
}

/** Validate persisted source at the adapter boundary, without accepting AST as state. */
export function parseMystAttributes(value: unknown): { schemaVersion: 1; source: string } {
  const attrs = mystDocumentDefinition.validateFields(value);
  return { schemaVersion: 1, source: attrs.source };
}
/** Only source is authoritative; metadata, bibliography and diagnostics are rederived on parse. */
export function importMystBundle(text: string): { schemaVersion: 1; source: string } {
  const value: unknown = JSON.parse(text);
  if (!record(value) || value.format !== 'pero-myst' || value.version !== 1) throw new TypeError('Unsupported MyST bundle');
  return parseMystAttributes({ schemaVersion: 1, source: value.source });
}

/** MyST uses the shared document-block adapter while its source domain remains
 * deliberately strict: future schemas must not be pasted or saved as version 1. */
export const mystDocumentDefinition = registerDocumentBlock(defineDocumentBlock({
  type: 'mystDocument', defaults: { source: '' }, futureVersions: 'reject',
  versionOne(attrs) {
    if (new TextEncoder().encode(attrs.source).length > MYST_SOURCE_MAX_BYTES) throw new RangeError('MyST source exceeds 256 KiB');
  },
}));
