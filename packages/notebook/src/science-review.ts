export type ColumnPolicy = 'writable' | 'protected' | 'read-only' | 'computed' | 'snapshot' | 'converted';
export interface CandidateRun { name: string; family: string; key: string; failed: boolean; tables: Record<string, string[][]> }
export interface CandidateResponse { source: string; runs: CandidateRun[]; tables: string[] }
export interface DataReview { response: CandidateResponse; baseContent: string; run: number; table: string; selected: number[]; edits: Record<string, string>; policy: ColumnPolicy }
export interface ComparedRow { index: number; cells: { original: string; value: string; others: (string | null)[]; different: boolean; edited: boolean }[]; different: boolean }
export interface RecordedCheck { text: string; acknowledged: boolean; usefulness: 'unmarked' | 'useful' | 'not-useful' }
export interface RecordedChecks { source: string; traceId: string | null; checkedAt: string | null; checkedVersion: number | null; status: 'complete' | 'partial' | 'error' | 'empty'; error: string | null; missing: string[]; items: RecordedCheck[] }

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, limit = 10_000): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${name} must be text, at most ${limit} characters.`);
  return value;
}
function json(raw: string): unknown {
  if (raw.length > 1_000_000) throw new Error('Import exceeds 1,000,000 characters.');
  return JSON.parse(raw);
}

/** Imports external run payloads, including the reference's public runResults format.
 * Pairwise match claims are intentionally not trusted: comparison is recomputed by row position.
 */
export function parseCandidateResponse(raw: string): CandidateResponse {
  const value = object(json(raw), 'Response');
  if (!Array.isArray(value.runResults) || !value.runResults.length || value.runResults.length > 8) throw new Error('Expected 1–8 runResults.');
  const runs = value.runResults.map((entry, index): CandidateRun => {
    const run = object(entry, `Run ${index + 1}`), tables = object(run.newRows, 'newRows');
    if (typeof run.hadError !== 'boolean') throw new Error('Each run requires boolean hadError.');
    const parsed: Record<string, string[][]> = Object.create(null);
    if (Object.keys(tables).length > 20) throw new Error('At most 20 tables per run.');
    for (const [name, rows] of Object.entries(tables)) {
      if (!name.trim() || name.length > 100 || !Array.isArray(rows) || rows.length > 499) throw new Error('Tables need a name and at most 499 rows.');
      parsed[name] = rows.map(row => {
        if (!Array.isArray(row) || !row.length || row.length > 50) throw new Error('Each candidate row needs 1–50 cells.');
        return row.map(cell => text(typeof cell === 'string' ? cell : object(cell, 'Cell').text, 'Cell'));
      });
      if (parsed[name].some(row => row.length !== parsed[name][0].length)) throw new Error('Candidate tables must be rectangular.');
    }
    return { name: text(run.displayName, 'displayName', 200), family: text(run.modelFamily, 'modelFamily', 200),
      key: text(run.runConfigKey ?? String(index), 'runConfigKey', 200), failed: run.hadError, tables: parsed };
  });
  return { source: raw, runs, tables: [...new Set(runs.flatMap(run => Object.keys(run.tables)))] };
}

export function startDataReview(response: CandidateResponse, baseContent: string): DataReview {
  const run = Math.max(0, response.runs.findIndex(item => !item.failed));
  const table = Object.keys(response.runs[run].tables)[0] ?? response.tables[0] ?? '';
  return { response, baseContent, run, table, selected: (response.runs[run].tables[table] ?? []).map((_, i) => i), edits: {}, policy: 'writable' };
}
export function selectReviewRun(review: DataReview, run: number, table = review.table): DataReview {
  if (!review.response.runs[run] || (table !== '' && !review.response.tables.includes(table))) throw new Error('Select an existing run and table.');
  return { ...review, run, table, selected: (review.response.runs[run].tables[table] ?? []).map((_, i) => i) };
}
export function editReviewCell(review: DataReview, row: number, column: number, value: string): DataReview {
  if (review.policy !== 'writable') throw new Error('This column policy does not permit edits.');
  if (review.response.runs[review.run].failed || review.response.runs[review.run].tables[review.table]?.[row]?.[column] === undefined) throw new Error('Choose a cell from a successful run.');
  text(value, 'Edit');
  return { ...review, edits: { ...review.edits, [JSON.stringify([review.run, review.table, row, column])]: value } };
}
export function compareReviewRows(review: DataReview): ComparedRow[] {
  const primary = review.response.runs[review.run];
  return (primary.tables[review.table] ?? []).map((row, r) => {
    const cells = row.map((original, c) => {
      const edit = review.edits[JSON.stringify([review.run, review.table, r, c])];
      const others = review.response.runs.filter((_, i) => i !== review.run).map(run => run.failed ? null : run.tables[review.table]?.[r]?.[c] ?? null);
      return { original, value: edit ?? original, edited: edit !== undefined, others, different: others.some(value => value !== original) };
    });
    return { index: r, cells, different: cells.some(cell => cell.different) };
  });
}
export function acceptDataReview(review: DataReview, currentContent: string, acknowledged: boolean) {
  if (currentContent !== review.baseContent) throw new Error('The notebook changed after review began. Reload the response and review again.');
  const selectedRun = review.response.runs[review.run];
  if (selectedRun.failed) throw new Error('A failed run cannot be accepted.');
  if (!acknowledged) throw new Error('Acknowledge that these are reviewed candidates, not verified scientific results.');
  const compared = compareReviewRows(review), selected = [...new Set(review.selected)].sort((a, b) => a - b);
  if (!selected.length || selected.some(i => !Number.isInteger(i) || !compared[i])) throw new Error('Select at least one valid candidate row.');
  return { method: 'pero-human-candidate-review/1', input: review.response.source, run: selectedRun.name, family: selectedRun.family, table: review.table,
    selectedRows: selected, edits: review.edits, policy: review.policy, rows: selected.map(i => compared[i].cells.map(cell => cell.value)),
    limits: 'Human-accepted external candidates. No model was called. Agreement is recomputed by row position, not by imported exact-match claims; same-family agreement is not independent validation. Failed runs and missing cells remain visible. The snapshot inserts new content and does not overwrite existing cells. Acceptance is not scientific or owner verification.' };
}

export function parseRecordedChecks(raw: string): RecordedChecks {
  const data = object(json(raw), 'Check response'), missing: string[] = [];
  const optionalText = (key: string) => {
    if (data[key] === undefined || data[key] === null || data[key] === '') { missing.push(key); return null; }
    return text(data[key], key, 1000);
  };
  const traceId = optionalText('traceId'), checkedAt = optionalText('checkedAt');
  if (checkedAt !== null && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(checkedAt) || !Number.isFinite(Date.parse(checkedAt)))) throw new Error('checkedAt must be an ISO timestamp with timezone.');
  let checkedVersion: number | null = null;
  if (data.checkedVersion === undefined || data.checkedVersion === null) missing.push('checkedVersion');
  else if (typeof data.checkedVersion !== 'number' || !Number.isSafeInteger(data.checkedVersion) || data.checkedVersion < 0) throw new Error('checkedVersion must be a non-negative integer.');
  else checkedVersion = data.checkedVersion;
  if (data.hadError !== undefined && typeof data.hadError !== 'boolean') throw new Error('hadError must be boolean.');
  if (data.hadError === undefined) missing.push('hadError');
  const error = data.errorMessage == null ? null : text(data.errorMessage, 'errorMessage');
  if (!Array.isArray(data.checkResults) || data.checkResults.length > 499) throw new Error('checkResults must be an array of at most 499 items.');
  const items = data.checkResults.map((item): RecordedCheck => {
    const value = text(object(item, 'Check').text, 'Check text');
    if (!value.trim()) throw new Error('Check text cannot be empty.');
    return { text: value, acknowledged: false, usefulness: 'unmarked' };
  });
  const failed = data.hadError === true || !!error;
  return { source: raw, traceId, checkedAt, checkedVersion, missing, error: failed ? error || 'The source reported an error.' : null,
    status: failed && !items.length ? 'error' : missing.length || failed ? 'partial' : items.length ? 'complete' : 'empty', items };
}

export function recordedChecksSnapshot(checks: RecordedChecks, acknowledged: boolean) {
  if (!acknowledged) throw new Error('Acknowledge the source limits before inserting.');
  return { method: 'pero-recorded-check-review/1', ...checks,
    limits: 'Imported check report and local human acknowledgments. No check or model was run. Checked time and version refer to the imported source, not this notebook. Acknowledgment or usefulness feedback does not establish completion, scientific validity, or owner verification.' };
}
