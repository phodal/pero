// A connector groups several sources: searching a source should find its group.
export function matchesProvider(entry, query, extraNames = []) {
  const needle = query.trim().toLocaleLowerCase();
  return [entry.displayName, entry.providerId, entry.summary, entry.summaryEn, ...extraNames]
    .some(value => typeof value === 'string' && value.toLocaleLowerCase().includes(needle));
}
