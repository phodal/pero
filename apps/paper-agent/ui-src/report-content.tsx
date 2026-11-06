import React from 'react';
import { Button, Disclosure, EmptyState, Toolbar } from '@pero/app-sdk/ui';
import { ScientificContent } from './scientific-content';
import { EvidenceMatrix } from './evidence-matrix';
import type { Api, Evidence, Intent, Report, PdfFocus } from './types';
import type { Translator } from './i18n';

export type Citation = { paperId: string; quote?: string; passageId?: string; anchor?: PdfFocus };
function Citations({ paperIds, evidence, intent, onCite, t }: { paperIds: string[]; evidence?: Evidence[]; intent: Intent; onCite(value: Citation): void; t: Translator }) {
  return <div className="pa-citations" aria-label={t('evidence')}>{paperIds.flatMap(id => {
    const paper = intent.papers.find(paper => paper.id === id), refs = evidence?.filter(item => item.paperId === id) ?? [];
    const quotes = refs.length ? refs.map(ref => ref.quote) : [undefined];
    return quotes.map((quote, index) => {
      const page = intent.passages?.find(passage => passage.id === refs[index]?.passageId)?.page;
      return <Button key={`${id}:${index}`} variant="ghost" onClick={() => onCite({ paperId: id, quote, passageId: refs[index]?.passageId })}><span className="pa-citation-number">{intent.papers.findIndex(paper => paper.id === id) + 1}{quotes.length > 1 && `.${index + 1}`}</span><span>{page && intent.papers.length === 1 ? `${t('pdfPage')} ${page}` : paper?.title ?? id}</span>{page && intent.papers.length > 1 && <span>{t('pdfPage')} {page}</span>}{quote && <span aria-label={t('exactQuote')}>↗</span>}</Button>;
    });
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
    <footer className="pa-report-limitations"><h2>{t('limitations')}</h2><p className="pa-prose">{report.limitations}</p>{!!intent.retrieval?.gaps?.length && <><h3>{t('researchGaps')}</h3><ul>{intent.retrieval.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></>}{!!report.experiments?.length && <small>{t('reported')}</small>}</footer>
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
