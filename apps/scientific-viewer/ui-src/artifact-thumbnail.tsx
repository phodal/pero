import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ContentIcon } from '@pero/app-sdk/ui';
import type { SessionArtifact, SessionArtifactVersion } from '../../../protocol/generated/host';
import { artifactSourceUrl, readArtifactSnapshot } from './artifact-source';
import { sourceText } from './preview-source';

export function artifactType(version: SessionArtifactVersion): string {
  if (version.media && version.media.kind !== 'document') return version.media.kind === 'image'
    ? version.media.mime_type.split('/')[1].replace('svg+xml', 'SVG').toUpperCase() : version.media.kind === 'notebook' ? 'Notebook' : version.media.kind.toUpperCase();
  const format = version.media?.kind === 'document' ? version.media.format : version.format;
  return format.kind === 'code' ? format.language : ({ markdown: 'Markdown', json: 'JSON', json_lines: 'JSONL', text: 'Text' } as const)[format.kind];
}

export function artifactSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** These are the actual saved bytes, or the ordinary file-type icon. No synthetic chart previews. */
export function ArtifactThumbnail({ artifact, version }: { artifact: SessionArtifact; version: SessionArtifactVersion }) {
  const locator = { threadId: artifact.thread_id, artifactId: artifact.id, version: version.version };
  const image = version.media?.kind === 'image';
  const textEligible = !image && version.bytes <= 64 * 1024 && (!version.media || version.media.kind === 'document');
  const [snippet, setSnippet] = useState(''), [failed, setFailed] = useState(false);
  const url = artifactSourceUrl(locator);
  useEffect(() => {
    if (!textEligible) return;
    const abort = new AbortController();
    void fetch(url, { signal: abort.signal }).then(response => readArtifactSnapshot(locator, response)).then(snapshot => {
      if (!abort.signal.aborted) setSnippet(sourceText(snapshot).split('\n').slice(0, 18).join('\n'));
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, [url, textEligible]);
  if (image && !failed) return <div className="artifact-thumbnail artifact-image-thumbnail"><img src={url} loading="lazy" decoding="async" alt="" onError={() => setFailed(true)} /></div>;
  const format = version.media?.kind === 'document' ? version.media.format : version.format;
  if (snippet && !failed) return <div className="artifact-thumbnail artifact-document-thumbnail" aria-hidden="true">
    {format.kind === 'markdown' ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{snippet}</ReactMarkdown> : <pre>{snippet}</pre>}
  </div>;
  return <div className="artifact-thumbnail artifact-icon-thumbnail" aria-hidden="true"><ContentIcon source={{ path: version.filename ?? artifact.title, language: format.kind === 'code' ? format.language : undefined }} /><span>{artifactType(version)}</span></div>;
}
