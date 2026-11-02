import React, { useEffect, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Dialog, Feedback, Toolbar } from '@pero/app-sdk/ui';
import type { Api } from './types';
import type { ResearchBundle } from './research-types';

export type ReadingSource = { bundleId: string; resourceId: string; url: string; revision: string; authorized: boolean; reviewUrl: string };
type Review = { status: string; draftId: string; reviewId?: string; version?: string; htmlUrl?: string; texUrl?: string | null; warnings?: string[]; error?: string };
type Selection = { bundle: ResearchBundle; source: ReadingSource; sourceIds: string[] };

export function ArxivReading({ api, paperId, onPrepare, onClose }: { api: Api; paperId: string; onPrepare(source: ReadingSource): Promise<void>; onClose(): void }) {
  const { t } = useAppI18n({
    sources: { zh: 'arXiv 阅读来源', en: 'arXiv reading sources' },
    checking: { zh: '检查版本…', en: 'Checking version…' },
    retry: { zh: '重试', en: 'Retry' },
    scope: { zh: '官方 HTML，最多 8 MiB。实际大小和许可未确认。', en: 'Official HTML, up to 8 MiB. Actual size and license unknown.' },
    tex: { zh: '附带 TeX 源码（最多 16 MiB，大小和许可未知）', en: 'Include TeX source (up to 16 MiB; size and license unknown)' },
    download: { zh: '下载并排版', en: 'Download and format' },
    failed: { zh: '排版失败', en: 'Formatting failed' },
    close: { zh: '关闭来源检查', en: 'Close source review' },
  });
  const [review, setReview] = useState<Review | null>(null), [selection, setSelection] = useState<Selection | null>(null);
  const [tex, setTex] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const endpoint = `/api/papers/${paperId}/reading`;
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>;
    setReview(null); setError('');
    async function inspect(draftId?: string) {
      try {
        const value = await api.post<Review>(endpoint, { operation: 'review', ...(draftId ? { draftId } : attempt > 0 ? { refresh: true } : {}) });
        if (!alive) return;
        setReview(value);
        if (value.status === 'inspecting') timer = setTimeout(() => void inspect(value.draftId), 700);
      } catch (error) { if (alive) setError(error instanceof Error ? error.message : String(error)); }
    }
    void inspect();
    return () => { alive = false; clearTimeout(timer); };
  }, [api, endpoint, attempt]);
  async function confirm() {
    if (!review || busy) return;
    setBusy(true); setError('');
    try {
      const value = await api.post<Selection>(endpoint, { operation: 'confirm', draftId: review.draftId, reviewId: review.reviewId, tex, confirmedDownloads: true });
      setSelection(value);
      for (const resourceId of value.sourceIds) await api.post('/api/research/source', { operation: 'start', bundleId: value.bundle.id, resourceId });
      await onPrepare(value.source);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <Dialog className="pa-reading-review-dialog" title={review?.version ? `arXiv ${review.version}` : t('sources')} closeLabel={t('close')} onClose={onClose} size="sm">
    {!review && !error || review?.status === 'inspecting' ? <p role="status">{t('checking')}</p> : null}
    {(error || review?.error) && <Feedback kind="error">{error || review?.error}<Button disabled={busy} onClick={() => selection ? void onPrepare(selection.source) : setAttempt(value => value + 1)}>{t('retry')}</Button></Feedback>}
    {review?.status === 'ready' && !selection && <>
      <a href={review.htmlUrl} target="_blank" rel="noreferrer">arXiv {review.version} HTML</a>
      <p className="pa-document-meta">{t('scope')}</p>
      {review.texUrl && <label><Checkbox checked={tex} disabled={busy} onCheckedChange={checked => setTex(checked === true)}/>{t('tex')}</label>}
      <Toolbar><Button variant="primary" busy={busy} onClick={() => void confirm()}>{t('download')}</Button></Toolbar>
    </>}
  </Dialog>;
}
