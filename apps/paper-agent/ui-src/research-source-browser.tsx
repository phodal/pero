import React, { useEffect, useRef, useState } from 'react';
import { Button, Feedback, Split, SplitPane } from '@pero/app-sdk/ui';
import type { Api, PdfFocus } from './types';
import type { ResearchBundle } from './research-types';
import type { SourceReceipt } from './research-sources';

type Structure = { kind: string; name?: string; startLine: number; endLine: number; start: number; end: number; caption: string | null; context: string | null; reference: string | null };
type SourceMember = { id: string; path: string; sha256: string; size: number; kind: 'tex' | 'text' | 'image' | 'binary' | 'unknown_encoding'; lineCount: number | null; warning?: string; originalWidth?: number | null; originalHeight?: number | null; previewWidth?: number | null; previewHeight?: number | null; width?: number | null; height?: number | null; previewSha256?: string | null; previewUrl: string | null; structures: Structure[] };
type SourceList = { receipt: SourceReceipt; members: SourceMember[]; limitations: string[] };
type SourceRead = { archiveDigest: string; memberId: string; memberPath: string; memberDigest: string; startLine: number; endLine: number; start: number; end: number; content: string; nextLine: number | null; nextStart: number | null; totalLines: number };
type SourceComparison = { status: 'matched' | 'unresolved'; reason: string; matches: {
  source: { archiveDigest: string; memberId: string; memberPath: string; memberDigest: string; startLine: number; endLine: number; start: number; end: number; caption: string };
  pdf: { paperId?: string; documentId: string; fileDigest: string; page: number; start: number; end: number; quote: string };
}[] };

