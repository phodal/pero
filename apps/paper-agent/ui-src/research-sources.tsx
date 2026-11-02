import React, { useEffect, useRef, useState } from 'react';
import { Button, Feedback } from '@pero/app-sdk/ui';
import type { Api, PdfFocus } from './types';
import { assetSize, type ResearchBundle } from './research-types';
import { SourceBrowser } from './research-source-browser';

export type SourceReceipt = {
  sourcePageUrl: string; requestUrl: string; finalUrl: string; fetchedAt: string;
  archiveDigest: string; size: number; mime: string; format: string; workIdentity: string | null;
  revision: string | null; explicitVersion: string; memberCount: number; texCount: number;
};
type SourceDownload = {
  id: string; bundleId: string; resourceId: string;
  status: 'not_started' | 'running' | 'source_available' | 'pdf_only' | 'no_tex' | 'unavailable' | 'denied' | 'failed' | 'cancelled' | 'interrupted';
  stage: 'discovered' | 'downloading' | 'parsing' | 'available' | 'unavailable';
  error: string; localAvailable: boolean; receipt: SourceReceipt | null;
  restoredAt?: string | null; restoreFinalUrl?: string | null; previewRebuiltAt?: string | null;
};
const terminal = ['source_available', 'pdf_only', 'no_tex'];
const stopped = ['unavailable', 'denied', 'failed', 'cancelled', 'interrupted'];
const sourceStatus: Record<SourceDownload['status'], string> = {
  not_started: 'Source discovered; not downloaded', running: 'Downloading source…', source_available: 'Source files available',
  pdf_only: 'Provider returned PDF only; no TeX source', no_tex: 'Archive saved; no TeX files found', unavailable: 'Source files or previews unavailable',
  denied: 'Source access denied', failed: 'Source acquisition failed', cancelled: 'Source acquisition cancelled', interrupted: 'Source acquisition interrupted by restart',
};

