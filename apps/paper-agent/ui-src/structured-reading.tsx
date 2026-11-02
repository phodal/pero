import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Disclosure, Feedback, Select, Toolbar } from '@pero/app-sdk/ui';
import type { Api } from './types';
import './structured-reading.css';
import { SourceReports } from './research-source-reports';
import type { DocumentEvidenceScope } from './research-types';
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
function Contents({ tokens, onTarget }: { tokens: Inline[]; onTarget(target: string): void }) {
  return <>{tokens.map((token, index) => {
    const content = token.kind === 'math' ? <MathValue token={token}/> : token.text;
    return token.target ? <button key={index} className="pa-inline-citation" onClick={() => onTarget(token.target)}>{content}</button>
      : token.url.startsWith('https://') ? <a key={index} href={token.url} target="_blank" rel="noreferrer noopener">{content}</a>
      : <React.Fragment key={index}>{content}</React.Fragment>;
  })}</>;
}

function readSetting(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function saveSetting(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Reading works without storage. */ } }

export function StructuredReading({ api, paperId, openToken, onReady, onPrepared, onReview, showText, toolbar, children }: { api: Api; paperId: string; openToken: number; showText?: boolean; toolbar?: HTMLElement | null; onReady(ready: boolean): void; onPrepared?(): void; onReview(): void; children: React.ReactNode }) {
  const { t } = useAppI18n({ prepareReading: { zh: '排版阅读', en: 'Format' }, preparing: { zh: '排版中…', en: 'Formatting…' }, failed: { zh: '阅读失败', en: 'Reading failed' } });
  const [reviewing, setReviewing] = useState(false);
  const [overview, setOverview] = useState<Overview>({ revisions: [], sources: [] }), [document, setDocument] = useState<Document | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<ReadingFailure | null>(null), [original, setOriginal] = useState<Original | null>(null), [originalBlock, setOriginalBlock] = useState('');
  const [target, setTarget] = useState(''), [candidates, setCandidates] = useState<Block[]>([]), [targetError, setTargetError] = useState('');
  const [evidenceScope, setEvidenceScope] = useState<EvidenceScope | null>(null);
  const [recordedScope, setRecordedScope] = useState<DocumentEvidenceScope | null>(null), [reportRefresh, setReportRefresh] = useState(0);
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
    originalEpoch.current++; setRecordedScope(null); setDocument(value); setOriginal(null); setOriginalBlock(''); setCandidates([]); setTargetError(''); onReady(true);
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
  if (showText) return <>{children}</>;
  const controls = <div className="pa-reader-format-controls">
    {!document && <><Button variant="ghost" disabled={busy} aria-expanded={reviewing} onClick={() => overview.reviewUrl ? setReviewing(value => !value) : onReview()}>{overview.reviewUrl ? t('prepareReading') : 'Review HTML sources'}</Button>{overview.sources.filter(s => s.authorized).map(s => <Button key={`${s.bundleId}:${s.resourceId}`} busy={busy} onClick={() => void prepare(s)}>Prepare Read · {s.revision}</Button>)}</>}
    {reviewing && <ArxivReading api={api} paperId={paperId} onPrepare={prepare}/>}
    {busy && <span role="status">{t('preparing')}</span>}
    {error && <details className="pa-reading-source-menu" open><summary>{t('failed')}</summary><div className="pa-reading-source-options"><Feedback kind="error">{error.message}<Button onClick={() => setError(null)}>Dismiss</Button>{error.source && <Button disabled={busy} onClick={() => void prepare(error.source!, true)}>Retry {error.source.revision}</Button>}</Feedback></div></details>}
  </div>;
  return <div ref={root} className="pa-structured-reading" data-document-id={document?.id}>
    {toolbar ? createPortal(controls, toolbar) : controls}
    {!document && !overview.reviewUrl && overview.sources.length === 0 && <p className="pa-document-meta">Read needs an explicitly approved, fixed-version official HTML source. Existing text and PDF remain available.</p>}
    {!document && overview.sources.some(s => !s.authorized) && <p className="pa-document-meta">HTML acquisition is not authorized. Review sources before downloading; PDF permission does not include HTML.</p>}
    {!document ? children : <>
      {(scopes.length > 1 || !!evidenceScope && !selectedScope) && <Select label="Evidence bundle" disabled={busy} value={selectedScope ? `${selectedScope.bundleId}:${selectedScope.resourceId}` : ''} onChange={value => {
        const scope = scopes.find(scope => `${scope.bundleId}:${scope.resourceId}` === value); chooseScope(document.id, scope ?? null);
      }} options={[{ value: '', label: 'Choose evidence bundle' }, ...scopes.map(scope => ({ value: `${scope.bundleId}:${scope.resourceId}`, label: `${scope.bundleId.slice(0, 12)} · ${scope.resourceId.slice(0, 8)}` }))]}/>}
      <Toolbar><Select disabled={busy} label="Read version" value={document.id} onChange={id => { const version = ++epoch.current; void load(id, version).catch(error => { if (version === epoch.current) setError({ message: String(error.message ?? error) }); }); }} options={overview.revisions.map(r => ({ value: r.id, label: `${r.source.version} · ${r.parser} · ${r.source.digest.slice(0, 10)}` }))}/><Button variant="ghost" disabled={busy || !activeRevision} onClick={() => void source()}>Original HTML</Button></Toolbar>
      <p className="pa-document-meta">Derived structure · PDF alignment unavailable · {document.parseStatus === 'partial' ? 'Partial parse' : 'Parsed, not fully read'}</p>
      {!!document.metadata.authors.length && <p>{document.metadata.authors.join(', ')}</p>}
      <Disclosure summary="Source and parsing details"><a href={document.source.url} target="_blank" rel="noreferrer">Official source · {document.source.version}</a><dl><dt>Original SHA-256</dt><dd><code>{document.source.digest}</code></dd><dt>Parser</dt><dd>{document.parser}</dd><dt>Response identity</dt><dd>{document.sourceIdentity}</dd>{document.metadata.date && <><dt>Declared date</dt><dd>{document.metadata.date}</dd></>}{document.metadata.identifiers.map(([kind, value], i) => <React.Fragment key={i}><dt>{kind}</dt><dd>{value}</dd></React.Fragment>)}</dl>{document.warnings.length > 0 && <ul>{document.warnings.map(w => <li key={w}>{w}</li>)}</ul>}<a href={`/api/paper-documents/${document.id}/original`} download="source.html.txt">Download original bytes (text)</a><div>{overview.sources.filter(s => s.authorized && !scopes.some(scope => scope.bundleId === s.bundleId && scope.resourceId === s.resourceId)).map(s => <Button key={`reuse:${s.bundleId}:${s.resourceId}`} disabled={busy} onClick={() => void prepare(s)}>Use saved Read · {s.revision}</Button>)}{overview.sources.filter(s => s.authorized).map(s => <Button key={`${s.bundleId}:${s.resourceId}`} disabled={busy} onClick={() => void prepare(s, true)}>Prepare fresh parse · {s.revision}</Button>)}</div></Disclosure>
      {activeRevision && <Disclosure summary="Recorded evidence"><Button disabled={busy} onClick={() => setReportRefresh(value => value + 1)}>Refresh recorded evidence</Button>
        <SourceReports key={activeRevision.bundleId} api={api} bundleId={activeRevision.bundleId} refresh={reportRefresh} navigating={busy}
          canOpenSource={() => false} openSource={() => {}} canOpenPdf={() => false} openPdf={() => {}}
          canOpenDocument={(observation, scope) => !!recordedRevision(scope, observation.resourceId)} openDocument={(observation, scope) => void openRecorded(scope, observation.id, observation.resourceId)}/>
      </Disclosure>}
      {recordedScope && <p role="status">Recorded {recordedScope.unit} {recordedScope.start}–{recordedScope.end} {recordedScope.unit === 'original-html' ? ' · Raw markup only; not structured scientific understanding.' : ` · ${recordedScope.blockId}. Showing the surrounding block; other content is not marked observed.`}</p>}
      <Disclosure summary="Contents"><nav aria-label="Document contents">{document.blocks.filter(b => b.kind === 'heading').map(b => <Button key={b.id} variant="ghost" onClick={() => reveal(b.id)}>{b.content.map(t => t.text).join('')}</Button>)}</nav></Disclosure>
      {targetError && <Feedback>{targetError}</Feedback>}{candidates.length > 0 && <Feedback>Multiple source targets. {candidates.map(b => <Button key={b.id} onClick={() => reveal(b.id)}>{b.id}</Button>)}</Feedback>}
      {document.blocks.map(block => {
        const content = <Contents tokens={block.content} onTarget={followTarget}/>;
        const rows = new Map<number, Cell[]>(); block.cells.forEach(c => rows.set(c.row, [...rows.get(c.row) ?? [], c]));
        const rowCount = block.cells.reduce((count, cell) => Math.max(count, cell.row + cell.row_span), 0);
        return <section key={block.id} tabIndex={-1} data-block-id={block.id} data-focused={target === block.id} className={`pa-document-block pa-block-${block.kind}`}>
          {block.kind === 'title' ? <h1>{content}</h1> : block.kind === 'heading' ? React.createElement(`h${Math.min(6, Math.max(2, block.level))}`, {}, content)
            : block.kind === 'table' && block.cells.length ? <div className="pa-table-scroll" tabIndex={0}><table><caption>{content}</caption><tbody>{Array.from({ length: rowCount }, (_, row) => <tr key={row}>{(rows.get(row) ?? []).map((cell, index) => React.createElement(cell.header ? 'th' : 'td', { key: index, rowSpan: cell.row_span, colSpan: cell.column_span }, <Contents tokens={cell.content} onTarget={followTarget}/>))}</tr>)}</tbody></table></div>
            : block.kind === 'figure' ? <figure><figcaption>{content}</figcaption><p className="pa-document-meta">Image bytes not acquired or visually observed.</p>{block.images.map((image, index) => <span key={index}>{image.alt || `Image ${index + 1}`} · metadata only </span>)}</figure>
            : block.kind === 'code' ? <pre>{content}</pre> : <div>{content}</div>}
          {block.limitations.length > 0 && <p className="pa-document-meta">{block.limitations.join('; ')}</p>}
          <Button variant="ghost" disabled={busy || !activeRevision} onClick={() => void source(block)}>Reveal original</Button>
        </section>;
      })}
      {original && <aside className="pa-original-html" aria-label="Original HTML source"><Toolbar><strong>Original HTML · characters {original.start}–{original.end}</strong><Button onClick={() => { originalEpoch.current++; setOriginal(null); if (originalBlock) reveal(originalBlock); }}>Close source</Button></Toolbar><p>{original.blockLocator ? `Block source: lines ${original.blockLocator.start_line}–${original.blockLocator.end_line}` : 'No exact block window available.'}</p><pre tabIndex={0}>{original.content}</pre>{original.nextStart != null && <Button disabled={busy || !activeRevision} onClick={() => void source(document.blocks.find(b => b.id === originalBlock), original.nextStart!)}>Next original window</Button>}</aside>}
    </>}
  </div>;
}
