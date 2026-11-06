import React, { useEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Disclosure, Button, Feedback, Icon } from '@pero/app-sdk/ui';
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

const labels = {
  statusFailed: { zh: '无法获取PDF状态。', en: 'Could not check PDF status.' }, statusUnknown: { zh: '状态未确认', en: 'Status unknown' },
  errorDetails: { zh: '错误详情', en: 'Error details' },
  title: { zh: 'PDF', en: 'PDF' }, refresh: { zh: '更新 PDF 状态', en: 'Refresh PDF status' },
  wait: { zh: '正在等待源码下载；也可手动开始下载 PDF。', en: 'Waiting for source downloads. You can also start the PDF manually.' },
  checking: { zh: '正在检查本地 PDF…', en: 'Checking saved PDFs…' }, checkFirst: { zh: '请更新状态后重试下载。', en: 'Refresh status before retrying a download.' },
  unavailable: { zh: '本地 PDF 不可用', en: 'Original PDF unavailable' }, completed: { zh: '已下载', en: 'Downloaded' },
  scanned: { zh: '没有可选文本；暂不支持 OCR。', en: 'No selectable text. OCR unavailable.' },
  restoring: { zh: '正在恢复 PDF…', en: 'Restoring PDF…' }, parsing: { zh: '正在检查页面文本…', en: 'Checking page text…' },
  running: { zh: '正在下载 PDF…', en: 'Downloading PDF…' }, failed: { zh: '下载失败', en: 'Download failed' },
  cancelled: { zh: '已取消下载', en: 'Download cancelled' }, interrupted: { zh: '重启中断了下载', en: 'Download interrupted by restart' },
  not_started: { zh: '尚未下载', en: 'Not downloaded' }, pages: { zh: '{count} 页', en: '{count} pages' },
  textPages: { zh: '{count} 页可提取文本', en: 'Text on {count} pages' },
  read: { zh: '阅读 PDF', en: 'Open saved PDF' }, details: { zh: '来源与下载信息', en: 'PDF source and version' },
  consulted: { zh: '研究中查阅过的页面：{pages}。不代表已完整阅读。', en: 'Study consulted pages {pages}; this does not mean every page was read in full.' },
  unread: { zh: '研究中尚未查阅此 PDF。', en: 'No pages read by a study yet.' },
  sourcePage: { zh: '来源页面', en: 'Source page' }, request: { zh: '请求链接', en: 'Requested URL' }, final: { zh: '下载链接', en: 'Final URL' },
  retrieved: { zh: '下载时间', en: 'Retrieved' }, restored: { zh: '恢复时间', en: 'Restored' }, restoreUrl: { zh: '恢复链接', en: 'Restore URL' },
  version: { zh: '文件版本', en: 'Version' }, document: { zh: '文档标识', en: 'Document' }, identity: { zh: '论文标识', en: 'Paper identity' },
  unresolved: { zh: '未确认；标题相似不能确认论文身份。', en: 'Unresolved; title similarity does not establish identity.' },
  limits: { zh: '哈希仅标识文件内容，不证明来源真实性。PDF 文本提取不包含 OCR 或表格重建。', en: 'The hash identifies bytes, not authenticity. Text extraction is not OCR or table reconstruction.' },
  cancel: { zh: '取消下载', en: 'Cancel PDF download' }, restore: { zh: '恢复 PDF', en: 'Restore PDF' },
  retryRestore: { zh: '重试恢复', en: 'Retry restore' }, start: { zh: '下载 PDF', en: 'Start PDF download' }, retry: { zh: '重试下载', en: 'Retry PDF download' },
};

