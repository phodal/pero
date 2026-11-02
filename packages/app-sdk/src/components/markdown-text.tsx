// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React from 'react';
import { ensureUiStyles } from './ui-styles';

export type MarkdownTextProps = {
  text: string;
  className?: string;
  /** Presentation slots for existing consumers; no content or execution hooks. */
  classNames?: { root?: string; table?: string };
};

function tableCells(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells: string[] = [];
  let cell = '', code = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\' && value[index + 1] === '|') { cell += '|'; index++; continue; }
    if (char === '`') code = !code;
    if (char === '|' && !code) { cells.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

/** **bold** and `code` inside one line; no HTML or autolinks. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={index}>{part.slice(1, -1)}</code>
        : <React.Fragment key={index}>{part}</React.Fragment>);
}

/** Read-only, line-oriented Markdown for untrusted documents. HTML, links,
 * images and diagram fences remain literal text; nothing is fetched or executed. */
export function MarkdownText({ text, className, classNames }: MarkdownTextProps) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  let fence: string[] | null = null;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
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
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = `h${Math.min(6, Math.max(2, heading[1].length + 1))}` as keyof React.JSX.IntrinsicElements;
      blocks.push(<Tag key={blocks.length}>{inline(heading[2])}</Tag>);
      continue;
    }
    const headers = tableCells(line), separators = tableCells(lines[index + 1] || '');
    if (headers.length > 1 && separators.length === headers.length && separators.every(cell => /^:?-{3,}:?$/.test(cell))) {
      const rows: string[][] = [];
      index++;
      while (index + 1 < lines.length && lines[index + 1].trim()) {
        const cells = tableCells(lines[index + 1]);
        if (cells.length !== headers.length) break;
        rows.push(cells); index++;
      }
      blocks.push(<div className={classNames?.table ?? 'pero-ui-markdown-table'} key={blocks.length} tabIndex={0}><table><thead><tr>{headers.map((cell, i) => <th scope="col" key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (line) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  if (fence) blocks.push(<pre key={blocks.length}><code>{fence.join('\n')}</code></pre>);
  return <div ref={node => { if (node) ensureUiStyles(node.ownerDocument); }} className={[classNames?.root ?? 'pero-ui-markdown-text', className].filter(Boolean).join(' ')}>{blocks}</div>;
}
