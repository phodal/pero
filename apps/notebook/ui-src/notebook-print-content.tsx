import { Fragment, type ReactNode } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import type { CellAnnotation, NotebookDocument, NotebookNode } from '@pero/notebook';
import { notebookPrintSections, type NotebookPrintSettings } from '@pero/notebook/notebook-print';
import { cellAddress, type Spreadsheet } from '@pero/notebook/spreadsheet';
import { formatCellValue, type CellFormat } from '@pero/notebook/grid-presentation';
import { calculateNotebookWorksheets, type NotebookWorksheet } from '@pero/notebook/worksheet';
import type { StructuredTableDraft } from '@pero/notebook/structured-table';
import type { NotebookMaterial } from '@pero/notebook/workspace';
import { messages } from './messages';

function printableRecord(value: unknown): string {
  return JSON.stringify(value, (key, item) => key === 'data' && typeof item === 'string' ? '[Embedded file bytes omitted from print]' : item, 2);
}
function rootWorksheets(root: NotebookNode): NotebookWorksheet[] {
  const sheets: NotebookWorksheet[] = [];
  const visit = (node: NotebookNode) => {
    if (node.type === 'spreadsheet') sheets.push({ id: String(node.attrs!.blockId), name: String(node.attrs?.label || ''), sheet: node.attrs!.sheet as Spreadsheet });
    node.content?.forEach(visit);
  };
  visit(root);
  return sheets;
}
function RichPrint({ root, includeInputs, contextRoot = root }: { root: NotebookNode; includeInputs: boolean; contextRoot?: NotebookNode }) {
  const { t } = useAppI18n(messages);
  const calculated = calculateNotebookWorksheets(rootWorksheets(contextRoot));
  const nodeView = (node: NotebookNode, key: number): ReactNode => {
    const attrs = node.attrs ?? {}, content = node.content?.map(nodeView);
    switch (node.type) {
      case 'namedReference': return <section key={key}><h3>{String(attrs.name)}</h3><p>{String(attrs.notes)}</p><small>{t('printEntryReference')}</small></section>;
      case 'doc': return <Fragment key={key}>{content}</Fragment>;
      case 'text': {
        let result: ReactNode = node.text;
        for (const mark of node.marks ?? []) {
          if (mark.type === 'bold') result = <strong>{result}</strong>;
          else if (mark.type === 'italic') result = <em>{result}</em>;
          else if (mark.type === 'underline') result = <u>{result}</u>;
          else if (mark.type === 'strike') result = <s>{result}</s>;
          else if (mark.type === 'code') result = <code>{result}</code>;
          else if (mark.type === 'subscript') result = <sub>{result}</sub>;
          else if (mark.type === 'superscript') result = <sup>{result}</sup>;
          else if (mark.type === 'link') result = <>{result} ({String(mark.attrs?.href ?? '')})</>;
        }
        return <Fragment key={key}>{result}</Fragment>;
      }
      case 'paragraph': return <p key={key}>{content ?? <br />}</p>;
      case 'heading': return <h3 key={key}>{content}</h3>;
      case 'section': return <section key={key}><h2>{String(attrs.label || t('section'))}</h2>{!!attrs.date && <p>{String(attrs.date)}</p>}{content}</section>;
      case 'blockquote': return <blockquote key={key}>{content}</blockquote>;
      case 'bulletList': case 'taskList': return <ul key={key}>{content}</ul>;
      case 'orderedList': return <ol key={key} start={typeof attrs.start === 'number' ? attrs.start : 1}>{content}</ol>;
      case 'listItem': return <li key={key}>{content}</li>;
      case 'taskItem': return <li key={key}>{attrs.checked ? '☑' : '☐'} {content}</li>;
      case 'hardBreak': return <br key={key} />;
      case 'horizontalRule': return <hr key={key} />;
      case 'codeBlock': return <pre key={key}>{content}</pre>;
      case 'referenceMention': return <span key={key}>{String(attrs.label)} ({printableRecord(attrs.source)})</span>;
      case 'spreadsheet': {
        const sheet = attrs.sheet as Spreadsheet, calculation = calculated.get(String(attrs.blockId))!;
        const { name, values, ambiguous } = calculation;
        const annotations = attrs.annotations as Record<string, CellAnnotation> | undefined, formats = attrs.formats as Record<string, CellFormat> | undefined;
        return <figure key={key}><figcaption>{name}</figcaption>{ambiguous && <p>{t('printDuplicateWorksheet')}</p>}<table><thead><tr><th>Cell</th>{Array.from({ length: sheet.columns }, (_, c) => <th key={c}>{cellAddress(c, 0).replace(/1$/, '')}</th>)}</tr></thead>
          <tbody>{Array.from({ length: sheet.rows }, (_, r) => <tr key={r}><th>{r + 1}</th>{Array.from({ length: sheet.columns }, (_, c) => { const address = cellAddress(c, r), raw = sheet.cells[address] ?? ''; return <td key={c} style={{ textAlign: formats?.[address]?.align, fontWeight: formats?.[address]?.bold ? 'bold' : undefined, fontStyle: formats?.[address]?.italic ? 'italic' : undefined }}>{formatCellValue(values[address], formats?.[address])}{annotations?.[address]?.unit && <small>{annotations[address].unit}</small>}{!!annotations?.[address]?.evidenceIds.length && <small>{t('evidence')}: {annotations[address].evidenceIds.join(', ')}</small>}{includeInputs && raw.startsWith('=') && <small>{raw}</small>}</td>; })}</tr>)}</tbody></table>
          <small>{t('printCalculatedLocally')}</small>{!!(attrs.merges as unknown[])?.length && <small>{t('printStoredCells')}</small>}</figure>;
      }
      case 'registrationTable': case 'inputTable': {
        const table = attrs.table as StructuredTableDraft;
        return <figure key={key}><figcaption>{table.name || node.type}</figcaption><table><thead><tr>{table.schema.columns.map(column => <th key={column.id}>{column.name} ({column.type})</th>)}</tr></thead><tbody>{table.rows.map(row => <tr key={row.id}>{table.schema.columns.map(column => <td key={column.id}>{row.cells[column.id] ?? ''}</td>)}</tr>)}</tbody></table>
          {!!(attrs.receipts as unknown[])?.length && <pre>{printableRecord(attrs.receipts)}</pre>}</figure>;
      }
      case 'attachment': return <figure key={key}><figcaption>{String(attrs.filename)} {String(attrs.caption || '')}</figcaption>{/^image\/(png|jpeg|gif|webp)$/.test(String(attrs.mime)) && typeof attrs.data === 'string' ? <img src={`data:${attrs.mime};base64,${attrs.data}`} alt={String(attrs.caption || attrs.filename)} /> : <p>{t('printAttachmentBytes')}</p>}<small>SHA-256: {String(attrs.sha256)}</small></figure>;
      case 'finding': return <section key={key}><h3>{t('finding')}</h3><p>{String(attrs.claim || '')}</p><p>{String(attrs.limitations || '')}</p><pre>{printableRecord(attrs.evidenceIds)}</pre></section>;
      default: return <section key={key}><h3>{String(attrs.label || node.type)}</h3><p>{t('printRecordedStructured')}</p><pre>{printableRecord(attrs)}</pre>{content}</section>;
    }
  };
  return <>{nodeView(root, 0)}</>;
}
export function NotebookPrintContent({ document, settings, entryId, revision, dirty, preparedAt }: {
  document: NotebookDocument; settings: NotebookPrintSettings; entryId: string; revision: number; dirty: boolean; preparedAt: string;
}) {
  const { t } = useAppI18n(messages);
  const selected = new Set(settings.sections);
  const materials = (items: NotebookMaterial[]): ReactNode => <ul>{items.map(item => <li key={item.id}><strong>{item.name}</strong> {item.quantity}{item.source && <pre>{printableRecord(item.source)}</pre>}{item.content && <RichPrint root={item.content} includeInputs={settings.includeInputs} />}{item.children && materials(item.children)}</li>)}</ul>;
  // Keep original Notes order and its full calculation context even when only one section is printed.
  const filtered = { ...document.content, content: document.content.content.filter(node => selected.has(node.type === 'section' ? `section:${node.attrs!.blockId}` : 'notes')) };
  const sectionLabels = notebookPrintSections(document).filter(section => selected.has(section.id)).map(section => section.label).join(' · ');
  return <article className="notebook-print-document"><h1>{document.title}</h1><p>{dirty ? t('printUnsavedDraft') : t('printSavedRevision', { revision })}</p>
    {settings.includeMetadata && <header><p>{t('printEntryMeta', { entryId, revision })}</p><p>{t('printPreparedAt', { preparedAt })}</p><p>{settings.paper} · {settings.orientation} · {settings.marginMm} mm</p>{document.metadata && <pre>{printableRecord(document.metadata)}</pre>}</header>}
    <RichPrint root={filtered} contextRoot={document.content} includeInputs={settings.includeInputs} />
    {(document.procedures ?? []).filter(procedure => selected.has(`procedure:${procedure.id}`)).map(procedure => <section key={procedure.id}><h2>{procedure.title}</h2>{procedure.introduction ? <RichPrint root={procedure.introduction} includeInputs={settings.includeInputs} /> : <p>{procedure.description}</p>}
      {!!procedure.materials.length && <><h3>{t('printMaterials')}</h3>{materials(procedure.materials)}</>}
      <ol>{procedure.steps.map(step => <li key={step.id}><p>{step.completed ? '☑' : '☐'} {step.kind ?? 'step'}{step.critical ? ` · ${t('printCritical')}` : ''}{step.pause ? ` · ${t('printPause')}` : ''}{step.minutes !== null ? ` · ${t('printMinutesPlanned', { minutes: step.minutes })}` : ''}</p>
        {step.content ? <RichPrint root={step.content} includeInputs={settings.includeInputs} /> : <p>{step.text}</p>}{step.timer && <p>{t('printRecordedTimer', { elapsedMs: step.timer.elapsedMs, running: step.timer.startedAt !== null ? t('printTimerRunning') : '' })}</p>}</li>)}</ol></section>)}
    <footer>{t('printFooter', { sections: sectionLabels })}</footer>
  </article>;
}
