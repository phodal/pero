import React, { useEffect, useState } from 'react';
import { Button, Feedback } from '@pero/app-sdk/ui';
import type { Api, Paper, PdfAnnotation } from './types';
import type { Translator } from './i18n';

type Cell = { id: string; column: string; annotation: PdfAnnotation };

export function ReadingMatrix({ api, active, count, papers, onOpen, t }: {
  api: Api; active: boolean; count: number; papers: Paper[]; onOpen(annotation: PdfAnnotation): void; t: Translator;
}) {
  const [cells, setCells] = useState<Cell[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true; setLoading(true); setError('');
    api.get<{ cells: Cell[] }>('/api/matrix').then(value => { if (alive) setCells(value.cells); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, active, count, retry]);
  const columns = [...new Set(cells.map(cell => cell.column))], paperIds = [...new Set(cells.map(cell => cell.annotation.paperId))];
  return <section className="pa-document pa-reading-matrix" aria-label={t('matrix')}>
    <h1>{t('matrix')}</h1>
    {loading && <p role="status">{t('loading')}</p>}
    {error && <Feedback kind="error">{error}<Button onClick={() => setRetry(value => value + 1)}>{t('retry')}</Button></Feedback>}
    {!loading && !cells.length && <p>{t('pdfMatrixEmpty')}</p>}
    {!!cells.length && <div className="pa-table-scroll" role="region" tabIndex={0} aria-label={t('matrix')}><table><thead><tr><th scope="col">{t('papers')}</th>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{paperIds.map(id => <tr key={id}><th scope="row">{papers.find(paper => paper.id === id)?.title ?? id}</th>{columns.map(column => <td key={column}>{cells.filter(cell => cell.annotation.paperId === id && cell.column === column).map(cell => <article key={cell.id} data-matrix-annotation={cell.annotation.id}>{cell.annotation.kind === 'figure' ? <img src={`/api/annotations/${cell.annotation.id}/image`} alt={`${t('pdfFigure')} · ${t('pdfPage')} ${cell.annotation.page}`}/> : <blockquote>{cell.annotation.quote}</blockquote>}{cell.annotation.note && <p>{cell.annotation.note}</p>}<Button variant="ghost" onClick={() => onOpen(cell.annotation)}>{t('pdfPage')} {cell.annotation.page} ↗</Button></article>)}</td>)}</tr>)}</tbody></table></div>}
  </section>;
}
