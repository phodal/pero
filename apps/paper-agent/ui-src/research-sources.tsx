import React, { useEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback, Icon } from '@pero/app-sdk/ui';
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
const labels = {
  statusFailed: { zh: '无法获取源码状态。', en: 'Could not check source status.' }, statusUnknown: { zh: '状态未确认', en: 'Status unknown' },
  errorDetails: { zh: '错误详情', en: 'Error details' },
  title: { zh: 'TeX 源码', en: 'TeX source' }, refresh: { zh: '更新源码状态', en: 'Refresh source status' },
  checking: { zh: '正在检查本地文件…', en: 'Checking local files…' }, checkFirst: { zh: '请更新状态后重试。', en: 'Refresh status before retrying.' },
  not_started: { zh: '尚未下载，文件内容未核验', en: 'Not downloaded; contents unverified' },
  running: { zh: '正在下载…', en: 'Downloading…' }, parsing: { zh: '正在检查归档内容…', en: 'Inspecting archive…' },
  source_available: { zh: '已下载', en: 'Downloaded' }, pdf_only: { zh: '来源只提供 PDF，没有 TeX 源码', en: 'PDF only; no TeX source' },
  no_tex: { zh: '归档已保存，未找到 TeX 文件', en: 'Archive saved; no TeX files' }, unavailable: { zh: '本地文件不可用', en: 'Local files unavailable' },
  denied: { zh: '无法访问源码', en: 'Source access denied' }, failed: { zh: '下载失败', en: 'Download failed' },
  cancelled: { zh: '已取消下载', en: 'Download cancelled' }, interrupted: { zh: '重启中断了下载', en: 'Download interrupted by restart' },
  scope: { zh: '源码与插图用于论文排版，不等于复现实验代码。查看文件不会编译或运行代码。', en: 'These are typesetting files and figures, not experiment code. Browsing does not compile or run files.' },
  version: { zh: '版本未确认', en: 'Version unresolved' }, files: { zh: '{count} 个文件', en: '{count} files' }, tex: { zh: '{count} 个 TeX 文件', en: '{count} TeX files' },
  details: { zh: '来源与下载信息', en: 'Source and download details' }, discovery: { zh: '发现时的记录', en: 'Discovery record' },
  sourcePage: { zh: '来源页面', en: 'Source page' }, request: { zh: '请求链接', en: 'Requested URL' }, final: { zh: '下载链接', en: 'Final URL' },
  retrieved: { zh: '下载时间', en: 'Retrieved' }, format: { zh: '文件格式', en: 'Format' }, identity: { zh: '论文与版本', en: 'Work and version' },
  unresolved: { zh: '标识未确认', en: 'Identity unresolved' }, byteVersion: { zh: '文件版本', en: 'Byte version' },
  rebuilt: { zh: '预览重建时间', en: 'Preview rebuilt' }, restored: { zh: '恢复时间', en: 'Restored' }, restoreUrl: { zh: '恢复链接', en: 'Restore URL' },
  dialogClose: { zh: '关闭', en: 'Close' },
  close: { zh: '收起文件', en: 'Close source files' }, browse: { zh: '查看文件', en: 'Browse source files' }, evidence: { zh: '查看保存记录', en: 'Open saved source evidence' },
  cancel: { zh: '取消下载', en: 'Cancel source download' }, restore: { zh: '恢复源码文件', en: 'Restore source archive' },
  retryRestore: { zh: '重试恢复', en: 'Retry source restore' }, get: { zh: '下载源码', en: 'Get source archive' }, retry: { zh: '重试下载', en: 'Retry source download' },
};

