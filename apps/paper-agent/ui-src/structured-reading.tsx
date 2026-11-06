import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Table, Button, Feedback, Select, Toolbar } from '@pero/app-sdk/ui';
import type { Api } from './types';
import './structured-reading.css';
import type { DocumentEvidenceScope } from './research-types';
import { HtmlReading } from './html-reading';
import { ArxivReading, type ReadingSource } from './arxiv-reading';

type Inline = { kind: string; text: string; latex: string; mathml: string; target: string; url: string };
type Cell = { row: number; column: number; row_span: number; column_span: number; header: boolean; content: Inline[] };
type Locator = { start: number; end: number; start_line: number; end_line: number };
type Block = { id: string; kind: string; content: Inline[]; cells: Cell[]; images: { url: string; alt: string }[]; anchors: string[]; level: number; section_id: string; locator: Locator | null; limitations: string[] };
type Document = { id: string; paperId: string; parser: string; metadata: { title: string; authors: string[]; abstract: string; identifiers: [string, string][]; date: string | null }; source: { url: string; digest: string; version: string }; warnings: string[]; blocks: Block[]; parseStatus: string; sourceIdentity: string };
type Source = ReadingSource;
type ReadingFailure = { message: string; source?: Source };
type EvidenceScope = { bundleId: string; resourceId: string };
type Overview = { revisions: { id: string; source: Document['source']; parser: string; createdAt: string; bundleId: string; resourceId: string; scopes: EvidenceScope[] }[]; sources: Source[]; reviewUrl?: string | null };
type Original = { observationId?: string; documentId: string; content: string; start: number; end: number; nextStart: number | null; sourceDigest: string; blockLocator: Locator | null };
const mathTags = new Set('math mrow mi mn mo mtext ms mspace msup msub msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd mlabeledtr mfenced menclose mpadded mphantom mmultiscripts mprescripts none semantics'.split(' '));
const mathAttrs = new Set('display mathvariant stretchy fence separator accent accentunder columnalign rowalign columnspan rowspan open close separators notation linethickness bevelled'.split(' '));
function mathElement(node: Node, key: number): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element) || !mathTags.has(node.localName) || node.namespaceURI !== 'http://www.w3.org/1998/Math/MathML') return null;
  const attrs = Object.fromEntries(Array.from(node.attributes).filter(a => mathAttrs.has(a.name)).map(a => [a.name, a.value]));
  return React.createElement(node.localName, { ...attrs, key }, ...Array.from(node.childNodes).map(mathElement));
}
function MathValue({ token }: { token: Inline }) {
  const value = useMemo(() => token.mathml ? mathElement(new DOMParser().parseFromString(token.mathml, 'application/xml').documentElement, 0) : null, [token.mathml]);
  return value ? <>{value}</> : <span>{token.latex || token.text || 'Formula unavailable'}{!token.mathml && <small> (original formula only)</small>}</span>;
}
function headingLabel(block: Block) {
  return block.content.map(item => item.text).join('').replace(/\s+/g, ' ').trim();
}
function readingHeadings(blocks: Block[]) {
  const headings = blocks.flatMap(block => {
    if (block.kind !== 'heading') return [];
    const title = headingLabel(block);
    const letters = title.match(/\p{L}/gu) ?? [];
    if (letters.length < 2 || /source-conversion/i.test(title) || title.includes('Reveal original')) return [];
    return [{ id: block.id, title }];
  });
  return headings.length >= 2 ? headings : [];
}
function TextContents({ blocks, current, onOpen }: { blocks: Block[]; current: string; onOpen(id: string): void }) {
  const headings = readingHeadings(blocks);
  if (!headings.length) return null;
  return <nav className="pa-text-contents" aria-label="Contents">{headings.map(heading => <Button variant="ghost" type="button" key={heading.id} className="pa-text-contents-item" aria-current={current === heading.id ? 'location' : undefined} onClick={() => onOpen(heading.id)}>{heading.title}</Button>)}</nav>;
}
function Contents({ tokens, onTarget }: { tokens: Inline[]; onTarget(target: string): void }) {
  return <>{tokens.map((token, index) => {
    const content = token.kind === 'math' ? <MathValue token={token}/> : token.text;
    return token.target ? <Button variant="link" key={index} className="pa-inline-citation" onClick={() => onTarget(token.target)}>{content}</Button>
      : token.url.startsWith('https://') ? <a key={index} href={token.url} target="_blank" rel="noreferrer noopener">{content}</a>
      : <React.Fragment key={index}>{content}</React.Fragment>;
  })}</>;
}

