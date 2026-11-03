import React, { useEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Input, Textarea } from '@pero/app-sdk/ui';
import type { Api } from './types';
import type { OpenSourceEvidenceReport, SourceEvidenceReport, SourceObservation, SourceEvidenceLocation, SourceEvidenceMatch, DocumentEvidenceScope } from './research-types';

const labels = {
  title: { zh: '已记录证据', en: 'Recorded evidence' }, retry: { zh: '重新读取证据', en: 'Reload source reports' },
  loading: { zh: '正在读取证据…', en: 'Loading recorded evidence…' },
  empty: { zh: '尚无阅读证据。查看源码、图片或阅读正文后，可在此整理报告。', en: 'No reading evidence yet. Inspect source, images or paper text to collect evidence for a report.' },
  create: { zh: '用已记录证据创建报告', en: 'New report from recorded evidence' },
  include: { zh: '选择证据（{count}/64）', en: 'Include observed evidence ({count}/64)' },
  reportTitle: { zh: '报告标题', en: 'Report title' }, defaultTitle: { zh: '来源证据', en: 'Source evidence' },
  interpretation: { zh: '解读（可选，尚未验证）', en: 'Interpretation (optional; unresolved)' },
  save: { zh: '保存报告', en: 'Save source report' }, saving: { zh: '正在保存…', en: 'Saving…' },
  observations: { zh: '{count} 条证据', en: '{count} observations' },
  saved: { zh: '已保存的证据报告', en: 'Saved source evidence report' },
  unresolved: { zh: '证据已保存，解读尚未验证。', en: 'Saved evidence; interpretations remain unresolved.' },
  old: { zh: '这条旧对比未记录 PDF 标识，请重新对比。', en: 'This older comparison has no PDF identity. Repeat it to obtain verifiable evidence.' },
  unavailable: { zh: '原始文件不可用，请先恢复相同版本。', en: 'Original unavailable. Restore its exact version before rereading.' },
  open: { zh: '查看原始证据', en: 'Open original evidence' },
  openDocument: { zh: '查看记录的 {unit} {start}–{end}', en: 'Open recorded {unit} {start}–{end}' },
  visual: { zh: '提供图片预览不代表已完成视觉检查。', en: 'Preview delivery is not visual review.' },
  match: { zh: '第 {start}–{end} 行 → PDF 第 {page} 页', en: 'Lines {start}–{end} → PDF page {page}' },
  source: { zh: '查看对应源码', en: 'Open matched source' }, pdf: { zh: '查看 PDF 第 {page} 页', en: 'Open report PDF page {page}' },
  identity: { zh: '证据标识与限制', en: 'Evidence identity and limits' }, interpretations: { zh: '尚未验证的解读', en: 'Unresolved interpretations' },
  html: { zh: '原始 HTML，字符 {start}–{end}，原始标记', en: 'Original HTML, characters {start}–{end}, raw markup' },
  structured: { zh: '{unit} {block}，{start}–{end}', en: 'Structured {unit} {block}, {start}–{end}' },
  text: { zh: '{path}，第 {startLine}–{endLine} 行，字符 {start}–{end}', en: '{path}, lines {startLine}–{endLine}, characters {start}–{end}' },
  image: { zh: '{path}，已提供预览', en: '{path}, preview supplied' },
  matches: { zh: '源码 / PDF 对比，{count} 处文本匹配', en: 'Source / PDF comparison, {count} literal matches' },
  noMatch: { zh: '源码 / PDF 对比，尚未确认匹配', en: 'Source / PDF comparison, unresolved' },
};