export function ResearchSources({ api, bundle, startSourceIds, onRead, onAutoQueueComplete, onState, scopedIds }: {
  api: Api; bundle: ResearchBundle; startSourceIds: string[]; scopedIds?: string[]; onState?(state: { settled: boolean; available: boolean }): void; onAutoQueueComplete?(): void; onRead(id: string, focus?: PdfFocus): void;
}) {
  const resources = bundle.resources.filter(r => r.kind === 'source_archive' && bundle.sourceDownloadIds?.includes(r.id) && (scopedIds === undefined || scopedIds.includes(r.id)));
  const [values, setValues] = useState<Record<string, SourceDownload>>({}), [open, setOpen] = useState<string | null>(null);
  const [queue, setQueue] = useState(() => startSourceIds.filter(id => resources.some(r => r.id === id)));
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), pending = useRef(false), epoch = useRef(0);
  const running = resources.find(r => values[r.id]?.status === 'running');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const request = (operation: 'start' | 'status' | 'cancel', resourceId: string) => api.post<SourceDownload>('/api/research/source', { operation, bundleId: bundle.id, resourceId });
  async function refresh() {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError(''); const version = ++epoch.current;
    try {
      const replies = await Promise.all(resources.map(async r => [r.id, await request('status', r.id)] as const));
      if (mounted.current && version === epoch.current) setValues(Object.fromEntries(replies));
    } catch (error) { if (mounted.current && version === epoch.current) { setQueue([]); setError(String(error)); } }
    finally { if (mounted.current && version === epoch.current) { pending.current = false; setLoading(false); } }
  }
  useEffect(() => { void refresh(); }, []);
  async function operate(operation: 'start' | 'cancel', resourceId: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); const version = ++epoch.current;
    setQueue(ids => operation === 'cancel' ? [] : ids.filter(id => id !== resourceId));
    try {
      const value = await request(operation, resourceId);
      if (mounted.current && version === epoch.current) { setValues(prior => ({ ...prior, [resourceId]: value })); if (stopped.includes(value.status)) setQueue([]); }
    } catch (error) { if (mounted.current && version === epoch.current) { setQueue([]); setError(String(error)); } }
    finally { if (mounted.current && version === epoch.current) { pending.current = false; setBusy(false); } }
  }
  useEffect(() => {
    if (!running || busy || loading || error) return;
    let alive = true; const version = epoch.current;
    const timer = setTimeout(async () => {
      try {
        const value = await request('status', running.id);
        if (alive && version === epoch.current) { setValues(prior => ({ ...prior, [running.id]: value })); if (stopped.includes(value.status)) setQueue([]); }
      } catch (error) { if (alive && version === epoch.current) { setQueue([]); setError(String(error)); } }
    }, 700);
    return () => { alive = false; clearTimeout(timer); };
  }, [running?.id, values, busy, loading, error]);
  useEffect(() => {
    if (loading || busy || running || error || !queue.length) return;
    const next = queue.find(id => !terminal.includes(values[id]?.status) && values[id]?.status !== 'unavailable' && !values[id]?.receipt);
    if (next) void operate('start', next); else setQueue([]);
  }, [loading, busy, running?.id, error, queue, values]);
  useEffect(() => {
    if (loading || busy || running || error || queue.length) return;
    if (startSourceIds.every(id => terminal.includes(values[id]?.status) && values[id]?.localAvailable)) onAutoQueueComplete?.();
  }, [loading, busy, running, error, queue.length, values, startSourceIds, onAutoQueueComplete]);
  useEffect(() => {
    const idle = !loading && !busy && !running && !error && !queue.length && resources.length > 0;
    onState?.({
      settled: idle && resources.every(resource => [...terminal, ...stopped].includes(values[resource.id]?.status)),
      available: idle && resources.every(resource => terminal.includes(values[resource.id]?.status) && values[resource.id]?.localAvailable),
    });
  }, [loading, busy, running, error, queue.length, values, onState]);
  if (!resources.length) return null;
  return <section className="pa-research-downloads pa-research-sources" aria-label="Paper source files">
    <h2>Paper source files</h2><p>Read-only inspection. Source files are not compiled or executed. Figures are not reproducible experiment code or data.</p>
    <Button disabled={loading || busy} onClick={() => void refresh()}>Refresh source status</Button>
    {loading && <p role="status">Checking source archives…</p>}{error && <Feedback kind="error">{error} Check status before retrying.</Feedback>}
    <ul>{resources.map(resource => {
      const value = values[resource.id], receipt = value?.receipt, available = value?.localAvailable === true;
      return <li key={resource.id}><h3>{resource.title}</h3>
        <p role="status">{value?.status === 'running' && value.stage === 'parsing' ? 'Inspecting archive without executing files…' : sourceStatus[value?.status ?? 'not_started']}</p>
        {value?.error && <Feedback kind="error">{value.error}</Feedback>}
        {receipt && <><p>{receipt.revision || 'Version unresolved'} / {assetSize(receipt.size)} / {receipt.memberCount} files / {receipt.texCount} TeX files</p>
          <details><summary>Source archive provenance</summary><dl className="pa-resource-provenance">
            <dt>Source page</dt><dd>{receipt.sourcePageUrl}</dd><dt>Requested URL</dt><dd>{receipt.requestUrl}</dd><dt>Final URL</dt><dd>{receipt.finalUrl}</dd>
            <dt>Retrieved</dt><dd>{receipt.fetchedAt}</dd><dt>Format</dt><dd>{receipt.format} / {receipt.mime}</dd><dt>Archive SHA-256</dt><dd>{receipt.archiveDigest}</dd>
            <dt>Work / version</dt><dd>{receipt.workIdentity || 'Work identity unresolved'} / {receipt.revision || 'Version unresolved'}</dd><dt>Byte version</dt><dd>{receipt.explicitVersion}</dd>
            {value.previewRebuiltAt && <><dt>Preview rebuilt locally</dt><dd>{value.previewRebuiltAt}</dd></>}
            {value.restoredAt && <><dt>Restored</dt><dd>{value.restoredAt}</dd><dt>Restore URL</dt><dd>{value.restoreFinalUrl}</dd></>}
          </dl></details>
          <Button disabled={busy || loading} onClick={() => setOpen(open === resource.id ? null : resource.id)}>{open === resource.id ? 'Close source files' : available ? 'Browse source files' : 'Open saved source evidence'}</Button>
        </>}
        {value?.status === 'running' ? <Button disabled={busy || loading} onClick={() => void operate('cancel', resource.id)}>Cancel source download</Button> : value && (!terminal.includes(value.status) || !available) && <Button disabled={busy || loading || !!running || !!error} onClick={() => void operate('start', resource.id)}>{value.status === 'unavailable' ? 'Restore source archive' : receipt ? 'Retry source restore' : value.status === 'not_started' ? 'Get source archive' : 'Retry source download'}</Button>}
        {open === resource.id && receipt && <SourceBrowser api={api} bundle={bundle} resourceId={resource.id} receipt={receipt} available={available} onRead={onRead}/>}
      </li>;
    })}</ul>
  </section>;
}
