import { useEffect, useMemo, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, Select, Textarea } from '@pero/app-sdk/ui';
import { importMystProjectSnapshot, exportMystProjectSnapshot, replaceMystProjectResource } from '@pero/notebook/myst-project-snapshot';
import { compileMystProject } from '@pero/notebook/myst-project';
import { compileMystProjectCitations } from '@pero/notebook/myst-project-citations';
import { loadMystCitationRuntime } from './myst-citation-runtime';
import { compiledMystEntryPublication } from '@pero/notebook/ipynb-publication';
import { mystCompiledPublicationFormats } from '@pero/notebook/myst-publication-sdk';
import { openNotebookPublicationPrint } from './notebook-print';
import { mystProjectExportFormats } from '@pero/notebook/myst-project-formats';
import { renderMystProjectHtml } from '@pero/notebook/myst-project-render';
import { BlockFrame } from './block-frame';
import { mystProjectMessages } from './myst-project-messages';
import './myst-document.css';

export function MystProjectView(view: NodeViewProps) {
  const { t } = useAppI18n(mystProjectMessages);
  const raw = typeof view.node.attrs.snapshot === 'string' ? view.node.attrs.snapshot : '';
  const [selected, setSelected] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const base = useMemo(() => {
    try {
      // The registered editor adapter owns attribute shape; future block schemas
      // must remain raw recovery rather than enter the current snapshot parser.
      if (view.node.attrs.schemaVersion !== 1) return null;
      const snapshot = importMystProjectSnapshot(raw);
      const projection = compileMystProject(snapshot);
      return { snapshot, projection, html: renderMystProjectHtml(projection) };
    } catch { return null; }
  }, [raw, view.node.attrs.schemaVersion]);
  const [formatted, setFormatted] = useState<{ base: typeof base; result: NonNullable<typeof base> } | null>(null);
  useEffect(() => {
    if (!base) return;
    let current = true;
    void loadMystCitationRuntime().then(() => compileMystProjectCitations(base.snapshot, base.projection)).then(projection => {
      if (current) setFormatted({ base, result: { ...base, projection, html: renderMystProjectHtml(projection) } });
    }).catch(cause => {
      if (!current) return;
      const message = `Citation formatting unavailable: ${cause instanceof Error ? cause.message : String(cause)} Original source and unstyled preview are retained.`;
      const projection = { ...base.projection, diagnostics: [...base.projection.diagnostics, { severity: 'error' as const, code: 'citation-runtime-unavailable', message }] };
      setFormatted({ base, result: { ...base, projection } });
    });
    return () => { current = false; };
  }, [base]);
  // A prior resource's completion never replaces newer source or its exports.
  const formatting = !!base && formatted?.base !== base;
  const result = formatted?.base === base ? formatted.result : base;
  const selectedPath = selected || result?.snapshot.entry;
  const resource = result?.snapshot.files.find(file => file.path === selectedPath);
  const asset = result?.snapshot.assets?.find(file => file.path === selectedPath);
  const download = async (format: typeof mystProjectExportFormats[number]) => {
    setError(''); setNotice('');
    try {
      if ((!result || formatting) && format.id !== 'snapshot') return;
      const content = await format.serialize({ snapshot: raw, projection: result?.projection });
      downloadFile(`project${format.extensions[0]}`, new TextEncoder().encode(content), format.mediaType);
      setNotice(t('downloaded'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const downloadPublication = async (format: typeof mystCompiledPublicationFormats[number]) => {
    if (!result || formatting || result.projection.entry.kind === 'invalid' || exporting) return;
    setError(''); setNotice(''); setExporting(true);
    try {
      const content = await format.serialize(compiledMystEntryPublication(result.projection.entry, result.snapshot.assets));
      downloadFile(`project-entry${format.extensions[0]}`, typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content), format.mediaType);
      setNotice(t('downloaded'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setExporting(false); }
  };
  return <BlockFrame view={view} kind="mystProject">
    <p>{t('boundaries')}</p>
    {!result && <Feedback kind="warning">{t('unavailable')}</Feedback>}
    {result && <Select label={t('resource')} value={selectedPath ?? ''} options={[...result.snapshot.files, ...(result.snapshot.assets ?? [])].map(file => ({ value: file.path, label: file.path }))} onChange={setSelected} />}
    {result && resource && <>
      <Field label={t('source')}>{control => <Textarea {...control} className="notebook-myst-source" rows={12} aria-label={t('source')} value={resource.text} readOnly={!view.editor.isEditable} spellCheck={false} onChange={event => {
        if (!view.editor.isEditable) return;
        try {
          const next = replaceMystProjectResource(result.snapshot, resource.path, event.target.value);
          view.updateAttributes({ snapshot: exportMystProjectSnapshot(next) });
          setError(''); setNotice('');
        } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      }} />}</Field>
    </>}
    {asset && <section aria-label={t('asset')}>
      <p>{asset.path} · {asset.mediaType} · {asset.byteLength} bytes{asset.width ? ` · ${asset.width} × ${asset.height}` : ''}</p>
      {!asset.renderable && <Feedback kind="warning">{t('assetUnsupported')}</Feedback>}
      <Button onClick={() => downloadFile(asset.path.split('/').at(-1)!, Uint8Array.from(atob(asset.base64), char => char.charCodeAt(0)), 'application/octet-stream')}>{t('assetDownload')}</Button>
    </section>}
    {!result && <Field label={t('raw')}>{control => <Textarea {...control} className="notebook-myst-source" rows={12} aria-label={t('raw')} value={raw} readOnly spellCheck={false} />}</Field>}
    <div className="notebook-myst-actions">{mystProjectExportFormats.map(format => <Button key={format.id} disabled={(!result || formatting) && format.id !== 'snapshot'} onClick={() => download(format)}>{format.id === 'snapshot' ? t('snapshotDownload') : format.id === 'html' ? t('htmlDownload') : format.label}</Button>)}</div>
    {result && <>
      <p>{t('entryPublication')}</p>
      {result.projection.entry.kind === 'ipynb' && <Feedback kind="warning">{t('notebookRecoveryWarning')}</Feedback>}
      {result.projection.entry.kind === 'invalid' && <Feedback kind="warning">{t('publicationUnsupported')}</Feedback>}
      <div className="notebook-myst-actions">{mystCompiledPublicationFormats.map(format => <Button key={format.id} disabled={exporting || formatting || result.projection.entry.kind === 'invalid'} onClick={() => downloadPublication(format)}>{format.label}</Button>)}
        <Button disabled={formatting} onClick={() => openNotebookPublicationPrint(result.html)}>{t('printProject')}</Button>
      </div>
    </>}
    {formatting && <p role="status">{t('formatting')}</p>}
    {error && <Feedback kind="error">{error}</Feedback>}
    {notice && <p role="status">{notice}</p>}
    {!!result?.projection.diagnostics.length && <section className="notebook-myst-diagnostics" aria-label={t('diagnostics')}>
      <strong>{t('diagnostics')}</strong><ul>{result.projection.diagnostics.map((item, index) => <li key={index}>{item.path ? `${item.path}: ` : ''}{item.line ? `${item.line}: ` : ''}{item.message}</li>)}</ul>
    </section>}
    {result && <iframe className="notebook-myst-preview" title={t('preview')} sandbox="" referrerPolicy="no-referrer" srcDoc={result.html} />}
  </BlockFrame>;
}
