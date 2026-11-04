import React, { useEffect, useRef, useState } from 'react';
import { Button, Disclosure, Split, SplitPane } from '@pero/app-sdk/ui';
import { addedText, contentKind, paperSource } from './library';
import { ScientificContent } from './scientific-content';
import type { Paper, TextFocus } from './types';
import type { Translator } from './i18n';
import './saved-text-reading.css';

type Section = { title: string; level: number; element: HTMLElement };

function SourceLines({ content, focus, label }: { content: string; focus: TextFocus; label: string }) {
  const mark = useRef<HTMLElement>(null);
  // Search offsets are Python code points; convert once at this display boundary.
  const start = Math.max(0, focus.start), end = Math.max(start, focus.end);
  let from = 0, to = 0, position = 0;
  for (const character of content) {
    if (position >= end) break;
    to += character.length;
    if (position < start) from = to;
    position++;
  }
  const line = content.slice(0, from).split('\n').length;
  useEffect(() => { mark.current?.scrollIntoView({ block: 'center' }); }, [content, from, to, focus.token]);
  return <><p className="pa-document-meta">{label.replace('{n}', String(line))}</p><pre className="pa-search-source">{content.slice(0, from)}<mark ref={mark} data-search-line={line}>{content.slice(from, to)}</mark>{content.slice(to)}</pre></>;
}

/** Saved source text, kept separate from approved official HTML/PDF representations. */
export function SavedTextReading({ paper, busy, textFocus, onFull, onDiscuss, t }: {
  paper: Paper; busy: boolean; textFocus?: TextFocus | null; onFull(): void; onDiscuss(text: string): void; t: Translator;
}) {
  const source = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<Section[]>([]), [current, setCurrent] = useState<HTMLElement | null>(null), [excerpt, setExcerpt] = useState('');
  const firstHeading = /^#\s+([^\r\n]+)(?:\r?\n|$)/.exec(paper.content ?? '');
  // Omit only an exact duplicate display title. Stored text and search offsets stay unchanged.
  const content = firstHeading?.[1].trim() === paper.title ? paper.content!.slice(firstHeading[0].length) : paper.content;
  useEffect(() => {
    setExcerpt(''); setCurrent(null);
    // PDF extraction can turn entire paragraphs into headings. Only offer a useful outline.
    const headings = [...source.current?.querySelectorAll<HTMLElement>('h1,h2,h3') ?? []].filter(element => {
      const title = element.textContent?.trim();
      return title && title.length <= 120;
    });
    setSections(headings.length > 1 ? headings.map(element => ({ title: element.textContent!.trim(), level: Number(element.tagName[1]), element })) : []);
  }, [paper.id, content, textFocus?.token]);
  function capture() {
    const selection = window.getSelection();
    if (!selection || !source.current?.contains(selection.anchorNode) || !source.current.contains(selection.focusNode)) return;
    setExcerpt(selection.toString().trim());
  }
  return <Split className="pa-saved-reading" collapseBelow={680} storageKey="paper-agent.saved-text-outline">
    {!!sections.length && <SplitPane id="saved-text-outline" size={176} min={140} resizeLabel={t('resizeOutline')} className="pa-saved-outline" stackedBasis="auto">
      <nav aria-label={t('contents')}><h2>{t('contents')}</h2>{sections.map((section, index) => <button key={index} type="button" data-level={section.level} aria-current={current === section.element ? 'location' : undefined} onClick={() => { setCurrent(section.element); section.element.scrollIntoView({ block: 'start' }); }}>{section.title}</button>)}</nav>
    </SplitPane>}
    <SplitPane id="saved-text-content" min={280} className="pa-saved-scroll"><div className="pa-saved-prose">
      <header className="pa-saved-heading"><h1>{paper.title}</h1>{!!paper.authors.length && <p className="pa-saved-authors">{paper.authors.join(', ')}</p>}<dl><div><dt>{t('source')}</dt><dd>{paperSource(paper, t)}</dd></div><div><dt>{t('contentKind')}</dt><dd>{contentKind(paper, t)}</dd></div><div><dt>{t('readingVersion')}</dt><dd>{t('savedText')}</dd></div></dl></header>
      {paper.limitation && <p className="pa-document-meta">{paper.limitation}</p>}
      <div className="pa-source-text" ref={source} onMouseUp={capture} onKeyUp={capture}>{paper.content != null ? textFocus ? <SourceLines content={paper.content} focus={textFocus} label={t('sourceLine')}/> : paper.resourceKind ? <p className="pa-resource-excerpt">{content}</p> : <ScientificContent content={content ?? ''}/> : <p role="status">{t('loading')}</p>}</div>
      {!!excerpt && <div className="pa-reader-actions"><Button onClick={() => onDiscuss(excerpt)}>{t('discussSelection')}</Button></div>}
      <Disclosure summary={t('sourceDetails')}>
        {paper.source !== 'local-pdf' && <a href={paper.url} target="_blank" rel="noreferrer">{t('openOriginal')}</a>}
        {paper.contentKind !== 'full-text' && paper.source === 'alphaxiv' && <Button disabled={busy} onClick={onFull}>{t('fetchFull')}</Button>}
        <dl className="pa-details"><dt>{t('added')}</dt><dd>{addedText(paper.fetchedAt, t)}</dd><dt>SHA-256</dt><dd>{paper.contentDigest}</dd><dt>{t('frozenInput')}</dt><dd>{paper.fetchedAt}</dd></dl>
        <Disclosure summary={t('rawSource')}><pre className="pa-raw-source">{paper.content}</pre></Disclosure>
      </Disclosure>
    </div></SplitPane>
  </Split>;
}
