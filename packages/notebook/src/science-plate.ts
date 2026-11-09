export interface PlateSize { rows: number; columns: number }
export type PlateDirection = 'rows' | 'columns';
export interface PlateLayout { size: PlateSize; groups: Record<string, string[]> }
export function createPlate(rows: number, columns: number): PlateLayout {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 32 || columns < 1 || columns > 48) throw new Error('Plate dimensions must be 1–32 rows and 1–48 columns.');
  return { size: { rows, columns }, groups: {} };
}
export function plateRowLabel(row: number): string {
  return row < 26 ? String.fromCharCode(65 + row) : `A${String.fromCharCode(65 + row - 26)}`;
}
export function plateWellName(index: number, size: PlateSize): string {
  return `${plateRowLabel(Math.floor(index / size.columns))}${index % size.columns + 1}`;
}
export function plateWellIndex(name: string, size: PlateSize): number {
  const match = /^([A-Z]{1,2})([1-9]\d*)$/.exec(name.trim().toUpperCase());
  if (!match) throw new Error(`Invalid well ${name}.`);
  const row = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1, column = Number(match[2]) - 1;
  if (row >= size.rows || column >= size.columns) throw new Error(`Well ${name} lies outside the plate.`);
  return row * size.columns + column;
}
export function plateRectangle(first: number, last: number, size: PlateSize): number[] {
  if ([first, last].some(i => !Number.isInteger(i) || i < 0 || i >= size.rows * size.columns)) throw new Error('Selection lies outside the plate.');
  const selected: number[] = [];
  const r1 = Math.floor(first / size.columns), r2 = Math.floor(last / size.columns), c1 = first % size.columns, c2 = last % size.columns;
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) selected.push(r * size.columns + c);
  return selected;
}
export function plateTraversal(selected: readonly number[], size: PlateSize, direction: PlateDirection): number[] {
  if (selected.some(i => !Number.isInteger(i) || i < 0 || i >= size.rows * size.columns)) throw new Error('Selection lies outside the plate.');
  return [...new Set(selected)].sort((a, b) => direction === 'rows' ? a - b : a % size.columns - b % size.columns || a - b);
}
export function assignPlate(layout: PlateLayout, selected: readonly number[], group: string, mode: 'replace' | 'add' | 'clear'): PlateLayout {
  if (mode !== 'clear' && (!group.trim() || group.length > 64)) throw new Error('Group name must contain 1–64 characters.');
  const groups = { ...layout.groups };
  for (const index of plateTraversal(selected, layout.size, 'rows')) {
    const name = plateWellName(index, layout.size);
    if (mode === 'clear') delete groups[name];
    else {
      const next = mode === 'replace' ? [group.trim()] : [...new Set([...(groups[name] ?? []), group.trim()])];
      if (next.length > 12) throw new Error('A well can contain at most 12 groups.');
      groups[name] = next;
    }
  }
  return { ...layout, groups };
}
export function plateSnapshot(layout: PlateLayout, selected: readonly number[], direction: PlateDirection) {
  const order = plateTraversal(selected, layout.size, direction);
  return { method: 'pero-plate-layout/1', size: layout.size, direction, selected: order.map(i => plateWellName(i, layout.size)),
    wells: Array.from({ length: layout.size.rows * layout.size.columns }, (_, i) => ({ well: plateWellName(i, layout.size), groups: layout.groups[plateWellName(i, layout.size)] ?? [], order: order.includes(i) ? order.indexOf(i) + 1 : null })),
    limits: 'Layout metadata only. No instrument, physical plate, sample inventory, dispensing, or scientific verification is connected.' };
}
