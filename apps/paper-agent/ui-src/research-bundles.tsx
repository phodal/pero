import React, { useCallback, useEffect, useState } from 'react';
import { Button, Feedback } from '@pero/app-sdk/ui';
import type { Api, PdfFocus } from './types';
import { ResourceDetails } from './research-import';
import { ResearchSources } from './research-sources';
import { ResearchPdfDownloads } from './research-pdf-downloads';
import { ResearchDownloads } from './research-downloads';
import { ResearchClone } from './research-clone';
import type { ResearchBundle } from './research-types';

export function ResearchBundleList({ bundles, onOpen }: { bundles: ResearchBundle[]; onOpen(id: string): void }) {
  if (!bundles.length) return null;
  return <section className="pa-research-bundles" aria-label="Research bundles"><h2>Research bundles</h2><ul>{bundles.map(bundle => <li key={bundle.id}><Button variant="ghost" onClick={() => onOpen(bundle.id)}>{bundle.title}</Button><small>{bundle.resources.length} references</small></li>)}</ul></section>;
}

export function ResearchBundleView({ api, id, startDownloadIds, startPdfIds, startSourceIds, onRead }: { api: Api; id: string; startDownloadIds: string[]; startPdfIds: string[]; startSourceIds: string[]; onRead(id: string, focus?: PdfFocus): void }) {
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
  return <div className="pa-library-content pa-research-bundle">
    {error ? <Feedback kind="error">{error}<Button onClick={() => setAttempt(value => value + 1)}>Retry</Button></Feedback> : !bundle && <p role="status">Loading bundle…</p>}
    {bundle && <><h2>{bundle.title}</h2><p className="pa-muted">Saved references</p><a href={bundle.seedUrl} target="_blank" rel="noreferrer">Original research URL</a>
      <ul className="pa-resource-list">{bundle.resources.map(resource => <li key={resource.id}><h3>{resource.title}</h3><ResourceDetails resource={resource} onRead={onRead}/>{resource.kind === 'code' && resource.identity.startsWith('github:') && <ResearchClone bundle={bundle} resource={resource}/>}</li>)}</ul>
      <ResearchSources key={`source:${bundle.id}`} api={api} bundle={bundle} startSourceIds={startSourceIds} onRead={onRead} onAutoQueueComplete={sourceBatchComplete}/>
      <ResearchPdfDownloads key={`pdf:${bundle.id}`} api={api} bundle={bundle} startPdfIds={startPdfIds} onRead={onRead} waitForSources={waitForSources}/>
      <ResearchDownloads key={bundle.id} bundle={bundle} startDownloadIds={startDownloadIds}/>
    </>}
  </div>;
}
