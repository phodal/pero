import React from 'react';

/** **bold** and `code` inside one line; everything else stays text. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={index}>{part.slice(2, -2)}</strong>
    : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={index}>{part.slice(1, -1)}</code>
    : <React.Fragment key={index}>{part}</React.Fragment>);
}

/** The little Markdown a brief uses. No HTML and no links are rendered from model text. */
export function RichText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  let fence: string[] | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      if (fence) { blocks.push(<pre key={blocks.length}><code>{fence.join('\n')}</code></pre>); fence = null; }
      else { flush(); fence = []; }
      continue;
    }
    if (fence) { fence.push(raw); continue; }
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)、]\s*(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered && !bullet;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>);
  }
  flush();
  if (fence) blocks.push(<pre key={blocks.length}><code>{fence.join('\n')}</code></pre>);
  return <div className="point-rich-text">{blocks}</div>;
}

export function SectionHead({ id, title, count }: { id: string; title: string; count?: number }) {
  return <div className="point-pulse-head">
    <h2 id={id} tabIndex={-1}>{title}</h2>{count ? <span className="point-pulse-count">{count}</span> : null}
  </div>;
}
