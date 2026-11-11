import { ipynbImportFormats } from '@pero/notebook/ipynb';
import { mystProjectImportFormats } from '@pero/notebook/myst-project-formats';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, FilePicker, Textarea } from '@pero/app-sdk/ui';
import { MYST_SOURCE_MAX_BYTES, parseMystAttributes, parseMystDocument } from '@pero/notebook/myst';
import { mystImportFormats, mystExportFormats } from '@pero/notebook/myst-formats';
import { renderMystHtml } from '@pero/notebook/myst-render';
import { BlockFrame } from './block-frame';
import { mystMessages } from './myst-document-messages';
import './myst-document.css';

const importFormats = [...ipynbImportFormats.map(format => ({ format, type: 'ipynbDocument' })), ...mystImportFormats.map(format => ({ format, type: 'mystDocument' })), ...mystProjectImportFormats.map(format => ({ format, type: 'mystProject' }))];
const exportLabels: Record<string, keyof typeof mystMessages> = { source: 'sourceDownload', bundle: 'bundleDownload', html: 'htmlDownload' };

export function MystDocumentView(view: NodeViewProps) {
  const { t } = useAppI18n(mystMessages);
  const source = typeof view.node.attrs.source === 'string' ? view.node.attrs.source : '';
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const result = useMemo(() => {
    try {
      parseMystAttributes(view.node.attrs);
      const document = parseMystDocument(source);
      return { document, html: renderMystHtml(document) };
    } catch { return null; }
  }, [source, view.node.attrs.schemaVersion]);
  const download = (format: typeof mystExportFormats[number]) => {
    setError(''); setNotice('');
    try {
      if (!result && format.id !== 'source') return;
      downloadFile(`document${format.extensions[0]}`, new TextEncoder().encode(format.serialize({ source })), format.mediaType);
      setNotice(t('downloaded'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <BlockFrame view={view} kind="mystDocument">
    <p>{t('boundaries')}</p>
    {!result && <Feedback kind="warning">{t('unavailable')}</Feedback>}
    <Field label={t('source')}>{control => <Textarea {...control} className="notebook-myst-source" rows={12} aria-label={t('source')} value={source} readOnly={!view.editor.isEditable || !result} spellCheck={false} onChange={event => {
      if (!view.editor.isEditable || !result) return;
      const next = event.target.value;
      if (new TextEncoder().encode(next).length > MYST_SOURCE_MAX_BYTES) { setError(t('limit')); return; }
      setError(''); setNotice(''); view.updateAttributes({ source: next });
    }} />}</Field>
    <div className="notebook-myst-actions">
      {mystExportFormats.map(format => <Button key={format.id} disabled={!result && format.id !== 'source'} onClick={() => download(format)}>{exportLabels[format.id] ? t(exportLabels[format.id]) : format.label}</Button>)}
    </div>
    {error && <Feedback kind="error">{error}</Feedback>}
    {notice && <p role="status">{notice}</p>}
    {!!result?.document.diagnostics.length && <section className="notebook-myst-diagnostics" aria-label={t('diagnostics')}>
      <strong>{t('diagnostics')}</strong><ul>{result.document.diagnostics.map((item, index) => <li key={index}>{item.line ? `${item.line}: ` : ''}{item.message}</li>)}</ul>
    </section>}
    {result && <iframe className="notebook-myst-preview" title={t('preview')} sandbox="" referrerPolicy="no-referrer" srcDoc={result.html} />}
  </BlockFrame>;
}

/** Imports append a new source or project block. An awaited file read never replaces a draft. */
export function NotebookMystTools({ editor, onInsert }: { editor: Editor; onInsert(nodes: JSONContent[]): boolean }) {
  const { t } = useAppI18n(mystMessages);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const importFile = async (file: File) => {
    if (pending.current || !editor.isEditable) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const selected = importFormats.find(({ format }) => format.extensions.some(extension => file.name.toLowerCase().endsWith(extension)));
      if (!selected) throw new Error(t('fileType'));
      const { format } = selected;
      if (format.maxBytes !== undefined && file.size > format.maxBytes) throw new Error(t('fileLimit'));
      const text = selected.type === 'ipynbDocument' ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()) : await file.text();
      const attrs = format.parse(text);
      if (!alive.current) return;
      if (editor.isDestroyed || !editor.isEditable || !onInsert([{ type: selected.type, attrs }])) throw new Error(t('insertFailed'));
      setNotice(t('imported'));
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  return <div><FilePicker compact variant="ghost" label={t('import')} emptyLabel="" title={t('importHint')} accept={importFormats.flatMap(({ format }) => format.extensions).join(',')} busy={busy} disabled={!editor.isEditable} onFile={file => void importFile(file)} />
    {error && <Feedback kind="error">{error}</Feedback>}{notice && <p role="status">{notice}</p>}
  </div>;
}
