import React, { useEffect, useRef, useState } from 'react';
import { Disclosure, Progress, Button, Feedback } from '@pero/app-sdk/ui';
import { assetSize, type ResearchBundle } from './research-types';

type DownloadReply = {
  download: { id: string; sourceId: string; status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'; received: number; total: number | null; error: string | null } | null;
  asset: { id: string; size: number; sha256: string; localAvailable: boolean } | null;
  receipt: { bundleId: string; assetId: string; jobId: string | null; catalogAssetId: string | null; reused: boolean; retryable: boolean };
};

/** A view of Data jobs, not a second downloader. Only explicit saved choices can start. */
export function ResearchDownloads({ bundle, startDownloadIds }: { bundle: ResearchBundle; startDownloadIds: string[] }) {
  const assets = bundle.resources.flatMap(resource => resource.assets).filter(asset => bundle.downloadIds.includes(asset.id));
  const [replies, setReplies] = useState<Record<string, DownloadReply>>({}), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [queue, setQueue] = useState(startDownloadIds);
  const mounted = useRef(true), epoch = useRef(0), pending = useRef(false);
  const running = assets.find(asset => replies[asset.id]?.download?.status === 'running');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  async function request(operation: 'start' | 'status' | 'cancel', assetId: string): Promise<DownloadReply> {
    const response = await fetch('/host/research-assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, bundleId: bundle.id, assetId }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.detail || value.error || `Data request failed (${response.status})`);
    return value;
  }
  async function refresh() {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError(''); const version = ++epoch.current;
    try {
      const values = await Promise.all(assets.map(async asset => [asset.id, await request('status', asset.id)] as const));
      if (mounted.current && version === epoch.current) setReplies(Object.fromEntries(values));
    } catch (error) { if (mounted.current && version === epoch.current) { setQueue([]); setError(error instanceof Error ? error.message : String(error)); } }
    finally { if (mounted.current && version === epoch.current) { pending.current = false; setLoading(false); } }
  }
  useEffect(() => { void refresh(); }, []);
  async function operate(operation: 'start' | 'cancel', assetId: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); const version = ++epoch.current;
    setQueue(values => operation === 'cancel' ? [] : values.filter(id => id !== assetId));
    try {
      const value = await request(operation, assetId);
      if (mounted.current && version === epoch.current) {
        setReplies(values => ({ ...values, [assetId]: value }));
        if (value.download && ['failed', 'cancelled', 'interrupted'].includes(value.download.status)) setQueue([]);
      }
    } catch (error) { if (mounted.current && version === epoch.current) { setQueue([]); setError(error instanceof Error ? error.message : String(error)); } }
    finally { if (mounted.current && version === epoch.current) { pending.current = false; setBusy(false); } }
  }
  useEffect(() => {
    if (!running || busy || error) return;
    let alive = true; const version = epoch.current;
    const timer = setTimeout(async () => {
      try {
        const value = await request('status', running.id);
        if (alive && version === epoch.current) {
          setReplies(values => ({ ...values, [running.id]: value }));
          if (value.download && ['failed', 'cancelled', 'interrupted'].includes(value.download.status)) setQueue([]);
        }
      } catch (error) { if (alive && version === epoch.current) { setQueue([]); setError(error instanceof Error ? error.message : String(error)); } }
    }, 700);
    return () => { alive = false; clearTimeout(timer); };
  }, [running?.id, replies, busy, error]);
  useEffect(() => {
    if (loading || busy || running || error || !queue.length) return;
    const next = queue.find(id => replies[id]?.download?.status !== 'completed');
    if (next) void operate('start', next); else setQueue([]);
  }, [loading, busy, running?.id, error, queue, replies]);
  if (!assets.length) return null;
  return <section className="pa-research-downloads" aria-label="Downloads">
    <h2>Downloads</h2><p className="pa-muted">References stay saved if a download fails. Data manages local files.</p>
    {loading && <p role="status">Checking downloads…</p>}
    {error && <Feedback kind="error">{error}<Button disabled={busy || loading} onClick={() => void refresh()}>Retry status</Button></Feedback>}
    <ul>{assets.map(asset => {
      const reply = replies[asset.id], job = reply?.download;
      return <li key={asset.id}><h3>{asset.filename}</h3><p className="pa-muted">{assetSize(asset.size)} / {asset.license}</p>
        {job ? <p role="status">{job.status === 'running' ? `Downloading: ${assetSize(job.received)} of ${assetSize(job.total)}` : job.status === 'completed' ? reply.asset?.localAvailable ? 'Available in Data' : 'File unavailable in Data' : job.status}</p> : !loading && <p>Not started</p>}
        {job?.status === 'running' && <Progress label={`Download progress: ${asset.filename}`} value={job.received} max={job.total || asset.size}/>}
        {job?.error && <Feedback kind="error">{job.error}</Feedback>}
        {job?.status === 'running' ? <Button disabled={busy} onClick={() => void operate('cancel', asset.id)}>Cancel download</Button> : (!job || reply.receipt.retryable) && <Button disabled={loading || busy || !!running || !!error} onClick={() => void operate('start', asset.id)}>{job ? 'Retry download' : 'Start download'}</Button>}
        {reply?.receipt.jobId && <Disclosure variant="inline" summary={<>Download receipt</>}><dl className="pa-resource-provenance"><dt>Job</dt><dd>{reply.receipt.jobId}</dd><dt>Data asset</dt><dd>{reply.receipt.catalogAssetId || 'Not published'}</dd><dt>Reused</dt><dd>{reply.receipt.reused ? 'Yes' : 'No'}</dd>{reply.asset?.sha256 && <><dt>SHA-256</dt><dd>{reply.asset.sha256}</dd></>}</dl></Disclosure>}
      </li>;
    })}</ul>
  </section>;
}
