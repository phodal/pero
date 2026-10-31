export type Cell = string | number | boolean | null | Cell[] | { [key: string]: Cell };
export type Row = Record<string, Cell>;
export type AssetKind = 'Time series' | 'Table' | 'Model' | 'Records';
export type Asset = {
  id: string;
  name: string;
  kind: AssetKind;
  format: string;
  source: string;
  description: string;
  updated: string;
  updatedRank: number;
  rows: Row[];
  units: Record<string, string>;
};
export type PreviewMode = 'chart' | 'rows';

export const IMPORT_LIMIT = 5 * 1024 * 1024;
export const ROW_LIMIT = 10_000;

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export const formatInt = (value: number) => new Intl.NumberFormat('en-US').format(value);
export const formatNum = (value: number) => Number.isFinite(value) ? (Math.round(value * 1000) / 1000).toString() : '\u2014';

export function fields(asset: Asset): string[] {
  return [...new Set(asset.rows.flatMap(row => Object.keys(row)))];
}

export function missingCount(asset: Asset): number {
  const keys = fields(asset);
  return asset.rows.reduce((total, row) => total + keys.filter(key => row[key] == null || row[key] === '').length, 0);
}

export function visibleAssets(assets: Asset[], query: string): Asset[] {
  const text = query.trim().toLowerCase();
  const list = text
    ? assets.filter(asset => `${asset.name} ${asset.kind} ${asset.source} ${asset.description} ${fields(asset).join(' ')}`.toLowerCase().includes(text))
    : assets;
  return [...list].sort((a, b) => b.updatedRank - a.updatedRank || a.name.localeCompare(b.name));
}

export function chartEligible(asset: Asset): boolean {
  if (asset.kind === 'Records' || asset.kind === 'Model') return false;
  const numeric = fields(asset).filter(key => {
    const present = asset.rows.filter(row => row[key] != null);
    return present.some(row => Number.isFinite(Number(row[key]))) && present.every(row => typeof row[key] === 'number' || (typeof row[key] === 'string' && row[key].trim() !== '' && !Number.isNaN(Number(row[key]))));
  });
  return numeric.length >= 1 && asset.rows.length > 2;
}

export function chartSeries(asset: Asset): { x: string | null; ys: string[] } {
  const numeric = fields(asset).filter(key => asset.rows.some(row => typeof row[key] === 'number') && asset.rows.every(row => row[key] == null || typeof row[key] === 'number'));
  const x = numeric.find(key => /^(time|timestamp|frequency|sample|index)/i.test(key)) ?? null;
  let ys = numeric.filter(key => key !== x);
  if (ys.includes('setpoint') && ys.includes('response')) ys = ['response', 'setpoint'];
  else if (ys.length > 1 && asset.units[ys[0]] && asset.units[ys[1]] && asset.units[ys[0]] !== asset.units[ys[1]]) ys = ys.slice(0, 1);
  return { x, ys: ys.slice(0, 2) };
}

export function parseDelimited(text: string, separator: string): Row[] {
  const result: string[][] = [];
  let current: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (character === separator && !quoted) {
      current.push(value); value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[i + 1] === '\n') i += 1;
      current.push(value); value = '';
      if (current.some(cell => cell !== '')) result.push(current);
      current = [];
    } else value += character;
  }
  if (quoted) throw new Error('Unclosed quoted field');
  if (value !== '' || current.length) { current.push(value); result.push(current); }
  if (result.length < 2) throw new Error('Expected a header row and at least one data row');
  const head = result[0].map((name, index) => name.trim() || `field_${index + 1}`);
  if (new Set(head).size !== head.length) throw new Error('Duplicate column names in header');
  if (head.length > 64) throw new Error('Up to 64 fields');
  const rows: Row[] = result.slice(1).map((cells, index) => {
    if (cells.length !== head.length) throw new Error(`Row ${index + 2} has ${cells.length} fields, expected ${head.length}`);
    return Object.fromEntries(head.map((key, column) => [key, cells[column] === undefined || cells[column].trim() === '' ? null : cells[column]]));
  });
  for (const key of head) {
    const known = rows.map(row => row[key]).filter(value => value != null);
    if (known.length && known.every(value => typeof value === 'string' && NUMBER_RE.test(value) && Number.isFinite(Number(value))))
      for (const row of rows) if (row[key] != null) row[key] = Number(row[key]);
  }
  return rows;
}

function normalizeJSON(value: unknown): Row[] {
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) throw new Error('Expected an object or array of objects');
  return rows as Row[];
}

export function parseImported(name: string, text: string): { rows: Row[]; kind: AssetKind; format: string } {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  let parsed: unknown;
  if (ext === 'csv') parsed = parseDelimited(text, ',');
  else if (ext === 'tsv') parsed = parseDelimited(text, '\t');
  else if (ext === 'json') parsed = JSON.parse(text);
  else if (ext === 'jsonl' || ext === 'ndjson') parsed = text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`Invalid JSON on line ${index + 1}`); }
  });
  else throw new Error('Unsupported format');
  const rows = normalizeJSON(parsed);
  if (rows.length > ROW_LIMIT) throw new Error('Up to 10,000 rows');
  return { rows, kind: ext === 'json' ? 'Records' : 'Table', format: ext.toUpperCase() };
}
