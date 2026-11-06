import React, { useEffect, useRef, useState } from 'react';
import { Button, Toolbar } from '@pero/app-sdk/ui';
import type { Api, EvidenceLocation, Paper, PdfFocus, PdfSource, PdfRect, TextFocus } from './types';
import { PdfReader, type ReaderChrome } from './pdf-reader';
import { SavedTextReading } from './saved-text-reading';
import { StructuredReading } from './structured-reading';
import type { Translator } from './i18n';
import './reader-workspace.css';

export function Reader({ paper, busy, openToken, pdfReloadToken, api, pdfFocus, textFocus, onFull, onDiscuss, onMatrixAdded, onReview, chrome, t }: {
  paper: Paper; busy: boolean; openToken: number; pdfReloadToken?: number; api: Api; pdfFocus?: PdfFocus | null; textFocus?: TextFocus | null; onFull(): void;
  onDiscuss(text: string, source?: PdfSource): void; onMatrixAdded(): Promise<void>; onReview(): void; chrome: ReaderChrome; t: Translator;
}) {
  const [structured, setStructured] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [readRequest, setReadRequest] = useState(0);
  return <article className="pa-document pa-reading-document" data-paper-id={paper.id} data-structured={structured} aria-label={paper.title}>
    <PdfReader key={paper.id} sourceUrl={sourceUrl} openToken={openToken} readRequest={readRequest} pdfReloadToken={pdfReloadToken} chrome={chrome} paper={paper} api={api} focus={textFocus ? null : pdfFocus} lockText={!!textFocus} readLabel={t('readerText')} t={t} onDiscuss={onDiscuss} onMatrixAdded={onMatrixAdded}>
      <div className="pa-text-reading pero-reader-body"><div className="pero-reader-content">
        <StructuredReading onDiscuss={onDiscuss} onSourceUrl={setSourceUrl} paperSource={paper.source} openToken={openToken} showText={!!textFocus} api={api} paperId={paper.id} onReady={setStructured} onPrepared={() => setReadRequest(value => value + 1)} onReview={onReview}>
        <SavedTextReading paper={paper} busy={busy} textFocus={textFocus} onFull={onFull} onDiscuss={onDiscuss} t={t}/>
        </StructuredReading>
      </div></div>
    </PdfReader>
  </article>;
}

export { ReportView, Experiments, type Citation } from './report-content';
import type { Citation } from './report-content';

export function EvidencePanel({ citation, location, paper, busy, onClose, onRead, t }: { citation: Citation | null; location: EvidenceLocation | null; paper: Paper | undefined; busy: boolean; onClose(): void; onRead(page?: number, rects?: PdfRect[]): void; t: Translator }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (citation) panel.current?.querySelector('button')?.focus(); }, [citation]);
  if (!citation) return null;
  return <aside ref={panel} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }} className="pa-evidence" aria-label={t('evidence')}>
    <Toolbar actions={<Button variant="ghost" onClick={onClose}>{t('close')}</Button>}><h2>{t('evidence')}</h2></Toolbar>
    <h3>{paper?.title}</h3><p className="pa-kicker">{paper?.source} / {paper && t(paper.contentKind === 'abstract' ? 'abstract' : paper.contentKind === 'report' ? 'sourceReport' : 'fullText')}</p>
    {busy ? <p role="status">{t('loading')}</p> : location ? <><p className="pa-kicker">{t('exactQuote')}{location.heading && ` / ${location.heading}`}</p><div className="pa-evidence-context">{location.before && <span>{location.before}</span>}<mark>{location.quote}</mark>{location.after && <span>{location.after}</span>}</div></> : <p>{t('missingQuote')}</p>}
    {location?.pdf?.verification === 'page-text-match' && <p>Matching pages only; the exact region is unavailable.</p>}
    {!!location?.pdf?.candidates?.length && <p>Multiple exact matches. Choose a region. {location.pdf.candidateCount! > location.pdf.candidates!.length && `Showing the first ${location.pdf.candidates!.length} of ${location.pdf.candidateCount}; use a longer quote to narrow the location.`}</p>}
    {location?.pdf?.candidates?.length ? <div className="pa-actions">{location.pdf.candidates.map((candidate, index) => <Button key={index} onClick={() => onRead(candidate.page, candidate.rects)}>Page {candidate.page} · Match {index + 1} ↗</Button>)}</div> : location?.pdf ? <div className="pa-actions">{location.pdf.pages.map(page => <Button key={page} disabled={!paper} onClick={() => onRead(page)}>{t('pdfPage')} {page} ↗</Button>)}</div> : <Button disabled={!paper} onClick={() => onRead()}>{t('readSource')}</Button>}
  </aside>;
}
