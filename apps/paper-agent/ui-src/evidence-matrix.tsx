import React from 'react';
import type { Intent, Report } from './types';
import type { Translator } from './i18n';
import type { Citation } from './documents';

export function EvidenceMatrix({ matrix, intent, onCite, t }: {
  matrix: Report['matrix']; intent: Intent; onCite(value: Citation): void; t: Translator;
}) {
  if (!matrix) return null;
  return <section className="pa-matrix">
    <h2>{t('matrix')}</h2>
    <div className="pa-table-scroll" tabIndex={0} role="region" aria-label={t('matrix')}><table>
      <thead><tr><th scope="col">{t('papers')}</th>{matrix.columns.map(column => <th scope="col" key={column.id}>{column.label}</th>)}</tr></thead>
      <tbody>{intent.papers.map((paper, index) => <tr key={paper.id}>
        <th scope="row"><button type="button" className="pa-matrix-source" onClick={() => onCite({ paperId: paper.id })}>[{index + 1}] {paper.title}</button></th>
        {matrix.columns.map(column => {
          const cell = matrix.cells.find(cell => cell.paperId === paper.id && cell.columnId === column.id);
          return <td key={column.id} data-status={cell?.status ?? 'missing'}>
            {cell?.status !== 'supported' && <span>{t(cell?.status === 'conflict' ? 'conflict' : 'missing')}</span>}
            {cell?.value && <p>{cell.value}</p>}
            <div className="pa-cell-evidence">{cell?.evidence.map((ref, i) => <button className="pa-inline-citation" type="button" key={i} aria-label={`${column.label} ${t('evidence')} ${i + 1}`} onClick={() => onCite(ref)}>[{i + 1}]</button>)}</div>
          </td>;
        })}
      </tr>)}</tbody>
    </table></div>
  </section>;
}
