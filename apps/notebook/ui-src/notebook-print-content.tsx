import { Fragment, type ReactNode } from 'react';
import type { CellAnnotation, NotebookDocument, NotebookNode } from '@pero/notebook';
import { notebookPrintSections, type NotebookPrintSettings } from '@pero/notebook/notebook-print';
import { cellAddress, type Spreadsheet } from '@pero/notebook/spreadsheet';
import { formatCellValue, type CellFormat } from '@pero/notebook/grid-presentation';
import { calculateNotebookWorksheets, type NotebookWorksheet } from '@pero/notebook/worksheet';
import type { StructuredTableDraft } from '@pero/notebook/structured-table';
import type { NotebookMaterial } from '@pero/notebook/workspace';

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
  const calculated = calculateNotebookWorksheets(rootWorksheets(contextRoot));
  const nodeView = (node: NotebookNode, key: number): ReactNode => {
    const attrs = node.attrs ?? {}, content = node.content?.map(nodeView);
    switch (node.type) {
      case 'namedReference': return <section key={key}><h3>{String(attrs.name)}</h3><p>{String(attrs.notes)}</p><small>Entry reference / 条目引用</small></section>;
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
      case 'section': return <section key={key}><h2>{String(attrs.label || 'Section / 章节')}</h2>{!!attrs.date && <p>{String(attrs.date)}</p>}{content}</section>;
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
        return <figure key={key}><figcaption>{name}</figcaption>{ambiguous && <p>Duplicate worksheet name: only local cell references are calculated. / 工作表名称重复，仅计算本表单元格引用。</p>}<table><thead><tr><th>Cell</th>{Array.from({ length: sheet.columns }, (_, c) => <th key={c}>{cellAddress(c, 0).replace(/1$/, '')}</th>)}</tr></thead>
          <tbody>{Array.from({ length: sheet.rows }, (_, r) => <tr key={r}><th>{r + 1}</th>{Array.from({ length: sheet.columns }, (_, c) => { const address = cellAddress(c, r), raw = sheet.cells[address] ?? ''; return <td key={c} style={{ textAlign: formats?.[address]?.align, fontWeight: formats?.[address]?.bold ? 'bold' : undefined, fontStyle: formats?.[address]?.italic ? 'italic' : undefined }}>{formatCellValue(values[address], formats?.[address])}{annotations?.[address]?.unit && <small>{annotations[address].unit}</small>}{!!annotations?.[address]?.evidenceIds.length && <small>Evidence / 证据: {annotations[address].evidenceIds.join(', ')}</small>}{includeInputs && raw.startsWith('=') && <small>{raw}</small>}</td>; })}</tr>)}</tbody></table>
          <small>Calculated locally from recorded inputs; not measured results. / 根据已记输入本地计算，不是实测结果。</small>{!!(attrs.merges as unknown[])?.length && <small>All stored cells are shown, including cells covered by editor merges. / 展示全部已存单元格，包括编辑器合并区域内的单元格。</small>}</figure>;
      }
      case 'registrationTable': case 'inputTable': {
        const table = attrs.table as StructuredTableDraft;
        return <figure key={key}><figcaption>{table.name || node.type}</figcaption><table><thead><tr>{table.schema.columns.map(column => <th key={column.id}>{column.name} ({column.type})</th>)}</tr></thead><tbody>{table.rows.map(row => <tr key={row.id}>{table.schema.columns.map(column => <td key={column.id}>{row.cells[column.id] ?? ''}</td>)}</tr>)}</tbody></table>
          {!!(attrs.receipts as unknown[])?.length && <pre>{printableRecord(attrs.receipts)}</pre>}</figure>;
      }
      case 'attachment': return <figure key={key}><figcaption>{String(attrs.filename)} {String(attrs.caption || '')}</figcaption>{/^image\/(png|jpeg|gif|webp)$/.test(String(attrs.mime)) && typeof attrs.data === 'string' ? <img src={`data:${attrs.mime};base64,${attrs.data}`} alt={String(attrs.caption || attrs.filename)} /> : <p>Attachment bytes are not included in print. / 打印不包含附件字节。</p>}<small>SHA-256: {String(attrs.sha256)}</small></figure>;
      case 'finding': return <section key={key}><h3>Finding / 发现</h3><p>{String(attrs.claim || '')}</p><p>{String(attrs.limitations || '')}</p><pre>{printableRecord(attrs.evidenceIds)}</pre></section>;
      default: return <section key={key}><h3>{String(attrs.label || node.type)}</h3><p>Recorded structured content / 已记录结构化内容</p><pre>{printableRecord(attrs)}</pre>{content}</section>;
    }
  };
  return <>{nodeView(root, 0)}</>;
}
export function NotebookPrintContent({ document, settings, entryId, revision, dirty, preparedAt }: {
  document: NotebookDocument; settings: NotebookPrintSettings; entryId: string; revision: number; dirty: boolean; preparedAt: string;
}) {
  const selected = new Set(settings.sections);
  const materials = (items: NotebookMaterial[]): ReactNode => <ul>{items.map(item => <li key={item.id}><strong>{item.name}</strong> {item.quantity}{item.source && <pre>{printableRecord(item.source)}</pre>}{item.content && <RichPrint root={item.content} includeInputs={settings.includeInputs} />}{item.children && materials(item.children)}</li>)}</ul>;
  // Keep original Notes order and its full calculation context even when only one section is printed.
  const filtered = { ...document.content, content: document.content.content.filter(node => selected.has(node.type === 'section' ? `section:${node.attrs!.blockId}` : 'notes')) };
  return <article className="notebook-print-document"><h1>{document.title}</h1><p>{dirty ? 'UNSAVED DRAFT / 未保存草稿' : `Saved revision / 已保存版本 ${revision}`}</p>
    {settings.includeMetadata && <header><p>Entry / 条目: {entryId} · Base revision / 基准版本: {revision}</p><p>Prepared / 生成时间: {preparedAt}</p><p>{settings.paper} · {settings.orientation} · {settings.marginMm} mm</p>{document.metadata && <pre>{printableRecord(document.metadata)}</pre>}</header>}
    <RichPrint root={filtered} contextRoot={document.content} includeInputs={settings.includeInputs} />
    {(document.procedures ?? []).filter(procedure => selected.has(`procedure:${procedure.id}`)).map(procedure => <section key={procedure.id}><h2>{procedure.title}</h2>{procedure.introduction ? <RichPrint root={procedure.introduction} includeInputs={settings.includeInputs} /> : <p>{procedure.description}</p>}
      {!!procedure.materials.length && <><h3>Materials / 材料</h3>{materials(procedure.materials)}</>}
      <ol>{procedure.steps.map(step => <li key={step.id}><p>{step.completed ? '☑' : '☐'} {step.kind ?? 'step'}{step.critical ? ' · Critical / 关键' : ''}{step.pause ? ' · Pause / 暂停' : ''}{step.minutes !== null ? ` · ${step.minutes} min planned / 计划` : ''}</p>
        {step.content ? <RichPrint root={step.content} includeInputs={settings.includeInputs} /> : <p>{step.text}</p>}{step.timer && <p>Recorded timer / 已记录计时: {step.timer.elapsedMs} ms{step.timer.startedAt !== null ? ' (running / 运行中)' : ''}</p>}</li>)}</ol></section>)}
    <footer>Sections / 章节: {notebookPrintSections(document).filter(section => selected.has(section.id)).map(section => section.label).join(' · ')}. Printing does not save or verify this entry. / 打印不代表保存或验证。</footer>
  </article>;
}