export function SourceReports({ api, bundleId, refresh, navigating, canOpenSource, openSource, canOpenPdf, openPdf, canOpenDocument, openDocument }: {
  api: Api; bundleId: string; refresh: number; navigating: boolean;
  canOpenSource(observation: SourceObservation, location: SourceEvidenceLocation): boolean;
  openSource(observation: SourceObservation, location: SourceEvidenceLocation): void;
  canOpenPdf(observation: SourceObservation): boolean;
  openPdf(observation: SourceObservation, match: SourceEvidenceMatch): void;
  canOpenDocument?(observation: SourceObservation, scope: DocumentEvidenceScope): boolean;
  openDocument?(observation: SourceObservation, scope: DocumentEvidenceScope): void;
}) {
  const { t } = useAppI18n(labels);
  function observationLabel(observation: SourceObservation) {
    const anchor = observation.anchor;
    if (observation.kind === 'scientific_document') return (anchor.documentScopes ?? []).map(scope => t(scope.unit === 'original-html' ? 'html' : 'structured', { unit: scope.unit, block: scope.blockId, start: scope.start, end: scope.end })).join('; ');
    if (observation.kind === 'source_text') return t('text', { path: anchor.memberPath ?? '', startLine: anchor.startLine ?? '', endLine: anchor.endLine ?? '', start: anchor.start ?? '', end: anchor.end ?? '' });
    if (observation.kind === 'source_image') return t('image', { path: anchor.memberPath ?? '' });
    return t(anchor.status === 'matched' ? 'matches' : 'noMatch', { count: anchor.matches?.length ?? 0 });
  }
  const [observations, setObservations] = useState<SourceObservation[]>([]), [reports, setReports] = useState<SourceEvidenceReport[]>([]);
  const [selected, setSelected] = useState<string[]>([]), [title, setTitle] = useState(''), [interpretation, setInterpretation] = useState('');
  const [opened, setOpened] = useState<OpenSourceEvidenceReport | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const mounted = useRef(true), epoch = useRef(0);
  const request = <T,>(input: Record<string, unknown>) => api.post<T>('/api/research/source-report', { bundleId, ...input });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useEffect(() => { epoch.current++; setOpened(null); setSelected([]); setTitle(''); setInterpretation(''); setBusy(false); }, [bundleId]);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    Promise.all([request<{ observations: SourceObservation[] }>({ operation: 'observations' }), request<{ reports: SourceEvidenceReport[] }>({ operation: 'list' })])
      .then(([evidence, saved]) => {
        if (!alive) return;
        setObservations(evidence.observations); setReports(saved.reports);
        setSelected(ids => ids.filter(id => evidence.observations.some(item => item.id === id)));
      }, reason => { if (alive) setError(String(reason)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, bundleId, refresh, attempt]);
  async function openOrSave(reportId?: string) {
    if (busy) return;
    const version = ++epoch.current; setBusy(true); setError('');
    try {
      const result = await request<OpenSourceEvidenceReport>(reportId ? { operation: 'read', reportId } : {
        operation: 'create', title: title.trim() || t('defaultTitle'), observationIds: selected,
        interpretations: interpretation.trim() ? [interpretation.trim()] : [],
      });
      if (mounted.current && version === epoch.current) { setOpened(result); setAttempt(value => value + 1); }
    } catch (reason) { if (mounted.current && version === epoch.current) setError(String(reason)); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  return <section className="pa-source-reports" aria-label={t('title')}>
    <h4>{t('title')}</h4>
    {error && <Feedback kind="error">{error}<Button disabled={busy || loading} onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button></Feedback>}
    {loading && <p role="status">{t('loading')}</p>}
    {!loading && !observations.length ? <p>{t('empty')}</p> : !!observations.length && <details>
      <summary>{t('create')}</summary>
      <fieldset disabled={busy || loading}><legend>{t('include', { count: selected.length })}</legend>
        {observations.map(item => <label key={item.id} className="pa-source-report-choice"><input type="checkbox" disabled={selected.length >= 64 && !selected.includes(item.id)} checked={selected.includes(item.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))}/><span>{observationLabel(item)}</span></label>)}
      </fieldset>
      <label>{t('reportTitle')}<Input value={title} maxLength={200} placeholder={t('defaultTitle')} disabled={busy} onChange={event => setTitle(event.target.value)}/></label>
      <label>{t('interpretation')}<Textarea value={interpretation} maxLength={1000} rows={2} disabled={busy} onChange={event => setInterpretation(event.target.value)}/></label>
      <Button disabled={busy || loading || !selected.length} onClick={() => void openOrSave()}>{t(busy ? 'saving' : 'save')}</Button>
    </details>}
    {!!reports.length && <ul className="pa-source-report-list">{reports.map(report => <li key={report.id}><Button variant="ghost" disabled={busy} aria-pressed={opened?.id === report.id} onClick={() => void openOrSave(report.id)}>{report.title}</Button><small>{t('observations', { count: report.observationIds.length })}</small></li>)}</ul>}
    {opened && <article aria-label={t('saved')}><h4>{opened.title}</h4><p role="status">{t('unresolved')}</p>
      <ul>{opened.observations.map(item => <li key={item.id}><strong>{observationLabel(item)}</strong>
        {opened.currentAvailability.find(value => value.observationId === item.id)?.available === false && <Feedback>{opened.currentAvailability.find(value => value.observationId === item.id)?.reason === 'comparison_scope_unrecorded' ? t('old') : t('unavailable')}</Feedback>}
        {(item.kind === 'source_text' || item.kind === 'source_image') && canOpenSource(item, item.anchor) && <Button disabled={busy || navigating || !opened.currentAvailability.find(value => value.observationId === item.id)?.available} onClick={() => openSource(item, item.anchor)}>{t('open')}</Button>}
        {item.anchor.documentScopes?.map((scope, index) => canOpenDocument?.(item, scope) && openDocument && <Button key={`document:${index}`} disabled={busy || navigating || !opened.currentAvailability.find(value => value.observationId === item.id)?.available} onClick={() => openDocument(item, scope)}>{t('openDocument', { unit: scope.unit, start: scope.start, end: scope.end })}</Button>)}
        {item.anchor.visualReview === 'not_reviewed' && <p>{t('visual')}</p>}
        {!!item.anchor.matches?.length && <ul>{item.anchor.matches.map((match, index) => <li key={index}>{match.source.memberPath}, {t('match', { start: match.source.startLine ?? '', end: match.source.endLine ?? '', page: match.pdf.page })}
          <div className="pa-actions">{canOpenSource(item, match.source) && <Button disabled={busy || navigating || !opened.currentAvailability.find(value => value.observationId === item.id)?.available} onClick={() => openSource(item, match.source)}>{t('source')}</Button>}
          {canOpenPdf(item) && <Button disabled={busy || navigating || !opened.currentAvailability.find(value => value.observationId === item.id)?.available} onClick={() => openPdf(item, match)}>{t('pdf', { page: match.pdf.page })}</Button>}</div>
        </li>)}</ul>}
        <details><summary>{t('identity')}</summary><pre className="pa-source-text">{JSON.stringify(item.anchor, null, 2)}</pre><ul>{item.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></details>
      </li>)}</ul>
      {!!opened.interpretations.length && <section aria-label={t('interpretations')}><h4>{t('interpretations')}</h4>{opened.interpretations.map((item, index) => <p key={index}>{item.text}</p>)}</section>}
    </article>}
  </section>;
}
