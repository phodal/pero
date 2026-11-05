import React, { useEffect, useState } from 'react';
import { Button, Feedback } from '@pero/app-sdk/ui';
import { useAppI18n } from '@pero/app-sdk';
import type { ResearchAttempt } from './manual-records';
import type { Report } from './types';

export type DataPin = { datasetId: string; versionId: string; name: string; sha256: string };
export type Dataset = { datasetId: string; name: string; archived: boolean;
  versions: { versionId: string; sha256: string; availability: string }[] };
type Version = { subject: string; name: string; pinned: string | null; latest: string | null; status: 'changed' | 'unchanged' | 'unknown' | 'unsupported' };
type Check = { checkedAt: string; papers: Version[]; datasets: Version[]; affectedReportIds: string[]; affectedAttempts: ResearchAttempt[] };
type Overview = { watches: { recordId: string; scheduled: boolean; running: boolean; next?: string }[];
  updates: { researchRecordId: string; result: Check | null; error: string | null }[]; fault?: string };

export async function researchHost<T>(route: 'research-assets' | 'automation', body: unknown): Promise<T> {
  const response = await fetch(`/host/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  const value = await response.json();
  if (route !== 'automation') return value as T;
  if (value.status !== 200) throw new Error(value.body?.error ?? 'Research check unavailable');
  return value.body as T;
}

export function ResearchWatch({ recordId, versions, reports, onAttempt }: { recordId: string; versions: DataPin[];
  reports: Report[]; onAttempt(attempt: ResearchAttempt): void }) {
  const { t } = useAppI18n({
    title: { en: 'Research updates', zh: '研究更新' }, loading: { en: 'Loading checks…', zh: '正在加载检查…' },
    check: { en: 'Check now', zh: '立即检查' }, daily: { en: 'Check daily', zh: '每天检查' },
    pause: { en: 'Pause checks', zh: '暂停检查' }, schedule: { en: 'Checks run while Pero is open.', zh: 'Pero 打开时执行检查。' },
    empty: { en: 'No check has finished.', zh: '暂无完成的检查。' }, running: { en: 'Checking research inputs…', zh: '正在检查研究输入…' },
    retry: { en: 'Reload', zh: '重新加载' }, changed: { en: 'Update available', zh: '有更新' },
    unchanged: { en: 'Up to date', zh: '版本一致' }, unknown: { en: 'Could not verify latest', zh: '无法确认最新版本' },
    unsupported: { en: 'No upstream resolver', zh: '暂无上游解析方式' }, reports: { en: 'Affected reports', zh: '受影响的报告' },
    attempts: { en: 'Affected verification attempts', zh: '受影响的验证记录' },
    unavailable: { en: 'Saved report reference', zh: '已保存的报告引用' },
  });
  const [value, setValue] = useState<Overview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const watch = value?.watches.find(item => item.recordId === recordId);
  const update = value?.updates.find(item => item.researchRecordId === recordId);
  const request = (operation?: string) => researchHost<Overview>('automation', { method: operation ? 'POST' : 'GET',
    path: '/api/research-watch', body: operation ? { recordId, operation } : null });
  async function refresh(operation?: string) {
    setBusy(true); setError('');
    try { setValue(await request(operation)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [recordId]);
  useEffect(() => {
    if (!watch?.running || error) return;
    const timer = setTimeout(() => void refresh(), 800);
    return () => clearTimeout(timer);
  }, [value, error]);
  return <section aria-label={t('title')}>
    <h3>{t('title')}</h3>
    {!!versions.length && <ul>{versions.map(version => <li key={version.datasetId}>{version.name} ({version.versionId.slice(0, 8)})</li>)}</ul>}
    <div className="pa-actions">
      <Button disabled={busy || !!watch?.running} onClick={() => void refresh('check')}>{t('check')}</Button>
      <Button disabled={busy} onClick={() => void refresh(watch?.scheduled ? 'pause' : 'schedule')}>{t(watch?.scheduled ? 'pause' : 'daily')}</Button>
    </div>
    {watch?.scheduled && <p className="pa-muted">{t('schedule')} {watch.next && <time dateTime={watch.next}>{new Date(watch.next).toLocaleString()}</time>}</p>}
    {(error || value?.fault || update?.error) && <Feedback kind="error">{error || value?.fault || update?.error}
      <Button disabled={busy} onClick={() => void refresh()}>{t('retry')}</Button></Feedback>}
    {!value && busy && <p role="status">{t('loading')}</p>}
    {watch?.running && <p role="status">{t('running')}</p>}
    {value && !update && !watch?.running && <p>{t('empty')}</p>}
    {update?.result && <>
      <time dateTime={update.result.checkedAt}>{new Date(update.result.checkedAt).toLocaleString()}</time>
      <ul>{[...update.result.papers, ...update.result.datasets].map(row => <li key={row.subject}>
        <strong>{row.name}</strong> {t(row.status)}
        {row.status === 'changed' && row.latest && (/^(?:[a-z.-]+\/)?\d+(?:\.\d+)?v\d+$/.test(row.latest)
          ? <a href={`https://arxiv.org/abs/${row.latest}`} target="_blank" rel="noreferrer"> {row.latest}</a>
          : <span> ({row.latest.slice(0, 8)})</span>)}
      </li>)}</ul>
      {!!update.result.affectedReportIds.length && <><h4>{t('reports')}</h4><ul>{update.result.affectedReportIds.map(id => <li key={id}>
        {reports.find(report => report.id === id)?.title ?? t('unavailable')}
      </li>)}</ul></>}
      {!!update.result.affectedAttempts.length && <><h4>{t('attempts')}</h4><ul>{update.result.affectedAttempts.map(attempt => <li key={`${attempt.itemId}/${attempt.attemptId}`}>
        <Button variant="ghost" onClick={() => onAttempt(attempt)}>{attempt.profile} / {attempt.policy} / {attempt.attemptId.slice(0, 8)}</Button>
      </li>)}</ul></>}
    </>}
  </section>;
}
