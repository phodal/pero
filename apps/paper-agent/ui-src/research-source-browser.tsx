import React, { useEffect, useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Select, Feedback, Split, SplitPane } from '@pero/app-sdk/ui';
import type { Api, PdfFocus, SourceFocus } from './types';
import type { ResearchBundle, SourceObservation, SourceEvidenceLocation } from './research-types';
import { SourceReports } from './research-source-reports';
import type { SourceReceipt } from './research-sources';

type Structure = { kind: string; name?: string; startLine: number; endLine: number; start: number; end: number; caption: string | null; context: string | null; reference: string | null };
type SourceMember = { id: string; path: string; sha256: string; size: number; kind: 'tex' | 'text' | 'image' | 'binary' | 'unknown_encoding'; lineCount: number | null; warning?: string; originalWidth?: number | null; originalHeight?: number | null; previewWidth?: number | null; previewHeight?: number | null; width?: number | null; height?: number | null; previewSha256?: string | null; previewUrl: string | null; structures: Structure[] };
type SourceList = { receipt: SourceReceipt; members: SourceMember[]; limitations: string[] };
type SourceRead = { observationId?: string; observationWarning?: string; archiveDigest: string; memberId: string; memberPath: string; memberDigest: string; startLine: number; endLine: number; start: number; end: number; content: string; nextLine: number | null; nextStart: number | null; totalLines: number };
type SourceComparison = { observationId?: string; observationWarning?: string; status: 'matched' | 'unresolved'; reason: string; matches: {
  source: { archiveDigest: string; memberId: string; memberPath: string; memberDigest: string; startLine: number; endLine: number; start: number; end: number; caption: string };
  pdf: { paperId?: string; documentId: string; fileDigest: string; page: number; start: number; end: number; quote: string };
}[] };

