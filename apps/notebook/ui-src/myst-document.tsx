import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, FilePicker, Textarea } from '@pero/app-sdk/ui';
import { MYST_SOURCE_MAX_BYTES, parseMystAttributes, parseMystDocument, importMystBundle, exportMystBundle } from '@pero/notebook/myst';
import { renderMystHtml } from '@pero/notebook/myst-render';
import { BlockFrame } from './block-frame';
import { mystMessages } from './myst-document-messages';
import './myst-document.css';

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
  const download = (kind: 'source' | 'bundle' | 'html') => {
    setError(''); setNotice('');
    try {
      const text = kind === 'source' ? source : kind === 'bundle' && result ? exportMystBundle(result.document) : result?.html;
      if (text === undefined) return;
      downloadFile(`document.${kind === 'source' ? 'myst' : kind === 'bundle' ? 'myst.json' : 'html'}`, new TextEncoder().encode(text), kind === 'html' ? 'text/html' : kind === 'bundle' ? 'application/json' : 'text/plain;charset=utf-8');
      setNotice(t('downloaded'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <BlockFrame view={view} kind="mystDocument">
    <p>{t('boundaries')}</p>
    {!result && <Feedback kind="warning">{t('unavailable')}</Feedback>}
    <Field label={t('source')}>{control => <Textarea {...control} className="notebook-myst-source" aria-label={t('source')} value={source} readOnly={!view.editor.isEditable || !result} spellCheck={false} onChange={event => {
      if (!view.editor.isEditable || !result) return;
      const next = event.target.value;
      if (new TextEncoder().encode(next).length > MYST_SOURCE_MAX_BYTES) { setError(t('limit')); return; }
      setError(''); setNotice(''); view.updateAttributes({ source: next });
    }} />}</Field>
    <div className="notebook-myst-actions">
      <Button onClick={() => download('source')}>{t('sourceDownload')}</Button>
      <Button disabled={!result} onClick={() => download('bundle')}>{t('bundleDownload')}</Button>
      <Button disabled={!result} onClick={() => download('html')}>{t('htmlDownload')}</Button>
    </div>
    {error && <Feedback kind="error">{error}</Feedback>}
    {notice && <p role="status">{notice}</p>}
    {!!result?.document.diagnostics.length && <section className="notebook-myst-diagnostics" aria-label={t('diagnostics')}>
      <strong>{t('diagnostics')}</strong><ul>{result.document.diagnostics.map((item, index) => <li key={index}>{item.line ? `${item.line}: ` : ''}{item.message}</li>)}</ul>
    </section>}
    {result && <iframe className="notebook-myst-preview" title={t('preview')} sandbox="" referrerPolicy="no-referrer" srcDoc={result.html} />}
  </BlockFrame>;
}

/** Imports append a new source block. An awaited file read never replaces a draft. */
export function NotebookMystTools({ editor, onInsert }: { editor: Editor; onInsert(nodes: JSONContent[]): boolean }) {
  const { t } = useAppI18n(mystMessages);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const importFile = async (file: File) => {
    if (pending.current || !editor.isEditable) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const bundle = file.name.toLowerCase().endsWith('.myst.json');
      if (!bundle && !/\.(md|myst)$/i.test(file.name)) throw new Error(t('fileType'));
      // JSON escapes and derived diagnostics may be larger than the source itself.
      if (file.size > (bundle ? MYST_SOURCE_MAX_BYTES * 8 : MYST_SOURCE_MAX_BYTES)) throw new Error(t('fileLimit'));
      const text = await file.text();
      const attrs = bundle ? importMystBundle(text) : parseMystAttributes({ schemaVersion: 1, source: text });
      if (!alive.current) return;
      if (editor.isDestroyed || !editor.isEditable || !onInsert([{ type: 'mystDocument', attrs }])) throw new Error(t('insertFailed'));
      setNotice(t('imported'));
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  return <div><FilePicker compact variant="ghost" label={t('import')} emptyLabel="" title={t('importHint')} accept=".md,.myst,.myst.json" busy={busy} disabled={!editor.isEditable} onFile={file => void importFile(file)} />
    {error && <Feedback kind="error">{error}</Feedback>}{notice && <p role="status">{notice}</p>}
  </div>;
}
