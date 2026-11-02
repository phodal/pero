import React, { useEffect, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Disclosure, Feedback, Toolbar } from '@pero/app-sdk/ui';
import type { Api } from './types';
import type { ResearchBundle } from './research-types';
import { ResearchSources } from './research-sources';

export type ReadingSource = { bundleId: string; resourceId: string; url: string; revision: string; authorized: boolean; reviewUrl: string };
type Review = { status: string; draftId: string; reviewId?: string; version?: string; htmlUrl?: string; texUrl?: string | null; warnings?: string[]; error?: string };
type Selection = { bundle: ResearchBundle; source: ReadingSource; sourceIds: string[] };

export function ArxivReading({ api, paperId, onPrepare }: { api: Api; paperId: string; onPrepare(source: ReadingSource): Promise<void> }) {
  const { t } = useAppI18n({
    sources: { zh: 'arXiv 阅读来源', en: 'arXiv reading sources' },
    checking: { zh: '正在检查 arXiv 版本和阅读来源…', en: 'Checking arXiv version and reading sources…' },
    retry: { zh: '重试', en: 'Retry' },
    scope: { zh: '下载官方 HTML 并排版（最多 8 MiB）；许可和实际大小未知。PDF 引用仍定位到原 PDF。', en: 'Download and format official HTML (up to 8 MiB); license and actual size unknown. PDF citations keep their original PDF locations.' },
    tex: { zh: '同时下载此版本的 TeX 源码（最多 16 MiB，许可和大小未知）', en: 'Also download this version’s TeX source (up to 16 MiB; license and size unknown)' },
    download: { zh: '下载并排版', en: 'Download and format' },
    preparing: { zh: '正在准备正文…', en: 'Preparing reading…' },
    sourceFiles: { zh: 'TeX 源码', en: 'TeX source files' },
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
      await onPrepare(value.source);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section aria-label={t('sources')}>
    {!review && !error || review?.status === 'inspecting' ? <p role="status">{t('checking')}</p> : null}
    {(error || review?.error) && <Feedback kind="error">{error || review?.error}<Button disabled={busy} onClick={() => selection ? void onPrepare(selection.source) : setAttempt(value => value + 1)}>{t('retry')}</Button></Feedback>}
    {review?.status === 'ready' && !selection && <>
      <p><a href={review.htmlUrl} target="_blank" rel="noreferrer">arXiv {review.version} HTML</a></p>
      <p className="pa-document-meta">{t('scope')}</p>
      {review.texUrl && <label><Checkbox checked={tex} disabled={busy} onCheckedChange={setTex}/>{t('tex')}</label>}
      {review.warnings?.map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
      <Toolbar><Button variant="primary" busy={busy} onClick={() => void confirm()}>{t('download')}</Button></Toolbar>
    </>}
    {selection && <>
      {busy && <p role="status">{t('preparing')}</p>}
      {selection.sourceIds.length > 0 && <Disclosure summary={t('sourceFiles')}><ResearchSources api={api} bundle={selection.bundle} startSourceIds={selection.sourceIds} scopedIds={selection.sourceIds} onRead={() => {}}/></Disclosure>}
    </>}
  </section>;
}
