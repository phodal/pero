export type Kind = 'needs_you' | 'risk' | 'change' | 'done' | 'watch' | 'filtered';
export type Card = {
  id: string; kind: Kind; title: string; conclusion: string; body: string;
  why?: string; impact?: string; handled?: boolean;
  entity?: { type: string; label: string; id?: string; url?: string };
  sources?: { label: string; url?: string }[];
  seen?: boolean; dismissed?: boolean;
  feedback?: { vote: 'more' | 'less'; note: string; at: string };
};
export type Edition = { id: string; createdAt: string; cards: Card[]; tomorrow?: string; goalId?: string; automation?: string };
export type Watch = { id: string; text: string; cadence: 'brief' | 'hourly' | 'daily' | 'weekday'; createdAt: string };
export type ArchiveSummary = { id: string; createdAt: string; cards: number; goalId?: string };
export type Home = { proactivity: 'off' | 'decisions' | 'brief' | 'active'; watches: Watch[]; editions: Edition[]; archive: ArchiveSummary[] };

const ORDER = ['risk', 'change', 'watch', 'done'] as const;

export function projectBrief(editions: Edition[], selectedId = '') {
  const selected = selectedId ? editions.find(edition => edition.id === selectedId) : undefined;
  const current = selected || editions.find(edition => !edition.goalId) || null;
  const visible = (current?.cards ?? []).filter(card => !card.dismissed);
  const needsYou = visible.filter(card => card.kind === 'needs_you');
  const filtered = visible.filter(card => card.kind === 'filtered');
  const cards = visible.filter(card => ORDER.includes(card.kind as typeof ORDER[number]))
    .sort((left, right) => ORDER.indexOf(left.kind as typeof ORDER[number]) - ORDER.indexOf(right.kind as typeof ORDER[number]));
  return { current, needsYou, cards, filtered, attention: needsYou.filter(card => !card.seen).length };
}

export function latestReport(editions: Edition[], watchId: string) {
  return editions.find(edition => edition.goalId === watchId) ?? null;
}
