import React, { useEffect, useState } from 'react';
import { Button, Feedback } from '@pero/app-sdk/ui';
import type { Api } from './types';
import { ResourceDetails } from './research-import';
import { ResearchDownloads } from './research-downloads';
import type { ResearchBundle } from './research-types';

export function ResearchBundleList({ bundles, onOpen }: { bundles: ResearchBundle[]; onOpen(id: string): void }) {
  if (!bundles.length) return null;
  return <section className="pa-research-bundles" aria-label="Research bundles"><h2>Research bundles</h2><ul>{bundles.map(bundle => <li key={bundle.id}><Button variant="ghost" onClick={() => onOpen(bundle.id)}>{bundle.title}</Button><small>{bundle.resources.length} references</small></li>)}</ul></section>;
}

export function ResearchBundleView({ api, id, startDownloadIds, onRead }: { api: Api; id: string; startDownloadIds: string[]; onRead(id: string): void }) {
  const [bundle, setBundle] = useState<ResearchBundle | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true; setError('');
    api.get<ResearchBundle>(`/api/research/bundles/${encodeURIComponent(id)}`).then(value => { if (alive) setBundle(value); }, error => { if (alive) setError(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, [api, id, attempt]);
  return <div className="pa-library-content pa-research-bundle">
    {error ? <Feedback kind="error">{error}<Button onClick={() => setAttempt(value => value + 1)}>Retry</Button></Feedback> : !bundle && <p role="status">Loading bundle…</p>}
    {bundle && <><h2>{bundle.title}</h2><p className="pa-muted">Saved references</p><a href={bundle.seedUrl} target="_blank" rel="noreferrer">Original research URL</a>
      <ul className="pa-resource-list">{bundle.resources.map(resource => <li key={resource.id}><h3>{resource.title}</h3><ResourceDetails resource={resource} onRead={onRead}/></li>)}</ul>
      <ResearchDownloads key={bundle.id} bundle={bundle} startDownloadIds={startDownloadIds}/>
    </>}
  </div>;
}
