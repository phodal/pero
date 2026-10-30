import React, { useEffect, useRef, useState } from 'react';
import { Button, Disclosure, EmptyState, Toolbar } from '@pero/app-sdk/ui';
import type { Api, Evidence, EvidenceLocation, Intent, Paper, Report, PdfFocus, PdfSource } from './types';
import { PdfReader, type ReaderChrome } from './pdf-reader';
import { ScientificContent } from './scientific-content';
import { EvidenceMatrix } from './evidence-matrix';
import type { Translator } from './i18n';

export function Reader({ paper, busy, api, pdfFocus, onFull, onDiscuss, onMatrixAdded, chrome, t }: {
  paper: Paper; busy: boolean; api: Api; pdfFocus?: PdfFocus | null; onFull(): void;
  onDiscuss(text: string, source?: PdfSource): void; onMatrixAdded(): Promise<void>; chrome: ReaderChrome; t: Translator;
}) {
  const source = useRef<HTMLDivElement>(null);
  const [excerpt, setExcerpt] = useState('');
  useEffect(() => { setExcerpt(''); }, [paper.id]);
  function capture() {
    const selection = window.getSelection();
    if (!paper.content || !selection || !selection.rangeCount || !source.current?.contains(selection.anchorNode) || !source.current.contains(selection.focusNode)) return;
    const value = selection.toString().trim();
    setExcerpt(value.length <= 2000 ? value : '');
  }
  return <article className="pa-document pa-reading-document" data-paper-id={paper.id} aria-label={paper.title}>
    <PdfReader key={paper.id} chrome={chrome} paper={paper} api={api} focus={pdfFocus} t={t} onDiscuss={onDiscuss} onMatrixAdded={onMatrixAdded}>
      <div className="pa-text-reading">
        {paper.contentKind !== 'full-text' && <p className="pa-document-meta">{t(paper.contentKind === 'abstract' ? 'abstract' : 'sourceReport')}</p>}
        <div className="pa-source-text" ref={source} onMouseUp={capture} onKeyUp={capture}>{paper.content ? <ScientificContent content={paper.content}/> : t('loading')}</div>
        {!!excerpt && <div className="pa-reader-actions"><Button onClick={() => onDiscuss(excerpt)}>{t('discussSelection')}</Button></div>}
        <Disclosure summary={t('sourceDetails')}>
          {paper.source !== 'local-pdf' && <a href={paper.url} target="_blank" rel="noreferrer">{t('original')}</a>}
          {paper.contentKind !== 'full-text' && paper.source === 'alphaxiv' && <Button disabled={busy} onClick={onFull}>{t('fetchFull')}</Button>}
          <dl className="pa-details"><dt>SHA-256</dt><dd>{paper.contentDigest}</dd><dt>{t('frozenInput')}</dt><dd>{paper.fetchedAt}</dd></dl>
          <Disclosure summary={t('rawSource')}><pre className="pa-raw-source">{paper.content}</pre></Disclosure>
        </Disclosure>
      </div>
    </PdfReader>
  </article>;
}

