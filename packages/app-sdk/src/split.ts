/** One column in a split. `size` null fills the space the sized panes leave. */
export type SplitPaneSpec = {
  id: string;
  size: number | null;
  min: number;
};

export type SeparatorTarget = { id: string; side: 'start' | 'end' };

const storedMax = 4000;

export function shownPaneSize(width: number, min: number, max: number) {
  const upper = Math.max(min, max);
  return Math.round(Math.min(Math.max(width, min), upper));
}

/** Largest width this pane can take without pushing another pane under its minimum. */
export function paneLimit(panes: readonly SplitPaneSpec[], id: string, sizes: Readonly<Record<string, number>>, container: number) {
  const pane = panes.find(item => item.id === id);
  if (!pane || pane.size == null) return pane?.min ?? 0;
  let reserved = 0;
  for (const item of panes) {
    if (item.id === id) continue;
    reserved += item.size == null ? item.min : Math.max(item.min, sizes[item.id] ?? item.size);
  }
  return Math.max(pane.min, container - reserved);
}

/** The separator between two panes resizes the sized neighbor. The flex pane absorbs the change. */
export function separatorPane(before: SplitPaneSpec, after: SplitPaneSpec): SeparatorTarget | null {
  if (before.size != null) return { id: before.id, side: 'start' };
  if (after.size != null) return { id: after.id, side: 'end' };
  return null;
}

/** Positive dx moves the pointer toward the right of the screen. */
export function resizeDelta(side: 'start' | 'end', dx: number, rtl: boolean) {
  const towardEnd = rtl ? -dx : dx;
  return side === 'start' ? towardEnd : -towardEnd;
}

/** Arrow keys grow the pane on the pointer side. Home gives the start pane its minimum. */
export function keyboardSize(current: number, key: string, shift: boolean, rtl: boolean, side: 'start' | 'end', min: number, max: number) {
  const step = shift ? 80 : 16;
  const towardEnd = rtl ? 'ArrowLeft' : 'ArrowRight';
  const towardStart = rtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === 'Home') return side === 'start' ? min : shownPaneSize(max, min, max);
  if (key === 'End') return side === 'start' ? shownPaneSize(max, min, max) : min;
  if (key === towardEnd) return shownPaneSize(current + (side === 'start' ? step : -step), min, max);
  if (key === towardStart) return shownPaneSize(current + (side === 'start' ? -step : step), min, max);
  return null;
}

export function readStoredSizes(raw: string | null, panes: readonly SplitPaneSpec[]) {
  const sizes: Record<string, number> = {};
  for (const pane of panes) if (pane.size != null) sizes[pane.id] = pane.size;
  if (!raw) return sizes;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return sizes; }
  if (typeof parsed === 'number') {
    const sized = panes.filter(pane => pane.size != null);
    if (sized.length === 1 && parsed >= sized[0].min && parsed <= storedMax) sizes[sized[0].id] = parsed;
    return sizes;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return sizes;
  const record = parsed as Record<string, unknown>;
  for (const pane of panes) {
    if (pane.size == null) continue;
    const value = record[pane.id];
    if (typeof value === 'number' && value >= pane.min && value <= storedMax) sizes[pane.id] = value;
  }
  return sizes;
}
