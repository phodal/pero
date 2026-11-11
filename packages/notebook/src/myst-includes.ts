import { MYST_SOURCE_MAX_BYTES, parseMystSource, type MystDiagnostic, type MystNode, type MystParsedDocument } from './myst.ts';
import { resolveMystResource, type MystProjectSnapshot } from './myst-project-snapshot.ts';

export interface MystIncludeProvenance { path: string; lines: number[]; stack: string[] }
export interface MystIncludeExpansion { parsed: MystParsedDocument; resources: string[] }
export const MYST_INCLUDE_MAX_DEPTH = 12;
export const MYST_INCLUDE_MAX_BYTES = 1024 * 1024;
export const MYST_INCLUDE_MAX_COUNT = 128;
const supported = new Set(['literal', 'lang', 'language', 'code', 'start-line', 'end-line', 'lines', 'start-at', 'start-after', 'end-at', 'end-before']);
/** Pinned myst-directives 1.7.5 and myst-transforms at 50e8220 use whole lines.
 * Their implemented end-line is inclusive despite the option's documentation. */
export function selectMystInclude(text: string, options: Readonly<Record<string, string>>): { text: string; lines: number[] } {
  for (const key of Object.keys(options)) if (!supported.has(key)) throw new TypeError(`Unsupported include option: ${key}`);
  for (const group of [['start-at', 'start-after', 'start-line', 'lines'], ['end-at', 'end-before', 'end-line', 'lines'], ['lang', 'language', 'code']]) {
    if (group.filter(key => key in options).length > 1) throw new TypeError(`Conflicting include options: ${group.join(', ')}`);
  }
  if ('literal' in options && !['', 'true'].includes(options.literal)) throw new TypeError('literal must be an empty flag or true');
  const lines = text.split('\n').map((value, index) => ({ value, line: index + 1 }));
  let selected = lines;
  const integer = (key: string) => {
    if (!/^-?\d+$/.test(options[key])) throw new TypeError(`Invalid include ${key}`);
    const number = Number(options[key]);
    if (!Number.isSafeInteger(number)) throw new TypeError(`Invalid include ${key}`);
    return number;
  };
  if ('lines' in options) {
    let selectionBytes = 0;
    selected = options.lines.split(',').flatMap(part => {
      const match = /^(\d+)(?:\s*-\s*(\d+)?)?$/.exec(part.trim());
      if (!match || Number(match[1]) < 1 || (match[2] && Number(match[2]) < Number(match[1]))) throw new TypeError('Invalid include lines range');
      const start = Number(match[1]);
      const end = part.includes('-') ? (match[2] ? Number(match[2]) : lines.length) : start;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new TypeError('Invalid include lines range');
      const slice = lines.slice(start - 1, end);
      selectionBytes += slice.reduce((size, line) => size + new TextEncoder().encode(line.value).length + 1, 0);
      if (selectionBytes > MYST_INCLUDE_MAX_BYTES) throw new RangeError('Include selection exceeds 1 MiB');
      return slice;
    });
  } else if ('start-line' in options || 'end-line' in options) {
    if (['start-at', 'start-after', 'end-at', 'end-before'].some(key => key in options)) throw new TypeError('Mixed line and marker filters are not supported');
    const start = 'start-line' in options ? integer('start-line') : 0;
    const end = 'end-line' in options ? integer('end-line') : lines.length - 1;
    selected = lines.slice(start < 0 ? lines.length + start : start, end < 0 ? lines.length + end + 1 : end + 1);
  } else {
    let start = 0;
    const startKey = 'start-at' in options ? 'start-at' : 'start-after' in options ? 'start-after' : undefined;
    if (startKey) {
      if (!options[startKey]) throw new TypeError('Include marker must not be empty');
      start = lines.findIndex(line => line.value.includes(options[startKey]));
      if (start < 0) throw new TypeError(`Include marker not found: ${options[startKey]}`);
      if (startKey === 'start-after') start++;
    }
    const endKey = 'end-at' in options ? 'end-at' : 'end-before' in options ? 'end-before' : undefined;
    let end = lines.length;
    if (endKey) {
      if (!options[endKey]) throw new TypeError('Include marker must not be empty');
      const found = lines.slice(start + 1).findIndex(line => line.value.includes(options[endKey]));
      if (found < 0) throw new TypeError(`Include marker not found: ${options[endKey]}`);
      end = start + found + (endKey === 'end-at' ? 2 : 1);
    }
    selected = lines.slice(start, end);
  }
  return { text: selected.map(line => line.value).join('\n'), lines: selected.map(line => line.line) };
}
/** Expand explicit inputs into derived AST; failed directives retain their source. */
export function expandMystIncludes(snapshot: MystProjectSnapshot, path: string, parsed: MystParsedDocument): MystIncludeExpansion {
  const diagnostics: MystDiagnostic[] = [];
  const resources = new Set<string>();
  let size = 0, count = 0;
  const annotate = (node: MystNode, provenance: MystIncludeProvenance) => { node.provenance = provenance; node.children?.forEach(child => annotate(child, provenance)); };
  const expand = (node: MystNode, current: string, stack: string[]): MystNode => {
    if (node.type !== 'mystDirective' || !['include', 'literalinclude'].includes(String(node.name))) {
      if (node.children) node.children = node.children.map(child => expand(child, current, stack));
      return node;
    }
    const report = (code: string, message: string) => diagnostics.push({ severity: 'warning', code, message, path: current, line: node.position?.start.line });
    if (typeof node.directiveBody === 'string' && node.directiveBody.trim()) { report('include-body-unsupported', 'Include directive body is not supported; source is retained.'); return node; }
    const resolution = resolveMystResource(snapshot, current, typeof node.args === 'string' ? node.args.trim() : '');
    if (resolution.status !== 'resolved') { report(`include-${resolution.status}`, resolution.status === 'missing' ? `Include resource not provided: ${resolution.path}` : resolution.reason); return node; }
    resources.add(resolution.path);
    if (stack.includes(resolution.path)) { report('include-cycle', `Include cycle: ${[...stack, resolution.path].join(' → ')}`); return node; }
    if (stack.length > MYST_INCLUDE_MAX_DEPTH) { report('include-depth', `Include depth exceeds ${MYST_INCLUDE_MAX_DEPTH}`); return node; }
    if (++count > MYST_INCLUDE_MAX_COUNT) { report('include-budget', 'Include count budget exceeded'); return node; }
    const options = node.options ?? {};
    if (typeof options !== 'object' || Array.isArray(options) || !Object.values(options).every(value => typeof value === 'string')) { report('include-options', 'Invalid include options'); return node; }
    let selected: ReturnType<typeof selectMystInclude>;
    try { selected = selectMystInclude(resolution.resource.text, options as Record<string, string>); }
    catch (error) { report('include-options', error instanceof Error ? error.message : 'Invalid include filter'); return node; }
    size += new TextEncoder().encode(selected.text).length;
    if (size > MYST_INCLUDE_MAX_BYTES) { report('include-budget', 'Include expansion exceeds 1 MiB'); return node; }
    const opts = options as Record<string, string>;
    const provenance: MystIncludeProvenance = { path: resolution.path, lines: selected.lines, stack: [...stack, resolution.path] };
    let children: MystNode[];
    if (node.name === 'literalinclude' || 'literal' in opts || ['lang', 'language', 'code'].some(key => key in opts)) children = [{ type: 'code', value: selected.text, lang: opts.lang ?? opts.language ?? opts.code }];
    else {
      if (/\.(?:ipynb|tex)$/i.test(resolution.path)) { report('include-format-unsupported', 'Parsed notebook/TeX includes are not supported. Use a project page link or literalinclude; source is retained.'); return node; }
      if (new TextEncoder().encode(selected.text).length > MYST_SOURCE_MAX_BYTES) { report('include-parser-budget', 'Parsed include selection exceeds 256 KiB; directive source is retained.'); return node; }
      const included = parseMystSource(selected.text);
      diagnostics.push(...included.diagnostics.filter(item => item.code !== 'directive-disabled' || !/Directive (include|literalinclude) /.test(item.message)).map(item => ({ ...item, path: resolution.path, line: item.line ? selected.lines[item.line - 1] : undefined })));
      if (included.metadata.math || included.metadata.abbreviations) report('include-frontmatter-unsupported', 'Included math macros and abbreviations are preserved but not inherited.');
      children = included.ast.children ?? [];
    }
    children.forEach(child => annotate(child, provenance));
    return { type: 'block', provenance, children: children.map(child => expand(child, resolution.path, provenance.stack)) };
  };
  const ast = expand(structuredClone(parsed.ast), path, [path]);
  return { parsed: { ...parsed, ast, diagnostics: [...parsed.diagnostics.filter(item => item.code !== 'directive-disabled' || !/Directive (include|literalinclude) /.test(item.message)), ...diagnostics] }, resources: [...resources] };
}
