import React, { useEffect, useState } from 'react';
import { useAppContext } from '@pero/app-sdk';
import { Button, Feedback } from '@pero/app-sdk/ui';
import { artifactSourceUrl, readArtifactSnapshot, type ArtifactLocator, type ArtifactSnapshot } from './artifact-source';
import { RichPreview } from './rich-preview';
import type { PreviewKind } from './preview-source';

class PreviewBoundary extends React.Component<{ children: React.ReactNode; retry(): void; zh: boolean }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="artifact-empty"><Feedback kind="error">{this.state.error}</Feedback><Button onClick={this.props.retry}>{this.props.zh ? '重试' : 'Retry'}</Button></div> : this.props.children; }
}

/** One version uses the same loader and reader in quick look, gallery and standalone. */
export function ArtifactDocument({ locator, onDiscuss }: {
  locator: ArtifactLocator; onDiscuss(snapshot: ArtifactSnapshot, selection: string): Promise<void>;
}) {
  const { locale } = useAppContext(), zh = locale === 'zh-CN';
  const [snapshot, setSnapshot] = useState<ArtifactSnapshot | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setSnapshot(null); setError(''); setLoading(true);
    void (async () => {
      const response = await fetch(artifactSourceUrl(locator), { signal: abort.signal });
      const value = await readArtifactSnapshot(locator, response);
      if (!abort.signal.aborted) setSnapshot(value);
    })().catch(reason => { if (!abort.signal.aborted) setError(String(reason.message)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [locator.threadId, locator.artifactId, locator.version, attempt]);
  const kind: PreviewKind | undefined = snapshot && snapshot.kind !== 'document'
    ? ({ csv: 'table', tsv: 'table', image: 'image', pdf: 'pdf', html: 'html', notebook: 'notebook' } as const)[snapshot.kind] : undefined;
  return <div className="artifact-document">
    {loading && <div className="artifact-loading" role="status" aria-busy="true">{zh ? '正在载入产物…' : 'Loading artifact…'}</div>}
    {error && <div className="artifact-empty"><Feedback kind="error">{error}</Feedback><Button onClick={() => setAttempt(value => value + 1)}>{zh ? '重试' : 'Retry'}</Button></div>}
    {snapshot && <PreviewBoundary key={`${snapshot.id}/${attempt}`} retry={() => setAttempt(value => value + 1)} zh={zh}><RichPreview source={snapshot} kind={kind} selectionOnly
      onDiscuss={selection => onDiscuss(snapshot, selection)} /></PreviewBoundary>}
  </div>;
}