export function SourceBrowser({ api, bundle, resourceId, receipt, available = true, onRead, inspectionOnly = false, initialMemberId, initialFocus, onPreview }: {
  api: Api; bundle: ResearchBundle; resourceId: string; receipt: SourceReceipt; available?: boolean; inspectionOnly?: boolean; initialMemberId?: string; initialFocus?: SourceFocus | null;
  onPreview?(focus: SourceFocus): Promise<void>; onRead(id: string, focus?: PdfFocus): void | boolean | Promise<void | boolean>;
}) {
  const { t: copy } = useAppI18n({
    files: { zh: '文件', en: 'Files' }, loading: { zh: '正在读取源码…', en: 'Reading saved source…' },
    empty: { zh: '没有可查看的文件。', en: 'No inspectable files.' },
    choose: { zh: '选择文件查看源码。', en: 'Select a file to inspect its source.' },
    retry: { zh: '重试读取', en: 'Retry source read' }, start: { zh: '文件开头', en: 'Start of file' },
    next: { zh: '继续读取', en: 'Continue source' }, identity: { zh: '文件信息', en: 'File identity' },
    lines: { zh: '第 {start}–{end} 行，共 {total} 行', en: 'Lines {start}–{end} of {total}' },
    structures: { zh: '源码结构', en: 'Source structures' },
    encoding: { zh: '无法确认文本编码，可查看原始文件信息。', en: 'Text encoding could not be verified.' },
    limits: { zh: '解析范围与限制', en: 'Parsing scope and limits' },
    advanced: { zh: 'PDF 对照与证据', en: 'PDF comparison and evidence' },
    compare: { zh: '对照已保存的 PDF', en: 'Compare with saved PDF' },
    compareScope: { zh: '源码行号不对应 PDF 页码。只有已记录的文本匹配可用于定位。', en: 'Source lines do not map to PDF pages. Locations require recorded text matches.' },
    choosePdf: { zh: '选择已保存的 PDF', en: 'Select a saved PDF' },
    compareAction: { zh: '对照源码与 PDF', en: 'Compare source and PDF' },
    noPdf: { zh: '尚未保存用于对照的 PDF。请先下载相同版本的 PDF。', en: 'No PDF saved for comparison. Download a fixed-version PDF first.' },
    resize: { zh: '调整文件列表宽度', en: 'Resize source file list' },
    source: { zh: '只读源码', en: 'Read-only source file' },
    previewLine: { zh: '定位第 {line} 行的排版位置', en: 'Show typeset position of line {line}' },
    unavailable: { zh: '此文件没有可用预览。', en: 'No preview is available for this file.' },
  });
  const [listing, setListing] = useState<SourceList | null>(null), [member, setMember] = useState<SourceMember | null>(null);
  const [reading, setReading] = useState<SourceRead | null>(null), [image, setImage] = useState<string | null>(null);
  const [comparison, setComparison] = useState<SourceComparison | null>(null), [pdfId, setPdfId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [reportRefresh, setReportRefresh] = useState(0), [observationWarning, setObservationWarning] = useState('');
  const mounted = useRef(true), epoch = useRef(0), imageURL = useRef<string | null>(null);
  const pdfs = bundle.resources.filter(r => r.kind === 'pdf_candidate' && bundle.pdfDownloadIds?.includes(r.id));
  const originalDimensions = member?.originalWidth != null && member.originalHeight != null ? `${member.originalWidth} × ${member.originalHeight} px` : 'Unknown (not recorded)';
  const previewWidth = member?.previewWidth ?? member?.width, previewHeight = member?.previewHeight ?? member?.height;
  const previewDimensions = previewWidth != null && previewHeight != null ? `${previewWidth} × ${previewHeight} px` : 'Unknown (not recorded)';
  const request = <T,>(value: Record<string, unknown>) => api.post<T>('/api/research/source-read', { bundleId: bundle.id, resourceId, ...value });
  useEffect(() => {
    const identity = initialFocus?.memberId ?? initialMemberId;
    if (!identity || !listing) return;
    const initial = listing.members.find(item => item.id === identity);
    if (initial) void readMember(initial, 0, undefined, initialFocus?.line);
  }, [listing, initialMemberId, initialFocus]);
  function clearImage() { if (imageURL.current) URL.revokeObjectURL(imageURL.current); imageURL.current = null; setImage(null); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; if (imageURL.current) URL.revokeObjectURL(imageURL.current); }; }, []);
  useEffect(() => {
    if (!available) { epoch.current++; setError(''); setObservationWarning(''); setListing(null); setMember(null); setReading(null); clearImage(); setComparison(null); setBusy(false); return; }
    let alive = true; setBusy(true); setError('');
    request<SourceList>({ operation: 'list' }).then(value => { if (alive) setListing(value); }, error => { if (alive) setError(String(error)); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [api, resourceId, attempt, available]);
  async function readMember(item: SourceMember, start = 0, end?: number, line?: number) {
    if (!available) return;
    const version = ++epoch.current; setMember(item); setReading(null); clearImage(); setBusy(true); setError(''); setObservationWarning('');
    try {
      if (item.kind === 'tex' || item.kind === 'text') {
        const value = await request<SourceRead>({ operation: 'read', memberId: item.id, ...(line == null
          ? { start, ...(end == null ? {} : { end }) }
          : { startLine: line, endLine: Math.min(line + 19, item.lineCount ?? line) }) });
        if (mounted.current && version === epoch.current) { setReading(value); setObservationWarning(value.observationWarning || ''); if (value.observationId) setReportRefresh(n => n + 1); }
      } else if (item.kind === 'image' && item.previewUrl) {
        // The same bounded image operation used by App tools records the supplied
        // preview; merely listing a member is not image observation.
        const value = await request<{ type: 'source_image'; mimeType: string; data: string; observationId?: string; observationWarning?: string }>({ operation: 'image', memberId: item.id });
        if (value.mimeType !== 'image/png') throw new Error('Only the validated PNG preview is supported');
        const bytes = Uint8Array.from(atob(value.data), character => character.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/png' });
        if (mounted.current && version === epoch.current) { imageURL.current = URL.createObjectURL(blob); setImage(imageURL.current); setObservationWarning(value.observationWarning || ''); if (value.observationId) setReportRefresh(n => n + 1); }
      }
    } catch (error) { if (mounted.current && version === epoch.current) setError(String(error)); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  async function compare() {
    if (!pdfId || busy || !available) return;
    const version = ++epoch.current; setBusy(true); setError(''); setComparison(null); setObservationWarning('');
    try { const value = await request<SourceComparison>({ operation: 'compare', pdfResourceId: pdfId }); if (mounted.current && version === epoch.current) { setComparison(value); setObservationWarning(value.observationWarning || ''); if (value.observationId) setReportRefresh(n => n + 1); } }
    catch (error) { if (mounted.current && version === epoch.current) setError(String(error)); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  async function previewLine(focus: SourceFocus) {
    if (!onPreview || busy) return;
    setBusy(true); setError('');
    try { await onPreview(focus); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function reveal(match: { pdf: { documentId: string; fileDigest: string; page: number; start?: number; end?: number } }, resource = pdfId) {
    if (busy) return;
    const version = ++epoch.current; setBusy(true); setError(''); setObservationWarning('');
    try {
      const value = await api.post<{ localAvailable: boolean; receipt: null | { paperId: string; documentId: string; fileDigest: string } }>('/api/research/pdf', { operation: 'status', bundleId: bundle.id, resourceId: resource });
      if (!value.localAvailable || value.receipt?.documentId !== match.pdf.documentId || value.receipt.fileDigest !== match.pdf.fileDigest) throw new Error('The compared PDF version is unavailable. Restore that exact PDF before opening the match.');
      const focus = match.pdf.start != null && match.pdf.end != null
        ? await api.post<PdfFocus>('/api/pdf/locate', match.pdf)
        : { documentId: match.pdf.documentId, page: match.pdf.page };
      if (mounted.current && version === epoch.current && await onRead(value.receipt.paperId, focus) === false) throw new Error('Could not open the saved PDF. Try opening the match again.');
    } catch (error) { if (mounted.current && version === epoch.current) setError(String(error)); }
    finally { if (mounted.current && version === epoch.current) setBusy(false); }
  }
  function originalMember(observation: SourceObservation, location: SourceEvidenceLocation) {
    if (observation.resourceId !== resourceId || location.archiveDigest !== receipt.archiveDigest) return undefined;
    return listing?.members.find(item => item.id === location.memberId && item.sha256 === location.memberDigest);
  }
  return <div className="pa-source-browser">
    {busy && <p role="status">{copy('loading')}</p>}
    {error && <Feedback kind="error">{error}<Button disabled={busy} onClick={() => { if (member) void readMember(member); else setAttempt(n => n + 1); }}>{copy('retry')}</Button></Feedback>}
    {observationWarning && <Feedback>{observationWarning}</Feedback>}
    {listing && <Split className="pa-source-split" storageKey="paper-source-files" collapseBelow={660}>
      <SplitPane id={`source-files-${resourceId}`} size={240} min={160} resizeLabel={copy('resize')} as="aside">
        <h4>{copy('files')}</h4>{!listing.members.length && <p>{copy('empty')}</p>}<ul className="pa-source-files">{listing.members.map(item => <li key={item.id}><Button variant="ghost" aria-pressed={member?.id === item.id} disabled={busy} onClick={() => void readMember(item)}>{item.path}</Button><small>{item.kind} / {item.size.toLocaleString()} B{item.lineCount ? ` / ${item.lineCount} lines` : ''}</small></li>)}</ul>
      </SplitPane>
      <SplitPane id={`source-content-${resourceId}`} min={240} as="section" aria-label={copy('source')}>
        {!member ? <p>{copy('choose')}</p> : <><h4>{member.path}</h4>
          {member.warning && <Feedback>{member.warning}</Feedback>}<details><summary>{copy('identity')}</summary><dl className="pa-resource-provenance"><dt>Archive SHA-256</dt><dd>{receipt.archiveDigest}</dd><dt>Original member SHA-256</dt><dd>{member.sha256}</dd><dt>Original size</dt><dd>{member.size.toLocaleString()} B</dd>{member.previewSha256 && <><dt>Preview SHA-256</dt><dd>{member.previewSha256}</dd></>}<dt>Member</dt><dd>{member.id}</dd></dl></details>
          {member.kind === 'image' && <p>Original image: {originalDimensions}. Preview: {previewDimensions}.</p>}
          {reading && <><p>{copy('lines', { start: reading.startLine, end: reading.endLine, total: reading.totalLines })}</p><pre className="pa-source-text" tabIndex={0} aria-label={`Original source: ${reading.memberPath}`}>{onPreview ? (reading.content.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []).filter(Boolean).map((text, index) => {
            const line = reading.startLine + index;
            return <span className="pa-source-line" key={line}><button type="button" disabled={busy} aria-label={copy('previewLine', { line })} onClick={() => void previewLine({ memberId: reading.memberId, line })}>{line}</button>{initialFocus?.memberId === reading.memberId && initialFocus.line === line ? <mark>{text}</mark> : text}</span>;
          }) : reading.content}</pre><div className="pa-actions"><Button disabled={busy || reading.start === 0} onClick={() => void readMember(member)}>{copy('start')}</Button><Button disabled={busy || reading.nextStart == null} onClick={() => void readMember(member, reading.nextStart!)}>{copy('next')}</Button></div></>}
          {image && <figure><img className="pa-source-image" src={image} alt={`Source image ${member.path}`}/><figcaption>Validated raster preview. Its dimensions and SHA-256 describe the preview, not the original file. Not experiment code or data.</figcaption></figure>}
          {!busy && !reading && !image && <p>{member.kind === 'unknown_encoding' ? copy('encoding') : copy('unavailable')}</p>}
          {!!member.structures.length && <details className="pa-source-structures"><summary>{copy('structures')} ({member.structures.length})</summary><p>These are source locations, not compiled numbering or complete TeX interpretation. Nearby text is context only.</p><ul>{member.structures.map((item, i) => <li key={i}><Button variant="ghost" disabled={busy} onClick={() => void readMember(member, item.start)}>{item.kind}{item.name ? `: ${item.name}` : ''} / lines {item.startLine}–{item.endLine}</Button>{item.caption && <p>{item.caption}</p>}{item.reference && <p>Reference: {item.reference}</p>}{item.context && <p className="pa-muted">Context: {item.context}</p>}</li>)}</ul></details>}
        </>}
      </SplitPane>
    </Split>}
    {!inspectionOnly && <details className="pa-source-analysis"><summary>{copy('advanced')}</summary><section className="pa-source-compare" aria-label={copy('compare')}><h4>{copy('compare')}</h4>
      <p>{copy('compareScope')}</p>
      {pdfs.length ? <div className="pa-actions"><label>{copy('choosePdf')} <Select label={copy('choosePdf')} value={pdfId} disabled={busy} onChange={value => { setPdfId(value); setComparison(null); }} options={[{ value: '', label: copy('choosePdf') }, ...pdfs.map(pdf => ({ value: pdf.id, label: pdf.title, hint: pdf.originalUrl }))]} showHint/></label><Button disabled={busy || !pdfId || !available} onClick={() => void compare()}>{copy('compareAction')}</Button></div> : <p>{copy('noPdf')}</p>}
      {comparison && <><p role="status">{comparison.status === 'matched' ? 'Evidence-backed caption matches' : 'Comparison unresolved'}: {comparison.reason}</p><ul>{comparison.matches.map((match, i) => <li key={i}><p>{match.source.memberPath}, lines {match.source.startLine}–{match.source.endLine}</p><blockquote>{match.pdf.quote}</blockquote><Button disabled={busy} onClick={() => void reveal(match)}>Open matched PDF page {match.pdf.page}</Button><details><summary>Match versions</summary><dl className="pa-resource-provenance"><dt>Archive SHA-256</dt><dd>{match.source.archiveDigest}</dd><dt>Member SHA-256</dt><dd>{match.source.memberDigest}</dd><dt>PDF SHA-256</dt><dd>{match.pdf.fileDigest}</dd><dt>PDF document</dt><dd>{match.pdf.documentId}</dd></dl></details></li>)}</ul></>}
    </section>
    <SourceReports key={bundle.id} api={api} bundleId={bundle.id} refresh={reportRefresh} navigating={busy}
      canOpenSource={(observation, location) => !!originalMember(observation, location)}
      openSource={(observation, location) => { const item = originalMember(observation, location); if (item) void readMember(item, location.start ?? 0, location.end ?? undefined); }}
      canOpenPdf={observation => !!observation.anchor.pdfResourceId && pdfs.some(pdf => pdf.id === observation.anchor.pdfResourceId)}
      openPdf={(observation, match) => { if (observation.anchor.pdfResourceId && pdfs.some(pdf => pdf.id === observation.anchor.pdfResourceId)) void reveal(match, observation.anchor.pdfResourceId); }}/>
      {!!listing?.limitations.length && <details><summary>{copy('limits')}</summary><ul>{listing.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}</ul></details>}
    </details>}
  </div>;
}
