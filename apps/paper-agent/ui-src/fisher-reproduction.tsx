import React, { useEffect, useRef, useState } from 'react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Disclosure, Feedback, Input, Select, Table } from '@pero/app-sdk/ui';
import type { Api, PdfAnnotation } from './types';
import './fisher-reproduction.css';

export const FISHER_PDF_SHA256 = 'd3a49aaa4f2d283931544f58cb12b1174f537642b83def7ae9119a1d8717b740';
/** Only the reviewed source cell, never an arbitrary number or a result annotation. */
export function isFisherSource(annotation: PdfAnnotation, digest: string) {
  const r = annotation.rects[0];
  return digest === FISHER_PDF_SHA256 && annotation.kind === 'figure' && annotation.page === 4 && annotation.rects.length === 1
    && annotation.note === 'Fisher (1936), Table III: sepal-length within-species sum of squares, 19.1434 cm². Source value visually reviewed; PDF text-layer extraction misses this cell.'
    && r.x === .34 && r.y === .339 && r.width === .065 && r.height === .012;
}
type Comparison = { mode: 'absolute' | 'relative'; tolerance: number } | { mode: 'bounds'; lower: number; upper: number };
type Protocol = { id: string; data_sha256: string; python_version: string; metric: string; unit: string; reported: number; comparison: Comparison; command: string[]; scope: string };
type Report = { annotation_status?: string; workflow_status?: string; result_verdict?: string; paper_verdict?: string; comparison_status?: string; reported?: number; actual?: number | null; difference?: number | null; reason?: string };
type Attempt = { attemptId: string; execution: { status: string; request_id?: string; error?: string }; report: Report | null; independent: { numeric_recomputation?: string; independence?: string; reason?: string } | null; annotation: unknown };
type Item = { itemId: string; spec: Protocol; attempts: Attempt[] };
type Pending = { requestId: string; itemId: string; specId: string };
type Evidence = { case: string; scope: string; items: Item[]; data?: { sha256: string; location: string; rows: { species: string; row: number; length_cm: number }[] }; preview?: Protocol };
const endpoint = '/api/fisher/step';
const resolved = (attempt: Attempt) => ['failed', 'input_mismatch', 'environment_failed', 'blocked', 'cancelled', 'denied'].includes(attempt.execution.status) || (attempt.execution.status === 'completed' && attempt.report !== null);