/** Project saved consent and Paper's PDF lifecycle; never infer consent from a link. */
export function ResearchPdfDownloads({ api, bundle, startPdfIds, onRead, waitForSources = false, onAvailable, scopedIds }: {
  api: Api; bundle: ResearchBundle; startPdfIds: string[]; scopedIds?: string[]; waitForSources?: boolean; onAvailable?(available: boolean): void; onRead(id: string): void;
}) {
  const { t } = useAppI18n(labels);
  const resources = bundle.resources.filter(resource => resource.kind === 'pdf_candidate' && bundle.pdfDownloadIds?.includes(resource.id) && (scopedIds === undefined || scopedIds.includes(resource.id)));
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
  return <section className="pa-research-downloads" aria-label={t('title')}>
    {waitForSources && queue.length > 0 && <p role="status">{t('wait')}</p>}
    {error && <Feedback kind="error"><span>{t('statusFailed')}</span><Button disabled={busy || loading} onClick={() => void refresh()}>{t('refresh')}</Button><Disclosure variant="inline" summary={<>{t('errorDetails')}</>}>{error}</Disclosure></Feedback>}
    <ul>{resources.map(resource => {
      const value = values[resource.id], receipt = value?.receipt, readPages = value?.readPages ?? [];
      const unavailable = value?.status === 'unavailable' || (!!receipt && value?.localAvailable === false);
      return <li key={resource.id}>
        <div className="pa-bundle-resource-row"><Icon name="file-text" size={18}/><div className="pa-bundle-resource-name">
          <h2>{resources.length === 1 ? 'PDF' : resource.title}</h2><div className="pa-resource-meta">{resource.revision && <span>{resource.revision}</span>}{receipt && <><span>{assetSize(receipt.size)}</span><span>{t('pages', { count: receipt.pageCount })}</span><span>{t('textPages', { count: receipt.textPages })}</span></>}</div>
        </div>
        <span className="pa-bundle-status" role="status">{loading ? t('checking') : error ? t('statusUnknown') : unavailable && value?.status !== 'running' ? t('unavailable') : value?.status === 'running' ? t(receipt ? 'restoring' : value.stage === 'parsing' ? 'parsing' : 'running') : t(value?.status ?? 'not_started')}</span>
        <div className="pa-bundle-file-actions">{receipt && <Button disabled={unavailable} onClick={() => onRead(receipt.paperId)}>{t('read')}</Button>}
          {value?.status === 'running' ? <Button disabled={busy || loading} onClick={() => void operate('cancel', resource.id)}>{t('cancel')}</Button> : value && (value.status !== 'completed' || unavailable) && <Button disabled={busy || loading || !!running || !!error} onClick={() => void operate('start', resource.id)}>{t(value.status === 'unavailable' || value.status === 'completed' && unavailable ? 'restore' : receipt ? 'retryRestore' : value.status === 'not_started' ? 'start' : 'retry')}</Button>}
          {!error && <Button variant="ghost" aria-label={t('refresh')} title={t('refresh')} disabled={busy || loading} onClick={() => void refresh()}><Icon name="refresh" size={14}/></Button>}
        </div></div>
        {value?.error && <Feedback kind="error"><Disclosure variant="inline" summary={<>{t('errorDetails')}</>}>{value.error}</Disclosure></Feedback>}
        {receipt && <>
          {receipt.textPages === 0 && <Feedback>{t('scanned')}</Feedback>}
          {(receipt.extractionWarnings ?? []).map((warning, index) => <Feedback key={index}>{warning}</Feedback>)}
        </>}
        <Disclosure variant="inline" className="pa-source-provenance" summary={<>{t('details')}</>}><p>{resource.title}</p>
          {receipt && <><p>{readPages.length ? t('consulted', { pages: readPages.join(', ') }) : t('unread')}</p><dl className="pa-resource-provenance">
            <dt>{t('sourcePage')}</dt><dd><a href={receipt.sourcePageUrl} target="_blank" rel="noreferrer">{receipt.sourcePageUrl}</a></dd>
            <dt>{t('request')}</dt><dd>{receipt.requestUrl}</dd><dt>{t('final')}</dt><dd>{receipt.finalUrl}</dd>
            <dt>{t('retrieved')}</dt><dd>{receipt.fetchedAt}</dd>{value.restoredAt && <><dt>{t('restored')}</dt><dd>{value.restoredAt}</dd><dt>{t('restoreUrl')}</dt><dd>{value.restoreFinalUrl}</dd></>}<dt>SHA-256</dt><dd>{receipt.fileDigest}</dd>
            <dt>{t('version')}</dt><dd>{receipt.explicitVersion}</dd><dt>{t('document')}</dt><dd>{receipt.documentId}</dd>
            <dt>{t('identity')}</dt><dd>{receipt.workIdentity || t('unresolved')}</dd>
          </dl><p className="pa-muted">{t('limits')}</p></>}
          <a href={resource.url} target="_blank" rel="noreferrer">{resource.url}</a>
        </Disclosure>
      </li>;
    })}</ul>
  </section>;
}
