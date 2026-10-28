import React from 'react';
import type { Source } from '../science';
import type { Translate } from '../messages';
export function SourceStamp({ source, t }: { source: Source; t: Translate }) {
  return <div className="vc-source"><span className={`vc-tag ${source.kind === 'illustrative' ? 'vc-tag-warning' : ''}`}>{t(source.kind)}</span><span>{source.id}</span>{source.url && <a href={source.url} target="_blank" rel="noreferrer">{t('sourceLink')}</a>}<span className="vc-muted">{source.revision.slice(0, 12)}</span></div>;
}