function readSetting(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function saveSetting(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Reading works without storage. */ } }
function httpsUrl(value?: string | null): value is string {
  return typeof value === 'string' && value.startsWith('https://');
}
// A local PDF, or any snapshot with no remote HTML, has nothing to review.
// Unauthorized PDF permission is a notice, not a review target.
function htmlReviewAvailable(overview: Overview, paperSource?: string) {
  if (paperSource === 'local-pdf') return false;
  const paperReview = httpsUrl(overview.reviewUrl);
  const htmlSources = overview.sources.filter(item => httpsUrl(item.url));
  if (!paperReview && htmlSources.length === 0) return false;
  if (!paperReview && htmlSources.every(item => !item.authorized)) return false;
  return true;
}

export function StructuredReading({ api, paperId, openToken, onReady, onPrepared, onReview, showText, paperSource, children, onSourceUrl, onDiscuss }: { onDiscuss?(text: string): void; api: Api; paperId: string; openToken: number; showText?: boolean; paperSource?: string; onSourceUrl?(url: string): void; onReady(ready: boolean): void; onPrepared?(): void; onReview(): void; children: React.ReactNode }) {
  const { t } = useAppI18n({ prepareReading: { zh: '排版阅读', en: 'Format' }, preparing: { zh: '排版中…', en: 'Formatting…' }, failed: { zh: '阅读失败', en: 'Reading failed' }, partialHtml: { zh: 'HTML 转换不完整。', en: 'Partial HTML conversion.' }, official: { zh: '查看原文', en: 'Official source' }, backReading: { zh: '返回阅读', en: 'Back to reading' } });
  const [reviewing, setReviewing] = useState(false);
  const [overview, setOverview] = useState<Overview>({ revisions: [], sources: [] }), [document, setDocument] = useState<Document | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<ReadingFailure | null>(null), [original, setOriginal] = useState<Original | null>(null), [originalBlock, setOriginalBlock] = useState('');
  const [target, setTarget] = useState(''), [candidates, setCandidates] = useState<Block[]>([]), [targetError, setTargetError] = useState('');
  const [evidenceScope, setEvidenceScope] = useState<EvidenceScope | null>(null);
  const [recordedScope, setRecordedScope] = useState<DocumentEvidenceScope | null>(null);
  const root = useRef<HTMLDivElement>(null), epoch = useRef(0), originalEpoch = useRef(0);
  function chooseScope(identity: string, scope: EvidenceScope | null) {
    originalEpoch.current++; setOriginal(null); setRecordedScope(null); setEvidenceScope(scope);
    saveSetting(`paper-read-scope:${identity}`, JSON.stringify(scope));
  }
  async function load(identity: string, version: number, scope?: EvidenceScope) {
    const value = await api.get<Document>(`/api/paper-documents/${identity}`);
    if (version !== epoch.current) return;
    if (scope) chooseScope(identity, { bundleId: scope.bundleId, resourceId: scope.resourceId });
    else { try { setEvidenceScope(JSON.parse(readSetting(`paper-read-scope:${identity}`) ?? 'null')); } catch { setEvidenceScope(null); } }
    originalEpoch.current++; setRecordedScope(null); setDocument(value); onSourceUrl?.(value.source.url); setOriginal(null); setOriginalBlock(''); setCandidates([]); setTargetError(''); onReady(true);
    saveSetting(`paper-read-revision:${paperId}`, identity);
    return value;
  }
  useEffect(() => {
    const version = ++epoch.current; setDocument(null); setRecordedScope(null); setOverview({ revisions: [], sources: [] }); setBusy(false); setError(null); setOriginal(null); onReady(false);
    api.get<Overview>(`/api/paper-documents?paperId=${paperId}`).then(async value => {
      if (version !== epoch.current) return;
      setOverview(value);
      const saved = readSetting(`paper-read-revision:${paperId}`);
      const identity = value.revisions.find(r => r.id === saved)?.id ?? value.revisions[0]?.id;
      if (identity) await load(identity, version);
    }).catch(error => { if (version === epoch.current) setError({ message: String(error.message ?? error) }); });
    return () => { epoch.current++; originalEpoch.current++; };
    // Reader stays mounted behind the library. An explicit reopen must discover
    // newly approved bundle scopes even when the PDF identity did not change.
  }, [api, paperId, openToken]);
  useEffect(() => {
    if (!document || !root.current) return;
    const container = root.current.closest('.pa-text-reading');
    if (!container) return;
    const key = `paper-read-position:${document.id}:${document.source.digest}`;
    const stored = Number(readSetting(key));
    if (Number.isFinite(stored) && stored >= 0) container.scrollTop = stored;
    const save = () => saveSetting(key, String(container.scrollTop));
    container.addEventListener('scroll', save, { passive: true });
    return () => { container.removeEventListener('scroll', save); };
  }, [document?.id, showText]);
  useEffect(() => { if (original) { const panel = root.current?.querySelector<HTMLElement>('.pa-original-html'); panel?.scrollIntoView({ block: 'nearest' }); panel?.querySelector('button')?.focus(); } }, [original?.start, originalBlock]);
  async function prepare(source: Source, refresh = false) {
    if (busy) return;
    const version = ++epoch.current; setBusy(true); setError(null);
    setOverview(previous => ({ ...previous, sources: [...previous.sources.filter(value => value.bundleId !== source.bundleId || value.resourceId !== source.resourceId), source] }));
    try {
      const prepared = await api.post<{ documentId: string } & EvidenceScope>('/api/paper-document', { operation: 'prepare', paperId, bundleId: source.bundleId, resourceId: source.resourceId, refresh });
      await load(prepared.documentId, version, prepared);
      if (version === epoch.current) onPrepared?.();
      const next = await api.get<Overview>(`/api/paper-documents?paperId=${paperId}`);
      if (version === epoch.current) setOverview(next);
    } catch (error) { if (version === epoch.current) setError({ message: error instanceof Error ? error.message : String(error), source }); }
    finally { if (version === epoch.current) setBusy(false); }
  }
  function reveal(blockId: string) {
    setTarget(blockId);
    const element = root.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
    element?.scrollIntoView({ block: 'center' }); element?.focus({ preventScroll: true });
  }
  const revision = overview.revisions.find(revision => revision.id === document?.id);
  const scopes = revision?.scopes ?? (revision ? [revision] : []);
  const selectedScope = scopes.find(scope => scope.bundleId === evidenceScope?.bundleId && scope.resourceId === evidenceScope?.resourceId) ?? (!evidenceScope && scopes.length === 1 ? scopes[0] : null);
  const activeRevision = revision && selectedScope ? { ...revision, ...selectedScope } : null;
  function recordedRevision(scope: DocumentEvidenceScope, resourceId = activeRevision?.resourceId) {
    const revision = overview.revisions.find(revision => revision.id === scope.documentId && revision.parser === scope.parserRevision && revision.source.digest === scope.sourceDigest);
    const selected = revision?.scopes.find(value => value.bundleId === activeRevision?.bundleId && value.resourceId === resourceId);
    return revision && selected ? { ...revision, ...selected } : null;
  }
  async function openRecorded(scope: DocumentEvidenceScope, observationId: string, resourceId: string) {
    if (busy || !recordedRevision(scope, resourceId)) return;
    const version = ++epoch.current; setBusy(true); setError(null);
    try {
      const loaded = await load(scope.documentId, version, recordedRevision(scope, resourceId)!);
      if (version !== epoch.current || !loaded) return;
      if (loaded.parser !== scope.parserRevision || loaded.source.digest !== scope.sourceDigest || (scope.unit !== 'original-html' && !loaded.blocks.some(block => block.id === scope.blockId))) throw Error('Recorded document scope does not match this saved revision.');
      if (scope.unit === 'original-html') {
        const revision = recordedRevision(scope, resourceId)!;
        const rawVersion = ++originalEpoch.current;
        const raw = await api.post<Original>('/api/paper-document', { operation: 'source', documentId: scope.documentId,
          bundleId: revision.bundleId, resourceId: revision.resourceId, start: scope.start, limit: scope.end - scope.start });
        if (version !== epoch.current || rawVersion !== originalEpoch.current) return;
        if (raw.documentId !== scope.documentId || raw.sourceDigest !== scope.sourceDigest || raw.start !== scope.start || raw.end !== scope.end || raw.observationId !== observationId) throw Error('Original HTML window does not match the recorded evidence.');
        setOriginal(raw); setOriginalBlock('');
      }
      setRecordedScope(scope);
    } catch (error) { if (version === epoch.current) setError({ message: error instanceof Error ? error.message : String(error) }); }
    finally { if (version === epoch.current) setBusy(false); }
  }
  useEffect(() => {
    if (recordedScope && recordedScope.unit !== 'original-html' && document?.id === recordedScope.documentId) reveal(recordedScope.blockId);
  }, [recordedScope, document?.id]);
  function followTarget(anchor: string) {
    const matches = document?.blocks.filter(b => b.anchors.includes(anchor)) ?? [];
    setCandidates(matches.length > 1 ? matches : []); setTargetError(matches.length ? '' : `Unresolved reference: ${anchor}`);
    if (matches.length === 1) reveal(matches[0].id);
  }
  async function source(block?: Block, start?: number) {
    if (!document || busy) return;
    if (!activeRevision) { setError({ message: 'Choose an evidence bundle before reading original HTML.' }); return; }
    setRecordedScope(null);
    const version = ++originalEpoch.current;
    try {
      const value = await api.post<Original>('/api/paper-document', { operation: 'source', documentId: document.id, ...(activeRevision ? { bundleId: activeRevision.bundleId, resourceId: activeRevision.resourceId } : {}), ...(block ? { blockId: block.id } : {}), ...(start == null ? {} : { start }) });
      if (version === originalEpoch.current) { setOriginal(value); setOriginalBlock(block?.id ?? ''); }
    } catch (error) { if (version === originalEpoch.current) setError({ message: error instanceof Error ? error.message : String(error) }); }
  }
  if (showText) return <div className="pa-text-document">{children}</div>;
  const reviewHtml = !document && htmlReviewAvailable(overview, paperSource);
  const prepareSources = !document ? overview.sources.filter(item => item.authorized) : [];
  return <div ref={root} className="pa-structured-reading" data-document-id={document?.id}>
    {error && <Feedback kind="error">{error.message}<Button onClick={() => setError(null)}>Dismiss</Button>{error.source && <Button disabled={busy} onClick={() => void prepare(error.source!, true)}>Retry {error.source.revision}</Button>}</Feedback>}
    {!document && overview.sources.some(item => !item.authorized) && <p className="pa-document-meta">HTML acquisition is not authorized. Review sources before downloading; PDF permission does not include HTML.</p>}
    {(reviewHtml || prepareSources.length > 0 || busy) && <div className="pa-html-review">
      {reviewHtml && <Button variant="ghost" disabled={busy} aria-expanded={overview.reviewUrl ? reviewing : undefined} onClick={() => overview.reviewUrl ? setReviewing(value => !value) : onReview()}>{overview.reviewUrl ? t('prepareReading') : 'Review HTML sources'}</Button>}
      {prepareSources.map(item => <Button key={`${item.bundleId}:${item.resourceId}`} variant="ghost" busy={busy} onClick={() => void prepare(item)}>Prepare Read · {item.revision}</Button>)}
      {busy && <span role="status">{t('preparing')}</span>}
    </div>}
    {reviewing && <ArxivReading api={api} paperId={paperId} onClose={() => setReviewing(false)} onPrepare={async item => { await prepare(item); setReviewing(false); }}/>}
    {!document ? <div className="pa-text-document"><TextContents blocks={[]} current={target} onOpen={reveal}/>{children}</div> : <div className="pa-reading-column">
      {(scopes.length > 1 || !!evidenceScope && !selectedScope) && <Select label="Evidence bundle" disabled={busy} value={selectedScope ? `${selectedScope.bundleId}:${selectedScope.resourceId}` : ''} onChange={value => {
        const scope = scopes.find(scope => `${scope.bundleId}:${scope.resourceId}` === value); chooseScope(document.id, scope ?? null);
      }} options={[{ value: '', label: 'Choose evidence bundle' }, ...scopes.map(scope => ({ value: `${scope.bundleId}:${scope.resourceId}`, label: `${scope.bundleId.slice(0, 12)} · ${scope.resourceId.slice(0, 8)}` }))]}/>}
      {document.parseStatus === 'partial' && document.warnings.some(warning => warning !== 'image-bytes-not-acquired') && <p className="pa-document-meta">{t('partialHtml')} <a href={document.source.url} target="_blank" rel="noreferrer">{t('official')}</a></p>}
      {recordedScope && <p role="status">Recorded {recordedScope.unit} {recordedScope.start}–{recordedScope.end} {recordedScope.unit === 'original-html' ? ' · Raw markup only; not structured scientific understanding.' : ` · ${recordedScope.blockId}. Showing the surrounding block; other content is not marked observed.`}</p>}
      {targetError && <Feedback>{targetError}</Feedback>}{candidates.length > 0 && <Feedback>Multiple source targets. {candidates.map(b => <Button key={b.id} onClick={() => reveal(b.id)}>{b.id}</Button>)}</Feedback>}
      {recordedScope && <Button onClick={() => { setRecordedScope(null); setOriginal(null); }}>{t('backReading')}</Button>}
      <HtmlReading recorded={!!recordedScope} id={document.id} sourceUrl={document.source.url} onDiscuss={onDiscuss} renderSelection={selection => {
        if (selection.sourceId !== document.id || !selection.anchors.length) return null;
        // A selection can identify a block, never an observed text/byte range.
        // Every reported source anchor must resolve to the same unique block.
        const matches = selection.anchors.map(anchor => document.blocks.filter(block => block.anchors.includes(anchor)));
        const block = matches[0][0];
        if (!block || matches.some(values => values.length !== 1 || values[0] !== block)) return null;
        return <span className="pa-original-block-actions" data-block-id={block.id}><Button variant="ghost" disabled={busy || !activeRevision} onClick={() => void source(block)}>Reveal original</Button></span>;
      }}>
      {document.blocks.map(block => {
        const content = <Contents tokens={block.content} onTarget={followTarget}/>;
        const rows = new Map<number, Cell[]>(); block.cells.forEach(c => rows.set(c.row, [...rows.get(c.row) ?? [], c]));
        const rowCount = block.cells.reduce((count, cell) => Math.max(count, cell.row + cell.row_span), 0);
        return <section key={block.id} tabIndex={-1} data-block-id={block.id} data-focused={target === block.id} className={`pa-document-block pa-block-${block.kind}`}>
          {block.kind === 'title' ? <h1>{content}</h1> : block.kind === 'heading' ? React.createElement(`h${Math.min(6, Math.max(2, block.level))}`, {}, content)
            : block.kind === 'table' && block.cells.length ? <Table label="Scientific table" className="pa-table-scroll"><caption>{content}</caption><tbody>{Array.from({ length: rowCount }, (_, row) => <tr key={row}>{(rows.get(row) ?? []).map((cell, index) => React.createElement(cell.header ? 'th' : 'td', { key: index, rowSpan: cell.row_span, colSpan: cell.column_span }, <Contents tokens={cell.content} onTarget={followTarget}/>))}</tr>)}</tbody></Table>
            : block.kind === 'figure' ? <figure><figcaption>{content}</figcaption><p className="pa-document-meta">Image bytes not acquired or visually observed.</p>{block.images.map((image, index) => <span key={index}>{image.alt || `Image ${index + 1}`} · metadata only </span>)}</figure>
            : block.kind === 'code' ? <pre>{content}</pre> : <div>{content}</div>}
          {block.limitations.length > 0 && <p className="pa-document-meta">{block.limitations.join('; ')}</p>}
          <Button variant="ghost" disabled={busy || !activeRevision} onClick={() => void source(block)}>Reveal original</Button>
        </section>;
      })}
      </HtmlReading>
      {original && <aside className="pa-original-html" aria-label="Original HTML source"><Toolbar><strong>Original HTML · characters {original.start}–{original.end}</strong><Button onClick={() => { originalEpoch.current++; setOriginal(null); if (originalBlock) reveal(originalBlock); }}>Close source</Button></Toolbar><p>{original.blockLocator ? `Block source: lines ${original.blockLocator.start_line}–${original.blockLocator.end_line}` : 'No exact block window available.'}</p><pre tabIndex={0}>{original.content}</pre>{original.nextStart != null && <Button disabled={busy || !activeRevision} onClick={() => void source(document.blocks.find(b => b.id === originalBlock), original.nextStart!)}>Next original window</Button>}</aside>}
    </div>}
  </div>;
}
