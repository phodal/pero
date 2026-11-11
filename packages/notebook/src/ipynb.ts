import { defineDocumentBlock, registerDocumentBlock, type DocumentImportFormat, type DocumentExportFormat } from './scientific-block.ts';
import { parseMystImageData, type MystImageData } from './myst-assets.ts';
import { parseIpynbMathml, type IpynbMathml } from './ipynb-mathml.ts';
export const IPYNB_MAX_BYTES = 1024 * 1024;
export const IPYNB_PERSISTED_MAX_BYTES = 1536 * 1024;
export const IPYNB_MAX_CELLS = 256;
export type IpynbJson = null | boolean | number | string | IpynbJson[] | { [key: string]: IpynbJson };
type ObjectJson = { [key: string]: IpynbJson };
export interface IpynbCell {
  readonly index: number; readonly kind: 'markdown' | 'code' | 'raw'; readonly source: string;
  readonly raw: Readonly<ObjectJson>; readonly outputs: readonly Readonly<ObjectJson>[]; readonly stale: boolean;
  readonly images: readonly { location: string; image: MystImageData }[];
  readonly mathml: readonly IpynbMathml[]; readonly diagnostics: readonly string[];
}
export interface IpynbDocument { readonly source: string; readonly raw: Readonly<ObjectJson>; readonly cells: readonly IpynbCell[] }
const record = (v: unknown): v is ObjectJson => !!v && typeof v === 'object' && !Array.isArray(v);
export function ipynbText(v: unknown): string | undefined { return typeof v === 'string' ? v : Array.isArray(v) && v.every(s => typeof s === 'string') ? v.join('') : undefined; }
const bytes = (s: string) => new TextEncoder().encode(s).length;
function scalar(s: string) { if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s)) throw new TypeError('Notebook requires Unicode scalar values'); }
function freezeJson(v: unknown, depth = 0): void {
  if (depth > 64) throw new RangeError('Notebook JSON exceeds depth 64');
  if (typeof v === 'string') scalar(v);
  if (typeof v === 'number' && (!Number.isFinite(v) || Number.isInteger(v) && !Number.isSafeInteger(v))) throw new TypeError('Notebook number is not portable');
  if (v && typeof v === 'object') { for (const [k, child] of Object.entries(v)) { scalar(k); freezeJson(child, depth + 1); } Object.freeze(v); }
}
function rejectDuplicateKeys(source: string) {
  const stack: (Set<string> | null)[] = [];
  for (const m of source.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
    if (m[0] === '{') stack.push(new Set());
    else if (m[0] === '[') stack.push(null);
    else if (m[0] === '}' || m[0] === ']') stack.pop();
    else if (/^\s*:/.test(source.slice(m.index! + m[0].length))) {
      const keys = stack.at(-1); const key: string = JSON.parse(m[0]);
      if (keys?.has(key)) throw new TypeError('Duplicate notebook JSON key');
      keys?.add(key);
    }
  }
}
/** Original JSON is authoritative. Everything else is a frozen, disposable view. */
export function parseIpynb(source: string): IpynbDocument {
  if (typeof source !== 'string') throw new TypeError('Notebook source must be text');
  scalar(source);
  if (bytes(source) > IPYNB_MAX_BYTES || bytes(JSON.stringify(source)) > IPYNB_PERSISTED_MAX_BYTES) throw new RangeError('Notebook exceeds source or escaped persistence budget');
  const raw: unknown = JSON.parse(source); rejectDuplicateKeys(source); freezeJson(raw);
  if (!record(raw) || raw.nbformat !== 4 || !Number.isSafeInteger(raw.nbformat_minor) || Number(raw.nbformat_minor) < 0 || !record(raw.metadata) || !Array.isArray(raw.cells) || raw.cells.length > IPYNB_MAX_CELLS) throw new TypeError('Expected bounded nbformat 4 notebook');
  const ids = new Set<string>();
  const cells = raw.cells.map((cell, index): IpynbCell => {
    if (!record(cell) || !['markdown', 'code', 'raw'].includes(String(cell.cell_type)) || !record(cell.metadata) || ipynbText(cell.source) === undefined) throw new TypeError('Invalid notebook cell');
    if (cell.id !== undefined) {
      if (typeof cell.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(cell.id) || ids.has(cell.id)) throw new TypeError('Invalid or duplicate cell ID');
      ids.add(cell.id);
    } else if (Number(raw.nbformat_minor) >= 5) throw new TypeError('Cell ID required by nbformat 4.5');
    if (cell.attachments !== undefined && (!record(cell.attachments) || Object.values(cell.attachments).some(v => !record(v)))) throw new TypeError('Invalid attachment bundle');
    if (cell.cell_type === 'code' && (!(cell.execution_count === null || Number.isSafeInteger(cell.execution_count) && Number(cell.execution_count) >= 0) || !Array.isArray(cell.outputs) || cell.outputs.some(v => !record(v) || typeof v.output_type !== 'string'))) throw new TypeError('Invalid recorded code outputs');
    const outputs = (cell.cell_type === 'code' ? cell.outputs : []) as ObjectJson[];
    const images: { location: string; image: MystImageData }[] = []; const mathml: IpynbMathml[] = []; const diagnostics: string[] = [];
    const inspect = (bundle: ObjectJson, location: string) => {
      for (const [mime, value] of Object.entries(bundle)) {
        if (mime === 'image/png' || mime === 'image/jpeg') {
          try { images.push({ location, image: parseMystImageData(mime, ipynbText(value)?.replace(/\s/g, '')) }); }
          catch { diagnostics.push(`${location}: invalid ${mime} retained, not rendered`); }
        } else if (mime === 'application/mathml+xml') {
          const parsed = parseIpynbMathml(ipynbText(value) ?? '');
          if (parsed) mathml.push(parsed); else diagnostics.push(`${location}: unsupported MathML retained`);
        } else if (!['text/plain', 'text/latex'].includes(mime)) diagnostics.push(`${location}: ${mime} retained, not rendered`);
      }
    };
    outputs.forEach((output, i) => { if (record(output.data)) inspect(output.data, `Output ${i + 1}`); });
    if (record(cell.attachments)) for (const [name, bundle] of Object.entries(cell.attachments)) inspect(bundle as ObjectJson, `Attachment ${name}`);
    return Object.freeze({ index, kind: cell.cell_type as IpynbCell['kind'], source: ipynbText(cell.source)!, raw: cell, outputs, stale: cell.metadata['pero.outputsStale'] === true, images: Object.freeze(images), mathml: Object.freeze(mathml), diagnostics: Object.freeze(diagnostics) });
  });
  return Object.freeze({ source, raw, cells: Object.freeze(cells) });
}
function transition(document: IpynbDocument, edit: (raw: ObjectJson & { cells: ObjectJson[] }) => void): IpynbDocument { const raw = JSON.parse(document.source); edit(raw); return parseIpynb(JSON.stringify(raw, null, 2) + '\n'); }
export function editIpynbCell(document: IpynbDocument, index: number, source: string): IpynbDocument {
  const cell = document.cells[index]; if (!cell) throw new RangeError('Cell does not exist');
  if (source === cell.source) return document;
  return transition(document, raw => { raw.cells[index].source = Array.isArray(cell.raw.source) ? source.match(/[^\n]*\n|[^\n]+$/g) ?? [] : source; if (cell.kind === 'code') (raw.cells[index].metadata as ObjectJson)['pero.outputsStale'] = true; });
}
export function clearIpynbOutputs(document: IpynbDocument, index: number): IpynbDocument {
  if (document.cells[index]?.kind !== 'code') throw new TypeError('Only code cells have outputs');
  return transition(document, raw => { const cell = raw.cells[index]; cell.outputs = []; cell.execution_count = null; delete (cell.metadata as ObjectJson)['pero.outputsStale']; });
}
export function appendIpynbCell(document: IpynbDocument, kind: IpynbCell['kind'], id: string): IpynbDocument {
  return transition(document, raw => raw.cells.push({ id, cell_type: kind, metadata: {}, source: '', ...(kind === 'code' ? { execution_count: null, outputs: [] } : {}) }));
}
export const emptyIpynb = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] });
export const ipynbDocumentDefinition = registerDocumentBlock(defineDocumentBlock({ type: 'ipynbDocument', defaults: { source: emptyIpynb }, futureVersions: 'reject', versionOne: attrs => { parseIpynb(attrs.source); } }));
export const ipynbImportFormats: readonly DocumentImportFormat<{schemaVersion: 1; source: string}>[] = [{ id: 'ipynb', label: 'Jupyter notebook', extensions: ['.ipynb'], mediaType: 'application/x-ipynb+json', maxBytes: IPYNB_MAX_BYTES, parse(source) { parseIpynb(source); return { schemaVersion: 1, source }; } }];
export const ipynbExportFormats: readonly DocumentExportFormat<{source: string}>[] = [{ id: 'ipynb', label: 'Original Jupyter notebook', extensions: ['.ipynb'], mediaType: 'application/x-ipynb+json', serialize: document => document.source }];
