import React, { useEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Feedback } from '@pero/app-sdk/ui';
import type { Api, Paper } from './types';
import type { Translator } from './i18n';
import { downloadPaperFiles, type DownloadFormat, type DownloadStage, type SavedFiles } from './library-download';
import './library-save.css';

/** Download progress stays in the workspace; source checks remain with their owners. */
export function LibrarySave({ api, paper, format = 'pdf', t, onClose, onSaved, onRead }: {
  api: Api; paper: Paper; format?: DownloadFormat; t: Translator; onClose(): void; onSaved(): Promise<void>; onRead(id: string): void;
}) {
  const { t: copy } = useAppI18n({
    preparing: { zh: '正在准备下载…', en: 'Preparing download…' },
    pdf: { zh: '正在下载 PDF…', en: 'Downloading PDF…' }, tex: { zh: '正在下载 TeX…', en: 'Downloading TeX…' },
    saving: { zh: '正在保存…', en: 'Saving…' },
    complete: { zh: '下载完成', en: 'Downloaded' }, cancel: { zh: '取消下载', en: 'Cancel download' },
  });
  const controller = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<DownloadStage>('preparing'), [saved, setSaved] = useState<SavedFiles | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    const cancellation = new AbortController(); controller.current = cancellation;
    setSaved(null); setError(''); setStage('preparing');
    void downloadPaperFiles(api, paper, format, cancellation.signal, value => { if (alive) setStage(value); },
      async () => { if (alive) await onSaved(); })
      .then(value => { if (alive) setSaved(value); })
      .catch(error => { if (alive && !cancellation.signal.aborted) setError(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; cancellation.abort(); };
  }, [api, paper.id, format, attempt]);
  function close() { controller.current?.abort(); onClose(); }
  return <section className="pa-library-download" aria-label={t('downloadPaper')}>
    <span className="pa-download-title">{paper.title}</span>
    {error ? <Feedback kind="error">{error}<Button onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button></Feedback>
      : <span role="status">{saved ? copy('complete') : copy(stage)}</span>}
    {saved?.warnings?.map(warning => <Feedback key={warning}>{warning}</Feedback>)}
    {saved && <><span title={saved.tex || saved.pdf}>{saved.tex ? 'PDF + TeX' : 'PDF'}</span><Button onClick={() => onRead(paper.id)}>{t('readSource')}</Button></>}
    <Button variant="ghost" onClick={close}>{saved || error ? t('close') : copy('cancel')}</Button>
  </section>;
}
