import { useMemo, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, Select, Textarea } from '@pero/app-sdk/ui';
import { importMystProjectSnapshot, exportMystProjectSnapshot, replaceMystProjectResource } from '@pero/notebook/myst-project-snapshot';
import { compileMystProject } from '@pero/notebook/myst-project';
import { mystProjectExportFormats } from '@pero/notebook/myst-project-formats';
import { renderMystHtml } from '@pero/notebook/myst-render';
import { BlockFrame } from './block-frame';
import { mystProjectMessages } from './myst-project-messages';
import './myst-document.css';

export function MystProjectView(view: NodeViewProps) {
  const { t } = useAppI18n(mystProjectMessages);
  const raw = typeof view.node.attrs.snapshot === 'string' ? view.node.attrs.snapshot : '';
  const [selected, setSelected] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const result = useMemo(() => {
    try {
      // The registered editor adapter owns attribute shape; future block schemas
      // must remain raw recovery rather than enter the current snapshot parser.
      if (view.node.attrs.schemaVersion !== 1) return null;
      const snapshot = importMystProjectSnapshot(raw);
      const projection = compileMystProject(snapshot);
      return { snapshot, projection, html: renderMystHtml(projection.entry) };
    } catch { return null; }
  }, [raw, view.node.attrs.schemaVersion]);
  const resource = result?.snapshot.files.find(file => file.path === selected)
    ?? result?.snapshot.files.find(file => file.path === result.snapshot.entry);
  const download = (format: typeof mystProjectExportFormats[number]) => {
    setError(''); setNotice('');
    try {
      if (!result && format.id !== 'snapshot') return;
      downloadFile(`project${format.extensions[0]}`, new TextEncoder().encode(format.serialize({ snapshot: raw })), format.mediaType);
      setNotice(t('downloaded'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <BlockFrame view={view} kind="mystProject">
    <p>{t('boundaries')}</p>
    {!result && <Feedback kind="warning">{t('unavailable')}</Feedback>}
    {result && resource && <>
      <Select label={t('resource')} value={resource.path} options={result.snapshot.files.map(file => ({ value: file.path, label: file.path }))} onChange={setSelected} />
      <Field label={t('source')}>{control => <Textarea {...control} className="notebook-myst-source" rows={12} aria-label={t('source')} value={resource.text} readOnly={!view.editor.isEditable} spellCheck={false} onChange={event => {
        if (!view.editor.isEditable) return;
        try {
          const next = replaceMystProjectResource(result.snapshot, resource.path, event.target.value);
          view.updateAttributes({ snapshot: exportMystProjectSnapshot(next) });
          setError(''); setNotice('');
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      }} />}</Field>
    </>}
    {!result && <Field label={t('raw')}>{control => <Textarea {...control} className="notebook-myst-source" rows={12} aria-label={t('raw')} value={raw} readOnly spellCheck={false} />}</Field>}
    <div className="notebook-myst-actions">{mystProjectExportFormats.map(format => <Button key={format.id} disabled={!result && format.id !== 'snapshot'} onClick={() => download(format)}>{format.id === 'snapshot' ? t('snapshotDownload') : format.id === 'html' ? t('htmlDownload') : format.label}</Button>)}</div>
    {error && <Feedback kind="error">{error}</Feedback>}
    {notice && <p role="status">{notice}</p>}
    {!!result?.projection.diagnostics.length && <section className="notebook-myst-diagnostics" aria-label={t('diagnostics')}>
      <strong>{t('diagnostics')}</strong><ul>{result.projection.diagnostics.map((item, index) => <li key={index}>{item.path ? `${item.path}: ` : ''}{item.line ? `${item.line}: ` : ''}{item.message}</li>)}</ul>
    </section>}
    {result && <iframe className="notebook-myst-preview" title={t('preview')} sandbox="" referrerPolicy="no-referrer" srcDoc={result.html} />}
  </BlockFrame>;
}
