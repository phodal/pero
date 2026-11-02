import React, { useEffect, useRef, useState } from 'react';
import { Button, Feedback } from '@pero/app-sdk/ui';
import type { Api } from './types';
import { assetSize, type ResearchBundle } from './research-types';

type PdfDownload = {
  id: string; bundleId: string; resourceId: string;
  status: 'not_started' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unavailable';
  stage: 'discovered' | 'downloading' | 'parsing' | 'readable' | 'unavailable'; error: string; readPages?: number[]; localAvailable?: boolean; restoredAt?: string | null; restoreFinalUrl?: string | null;
  receipt: null | {
    sourcePageUrl: string; requestUrl: string; finalUrl: string; fetchedAt: string;
    fileDigest: string; size: number; pageCount: number; documentId: string; paperId: string;
    explicitVersion: string; textPages: number; textCharacters: number; extractionWarnings?: string[]; workIdentity: string | null; identityStatus: 'unresolved';
  };
};

/** Project saved consent and Paper's PDF lifecycle; never infer consent from a link. */
export function ResearchPdfDownloads({ api, bundle, startPdfIds, onRead, waitForSources = false, onAvailable }: {
  api: Api; bundle: ResearchBundle; startPdfIds: string[]; waitForSources?: boolean; onAvailable?(available: boolean): void; onRead(id: string): void;
}) {
  const resources = bundle.resources.filter(resource => resource.kind === 'pdf_candidate' && bundle.pdfDownloadIds?.includes(resource.id));
  const [values, setValues] = useState<Record<string, PdfDownload>>({});
  const [queue, setQueue] = useState(() => startPdfIds.filter(id => resources.some(resource => resource.id === id)));
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), pending = useRef(false), epoch = useRef(0);
  const running = resources.find(resource => values[resource.id]?.status === 'running');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const request = (operation: 'start' | 'status' | 'cancel', resourceId: string) => api.post<PdfDownload>(
    '/api/research/pdf', { operation, bundleId: bundle.id, resourceId });
  async function refresh() {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError(''); const version = ++epoch.current;
    try {
      const replies = await Promise.all(resources.map(async resource => [resource.id, await request('status', resource.id)] as const));
      if (mounted.current && version === epoch.current) setValues(Object.fromEntries(replies));
    } catch (error) {
      if (mounted.current && version === epoch.current) { setQueue([]); setError(error instanceof Error ? error.message : String(error)); }
    } finally { if (mounted.current && version === epoch.current) { pending.current = false; setLoading(false); } }
  }
  useEffect(() => { void refresh(); }, []);
  async function operate(operation: 'start' | 'cancel', resourceId: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); const version = ++epoch.current;
    setQueue(ids => operation === 'cancel' ? [] : ids.filter(id => id !== resourceId));
    try {
      const reply = await request(operation, resourceId);
      if (mounted.current && version === epoch.current) {
        setValues(previous => ({ ...previous, [resourceId]: reply }));
        if (['failed', 'cancelled', 'interrupted', 'unavailable'].includes(reply.status)) setQueue([]);
      }
    } catch (error) {
      // A lost response is not permission to replay a start. Reconcile first.
      if (mounted.current && version === epoch.current) { setQueue([]); setError(error instanceof Error ? error.message : String(error)); }
    } finally { if (mounted.current && version === epoch.current) { pending.current = false; setBusy(false); } }
  }
  useEffect(() => {
    if (!running || busy || loading || error) return;
    let alive = true; const version = epoch.current;
    const timer = setTimeout(async () => {
      try {
        const reply = await request('status', running.id);
        if (alive && version === epoch.current) {
          setValues(previous => ({ ...previous, [running.id]: reply }));
          if (['failed', 'cancelled', 'interrupted', 'unavailable'].includes(reply.status)) setQueue([]);
        }
      } catch (error) {
        if (alive && version === epoch.current) { setQueue([]); setError(error instanceof Error ? error.message : String(error)); }
      }
    }, 700);
    return () => { alive = false; clearTimeout(timer); };
  }, [running?.id, values, busy, loading, error]);
  useEffect(() => {
    if (waitForSources || loading || busy || running || error || !queue.length) return;
    const next = queue.find(id => {
      const value = values[id];
      // Missing original bytes require an explicit restore, not a queued replay.
      return value?.status !== 'completed' && value?.status !== 'unavailable' && !(value?.receipt && value.localAvailable === false);
    });
    if (next) void operate('start', next); else setQueue([]);
  }, [waitForSources, loading, busy, running?.id, error, queue, values]);
  useEffect(() => {
    if (resources.length) onAvailable?.(!loading && !busy && !error && resources.every(resource => values[resource.id]?.status === 'completed' && values[resource.id]?.localAvailable !== false));
  }, [loading, busy, error, values, onAvailable]);
  if (!resources.length) return null;
  return <section className="pa-research-downloads" aria-label="PDF reading sources">
    <h2>PDF reading sources</h2>
    {waitForSources && queue.length > 0 && <p role="status">PDF downloads wait for the selected source files. If a source fails or is cancelled, retry it explicitly or start a PDF manually.</p>}
    <p className="pa-muted">Saved PDFs are not automatically read. Study observations record the pages actually consulted.</p>
    <Button disabled={busy || loading} onClick={() => void refresh()}>Refresh PDF status</Button>
    {loading && <p role="status">Checking saved PDFs…</p>}
    {error && <Feedback kind="error">{error} Check status before retrying a download.</Feedback>}
    <ul>{resources.map(resource => {
      const value = values[resource.id], receipt = value?.receipt, readPages = value?.readPages ?? [];
      const unavailable = value?.status === 'unavailable' || (!!receipt && value?.localAvailable === false);
      return <li key={resource.id}>
        <h3>{resource.title}</h3>
        <p role="status">{unavailable && value?.status !== 'running' ? 'Original PDF unavailable' : value?.status === 'completed' ? 'PDF downloaded; text extraction available' : value?.status === 'running' ? receipt ? 'Restoring original PDF…' : value.stage === 'parsing' ? 'PDF downloaded; checking page text…' : 'Downloading PDF…' : value?.status === 'failed' ? 'PDF download failed' : value?.status === 'cancelled' ? 'PDF download cancelled' : value?.status === 'interrupted' ? 'PDF download interrupted by restart' : 'Link discovered; PDF not downloaded'}</p>
        {value?.error && <Feedback kind="error">{value.error}</Feedback>}
        {receipt && <>
          <p>{assetSize(receipt.size)} / {receipt.pageCount} pages / text on {receipt.textPages} pages</p>
          {(receipt.extractionWarnings ?? []).map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
          <p>{readPages.length ? `Study observed text on pages ${readPages.join(', ')}. This does not mean every page was read in full.` : 'No pages read by a study yet.'}</p>
          <Button disabled={unavailable} onClick={() => onRead(receipt.paperId)}>Open saved PDF</Button>
          <details><summary>PDF source and version</summary><dl className="pa-resource-provenance">
            <dt>Source page</dt><dd><a href={receipt.sourcePageUrl} target="_blank" rel="noreferrer">{receipt.sourcePageUrl}</a></dd>
            <dt>Requested URL</dt><dd>{receipt.requestUrl}</dd><dt>Final URL</dt><dd>{receipt.finalUrl}</dd>
            <dt>Retrieved</dt><dd>{receipt.fetchedAt}</dd>{value.restoredAt && <><dt>Restored</dt><dd>{value.restoredAt}</dd><dt>Restore URL</dt><dd>{value.restoreFinalUrl}</dd></>}<dt>SHA-256</dt><dd>{receipt.fileDigest}</dd>
            <dt>Version</dt><dd>{receipt.explicitVersion}</dd><dt>Document</dt><dd>{receipt.documentId}</dd>
            <dt>Paper identity</dt><dd>{receipt.workIdentity || 'Unresolved; title similarity does not establish identity.'}</dd>
          </dl><p className="pa-muted">The hash identifies these bytes, not the authenticity of the source. PDF text is not OCR or a reconstructed table.</p></details>
        </>}
        {value?.status === 'running' ? <Button disabled={busy || loading} onClick={() => void operate('cancel', resource.id)}>Cancel PDF download</Button> : value && (value.status !== 'completed' || unavailable) && <Button disabled={busy || loading || !!running || !!error} onClick={() => void operate('start', resource.id)}>{value.status === 'unavailable' || value.status === 'completed' && unavailable ? 'Restore PDF' : receipt ? 'Retry restore' : value.status === 'not_started' ? 'Start PDF download' : 'Retry PDF download'}</Button>}
      </li>;
    })}</ul>
  </section>;
}
