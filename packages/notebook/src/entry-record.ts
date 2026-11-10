/** Display identity and local mention records for one notebook entry. */
export const entryStatuses = ['in_progress', 'completed'] as const;
export type EntryStatus = typeof entryStatuses[number];
export interface EntryIdentity { code: string; status: EntryStatus }
export interface EntryNotice { id: string; name: string; at: string; note: string }

const noticeLimits = { notices: 100, name: 80, note: 500 } as const;

export function entryCode(entryId: string): string | null {
  if (!/^[a-f0-9]{32}$/.test(entryId)) return null;
  return `EXP${parseInt(entryId.slice(0, 8), 16).toString().padStart(8, '0').slice(-8)}`;
}

export function isEntryIdentity(value: unknown): value is EntryIdentity {
  if (!value || typeof value !== 'object') return false;
  const item = value as EntryIdentity;
  return typeof item.code === 'string' && /^EXP\d{8}$/.test(item.code) && entryStatuses.includes(item.status);
}

/** A stored identity wins. Otherwise the code is derived from the entry id and the status starts in progress. */
export function entryIdentity(entryId: string, stored?: EntryIdentity | null): EntryIdentity | null {
  if (stored && isEntryIdentity(stored)) return stored;
  const code = entryCode(entryId);
  return code ? { code, status: 'in_progress' } : null;
}

/** Records a person mention on the entry. The caller supplies the time; nothing is sent. */
export function recordMention(notices: readonly EntryNotice[], input: EntryNotice): EntryNotice[] | null {
  const name = input.name.trim();
  const note = input.note.trim();
  if (notices.length >= noticeLimits.notices) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.id) || notices.some(item => item.id === input.id)) return null;
  if (!name || [...name].length > noticeLimits.name || [...note].length > noticeLimits.note) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(input.at) || input.at.length > 40) return null;
  return [...notices, { id: input.id, name, at: input.at, note }];
}
