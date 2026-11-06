/** Display geometry for the released yield table. It does not score science. */

export interface YieldPoint {
  index: number;
  x: number;
  y: number;
}

export function yieldPercent(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Yield is not a finite fraction');
  return number * 100;
}

export function plotBounds(points: YieldPoint[]) {
  const values = [0, 100, ...points.flatMap(point => [point.x, point.y])];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.04 || 1;
  return { low: low - pad, high: high + pad };
}

/** A correction-factor rerun is drawn only after a real comparison exists. */
export function readCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return { columns: [] as string[], rows: [] as Record<string, string>[] };
  const columns = splitCsv(lines[0]);
  const rows = lines.slice(1, 501).map(line => Object.fromEntries(columns.map((column, index) => [column, splitCsv(line)[index] ?? ''])));
  return { columns, rows };
}

export function detectColumns(columns: string[]) {
  const find = (pattern: RegExp) => columns.find(column => pattern.test(column)) ?? '';
  return {
    smiles: find(/smiles/i),
    yieldExp: find(/yield \(exp\)|experimental yield|^yield$/i),
    yieldPred: find(/yield \(pred\)|predicted yield/i),
    name: find(/exp_name|^name$|reaction id/i),
  };
}

function splitCsv(line: string) {
  return line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''));
}

/** A correction-factor rerun is drawn only after a real comparison exists. */
export function showsRerun(status: string) {
  return status === 'PASS' || status === 'FAIL';
}
