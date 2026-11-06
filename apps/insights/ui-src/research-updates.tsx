import { useAppInfo, useAppI18n, useNavigate } from '@pero/app-sdk';
import { Button, Feedback } from '@pero/app-sdk/ui';
import { useEffect, useState } from 'react';

type Input = { subject: string; name: string; status: 'changed' | 'unchanged' | 'unknown' | 'unsupported'; latest: string | null };
type Check = { researchRecordId: string; checkedAt: number; error?: string; result?: {
  question: string; papers: Input[]; datasets: Input[]; affectedAttempts: unknown[]; affectedReportIds: string[];
} };

export function ResearchUpdates() {
  const { active } = useAppInfo(), navigate = useNavigate();
  const { t } = useAppI18n({
    title: { en: 'Research updates', zh: '研究更新' }, refresh: { en: 'Refresh', zh: '刷新' },
    openPaper: { en: 'Open Paper', zh: '打开 Paper' },
    refreshing: { en: 'Updating checks…', zh: '正在更新检查…' },
    loading: { en: 'Loading checks…', zh: '正在加载检查…' },
    empty: { en: 'No research checks yet. Start one from a saved Paper record.', zh: '暂无研究检查。可从已保存的 Paper 记录发起。' },
    unknown: { en: 'Latest could not be verified', zh: '无法确认最新版本' }, unsupported: { en: 'No upstream resolver', zh: '暂无上游解析方式' },
    unchanged: { en: 'Up to date', zh: '版本一致' }, changed: { en: 'Update available', zh: '有更新' },
    affected: { en: 'Linked results to review', zh: '需要复核的关联结果' }, failed: { en: 'Research check failed', zh: '研究检查失败' },
  });
  const [updates, setUpdates] = useState<Check[]>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setError(''); setBusy(true);
    fetch('/host/automation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ method: 'GET', path: '/api/research-watch' }) }).then(async response => {
        if (!response.ok) throw Error(await response.text());
        const value = await response.json();
        if (value.status !== 200) throw Error(value.body?.error);
        if (!controller.signal.aborted) setUpdates(value.body.updates);
      }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [active, refresh]);
  return <section className="point-research-updates" aria-label={t('title')}>
    <header><h2>{t('title')}</h2>
    <Button variant="ghost" onClick={() => void navigate('/apps/paper-agent')}>{t('openPaper')}</Button>
    <Button variant="ghost" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{t('refresh')}</Button></header>
    {busy && updates && <p role="status">{t('refreshing')}</p>}
    {error && <Feedback kind="error">{error}</Feedback>}
    {!updates && !error && <p role="status">{t('loading')}</p>}
    {updates?.length === 0 && !error && !busy && <p>{t('empty')}</p>}
    {!!updates?.length && <ul>{updates.map(update => <li key={update.researchRecordId}>
      <strong>{update.result?.question ?? t('failed')}</strong>{' '}
      <time>{new Date(update.checkedAt * 1000).toLocaleString()}</time>
      {update.error && <p>{update.error}</p>}
      {update.result && <>
        <ul>{[...update.result.papers, ...update.result.datasets].map(input => <li key={input.subject}>
          {input.name} — {t(input.status)}{input.status === 'changed' && input.latest ? ` (${input.latest.slice(0, 16)})` : ''}
        </li>)}</ul>
        {!!(update.result.affectedAttempts.length || update.result.affectedReportIds.length) &&
          <p>{t('affected')} ({update.result.affectedAttempts.length + update.result.affectedReportIds.length})</p>}
      </>}
    </li>)}</ul>}
  </section>;
}
