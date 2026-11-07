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
  const records: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(cell.trim()); cell = '';
      if (char !== ',') {
        if (row.some(value => value)) records.push(row);
        row = [];
        if (char === '\r' && source[index + 1] === '\n') index++;
      }
    } else cell += char;
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field');
  row.push(cell.trim());
  if (row.some(value => value)) records.push(row);
  const columns = records.shift() ?? [];
  const rows = records.map(values => {
    if (values.length !== columns.length) throw new Error('CSV row does not match its header');
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
  return { columns, rows };
}

export function uploadSmiles(table: ReturnType<typeof readCsv>, column: string) {
  const values = column ? table.rows.map(row => row[column]).filter(Boolean) : [];
  if (values.length > 32) throw new Error('Upload at most 32 nonempty SMILES; split this CSV into smaller files.');
  return values;
}

export function matchingPredictions(smiles: string[] | undefined, predictions: { smiles: string; predicted: string }[] | undefined) {
  return smiles?.length && predictions?.length === smiles.length && predictions.every((item, index) => item.smiles === smiles[index]) ? predictions : [];
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

/** A correction-factor rerun is drawn only after a real comparison exists. */
export function showsRerun(status: string) {
  return status === 'PASS' || status === 'FAIL';
}
