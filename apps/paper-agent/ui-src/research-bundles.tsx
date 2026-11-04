import React, { useCallback, useEffect, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Icon } from '@pero/app-sdk/ui';
import type { Api, PdfFocus } from './types';
import { ResourceDetails } from './research-import';
import { ResearchSources } from './research-sources';
import { ResearchPdfDownloads } from './research-pdf-downloads';
import { ResearchDownloads } from './research-downloads';
import { ResearchClone } from './research-clone';
import { SourceReports } from './research-source-reports';
import './research-bundles.css';
import type { ResearchBundle } from './research-types';

const labels = {
  bundles: { zh: '论文资料', en: 'Paper resources' }, references: { zh: '{count} 项资料', en: '{count} resources' },
  back: { zh: '返回文库', en: 'Back to library' }, original: { zh: '原始链接', en: 'Original link' },
  loading: { zh: '正在读取资料…', en: 'Loading resources…' }, retry: { zh: '重试', en: 'Retry' },
  saved: { zh: '已保存', en: 'Saved' }, reference: { zh: '仅保存链接', en: 'Link only' },
  read: { zh: '阅读论文', en: 'Read paper' }, article: { zh: '阅读文章', en: 'Read article' },
  evidence: { zh: '阅读证据与报告', en: 'Reading evidence and reports' },
  empty: { zh: '此论文还没有保存资料。', en: 'No resources have been saved for this paper.' },
  paper: { zh: '论文', en: 'Paper' }, web_article: { zh: '文章', en: 'Article' }, pdf_candidate: { zh: 'PDF 链接', en: 'PDF link' },
  source_archive: { zh: 'TeX 源码链接', en: 'TeX source link' }, code: { zh: '代码仓库', en: 'Code repository' },
  model: { zh: '模型', en: 'Model' }, dataset: { zh: '数据集', en: 'Dataset' }, benchmark: { zh: '基准', en: 'Benchmark' }, service: { zh: '服务', en: 'Service' },
};

export function ResearchBundleList({ bundles, onOpen }: { bundles: ResearchBundle[]; onOpen(id: string): void }) {
  const { t } = useAppI18n(labels);
  if (!bundles.length) return null;
  return <section className="pa-research-bundles" aria-label={t('bundles')}><h2>{t('bundles')}</h2><ul>{bundles.map(bundle => <li key={bundle.id}><Button variant="ghost" onClick={() => onOpen(bundle.id)}>{bundle.title}</Button><small>{t('references', { count: bundle.resources.length })}</small></li>)}</ul></section>;
}

export function ResearchBundleView({ api, id, startDownloadIds, startPdfIds, startSourceIds, onRead, onBack }: { api: Api; id: string; startDownloadIds: string[]; startPdfIds: string[]; startSourceIds: string[]; onRead(id: string, focus?: PdfFocus): void | boolean | Promise<void | boolean>; onBack(): void }) {
  const { t } = useAppI18n(labels);
  const [bundle, setBundle] = useState<ResearchBundle | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const sourceBatch = `${id}:${startSourceIds.join(',')}`;
  const [completedSourceBatch, setCompletedSourceBatch] = useState('');
  const sourceBatchComplete = useCallback(() => setCompletedSourceBatch(sourceBatch), [sourceBatch]);
  const waitForSources = startSourceIds.length > 0 && completedSourceBatch !== sourceBatch;
  useEffect(() => {
    let alive = true; setError('');
    api.get<ResearchBundle>(`/api/research/bundles/${encodeURIComponent(id)}`).then(value => { if (alive) setBundle(value); }, error => { if (alive) setError(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, [api, id, attempt]);
  const references = bundle?.resources.filter(resource =>
    !(resource.kind === 'source_archive' && bundle.sourceDownloadIds?.includes(resource.id)) &&
    !(resource.kind === 'pdf_candidate' && bundle.pdfDownloadIds?.includes(resource.id))) ?? [];
  return <div className="pa-library-content pa-research-bundle">
    <header className="pa-bundle-header"><Button variant="ghost" aria-label={t('back')} onClick={onBack}><Icon name="chevron-left"/></Button><h1>{bundle?.title ?? t('bundles')}</h1>
      {bundle && <a href={bundle.seedUrl} target="_blank" rel="noreferrer">{t('original')}<Icon name="external-link" size={12}/></a>}
    </header>
    {error ? <Feedback kind="error">{error}<Button onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button></Feedback> : !bundle && <p role="status">{t('loading')}</p>}
    {bundle && <>
      {!bundle.resources.length && <p>{t('empty')}</p>}
      <ul className="pa-bundle-resources">{references.map(resource => <li key={resource.id}>
        <div className="pa-bundle-resource-row"><Icon name={resource.kind === 'source_archive' ? 'file-code' : resource.kind === 'code' ? 'code' : 'file-text'} size={18}/>
          <div className="pa-bundle-resource-name"><h2>{resource.title === bundle.title ? t(resource.kind) : resource.title}</h2>
            <div className="pa-resource-meta">{resource.title !== bundle.title && <span>{t(resource.kind)}</span>}{resource.revision && <span>{resource.revision}</span>}<a href={resource.url} target="_blank" rel="noreferrer">{new URL(resource.url).hostname}<Icon name="external-link" size={12}/></a></div>
          </div>
          <span className="pa-bundle-status">{resource.paperId ? t('saved') : t('reference')}</span>
          {resource.paperId && <Button onClick={() => onRead(resource.paperId!)}>{t(resource.kind === 'web_article' ? 'article' : 'read')}</Button>}
        </div>
        {!!resource.unresolved.length && <ul className="pa-resource-warnings">{resource.unresolved.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <ResourceDetails resource={resource} detailsOnly/>
        {resource.kind === 'code' && resource.identity.startsWith('github:') && <ResearchClone bundle={bundle} resource={resource}/>}
      </li>)}</ul>
      <ResearchPdfDownloads key={`pdf:${bundle.id}`} api={api} bundle={bundle} startPdfIds={startPdfIds} onRead={onRead} waitForSources={waitForSources}/>
      <ResearchSources dialog key={`source:${bundle.id}`} api={api} bundle={bundle} startSourceIds={startSourceIds} onRead={onRead} onAutoQueueComplete={sourceBatchComplete}/>
      <ResearchDownloads key={bundle.id} bundle={bundle} startDownloadIds={startDownloadIds}/>
      {(!!bundle.htmlDownloadIds?.length || bundle.resources.some(resource => ['paper', 'pdf_candidate'].includes(resource.kind) && resource.workIdentity?.startsWith('arxiv:') && /^v[1-9]\d*$/.test(resource.revision ?? ''))) && <details className="pa-bundle-evidence"><summary>{t('evidence')}</summary>
        <SourceReports key={`evidence:${bundle.id}`} api={api} bundleId={bundle.id} refresh={attempt} navigating={false}
          canOpenSource={() => false} openSource={() => {}} canOpenPdf={() => false} openPdf={() => {}}/>
      </details>}
    </>}
  </div>;
}
