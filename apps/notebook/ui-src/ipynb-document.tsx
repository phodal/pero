import { useMemo, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, Textarea } from '@pero/app-sdk/ui';
import { parseIpynb, editIpynbCell, appendIpynbCell, clearIpynbOutputs, ipynbExportFormats, type IpynbDocument } from '@pero/notebook/ipynb';
import { renderIpynbHtml } from '@pero/notebook/ipynb-render';
import { BlockFrame } from './block-frame';
import { ipynbMessages } from './ipynb-messages';
import { publicationPreviewHtml } from './publication-preview';
import './myst-document.css';
export function IpynbDocumentView(view: NodeViewProps) {
  const { t } = useAppI18n(ipynbMessages); const [error, setError] = useState('');
  const source = typeof view.node.attrs.source === 'string' ? view.node.attrs.source : '';
  const result = useMemo(() => { if (view.node.attrs.schemaVersion !== 1) return null; try { const document = parseIpynb(source); return { document, html: renderIpynbHtml(document) }; } catch { return null; } }, [source, view.node.attrs.schemaVersion]);
  const edit = (change: (document: IpynbDocument) => IpynbDocument) => { if (!result || !view.editor.isEditable) return; try { view.updateAttributes({ source: change(result.document).source }); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } };
  return <BlockFrame view={view} kind="ipynbDocument">
    <p>{t('boundaries')}</p>
    {!result && <><Feedback kind="warning">{t('unavailable')}</Feedback><Field label={t('source')}>{control => <Textarea {...control} aria-label={t('source')} value={source} readOnly rows={8} />}</Field></>}
    {result?.document.cells.map(cell => <section key={String(cell.raw.id ?? cell.index)}>
      <Field label={`Cell ${cell.index + 1}: ${cell.kind}`}>{control => <Textarea {...control} className="notebook-myst-source" rows={6} aria-label={`Cell ${cell.index + 1}: ${cell.kind}`} value={cell.source} readOnly={!view.editor.isEditable} spellCheck={false} onChange={event => edit(document => editIpynbCell(document, cell.index, event.target.value))} />}</Field>
      {cell.kind === 'code' && <><p>{t(cell.stale ? 'stale' : 'recorded')}</p><Button disabled={!view.editor.isEditable} onClick={() => edit(document => clearIpynbOutputs(document, cell.index))}>{t('clear')}</Button></>}
    </section>)}
    <div className="notebook-myst-actions">
      {(['markdown', 'code', 'raw'] as const).map((kind, index) => <Button key={kind} disabled={!result || !view.editor.isEditable} onClick={() => edit(document => appendIpynbCell(document, kind, crypto.randomUUID()))}>{t((['addMarkdown', 'addCode', 'addRaw'] as const)[index])}</Button>)}
      <Button onClick={() => { const format = ipynbExportFormats[0]; downloadFile(`notebook${format.extensions[0]}`, new TextEncoder().encode(format.serialize({ source })), format.mediaType); }}>{t('download')}</Button>
    </div>
    {error && <Feedback kind="error">{error}</Feedback>}
    {result && <iframe className="notebook-myst-preview" title={t('preview')} sandbox="" referrerPolicy="no-referrer" srcDoc={publicationPreviewHtml(result.html)} />}
  </BlockFrame>;
}