export function ResearchSources({ api, bundle, startSourceIds, onRead, onAutoQueueComplete, onState, scopedIds, dialog = false }: {
  api: Api; bundle: ResearchBundle; startSourceIds: string[]; dialog?: boolean; scopedIds?: string[]; onState?(state: { settled: boolean; available: boolean }): void; onAutoQueueComplete?(): void; onRead(id: string, focus?: PdfFocus): void | boolean | Promise<void | boolean>;
}) {
  const { t } = useAppI18n(labels);
  const resources = bundle.resources.filter(r => r.kind === 'source_archive' && bundle.sourceDownloadIds?.includes(r.id) && (scopedIds === undefined || scopedIds.includes(r.id)));
  const [values, setValues] = useState<Record<string, SourceDownload>>({}), [open, setOpenState] = useState<string | null>(null);
  const [queue, setQueue] = useState(() => startSourceIds.filter(id => resources.some(r => r.id === id)));
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), pending = useRef(false), epoch = useRef(0);
  const openingEpoch = useRef(0);
  function setOpen(resourceId: string | null) { openingEpoch.current++; setOpenState(resourceId); }
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
  return <section className="pa-research-downloads pa-research-sources" aria-label={t('title')}>
    {error && <Feedback kind="error"><span>{t('statusFailed')}</span><Button disabled={busy || loading} onClick={() => void refresh()}>{t('refresh')}</Button><details><summary>{t('errorDetails')}</summary>{error}</details></Feedback>}
    <ul>{resources.map(resource => {
      const value = values[resource.id], receipt = value?.receipt, available = value?.localAvailable === true;
      return <li key={resource.id}>
        <div className="pa-bundle-resource-row"><Icon name="file-code" size={18}/><div className="pa-bundle-resource-name">
          <h2>{resources.length === 1 ? t('title') : resource.workIdentity || resource.title}</h2>
          <div className="pa-resource-meta"><span>{receipt?.revision || resource.revision || t('version')}</span>{receipt && <><span>{assetSize(receipt.size)}</span><span>{t('files', { count: receipt.memberCount })}</span><span>{t('tex', { count: receipt.texCount })}</span></>}</div>
        </div>
        <span className="pa-bundle-status" role="status">{loading ? t('checking') : error ? t('statusUnknown') : receipt && !available && terminal.includes(value?.status ?? '') ? t('unavailable') : value?.status === 'running' && value.stage === 'parsing' ? t('parsing') : t(value?.status ?? 'not_started')}</span>
        <div className="pa-bundle-file-actions">{receipt && <Button disabled={busy || loading} aria-haspopup={dialog ? 'dialog' : undefined} aria-expanded={open === resource.id} onClick={() => setOpen(open === resource.id ? null : resource.id)}>{open === resource.id ? t('close') : available ? t('browse') : t('evidence')}</Button>}
          {value?.status === 'running' ? <Button disabled={busy || loading} onClick={() => void operate('cancel', resource.id)}>{t('cancel')}</Button> : value && (!terminal.includes(value.status) || !available) && <Button disabled={busy || loading || !!running || !!error} onClick={() => void operate('start', resource.id)}>{t(value.status === 'unavailable' || !available && terminal.includes(value.status) ? 'restore' : receipt ? 'retryRestore' : value.status === 'not_started' ? 'get' : 'retry')}</Button>}
          {!error && <Button variant="ghost" aria-label={t('refresh')} title={t('refresh')} disabled={loading || busy} onClick={() => void refresh()}><Icon name="refresh" size={14}/></Button>}
        </div></div>
        {value?.error && <Feedback kind="error"><details><summary>{t('errorDetails')}</summary>{value.error}</details></Feedback>}
        <details className="pa-source-provenance"><summary>{t('details')}</summary>
          {receipt && <dl className="pa-resource-provenance">
            <dt>{t('sourcePage')}</dt><dd><a href={receipt.sourcePageUrl} target="_blank" rel="noreferrer">{receipt.sourcePageUrl}</a></dd><dt>{t('request')}</dt><dd>{receipt.requestUrl}</dd><dt>{t('final')}</dt><dd>{receipt.finalUrl}</dd>
            <dt>{t('retrieved')}</dt><dd>{receipt.fetchedAt}</dd><dt>{t('format')}</dt><dd>{receipt.format} / {receipt.mime}</dd><dt>SHA-256</dt><dd>{receipt.archiveDigest}</dd>
            <dt>{t('identity')}</dt><dd>{receipt.workIdentity || t('unresolved')} / {receipt.revision || t('version')}</dd><dt>{t('byteVersion')}</dt><dd>{receipt.explicitVersion}</dd>
            {value.previewRebuiltAt && <><dt>{t('rebuilt')}</dt><dd>{value.previewRebuiltAt}</dd></>}
            {value.restoredAt && <><dt>{t('restored')}</dt><dd>{value.restoredAt}</dd><dt>{t('restoreUrl')}</dt><dd>{value.restoreFinalUrl}</dd></>}
          </dl>}
          <p className="pa-muted">{t('discovery')}</p><p>{resource.title}</p><a href={resource.url} target="_blank" rel="noreferrer">{resource.url}</a>
          {!!resource.unresolved?.length && <ul>{resource.unresolved.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        </details>
        {open === resource.id && receipt && (dialog ? <Dialog title={`${t('title')} ${receipt.revision ?? ''}`} size="lg" className="pa-tex-source-dialog" closeLabel={t('dialogClose')} onClose={() => setOpen(null)}><SourceBrowser api={api} bundle={bundle} resourceId={resource.id} receipt={receipt} available={available} onRead={async (id, focus) => {
          const opening = openingEpoch.current;
          const opened = await onRead(id, focus);
          if (opened === true && mounted.current && opening === openingEpoch.current) setOpen(null);
          return opened;
        }}/></Dialog> : <SourceBrowser api={api} bundle={bundle} resourceId={resource.id} receipt={receipt} available={available} onRead={onRead}/>)}
      </li>;
    })}</ul>
    <p className="pa-muted pa-source-scope">{t('scope')}</p>
  </section>;
}
