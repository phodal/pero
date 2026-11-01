import React, { useEffect, useRef, useState } from 'react';
import { Button, Feedback, Input } from '@pero/app-sdk/ui';
import type { Api, PdfAnnotation } from './types';
import type { Translator } from './i18n';

type Policy = 'base' | 'shaped' | 'oracle';
type Comparison = { mode: 'absolute' | 'relative'; tolerance: number } | { mode: 'bounds'; lower: number; upper: number };
type Item = { id: string; spec_id: string; annotation_id: string; policy: Policy; comparison: Comparison; reported: number };
type Attempt = { attempt_id: string; status: string; phase?: string; error?: string; origin?: string };
type Request = { request_id: string; status: string; attempt_id?: string; item_id?: string };
type Entry = { item: Item; spec: { id: string; profile: string; seed: number; steps: number; episodes: number; samples: number; timeout_seconds: number; packages: [string, string][] }; attempts: Attempt[]; requests: Request[] };
type Evidence = { executionAvailable: boolean; items: Entry[] };
type Result = { execution_status: string; comparison_status: string; reported: number; actual: number | null; paper_verdict: string; diagnostic: null | { status: string; difference: number; relative_error: number | null; reason?: string }; reasons: string[] };
type Launch = { itemId: string; specId: string; requestId: string; state?: string; status?: string };
const endpoint = '/api/reproduction/step';
const terminal = (status: string) => ['completed', 'failed', 'cancelled', 'denied', 'blocked', 'not_started'].includes(status);
const active = (status: string) => ['starting', 'running'].includes(status);

/** This is a fixed-case affordance, not a general claim detector. Backend checks the PDF again. */
export function reproductionPolicy(quote: string): Policy | null {
  const tokens: string[] = quote.match(/(?<![\w.+-])\d+\.\d+(?![\w.])/g) ?? [];
  const matches = (Object.entries({ base: '0.0727', shaped: '0.0003', oracle: '0.0000' }) as [Policy, string][])
    .filter(([, value]) => tokens.includes(value));
  return matches.length === 1 ? matches[0][0] : null;
}

