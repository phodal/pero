/*
 * pero.structured-result v1 (contracts/structured-result-v1.json).
 * Pure validation for bounded Table / Chart results. No DOM, no network.
 * Limits follow the shape used by OpenIntelligentUI's table catalog (MIT,
 * CopilotKit/OpenIntelligentUI apps/app/src/components/generative-ui/table-catalog.tsx);
 * the code here is independent.
 */
export const STRUCTURED_RESULT_LIMITS = Object.freeze({
  titleChars: 300, columns: 12, rows: 200, cellChars: 2000,
  series: 6, pointsPerSeries: 500, labelChars: 200, provenanceLabelChars: 1000,
});
export const PROVENANCE_KINDS = Object.freeze(['user-provided', 'calculated', 'sourced', 'illustrative']);
export const PROVENANCE_REF_TYPES = Object.freeze(['artifact', 'evidence', 'run', 'url']);
const L = STRUCTURED_RESULT_LIMITS;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && v.length <= max;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const only = (o, keys, path, errors) => { for (const k of Object.keys(o)) if (!keys.includes(k)) errors.push(`${path}.${k}: unknown field`); };

function checkProvenance(p, errors) {
  if (!plain(p)) { errors.push('provenance: required'); return; }
  only(p, ['kind', 'label', 'ref'], 'provenance', errors);
  if (!PROVENANCE_KINDS.includes(p.kind)) errors.push(`provenance.kind: one of ${PROVENANCE_KINDS.join(', ')}`);
  if (!text(p.label, L.provenanceLabelChars) || !p.label.trim()) errors.push(`provenance.label: non-empty text ≤ ${L.provenanceLabelChars}`);
  if (p.ref !== undefined) {
    const r = p.ref;
    if (!plain(r)) { errors.push('provenance.ref: object'); return; }
    only(r, ['type', 'id', 'revision', 'digest'], 'provenance.ref', errors);
    if (!PROVENANCE_REF_TYPES.includes(r.type)) errors.push(`provenance.ref.type: one of ${PROVENANCE_REF_TYPES.join(', ')}`);
    if (!text(r.id, 500) || !r.id) errors.push('provenance.ref.id: non-empty text ≤ 500');
    if (r.type === 'url' && typeof r.id === 'string' && !/^https:\/\//.test(r.id)) errors.push('provenance.ref.id: url refs must be https');
    for (const k of ['revision', 'digest']) if (r[k] !== undefined && !text(r[k], 200)) errors.push(`provenance.ref.${k}: text ≤ 200`);
  }
}

function checkTruncated(t, errors) {
  if (t === undefined) return;
  if (!plain(t)) { errors.push('truncated: object'); return; }
  only(t, ['rows', 'points', 'series'], 'truncated', errors);
  for (const k of ['rows', 'points', 'series']) if (t[k] !== undefined && !(Number.isInteger(t[k]) && t[k] > 0)) errors.push(`truncated.${k}: positive integer (omitted count)`);
}

/** @returns {{ ok: true, value: object } | { ok: false, errors: string[] }} */
export function validateStructuredResult(input) {
  const errors = [];
  if (!plain(input)) return { ok: false, errors: ['result: object'] };
  if (input.version !== 1) errors.push('version: must be 1');
  if (!text(input.title, L.titleChars) || !input.title.trim()) errors.push(`title: non-empty text ≤ ${L.titleChars}`);
  checkProvenance(input.provenance, errors);
  checkTruncated(input.truncated, errors);
  if (input.kind === 'table') {
    only(input, ['version', 'kind', 'title', 'columns', 'rows', 'provenance', 'truncated'], 'result', errors);
    const { columns, rows } = input;
    if (!Array.isArray(columns) || columns.length < 1 || columns.length > L.columns) errors.push(`columns: 1–${L.columns}`);
    else columns.forEach((c, i) => { if (!text(c, L.labelChars)) errors.push(`columns[${i}]: text ≤ ${L.labelChars}`); });
    if (!Array.isArray(rows) || rows.length > L.rows) errors.push(`rows: at most ${L.rows}`);
    else rows.forEach((row, i) => {
      if (!Array.isArray(row) || row.length !== (columns?.length ?? -1)) { errors.push(`rows[${i}]: must have one cell per column`); return; }
      row.forEach((cell, j) => { if (!(cell === null || finite(cell) || text(cell, L.cellChars))) errors.push(`rows[${i}][${j}]: text ≤ ${L.cellChars}, finite number, or null`); });
    });
  } else if (input.kind === 'chart') {
    only(input, ['version', 'kind', 'title', 'chart', 'xLabel', 'yLabel', 'unit', 'series', 'provenance', 'truncated'], 'result', errors);
    if (!['bar', 'line'].includes(input.chart)) errors.push('chart: bar or line');
    for (const k of ['xLabel', 'yLabel', 'unit']) if (input[k] !== undefined && !text(input[k], L.labelChars)) errors.push(`${k}: text ≤ ${L.labelChars}`);
    const s = input.series;
    if (!Array.isArray(s) || s.length < 1 || s.length > L.series) errors.push(`series: 1–${L.series}`);
    else s.forEach((series, i) => {
      if (!plain(series)) { errors.push(`series[${i}]: object`); return; }
      only(series, ['name', 'points'], `series[${i}]`, errors);
      if (!text(series.name, L.labelChars) || !series.name) errors.push(`series[${i}].name: non-empty text ≤ ${L.labelChars}`);
      const pts = series.points;
      if (!Array.isArray(pts) || pts.length > L.pointsPerSeries) { errors.push(`series[${i}].points: at most ${L.pointsPerSeries}`); return; }
      const seen = new Set();
      pts.forEach((p, j) => {
        if (Array.isArray(p)) { if (seen.has(p[0])) errors.push(`series[${i}].points[${j}]: duplicate x ${JSON.stringify(p[0]).slice(0, 40)}`); seen.add(p[0]); }
        if (!Array.isArray(p) || p.length !== 2 || !(finite(p[0]) || text(p[0], L.labelChars)) || !(p[1] === null || finite(p[1]))) errors.push(`series[${i}].points[${j}]: [x label|number, finite number|null]`);
      });
    });
  } else errors.push('kind: table or chart');
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, value: input };
}

/** Producer helper: clip to the v1 limits and record what was dropped. */
export function truncateStructuredResult(input) {
  if (!plain(input)) return input;
  const out = { ...input };
  if (input.kind === 'table' && Array.isArray(input.rows) && input.rows.length > L.rows) {
    out.rows = input.rows.slice(0, L.rows);
    out.truncated = { ...input.truncated, rows: (input.truncated?.rows ?? 0) + input.rows.length - L.rows };
  }
  if (input.kind === 'chart' && Array.isArray(input.series)) {
    // Whole series beyond the limit are dropped too; their points count as omitted points.
    const extra = input.series.slice(L.series);
    let dropped = extra.reduce((n, s) => n + (Array.isArray(s?.points) ? s.points.length : 0), 0);
    out.series = input.series.slice(0, L.series).map(s => {
      if (!Array.isArray(s?.points) || s.points.length <= L.pointsPerSeries) return s;
      dropped += s.points.length - L.pointsPerSeries;
      return { ...s, points: s.points.slice(0, L.pointsPerSeries) };
    });
    if (extra.length || dropped) {
      const prior = plain(input.truncated) ? input.truncated : {};
      out.truncated = { ...prior };
      if (extra.length) out.truncated.series = (prior.series ?? 0) + extra.length;
      if (dropped) out.truncated.points = (prior.points ?? 0) + dropped;
    }
  }
  return out;
}
