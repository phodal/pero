export type ShelfStatus = 'reading' | 'to-read' | 'reviewed';
export type ShelfFilter = 'all' | ShelfStatus;
export type Shelf = Readonly<Record<string, ShelfStatus>>;

const storageKey = 'paper-agent.shelf';
const statuses: readonly ShelfStatus[] = ['reading', 'to-read', 'reviewed'];

export function isShelfStatus(value: unknown): value is ShelfStatus {
  return typeof value === 'string' && (statuses as readonly string[]).includes(value);
}

export function isShelfFilter(value: string): value is ShelfFilter {
  return value === 'all' || isShelfStatus(value);
}

export function statusOf(shelf: Shelf, id: string): ShelfStatus {
  return shelf[id] ?? 'to-read';
}

/** to-read → reading → reviewed → to-read */
export function cycleStatus(status: ShelfStatus): ShelfStatus {
  if (status === 'to-read') return 'reading';
  if (status === 'reading') return 'reviewed';
  return 'to-read';
}

/** Opening promotes to-read to reading and leaves reading and reviewed unchanged. */
export function promoteOnOpen(status: ShelfStatus): ShelfStatus {
  return status === 'to-read' ? 'reading' : status;
}

export function withStatus(shelf: Shelf, id: string, status: ShelfStatus): Shelf {
  if (shelf[id] === status) return shelf;
  return { ...shelf, [id]: status };
}

export function openPaper(shelf: Shelf, id: string): Shelf {
  return withStatus(shelf, id, promoteOnOpen(statusOf(shelf, id)));
}

export function addedWhen(fetchedAt: string, now: Date): 'today' | 'yesterday' | Date | null {
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) return null;
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((start(now) - start(date)) / 86_400_000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return date;
}

export function loadShelf(storage?: Pick<Storage, 'getItem'>): Shelf {
  const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  if (!store) return {};
  try {
    const raw = JSON.parse(store.getItem(storageKey) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const shelf: Record<string, ShelfStatus> = {};
    for (const [id, status] of Object.entries(raw)) if (isShelfStatus(status)) shelf[id] = status;
    return shelf;
  } catch {
    return {};
  }
}

export function saveShelf(shelf: Shelf, storage?: Pick<Storage, 'setItem'>) {
  const store = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  if (!store) return;
  try { store.setItem(storageKey, JSON.stringify(shelf)); } catch { /* private mode or a full disk */ }
}
