import React from 'react';
import { Button, Icon, PageHeader } from '@pero/app-sdk/ui';
import type { Translator } from './i18n';
import type { Paper } from './types';

export function ComparePapers({ papers, saving, busy, onDownload, onBack, onCompare, t }: {
  papers: Paper[]; saving: boolean; busy: boolean;
  onDownload(paper: Paper): void; onBack(): void; onCompare(fullText: boolean): void; t: Translator;
}) {
  const pdfReady = papers.filter(paper => paper.hasSearchablePdf).length;
  const textReady = papers.length > 1 && papers.every(paper => paper.hasSavedText);
  const allPdfReady = papers.length > 1 && pdfReady === papers.length;
  const textOnly = papers.some(paper => paper.contentKind !== 'full-text');
  return <div className="pa-research-page">
    <PageHeader title={t('comparePapers')} navigation={<Button variant="ghost" aria-label={t('backFromComparison')} onClick={onBack}><Icon name="chevron-left" size={16}/></Button>}/>
    <p className="pa-research-description" role="status">{t('comparisonPdfReady')} {pdfReady}/{papers.length}</p>
    <table className="pa-comparison-table">
      <thead><tr><th scope="col">{t('paperColumn')}</th><th scope="col">{t('savedText')}</th><th scope="col">PDF</th></tr></thead>
      <tbody>{papers.map(paper => {
        const downloadable = !paper.hasCachedPdf && !!(paper.pdfUrl || paper.pdfCandidateUrl);
        return <tr key={paper.id}>
          <th scope="row">{paper.title}</th>
          <td>{t(!paper.hasSavedText ? 'comparisonNoText' : paper.contentKind === 'abstract' ? 'abstract' : paper.contentKind === 'report' ? 'sourceReport' : 'fullText')}</td>
          <td><span>{t(paper.hasSearchablePdf ? 'comparisonSearchable' : paper.hasCachedPdf ? 'comparisonScanned' : downloadable ? 'comparisonPdfMissing' : 'comparisonNoPdf')}</span>
            {downloadable && <Button variant="ghost" disabled={saving || busy} aria-label={`${t('downloadPdf')} · ${paper.title}`} onClick={() => onDownload(paper)}>{t('downloadPdf')}</Button>}</td>
        </tr>;
      })}</tbody>
    </table>
    <div className="pa-actions pa-comparison-actions">
      <Button variant={allPdfReady ? 'primary' : 'secondary'} disabled={busy || !allPdfReady} onClick={() => onCompare(true)}>{t('compareUsingPdf')}</Button>
      <Button variant={!allPdfReady && textReady ? 'primary' : 'secondary'} disabled={busy || !textReady} onClick={() => onCompare(false)}>{t('compareUsingSavedText')}</Button>
    </div>
    <p className="pa-research-description">{t(!allPdfReady ? 'comparisonPdfRequirement' : 'comparisonDraftHint')}{textOnly && <> {t('comparisonSnapshotLimit')}</>}</p>
  </div>;
}