/** UI projects the existing frozen records. Host owns approval; PcgymApp owns execution. */
export function Reproduction({ api, annotation, t }: { api: Api; annotation: PdfAnnotation; t: Translator }) {
  const [evidence, setEvidence] = useState<Evidence | null>(null), [itemId, setItemId] = useState('');
  const [mode, setMode] = useState<Comparison['mode']>('absolute'), [tolerance, setTolerance] = useState('');
  const [lower, setLower] = useState(''), [upper, setUpper] = useState('');
  const [attemptId, setAttemptId] = useState(''), [result, setResult] = useState<Result | null>(null);
  const [launch, setLaunch] = useState<Launch | null>(null), [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [logs, setLogs] = useState<{ text: string; truncated: boolean } | null>(null);
  const mounted = useRef(true), operation = useRef(false), reading = useRef(false);
  const selected = evidence?.items.find(row => row.item.id === itemId) ??
    evidence?.items.find(row => row.requests.some(request => !terminal(request.status) && request.item_id === row.item.id)) ?? evidence?.items[0];
  const policy = reproductionPolicy(annotation.quote);
  const desktop = location.protocol === 'pero-app:';
  const unresolved = selected?.requests.find(request => !terminal(request.status));
  const running = evidence?.items.some(row => row.attempts.some(attempt => active(attempt.status)) || row.requests.some(request => active(request.status)));
  const chosen = selected?.attempts.find(attempt => attempt.attempt_id === attemptId);
  const logSelection = useRef('');
  logSelection.current = `${selected?.item.id ?? ''}:${chosen?.attempt_id ?? ''}`;
  const fail = (value: unknown) => { if (mounted.current) setError(value instanceof Error ? value.message : String(value)); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function refresh() {
    if (reading.current) return;
    reading.current = true;
    try {
      const value = await api.post<Evidence>(endpoint, { action: 'annotation-evidence', annotationId: annotation.id });
      if (mounted.current) { setEvidence(value); setLoading(false); }
      return value;
    } catch (value) { fail(value); }
    finally { reading.current = false; if (mounted.current) setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [annotation.id, api]);
  useEffect(() => {
    if (!running || error) return;
    const timer = setTimeout(() => { void refresh(); }, 750);
    return () => clearTimeout(timer);
  }, [running, evidence, error]);
  useEffect(() => {
    if (!launch) return;
    const request = evidence?.items.flatMap(row => row.requests).find(value => value.request_id === launch.requestId);
    if (request) {
      setUncertain(!terminal(request.status) && !active(request.status));
      if (request.attempt_id) setAttemptId(request.attempt_id);
    }
  }, [evidence, launch?.requestId]);
  useEffect(() => {
    setResult(null); setLogs(null);
    if (!selected || !chosen || !terminal(chosen.status)) return;
    let current = true;
    api.post<Result>(endpoint, { action: 'compare-item', itemId: selected.item.id, attemptId: chosen.attempt_id })
      .then(value => { if (current) setResult(value); }).catch(value => { if (current) fail(value); });
    return () => { current = false; };
  }, [api, selected?.item.id, chosen?.attempt_id, chosen?.status]);

  async function freeze() {
    if (operation.current || !policy || unresolved || uncertain) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const comparison: Comparison = mode === 'bounds' ? { mode, lower: Number(lower), upper: Number(upper) } : { mode, tolerance: Number(tolerance) };
      if ((mode === 'bounds' && (!lower.trim() || !upper.trim())) || (mode !== 'bounds' && !tolerance.trim())) throw new Error(t('reproductionInvalidRange'));
      if (Object.values(comparison).some(value => typeof value === 'number' && !Number.isFinite(value)) ||
          ('tolerance' in comparison && comparison.tolerance < 0) || ('lower' in comparison && comparison.lower > comparison.upper))
        throw new Error(t('reproductionInvalidRange'));
      const item = await api.post<Item>(endpoint, { action: 'prepare-item', annotationId: annotation.id, policy, comparison,
        profile: 'smoke', seed: 0, includeOracle: true, maxSeconds: 600 });
      if (!mounted.current) return;
      setItemId(item.id); setAttemptId(''); setLaunch(null); setUncertain(false); await refresh();
    } catch (value) { fail(value); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  async function run() {
    if (operation.current || !selected || unresolved || uncertain || !desktop || !evidence?.executionAvailable || selected.spec.profile !== 'smoke') return;
    operation.current = true; setBusy(true); setError('');
    const ids = { itemId: selected.item.id, specId: selected.item.spec_id, requestId: crypto.randomUUID() };
    setLaunch(ids); setUncertain(true); setAttemptId(''); setResult(null); setLogs(null);
    try {
      const value = await api.post<Launch>('/host/reproduction', { operation: 'request', ...ids });
      if (!mounted.current) return;
      setLaunch({ ...ids, state: value.state, status: value.status });
      setUncertain(!terminal(value.status ?? value.state ?? '') && !active(value.status ?? ''));
      await refresh();
    } catch (value) { fail(value); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  async function cancel() {
    const ids = launch ?? (selected && unresolved ? { itemId: unresolved.item_id ?? selected.item.id, specId: selected.item.spec_id, requestId: unresolved.request_id } : null);
    if (!ids || !desktop) return;
    setError('');
    try {
      const value = await api.post<Launch>('/host/reproduction', { operation: 'cancel', itemId: ids.itemId, specId: ids.specId, requestId: ids.requestId });
      if (!mounted.current) return;
      setLaunch({ ...ids, state: value.state, status: value.status });
      setUncertain(!terminal(value.status ?? value.state ?? '') && !active(value.status ?? ''));
      await refresh();
    } catch (value) { fail(value); }
  }
  async function readLogs() {
    if (!selected || !chosen) return;
    const selection = logSelection.current;
    try {
      const value = await api.post<{ text: string; truncated: boolean }>(endpoint, { action: 'logs', specId: selected.item.spec_id, attemptId: chosen.attempt_id });
      if (mounted.current && logSelection.current === selection) setLogs(value);
    } catch (value) { if (logSelection.current === selection) fail(value); }
  }

  return <section className="pa-reproduction" aria-label={t('reproductionTitle')}>
    <h3>{t('reproductionTitle')}</h3>
    <p>{t('reproductionCaveat')}</p>
    {!desktop && <p role="status">{t('reproductionDesktop')}</p>}
    {loading && <p role="status">{t('loading')}</p>}
    {evidence && !evidence.executionAvailable && <p role="status">{t('reproductionConfigure')}</p>}
    {error && <Feedback kind="error">{error}</Feedback>}
    <details open={!evidence?.items.length}>
      <summary>{t('reproductionFreeze')}</summary>
      <p>{t('reproductionBudget')}</p>
      <p>{t('reproductionDiagnostic')}</p>
      <label>{t('reproductionPolicy')}<input readOnly value={policy ?? '—'} /></label>
      <label>{t('reproductionRange')}<select value={mode} onChange={event => setMode(event.target.value as Comparison['mode'])}>
        <option value="absolute">{t('reproductionAbsolute')}</option><option value="relative">{t('reproductionRelative')}</option><option value="bounds">{t('reproductionBounds')}</option>
      </select></label>
      {mode === 'bounds' ? <><label>{t('reproductionLower')}<Input type="number" value={lower} onChange={event => setLower(event.target.value)} /></label><label>{t('reproductionUpper')}<Input type="number" value={upper} onChange={event => setUpper(event.target.value)} /></label></> :
        <label>{t('reproductionTolerance')}<Input type="number" min="0" step="any" value={tolerance} onChange={event => setTolerance(event.target.value)} /></label>}
      <Button onClick={() => void freeze()} disabled={busy || loading || !policy || !evidence?.executionAvailable || !!unresolved || uncertain}>{t('reproductionFreeze')}</Button>
    </details>
    {!!evidence?.items.length && <label>{t('reproductionItem')}<select disabled={busy || uncertain || !!unresolved} value={selected?.item.id ?? ''} onChange={event => { setItemId(event.target.value); setAttemptId(''); setLaunch(null); setUncertain(false); setError(''); }}>
      {evidence.items.map(row => <option key={row.item.id} value={row.item.id}>{row.item.policy} · {row.item.comparison.mode} · {row.item.id.slice(0, 10)}</option>)}
    </select></label>}
    {selected && <>
      <p className="pa-muted">{selected.spec.profile} · {selected.spec.steps} steps · {selected.spec.episodes} × {selected.spec.samples} · {selected.spec.timeout_seconds}s · seed {selected.spec.seed}</p>
      <details><summary>{t('reproductionInputs')}</summary><code>{selected.item.spec_id}</code><pre>{JSON.stringify({ comparison: selected.item.comparison, spec: selected.spec }, null, 2)}</pre></details>
      {selected.spec.profile !== 'smoke' && <p>{t('reproductionSmokeOnly')}</p>}
      <div className="pa-actions"><Button onClick={() => void run()} disabled={busy || !desktop || !evidence?.executionAvailable || selected.spec.profile !== 'smoke' || !!unresolved || uncertain}>{t('reproductionRun')}</Button>
        <Button variant="ghost" onClick={() => void cancel()} disabled={!desktop || (!unresolved && !uncertain && !busy)}>{t('reproductionCancel')}</Button>
        <Button variant="ghost" onClick={() => { setError(''); void refresh(); }}>{t('reproductionRefresh')}</Button></div>
      {(launch || unresolved) && <p role="status">{t('reproductionExecution')}: {unresolved?.status ?? launch?.status ?? launch?.state ?? t('reproductionAwaiting')}</p>}
      {uncertain && <p role="status">{t('reproductionUnknown')}</p>}
      {!!selected.attempts.length && <label>{t('reproductionAttempt')}<select value={attemptId} onChange={event => setAttemptId(event.target.value)}><option value="">—</option>{selected.attempts.map(attempt => <option key={attempt.attempt_id} value={attempt.attempt_id}>{attempt.status} · {attempt.attempt_id.slice(0, 10)}</option>)}</select></label>}
      {chosen && <><p>{t('reproductionExecution')}: {chosen.status === 'failed' && chosen.phase === 'preflight' ? t('reproductionEnvironmentFailed') : chosen.status}{chosen.phase ? ` · ${chosen.phase}` : ''}</p>{chosen.error && <Feedback kind="error">{chosen.error}</Feedback>}{chosen.origin?.includes('fixture') && <p>{t('reproductionFixture')}</p>}<Button variant="ghost" onClick={() => void readLogs()}>{t('reproductionLogs')}</Button></>}
      {result && <><dl><dt>{t('reproductionReported')}</dt><dd>{result.reported}</dd><dt>{t('reproductionActual')}</dt><dd>{result.actual ?? '—'}</dd><dt>{t('reproductionDifference')}</dt><dd>{result.diagnostic?.difference ?? '—'}</dd></dl><p>{t('reproductionRange')}: {result.diagnostic?.status ?? 'INCONCLUSIVE'}</p><p>{t('reproductionVerdict')}: {result.paper_verdict}</p>{result.diagnostic?.reason && <p>{result.diagnostic.reason}</p>}<details><summary>{t('reproductionReasons')}</summary><ul>{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></details></>}
      {logs && <><pre tabIndex={0}>{logs.text}</pre>{logs.truncated && <p>{t('reproductionLogTruncated')}</p>}</>}
    </>}
  </section>;
}