/** Presents backend-owned immutable protocols and attempts; never executes on mount. */
export function FisherReproduction({ api, annotation, onSource }: { api: Api; annotation: PdfAnnotation; onSource(): void }) {
  const { t } = useAppI18n({
    title: { zh: '复现 Fisher 表 III 的一个结果', en: 'Reproduce one Fisher Table III result' },
    scope: { zh: '仅重算一个已发表统计量。整篇论文：NOT_ASSESSED。', en: 'Numerical reanalysis of one published statistic. Whole paper: NOT_ASSESSED.' },
    source: { zh: '查看表 III 原始单元格', en: 'View original Table III cell' },
    observations: { zh: '核对输入观测值', en: 'Review input observations' },
    species: { zh: '物种', en: 'Species' }, row: { zh: '行号', en: 'Row' }, length: { zh: '萼片长度（cm）', en: 'Sepal length (cm)' },
    scanCorrection: { zh: 'setosa 第 32 行按原始扫描为 5.4；OCR 的 6.4 是错误识别。', en: 'Setosa row 32 is 5.4 in the original scan; OCR 6.4 is incorrect.' },
    data: { zh: '数据：表 I（PDF 第 3 页）人工转录的 100 个萼片长度，setosa 和 versicolor 各 50 个；非 UCI / sklearn 数据。', en: 'Data: 100 visually transcribed sepal lengths from Table I (PDF page 3), 50 each for setosa and versicolor; not UCI / sklearn data.' },
    method: { zh: '方法：分别求每个物种的均值，再求各观测值与本组均值之差的平方和。不除以自由度。单位 cm²；论文值 19.1434。', en: 'Method: sum squared deviations from each species mean, then sum both groups. No degrees-of-freedom divisor. Unit cm²; reported value 19.1434.' },
    budget: { zh: '只运行内置的 100 值算术与独立精确分数核验；不下载软件，不执行论文任意代码。', en: 'Runs only built-in 100-value arithmetic and an independent exact-fraction check; no software downloads or arbitrary paper code.' },
    comparison: { zh: '预先声明比较规则', en: 'Predeclare comparison rule' }, absolute: { zh: '绝对误差', en: 'Absolute error' }, relative: { zh: '相对误差', en: 'Relative error' }, bounds: { zh: '实际值范围', en: 'Actual-value bounds' },
    tolerance: { zh: '容差', en: 'Tolerance' }, lower: { zh: '下限', en: 'Lower bound' }, upper: { zh: '上限', en: 'Upper bound' },
    rounding: { zh: '默认绝对容差 0.00005，等于印刷值末位精度的一半；在运行前固定。', en: 'Default absolute tolerance 0.00005 is half the last printed decimal place, fixed before execution.' },
    confirm: { zh: '我已核对数据、统计口径和比较规则', en: 'I confirm the data, method and comparison rule' },
    freeze: { zh: '冻结方案', en: 'Freeze protocol' }, newProtocol: { zh: '建立新方案（保留旧版本）', en: 'Create new protocol (retain earlier versions)' },
    frozen: { zh: '已冻结方案', en: 'Frozen protocol' }, inputs: { zh: '完整输入、运行环境与命令', en: 'Full inputs, runtime and command' },
    run: { zh: '确认并运行固定算术', en: 'Confirm and run fixed arithmetic' }, rerun: { zh: '确认并新建一次运行', en: 'Confirm and run a new attempt' },
    recover: { zh: '用原请求标识恢复提交', en: 'Recover original request' },
    recoverHint: { zh: '状态查询未找到原请求。可显式重试相同请求标识；不会创建重复运行。', en: 'Status did not find the original request. Explicit recovery reuses its identity to avoid duplicate execution.' },
    refresh: { zh: '刷新状态', en: 'Refresh status' }, loading: { zh: '读取复现记录…', en: 'Loading reproduction records…' }, working: { zh: '正在处理…', en: 'Working…' },
    uncertain: { zh: '运行响应尚未确认。请刷新核对原请求；确认前不能重复运行。', en: 'Run response is unconfirmed. Refresh to reconcile the original request before another run.' },
    retained: { zh: '请求失败；保留的记录可能不是最新状态。', en: 'Request failed; retained records may not be current.' },
    invalid: { zh: '请填写有限非负容差，或有效且有序的上下限。', en: 'Enter a finite nonnegative tolerance, or finite ordered bounds.' },
    attempt: { zh: '运行记录（不可变）', en: 'Attempt history (immutable)' }, execution: { zh: '执行状态', en: 'Execution status' }, result: { zh: '单个结果判定', en: 'Single-result verdict' },
    reported: { zh: '论文值', en: 'Reported' }, actual: { zh: '实际值', en: 'Actual' }, difference: { zh: '差值', en: 'Difference' },
    independent: { zh: '独立数值核验', en: 'Independent numerical check' }, notChecked: { zh: '未核验', en: 'Not checked' },
    logs: { zh: '读取运行日志', en: 'Read attempt logs' }, export: { zh: '导出独立交接 ZIP', en: 'Export standalone handoff ZIP' },
    annotationMissing: { zh: '数值检查与证据回写不同：结果标注尚未确认保存，交接流程不完整。可查看日志定位原因。', en: 'Numerical verification and evidence write-back are separate: the result annotation has not been confirmed saved. The handoff workflow is incomplete; inspect the logs.' },
    archive: { zh: '包含原始 PDF、数据、冻结方案、运行证据与可独立运行的核验器。', en: 'Includes original PDF, data, frozen protocol, execution evidence and a standalone verifier.' },
  });
  const pendingKey = `pero.fisher.pending.${annotation.id}`;
  const [pending, setPending] = useState<Pending | null>(() => { try { return JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null'); } catch { return null; } });
  const [requestAbsent, setRequestAbsent] = useState(false);
  const [evidence, setEvidence] = useState<Evidence | null>(null), [itemId, setItemId] = useState(''), [attemptId, setAttemptId] = useState('');
  const [editing, setEditing] = useState(true), [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<Comparison['mode']>('absolute'), [tolerance, setTolerance] = useState('0.00005');
  const [lower, setLower] = useState(''), [upper, setUpper] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [logs, setLogs] = useState<{ attemptId: string; text: string } | null>(null);
  const alive = useRef(true), operation = useRef(false), reading = useRef(false);
  const selected = evidence?.items.find(row => row.itemId === itemId) ?? evidence?.items.at(-1);
  const chosen = selected?.attempts.find(row => row.attemptId === attemptId) ?? selected?.attempts.at(-1);
  const running = evidence?.items.some(row => row.attempts.some(attempt => !resolved(attempt)));
  const fail = (e: unknown) => { if (alive.current) setError(e instanceof Error ? e.message : String(e)); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function refresh() {
    if (reading.current) return;
    reading.current = true; setLoading(true);
    try {
      const value = await api.post<Evidence>(endpoint, { action: 'status', annotationId: annotation.id });
      if (!alive.current) return;
      setEvidence(value); setError('');
      const stored: Pending | null = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null');
      const receipt = stored && value.items.flatMap(row => row.attempts).find(attempt => attempt.execution.request_id === stored.requestId);
      setRequestAbsent(!!stored && !receipt);
      if (receipt && resolved(receipt)) { sessionStorage.removeItem(pendingKey); setPending(null); setRequestAbsent(false); }
      return value;
    } catch (e) { fail(e); }
    finally { reading.current = false; if (alive.current) setLoading(false); }
  }
  useEffect(() => { void refresh().then(value => { if (alive.current && value?.items.length) setEditing(false); }); }, [api, annotation.id]);
  async function freeze() {
    if (operation.current || !confirmed || pending || running) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const comparison: Comparison = mode === 'bounds' ? { mode, lower: Number(lower), upper: Number(upper) } : { mode, tolerance: Number(tolerance) };
      if ((mode === 'bounds' ? !lower.trim() || !upper.trim() : !tolerance.trim())
        || Object.values(comparison).some(v => typeof v === 'number' && !Number.isFinite(v))
        || ('tolerance' in comparison && comparison.tolerance < 0) || ('lower' in comparison && comparison.lower > comparison.upper)) throw Error(t('invalid'));
      const row = await api.post<{ itemId: string; spec: Protocol }>(endpoint, { action: 'freeze', annotationId: annotation.id, comparison, confirmed: true });
      if (!alive.current) return;
      setEvidence(previous => ({ case: previous?.case ?? '', scope: previous?.scope ?? '', preview: previous?.preview, data: previous?.data, items: [...(previous?.items.filter(i => i.itemId !== row.itemId) ?? []), { ...row, attempts: previous?.items.find(i => i.itemId === row.itemId)?.attempts ?? [] }] }));
      setItemId(row.itemId); setAttemptId(''); setEditing(false); setConfirmed(false);
      await refresh();
    } catch (e) { fail(e); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  async function run(recover = false) {
    if (operation.current || !selected || running || (pending && (!recover || !requestAbsent))) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const request = recover && pending ? pending : { requestId: crypto.randomUUID(), itemId: selected.itemId, specId: selected.spec.id };
      const { requestId } = request;
      // Persist before submitting so closing/reopening this panel cannot replay an uncertain request.
      sessionStorage.setItem(pendingKey, JSON.stringify(request)); setPending(request); setRequestAbsent(false);
      const attempt = await api.post<Attempt>(endpoint, { action: 'run', ...request, confirmed: true });
      if (!alive.current) return;
      setEvidence(previous => previous && ({ ...previous, items: previous.items.map(row => row.itemId !== request.itemId ? row : { ...row, attempts: [...row.attempts.filter(a => a.attemptId !== attempt.attemptId), attempt] }) }));
      setItemId(request.itemId); setAttemptId(attempt.attemptId);
      if (attempt.execution.request_id === requestId && resolved(attempt)) { sessionStorage.removeItem(pendingKey); setPending(null); }
      await refresh();
    } catch (e) { fail(e); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  async function readLogs() {
    if (!selected || !chosen) return;
    setError('');
    try {
      const value = await api.post<{ text: string }>(endpoint, { action: 'logs', itemId: selected.itemId, attemptId: chosen.attemptId });
      if (alive.current) setLogs({ attemptId: chosen.attemptId, text: value.text });
    } catch (e) { fail(e); }
  }
  async function exportArchive() {
    if (!selected || !chosen || operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/fisher/evidence-archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: selected.itemId, attemptId: chosen.attemptId }) });
      if (!response.ok) throw Error(await response.text());
      const bytes = await response.arrayBuffer();
      if (alive.current) downloadFile(`fisher-${chosen.attemptId.slice(0, 12)}.zip`, bytes, 'application/zip');
    } catch (e) { fail(e); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="pa-fisher-reproduction" aria-label={t('title')}>
    <h3>{t('title')}</h3><p>{t('scope')}</p>
    <Button variant="link" onClick={onSource}>{t('source')}</Button>
    {loading && <p role="status">{t('loading')}</p>}{busy && <p role="status">{t('working')}</p>}
    {error && <Feedback kind="error">{evidence && <span>{t('retained')} </span>}{error}</Feedback>}
    {!!pending && <Feedback kind="warning">{t('uncertain')}</Feedback>}
    {pending && requestAbsent && !running && <><p>{t('recoverHint')}</p><Button disabled={busy || loading} onClick={() => void run(true)}>{t('recover')}</Button></>}
    <Button variant="ghost" disabled={loading || busy} onClick={() => void refresh()}>{t('refresh')}</Button>
    {editing ? <div>
      <p>{t('data')}</p><p>{t('method')}</p><p>{t('budget')}</p>
      {evidence?.data && <Disclosure variant="inline" summary={t('observations')}><p>{evidence.data.location}</p><p>SHA-256: {evidence.data.sha256}</p><p>{t('scanCorrection')}</p><Table label={t('observations')} density="compact"><thead><tr><th scope="col">{t('species')}</th><th scope="col">{t('row')}</th><th scope="col">{t('length')}</th></tr></thead><tbody>{evidence.data.rows.map(row => <tr key={`${row.species}:${row.row}`}><td>{row.species}</td><td>{row.row}</td><td>{row.length_cm}</td></tr>)}</tbody></Table></Disclosure>}
      {evidence?.preview && <><p>Python {evidence.preview.python_version}</p><Disclosure variant="inline" summary={t('inputs')}><pre>{JSON.stringify(evidence.preview, null, 2)}</pre></Disclosure></>}
      <label>{t('comparison')}<Select label={t('comparison')} value={mode} onChange={v => { setMode(v as Comparison['mode']); setConfirmed(false); }} options={(['absolute', 'relative', 'bounds'] as const).map(value => ({ value, label: t(value) }))}/></label>
      {mode === 'bounds' ? <><label>{t('lower')}<Input type="number" step="any" value={lower} onChange={e => { setLower(e.target.value); setConfirmed(false); }}/></label><label>{t('upper')}<Input type="number" step="any" value={upper} onChange={e => { setUpper(e.target.value); setConfirmed(false); }}/></label></> : <label>{t('tolerance')}<Input type="number" step="any" min="0" value={tolerance} onChange={e => { setTolerance(e.target.value); setConfirmed(false); }}/></label>}
      <p>{t('rounding')}</p><label className="pa-fisher-confirm"><Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)}/>{t('confirm')}</label>
      <Button disabled={busy || loading || !evidence || !confirmed || !!pending || running} onClick={() => void freeze()}>{t('freeze')}</Button>
    </div> : <Button variant="ghost" disabled={busy || !!pending || running} onClick={() => { setEditing(true); setConfirmed(false); }}>{t('newProtocol')}</Button>}
    {selected && <>
      <label>{t('frozen')}<Select label={t('frozen')} value={selected.itemId} disabled={busy || !!pending} onChange={v => { setItemId(v); setAttemptId(''); }} options={evidence!.items.map(row => ({ value: row.itemId, label: `${row.spec.comparison.mode} · ${row.itemId.slice(0, 12)}` }))}/></label>
      <p>{selected.spec.metric} · {selected.spec.unit}</p><p>{JSON.stringify(selected.spec.comparison)}</p>
      <p>Python {selected.spec.python_version}</p>
      <Disclosure variant="inline" summary={t('inputs')}><pre>{JSON.stringify(selected.spec, null, 2)}</pre></Disclosure>
      <p>{t('budget')}</p><Button disabled={busy || loading || !!pending || running || editing} onClick={() => void run()}>{t(selected.attempts.length ? 'rerun' : 'run')}</Button>
      {!!selected.attempts.length && <label>{t('attempt')}<Select label={t('attempt')} value={chosen?.attemptId ?? ''} onChange={setAttemptId} options={selected.attempts.map(a => ({ value: a.attemptId, label: `${a.execution.status} · ${a.attemptId.slice(0, 12)}` }))}/></label>}
      {chosen && <section aria-label={t('result')}>
        <p>{t('execution')}: <strong>{chosen.execution.status}</strong></p>
        {chosen.execution.error && <Feedback kind="error">{chosen.execution.error}</Feedback>}
        <p>{t('result')}: <strong>{chosen.report?.result_verdict ?? 'INCONCLUSIVE'}</strong></p>
        <dl><dt>{t('reported')}</dt><dd>{chosen.report?.reported ?? selected.spec.reported}</dd><dt>{t('actual')}</dt><dd>{chosen.report?.actual ?? '—'}</dd><dt>{t('difference')}</dt><dd>{chosen.report?.difference ?? '—'}</dd></dl>
        {chosen.report?.reason && <p>{chosen.report.reason}</p>}
        <p>{t('independent')}: <strong>{chosen.independent?.numeric_recomputation ?? t('notChecked')}</strong></p>
        {chosen.independent?.independence && <p>{chosen.independent.independence}</p>}{chosen.independent?.reason && <p>{chosen.independent.reason}</p>}
        {chosen.report && (!chosen.annotation || chosen.report.annotation_status === 'failed' || chosen.report.workflow_status === 'incomplete') && <Feedback kind="warning">{t('annotationMissing')}</Feedback>}
        <p>{t('scope')}</p><Button variant="ghost" onClick={() => void readLogs()}>{t('logs')}</Button>
        {logs?.attemptId === chosen.attemptId && <pre tabIndex={0}>{logs.text}</pre>}
        {chosen.execution.status === 'completed' && chosen.report && <><Button disabled={busy} onClick={() => void exportArchive()}>{t('export')}</Button><p>{t('archive')}</p></>}
      </section>}
    </>}
  </section>;
}
