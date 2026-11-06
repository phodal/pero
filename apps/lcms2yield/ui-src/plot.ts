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
export function showsRerun(status: string) {
  return status === 'PASS' || status === 'FAIL';
}
