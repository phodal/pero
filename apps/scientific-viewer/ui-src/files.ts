/** Local bounded file inspection. Imported bytes are never evaluated as code. */
export const MAX_FILE = 10 * 1024 * 1024;
export type Asset = { id: string; name: string; size: number; sha256: string; source: string; license: string; synthetic: boolean; bytes: Uint8Array };
export type Table = { headers: string[]; rows: string[][]; missing: number };
export function parseTable(text: string): Table {
  if (text.length > MAX_FILE) throw new Error('Text exceeds 10 MiB');
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  const delimiter = text.split('\n', 1)[0].includes('\t') ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else if (quoted || !field) quoted = !quoted; else throw new Error('Unexpected quote'); }
    else if (!quoted && (c === delimiter || c === '\n')) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (row.length > 256) throw new Error('Maximum 256 columns');
      if (c === '\n') { rows.push(row); row = []; if (rows.length > 20001) throw new Error('Maximum 20,000 data rows'); }
    } else field += c;
  }
  if (quoted) throw new Error('Unterminated quoted field');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (rows.length > 20001 || rows.some(row => row.length > 256)) throw new Error('Maximum 20,000 data rows and 256 columns');
  const headers = rows.shift() ?? [];
  if (!headers.length || rows.some(row => row.length !== headers.length)) throw new Error('Inconsistent table columns');
  return { headers, rows, missing: rows.flat().filter(value => !value.trim()).length };
}
export function inspect(name: string): 'table' | 'structure' | 'molecule' | 'pdf' | 'json' | 'opaque' {
  const ext = name.split('.').at(-1)?.toLowerCase();
  if (['csv', 'tsv'].includes(ext ?? '')) return 'table';
  if (['pdb', 'cif', 'mmcif'].includes(ext ?? '')) return 'structure';
  if (['smi', 'smiles', 'mol', 'sdf'].includes(ext ?? '')) return 'molecule';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'json') return 'json';
  return 'opaque';
}
export type NumericPoint = { x: number; y: number; row: number };
function finiteNumber(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
/** Choose the first pair of columns with an observed numeric pair, without reordering rows. */
export function defaultNumericColumns(table: Table): [number, number] | null {
  for (const row of table.rows) {
    let first = -1;
    for (let column = 0; column < row.length; column++) {
      if (finiteNumber(row[column]) === null) continue;
      if (first !== -1) return [first, column];
      first = column;
    }
  }
  return null;
}
/** A null entry is a gap, not a zero or permission to connect its neighboring points. */
export function numericSeries(table: Table, xColumn = 0, yColumn = 1): Array<NumericPoint | null> {
  if ([xColumn, yColumn].some(column => !Number.isInteger(column) || column < 0 || column >= table.headers.length))
    throw new Error('Choose two columns from this table');
  return table.rows.map((row, index) => {
    const x = finiteNumber(row[xColumn]), y = finiteNumber(row[yColumn]);
    return x !== null && y !== null ? { x, y, row: index + 2 } : null;
  });
}
export { numericSeries as spectrum };
export async function assetFrom(file: File, metadata: Partial<Pick<Asset, 'source' | 'license' | 'synthetic'>> = {}): Promise<Asset> {
  if (!file.size || file.size > MAX_FILE) throw new Error('Choose a nonempty file up to 10 MiB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  return { id: crypto.randomUUID(), name: file.name, size: bytes.length, sha256, source: 'User-selected local file', license: 'Unknown', synthetic: false, ...metadata, bytes };
}
/** Mol* 5.13.1 uses structure labels as HTML in multiple stock controls.
 * Reject before creating the engine, retaining original bytes rather than silently sanitizing. */
export function structureText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/[<>&]/.test(text)) throw new Error('Structure preview blocked: HTML-like metadata is unsupported. The original local file is retained.');
  return text;
}
/** Consume stock drops so OpenFiles/Snapshot cannot bypass the validated import. */
export function blockStructureDrops(manager: { addHandler(name: string, handler: () => boolean): void }, report: (message: string) => void) {
  manager.addHandler('pero-validated-import-only', () => { report('Use Import file to open a structure; direct structure drops are disabled.'); return true; });
}
export function moleculeRecords(name: string, bytes: Uint8Array): string[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // Consume only the delimiter line's EOL: a following blank title is part of the MOL header.
  const records = (/\.sdf$/i.test(name) ? text.split(/^\$\$\$\$(?:\r?\n|$)/m)
    : /\.mol$/i.test(name) ? [text] : text.split(/\r?\n/)).filter(value => value.trim());
  if (!records.length) throw new Error('No molecule records');
  if (records.length > 200) throw new Error('Molecule preview is limited to 200 records');
  return records;
}