export function SourceBrowser({ api, bundle, resourceId, receipt, onRead }: {
  api: Api; bundle: ResearchBundle; resourceId: string; receipt: SourceReceipt; onRead(id: string, focus?: PdfFocus): void;
}) {
  const [listing, setListing] = useState<SourceList | null>(null), [member, setMember] = useState<SourceMember | null>(null);
  const [reading, setReading] = useState<SourceRead | null>(null), [image, setImage] = useState<string | null>(null);
  const [comparison, setComparison] = useState<SourceComparison | null>(null), [pdfId, setPdfId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const mounted = useRef(true), epoch = useRef(0), imageURL = useRef<string | null>(null);
  const pdfs = bundle.resources.filter(r => r.kind === 'pdf_candidate' && bundle.pdfDownloadIds?.includes(r.id));
  const originalDimensions = member?.originalWidth != null && member.originalHeight != null ? `${member.originalWidth} × ${member.originalHeight} px` : 'Unknown (not recorded)';
  const previewWidth = member?.previewWidth ?? member?.width, previewHeight = member?.previewHeight ?? member?.height;
  const previewDimensions = previewWidth != null && previewHeight != null ? `${previewWidth} × ${previewHeight} px` : 'Unknown (not recorded)';
  const request = <T,>(value: Record<string, unknown>) => api.post<T>('/api/research/source-read', { bundleId: bundle.id, resourceId, ...value });
  function clearImage() { if (imageURL.current) URL.revokeObjectURL(imageURL.current); imageURL.current = null; setImage(null); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; if (imageURL.current) URL.revokeObjectURL(imageURL.current); }; }, []);
  useEffect(() => {
    let alive = true; setBusy(true); setError('');
    request<SourceList>({ operation: 'list' }).then(value => { if (alive) setListing(value); }, error => { if (alive) setError(String(error)); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [api, resourceId, attempt]);
  async function readMember(item: SourceMember, start = 0) {
    const version = ++epoch.current; setMember(item); setReading(null); clearImage(); setBusy(true); setError('');
    try {
      if (item.kind === 'tex' || item.kind === 'text') {
        const value = await request<SourceRead>({ operation: 'read', memberId: item.id, start });
        if (mounted.current && version === epoch.current) setReading(value);
      } else if (item.kind === 'image' && item.previewUrl) {
        // Never render an archive-controlled URL or active SVG. Backend decodes and
        // re-encodes only bounded PNG/JPEG/WebP members to this fixed local route.
        const response = await fetch(`/api/research/source-image/${receipt.archiveDigest}/${item.id}`);
        if (!response.ok) throw new Error(`Image preview unavailable (${response.status})`);
        if (response.headers.get('Content-Type')?.split(';')[0] !== 'image/png') throw new Error('Only the validated PNG preview is supported');
        const blob = await response.blob();
        if (mounted.current && version === epoch.current) { imageURL.current = URL.createObjectURL(blob); setImage(imageURL.current); }
      }
    } catch (error) { if (mounted.current && version === epoch.current) setError(String(error)); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  async function compare() {
    if (!pdfId || busy) return;
    const version = ++epoch.current; setBusy(true); setError(''); setComparison(null);
    try { const value = await request<SourceComparison>({ operation: 'compare', pdfResourceId: pdfId }); if (mounted.current && version === epoch.current) setComparison(value); }
    catch (error) { if (mounted.current && version === epoch.current) setError(String(error)); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  async function reveal(match: SourceComparison['matches'][number]) {
    if (busy) return;
    const version = ++epoch.current; setBusy(true); setError('');
    try {
      const value = await api.post<{ localAvailable: boolean; receipt: null | { paperId: string; documentId: string; fileDigest: string } }>('/api/research/pdf', { operation: 'status', bundleId: bundle.id, resourceId: pdfId });
      if (!value.localAvailable || value.receipt?.documentId !== match.pdf.documentId || value.receipt.fileDigest !== match.pdf.fileDigest) throw new Error('The compared PDF version is unavailable. Restore that exact PDF before opening the match.');
      if (mounted.current && version === epoch.current) onRead(value.receipt.paperId, { documentId: match.pdf.documentId, page: match.pdf.page });
    } catch (error) { if (mounted.current && version === epoch.current) setError(String(error)); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  return <div className="pa-source-browser">
    {busy && <p role="status">Reading saved source…</p>}
    {error && <Feedback kind="error">{error}<Button disabled={busy} onClick={() => { if (member) void readMember(member); else setAttempt(n => n + 1); }}>Retry source read</Button></Feedback>}
    {listing?.limitations.map((limitation, i) => <Feedback key={i}>{limitation}</Feedback>)}
    {listing && <Split className="pa-source-split" storageKey="paper-source-files" collapseBelow={660}>
      <SplitPane id={`source-files-${resourceId}`} size={240} min={160} resizeLabel="Resize source file list" as="aside">
        <h4>Files</h4>{!listing.members.length && <p>No inspectable files in this saved representation.</p>}<ul className="pa-source-files">{listing.members.map(item => <li key={item.id}><Button variant="ghost" aria-pressed={member?.id === item.id} disabled={busy} onClick={() => void readMember(item)}>{item.path}</Button><small>{item.kind} / {item.size.toLocaleString()} B{item.lineCount ? ` / ${item.lineCount} lines` : ''}</small></li>)}</ul>
      </SplitPane>
      <SplitPane id={`source-content-${resourceId}`} min={240} as="section" aria-label="Read-only source file">
        {!member ? <p>Select a file to inspect its original source.</p> : <><h4>{member.path}</h4>
          {member.warning && <Feedback>{member.warning}</Feedback>}<details><summary>File identity</summary><dl className="pa-resource-provenance"><dt>Archive SHA-256</dt><dd>{receipt.archiveDigest}</dd><dt>Original member SHA-256</dt><dd>{member.sha256}</dd><dt>Original size</dt><dd>{member.size.toLocaleString()} B</dd>{member.previewSha256 && <><dt>Preview SHA-256</dt><dd>{member.previewSha256}</dd></>}<dt>Member</dt><dd>{member.id}</dd></dl></details>
          {member.kind === 'image' && <p>Original image: {originalDimensions}. Preview: {previewDimensions}.</p>}
          {reading && <><p>Original lines {reading.startLine}–{reading.endLine} of {reading.totalLines} / characters {reading.start}–{reading.end}</p><pre className="pa-source-text" tabIndex={0} aria-label={`Original source: ${reading.memberPath}`}>{reading.content}</pre><div className="pa-actions"><Button disabled={busy || reading.start === 0} onClick={() => void readMember(member)}>Start of file</Button><Button disabled={busy || reading.nextStart == null} onClick={() => void readMember(member, reading.nextStart!)}>Continue source</Button></div></>}
          {image && <figure><img className="pa-source-image" src={image} alt={`Source image ${member.path}`}/><figcaption>Validated raster preview. Its dimensions and SHA-256 describe the preview, not the original file. Not experiment code or data.</figcaption></figure>}
          {!busy && !reading && !image && <p>{member.kind === 'unknown_encoding' ? 'Text encoding could not be verified; original file retained without interpretation.' : 'Preview unavailable. SVG, EPS, PDF and binary members are listed, not converted or executed.'}</p>}
          {!!member.structures.length && <details className="pa-source-structures"><summary>Literal source structures ({member.structures.length})</summary><p>These are source locations, not compiled numbering or complete TeX interpretation. Nearby text is context only.</p><ul>{member.structures.map((item, i) => <li key={i}><Button variant="ghost" disabled={busy} onClick={() => void readMember(member, item.start)}>{item.kind}{item.name ? `: ${item.name}` : ''} / lines {item.startLine}–{item.endLine}</Button>{item.caption && <p>{item.caption}</p>}{item.reference && <p>Reference: {item.reference}</p>}{item.context && <p className="pa-muted">Context: {item.context}</p>}</li>)}</ul></details>}
        </>}
      </SplitPane>
    </Split>}
    <section className="pa-source-compare" aria-label="Source and PDF comparison"><h4>Compare with saved PDF</h4>
      <p>Source archive and PDF are separate byte versions. Matches require saved evidence; figure or table numbers alone are not a match.</p>
      {pdfs.length ? <div className="pa-actions"><label>PDF for comparison <select value={pdfId} disabled={busy} onChange={event => { setPdfId(event.target.value); setComparison(null); }}><option value="">Select a saved PDF</option>{pdfs.map(pdf => <option key={pdf.id} value={pdf.id}>{pdf.title} — {pdf.originalUrl}</option>)}</select></label><Button disabled={busy || !pdfId} onClick={() => void compare()}>Compare source and PDF</Button></div> : <p>No PDF approved in this bundle. Review and download a fixed-version PDF separately for comparison.</p>}
      {comparison && <><p role="status">{comparison.status === 'matched' ? 'Evidence-backed caption matches' : 'Comparison unresolved'}: {comparison.reason}</p><ul>{comparison.matches.map((match, i) => <li key={i}><p>{match.source.memberPath}, lines {match.source.startLine}–{match.source.endLine}</p><blockquote>{match.pdf.quote}</blockquote><Button disabled={busy} onClick={() => void reveal(match)}>Open matched PDF page {match.pdf.page}</Button><details><summary>Match versions</summary><dl className="pa-resource-provenance"><dt>Archive SHA-256</dt><dd>{match.source.archiveDigest}</dd><dt>Member SHA-256</dt><dd>{match.source.memberDigest}</dd><dt>PDF SHA-256</dt><dd>{match.pdf.fileDigest}</dd><dt>PDF document</dt><dd>{match.pdf.documentId}</dd></dl></details></li>)}</ul></>}
    </section>
  </div>;
}
