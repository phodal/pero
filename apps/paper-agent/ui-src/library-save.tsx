import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Feedback } from '@pero/app-sdk/ui';
import type { Api, Paper } from './types';
import type { Translator } from './i18n';
import { assetSize, type ResearchBundle } from './research-types';
import { ResearchSources } from './research-sources';
import { ResearchPdfDownloads } from './research-pdf-downloads';
import './library-save.css';

type FileOption = { available: boolean; cached?: boolean; resourceId?: string; url?: string; reason?: string; license: string | null; size: number | null };
type FileReview = {
  status: 'inspecting' | 'ready' | 'failed' | 'cancelled'; draftId?: string; reviewId?: string;
  paperId: string; documentId: string | null; version: string | null;
  pdf: FileOption; tex: FileOption; warnings: string[]; error?: string;
};
type FileSelection = {
  paperId: string; bundleId: string | null; bundle: ResearchBundle | null;
  pdfResourceId: string | null; sourceResourceId: string | null; documentId: string | null;
};

/** A review of copies only. Download state and consent remain with the source owners. */
export function LibrarySave({ api, paper, t, onClose, onSaved, onRead, onError }: {
  api: Api; paper: Paper; t: Translator; onClose(): void; onSaved(): Promise<void>; onRead(id: string): void; onError(error: unknown): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), mounted = useRef(true);
  const [review, setReview] = useState<FileReview | null>(null), [selection, setSelection] = useState<FileSelection | null>(null);
  const [tex, setTex] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0), [sourceReady, setSourceReady] = useState(false), [sourceSettled, setSourceSettled] = useState(false), [pdfReady, setPdfReady] = useState(false), [sourceEnabled, setSourceEnabled] = useState(false), [saved, setSaved] = useState('');
  const sourceState = useCallback(({ settled, available }: { settled: boolean; available: boolean }) => { setSourceSettled(settled); setSourceReady(available); }, []);
  const pdfState = useCallback((available: boolean) => { setPdfReady(available); if (available) setSourceEnabled(true); }, []);
  const endpoint = `/api/papers/${encodeURIComponent(paper.id)}/files`;
  useEffect(() => {
    mounted.current = true; dialog.current?.showModal();
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let alive = true, inspectingDraft: string | undefined, timer: ReturnType<typeof setTimeout>;
    setError(''); setReview(null);
    async function prepare(draftId?: string) {
      try {
        const value = await api.post<FileReview>(endpoint, { operation: 'prepare', ...(draftId ? { draftId } : {}) });
        if (!alive) {
          if (value.status === 'inspecting' && value.draftId) void api.post('/api/research/inspect', { draftId: value.draftId, cancel: true }).catch(onError);
          return;
        }
        inspectingDraft = value.status === 'inspecting' ? value.draftId : undefined;
        setReview(value);
        if (value.status === 'inspecting' && value.draftId) timer = setTimeout(() => void prepare(value.draftId), 700);
      } catch (error) { if (alive) setError(error instanceof Error ? error.message : String(error)); }
    }
    void prepare();
    return () => {
      alive = false; clearTimeout(timer);
      if (inspectingDraft) void api.post('/api/research/inspect', { draftId: inspectingDraft, cancel: true }).catch(onError);
    };
  }, [api, endpoint, attempt]);
  function close() { if (!busy) onClose(); }
  async function confirm() {
    if (!review || busy) return;
    setBusy(true); setError('');
    try {
      const value = await api.post<FileSelection>(endpoint, { operation: 'confirm', draftId: review.draftId, reviewId: review.reviewId, pdf: true, tex, confirmedDownloads: true });
      if (mounted.current) { setSelection(value); setSourceReady(!value.sourceResourceId); setSourceSettled(!value.sourceResourceId); setPdfReady(!value.pdfResourceId); setSourceEnabled(!value.pdfResourceId); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function exportCopies() {
    if (!selection || busy) return;
    setBusy(true); setError('');
    try {
      const { bundleId, pdfResourceId, sourceResourceId, documentId } = selection;
      const result = await api.post<{ pdf: string; tex?: string; texNote?: string }>(endpoint, { operation: 'export', bundleId, pdfResourceId, sourceResourceId, documentId });
      if (mounted.current) setSaved(`${result.tex ? t('paperSavedWithTex') : t('paperSaved')}${result.texNote && result.texNote !== 'no-tex' ? ` (${result.texNote})` : ''}`);
      await onSaved();
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="pa-library-save" aria-labelledby="pa-save-title" onCancel={event => { event.preventDefault(); void close(); }}>
    <header><h2 id="pa-save-title">{t('saveCopies')}</h2><Button variant="ghost" disabled={busy} onClick={() => void close()}>{t('close')}</Button></header>
    <p>{paper.title}</p>
    {error && <Feedback kind="error">{error}</Feedback>}
    {!selection && <>
      {(!review || review.status === 'inspecting') && !error && <p role="status">{t('saveInspecting')}</p>}
      {(error || review?.status === 'failed' || review?.status === 'cancelled') && <><p>{review?.error}</p><Button disabled={busy} onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button></>}
      {review?.status === 'ready' && <>
        <p>{t('saveVersion')}: {review.version || t('saveUnknown')}</p>
        {review.warnings.map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
        <ul className="pa-save-options">{(['pdf', 'tex'] as const).map(kind => {
          const option = review[kind];
          return <li key={kind}><label><Checkbox checked={kind === 'pdf' || tex} disabled={busy || kind === 'pdf' || !option.available} onCheckedChange={checked => setTex(checked === true)}/>{kind === 'pdf' ? 'PDF' : 'TeX'}</label>
            <span>{t('saveLicense')}: {option.license || t('saveUnknown')} / {assetSize(option.size)}</span>
            {option.reason && !review.warnings.includes(option.reason) && <p>{option.reason}</p>}</li>;
        })}</ul>
        <p className="pa-muted">{t('saveScope')}</p>
        <div className="pa-actions"><Button disabled={busy} onClick={() => void close()}>{t('saveCancel')}</Button><Button variant="primary" busy={busy} disabled={!review.pdf.available || busy} onClick={() => void confirm()}>{t('saveConfirm')}</Button></div>
      </>}
    </>}
    {selection && <>
      {selection.bundle && <>
        {sourceEnabled && selection.sourceResourceId && <ResearchSources api={api} bundle={selection.bundle} startSourceIds={[selection.sourceResourceId]} scopedIds={[selection.sourceResourceId]} onState={sourceState} onRead={onRead}/>}
        {selection.pdfResourceId && <ResearchPdfDownloads api={api} bundle={selection.bundle} startPdfIds={[selection.pdfResourceId]} scopedIds={[selection.pdfResourceId]} onAvailable={pdfState} onRead={onRead}/>}
      </>}
      {saved && <p role="status">{saved}</p>}
      <Button variant="primary" busy={busy} disabled={busy || !sourceSettled || !pdfReady} onClick={() => void exportCopies()}>{t(sourceReady ? 'saveExport' : 'saveExportPdf')}</Button>
      <p className="pa-muted">{t('saveNotRead')} {t('saveCloseJobs')}</p>
    </>}
  </dialog>;
}