export type Citation = { paperId: string; quote?: string; passageId?: string };
function Citations({ paperIds, evidence, intent, onCite, t }: { paperIds: string[]; evidence?: Evidence[]; intent: Intent; onCite(value: Citation): void; t: Translator }) {
  return <div className="pa-citations" aria-label={t('evidence')}>{paperIds.flatMap(id => {
    const paper = intent.papers.find(paper => paper.id === id), refs = evidence?.filter(item => item.paperId === id) ?? [];
    const quotes = refs.length ? refs.map(ref => ref.quote) : [undefined];
    return quotes.map((quote, index) => <Button key={`${id}:${index}`} variant="ghost" onClick={() => onCite({ paperId: id, quote, passageId: refs[index]?.passageId })}><span className="pa-citation-number">{intent.papers.findIndex(paper => paper.id === id) + 1}{quotes.length > 1 && `.${index + 1}`}</span><span>{paper?.title ?? id}</span>{quote && <span aria-label={t('exactQuote')}>↗</span>}</Button>);
  })}</div>;
}
function PrintedEvidence({ evidence, paperIds, intent }: { evidence?: Evidence[]; paperIds: string[]; intent: Intent }) {
  return <div className="pa-print-only"><p className="pa-kicker">{paperIds.map(id => `[${intent.papers.findIndex(paper => paper.id === id) + 1}] ${intent.papers.find(paper => paper.id === id)?.title ?? id}`).join(' / ')}</p>{evidence?.map((item, index) => {
    const number = intent.papers.findIndex(paper => paper.id === item.paperId) + 1;
    return <blockquote className="pa-printed-quote" key={index}><p className="pa-prose">{item.quote}</p><cite>[{number}] {intent.papers.find(paper => paper.id === item.paperId)?.title}</cite></blockquote>;
  })}</div>;
}
export function ReportView({ report, intent, onCite, t, api }: { report: Report | null; intent: Intent | null; onCite(value: Citation): void; t: Translator; api?: Api }) {
  if (!report || !intent) return <EmptyState heading={t('noReport')} description={t('noReportCopy')}/>;
  return <article className="pa-document pa-report" data-report-id={report.id}>
    <header className="pa-document-heading"><h1>{report.title}</h1><p className="pa-document-meta">{t('unverified')}</p></header>
    {report.sections?.map((section, index) => <section className="pa-report-section" key={index}>
      <h2>{section.heading}</h2>
      <ScientificContent content={section.content} evidence={section.evidence} onCite={onCite} citationLabel={t('evidence')}/><PrintedEvidence evidence={section.evidence} paperIds={section.paperIds} intent={intent}/><Citations paperIds={section.paperIds} evidence={section.evidence} intent={intent} onCite={onCite} t={t}/>
    </section>)}
    <EvidenceMatrix api={api} reportId={report.id} matrix={report.matrix} intent={intent} onCite={onCite} t={t}/>
    <footer className="pa-report-limitations"><h2>{t('limitations')}</h2><p className="pa-prose">{report.limitations}</p>{!!report.experiments?.length && <small>{t('reported')}</small>}</footer>
    <section className="pa-print-only pa-print-appendix">
      {!!report.experiments?.length && <><h2>{t('experiments')}</h2>{report.experiments.map((experiment, index) => <section key={index}>
        <h3>{experiment.title} / {t(experiment.status === 'passed' ? 'passed' : experiment.status === 'failed' ? 'experimentFailed' : experiment.status === 'blocked' ? 'blocked' : 'notRun')}</h3>
        <dl><dt>{t('expected')}</dt><dd>{experiment.expected}</dd><dt>{t('observed')}</dt><dd>{experiment.observed}</dd><dt>{t('limitations')}</dt><dd>{experiment.limitations}</dd></dl>
        <PrintedEvidence evidence={experiment.evidence} paperIds={experiment.paperIds} intent={intent}/>
        {!!experiment.commands.length && <><h3>{t('commands')}</h3><pre>{experiment.commands.join('\n')}</pre></>}
        {experiment.files.map(file => <section key={file.path}><h3>{file.path}</h3><pre><code>{file.content}</code></pre></section>)}
      </section>)}</>}
      <h2>{t('sourceVersions')}</h2><ol>{intent.papers.map(paper => <li key={paper.id}><strong>{paper.title}</strong><br/><a href={paper.url}>{paper.url}</a><br/>{paper.source} / {t(paper.contentKind === 'abstract' ? 'abstract' : paper.contentKind === 'report' ? 'sourceReport' : 'fullText')}<br/><code>{paper.contentDigest}</code><br/>{paper.fetchedAt}</li>)}</ol>
    </section>
  </article>;
}
export function Experiments({ report, intent, onCite, t }: { report: Report | null; intent: Intent | null; onCite(value: Citation): void; t: Translator }) {
  if (!report?.experiments?.length || !intent) return <EmptyState heading={t('noExperiments')} description={t('noExperimentsCopy')}/>;
  const statusKey = { passed: 'passed', failed: 'experimentFailed', blocked: 'blocked', 'not-run': 'notRun' } as const;
  return <div className="pa-experiments"><p className="pa-muted">{t('reported')} / {t('unverified')}</p>{report.experiments.map((experiment, index) => <article key={index}>
    <Toolbar><h2>{experiment.title}</h2><span className="pa-experiment-status">{t(statusKey[experiment.status])}</span></Toolbar>
    <Citations paperIds={experiment.paperIds} evidence={experiment.evidence} intent={intent} onCite={onCite} t={t}/>
    <dl><dt>{t('expected')}</dt><dd>{experiment.expected}</dd><dt>{t('observed')}</dt><dd>{experiment.observed}</dd><dt>{t('limitations')}</dt><dd>{experiment.limitations}</dd></dl>
    {!!experiment.commands.length && <Disclosure summary={t('commands')}><pre>{experiment.commands.join('\n')}</pre></Disclosure>}
    {experiment.files.map(file => <Disclosure key={file.path} summary={file.path}><pre className="pa-code"><code>{file.content}</code></pre></Disclosure>)}
  </article>)}</div>;
}
export function EvidencePanel({ citation, location, paper, busy, onClose, onRead, t }: { citation: Citation | null; location: EvidenceLocation | null; paper: Paper | undefined; busy: boolean; onClose(): void; onRead(page?: number): void; t: Translator }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (citation) panel.current?.querySelector('button')?.focus(); }, [citation]);
  if (!citation) return null;
  return <aside ref={panel} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }} className="pa-evidence" aria-label={t('evidence')}>
    <Toolbar actions={<Button variant="ghost" onClick={onClose}>{t('close')}</Button>}><h2>{t('evidence')}</h2></Toolbar>
    <h3>{paper?.title}</h3><p className="pa-kicker">{paper?.source} / {paper && t(paper.contentKind === 'abstract' ? 'abstract' : paper.contentKind === 'report' ? 'sourceReport' : 'fullText')}</p>
    {busy ? <p role="status">{t('loading')}</p> : location ? <><p className="pa-kicker">{t('exactQuote')}{location.heading && ` / ${location.heading}`}</p><div className="pa-evidence-context">{location.before && <span>{location.before}</span>}<mark>{location.quote}</mark>{location.after && <span>{location.after}</span>}</div></> : <p>{t('missingQuote')}</p>}
    {location?.pdf ? <div className="pa-actions">{location.pdf.pages.map(page => <Button key={page} disabled={!paper} onClick={() => onRead(page)}>{t('pdfPage')} {page} ↗</Button>)}</div> : <Button disabled={!paper} onClick={() => onRead()}>{t('readSource')}</Button>}
  </aside>;
}
