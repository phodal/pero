import React from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import type { Evidence } from './types';
import 'katex/dist/katex.min.css';

/** Source text remains immutable; references resolve only against this section's evidence. */
export function ScientificContent({ content, evidence = [], onCite, citationLabel = 'Evidence' }: {
  content: string; evidence?: Evidence[]; onCite?(value: Evidence): void; citationLabel?: string;
}) {
  return <div className="pa-scientific"><Markdown remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 1000 }], [rehypeHighlight, { detect: false }]]}
    urlTransform={url => /^evidence:[1-9]\d*$/.test(url) ? url : defaultUrlTransform(url)}
    components={{
      a({ href, children }) {
        const match = /^evidence:([1-9]\d*)$/.exec(href ?? '');
        if (match) {
          const ref = evidence[Number(match[1]) - 1];
          return ref && onCite ? <button type="button" className="pa-inline-citation" aria-label={`${citationLabel} ${match[1]}`} onClick={() => onCite(ref)}>{children}<sup>{match[1]}</sup></button> : <span>{children} [?]</span>;
        }
        return <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{children}</a>;
      },
      table: ({ children }) => <div className="pa-table-scroll" tabIndex={0}><table>{children}</table></div>,
      img: ({ src, alt }) => src ? <img src={src} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer"/> : <span>{alt}</span>,
    }}>{content}</Markdown></div>;
}
