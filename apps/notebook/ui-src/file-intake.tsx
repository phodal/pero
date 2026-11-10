import { useEffect, useRef, useState } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { listInstalledAppViews, requestAppShell, useAppI18n, type InstalledAppViews } from '@pero/app-sdk';
import { Button, Dialog, Disclosure, Feedback, Field, FilePicker, Input, Textarea } from '@pero/app-sdk/ui';
import { attachmentBytes, isAttachmentFilename, isPreviewImage, type AttachmentAttributes } from '@pero/notebook/attachment';
import { createAttachment } from './content-blocks';
import { messages } from './messages';

export function NotebookFileIntake({ editor, onInsert }: { editor: Editor; onInsert(nodes: JSONContent[]): void }) {
  const { t } = useAppI18n(messages);
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" disabled={!editor.isEditable} onClick={() => setOpen(true)}>{t('previewFileImport')}</Button>{open && <FileIntakeDialog editor={editor} onInsert={onInsert} onClose={() => setOpen(false)} />}</>;
}

export function FileIntakeDialog({ editor, onInsert, onClose }: { editor: Editor; onInsert(nodes: JSONContent[]): void; onClose(): void }) {
  const { t } = useAppI18n(messages);
  const [file, setFile] = useState<AttachmentAttributes | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [preview, setPreview] = useState(''), [catalog, setCatalog] = useState<InstalledAppViews[] | null>(null), [catalogError, setCatalogError] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(false), [navigating, setNavigating] = useState('');
  const request = useRef(0), live = useRef(true), base = useRef(JSON.stringify(editor.getJSON()));
  const controller = useRef<AbortController | null>(null), applying = useRef(false);
  useEffect(() => () => { live.current = false; request.current++; controller.current?.abort(); }, []);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    if (isPreviewImage(file.mime)) {
      const url = URL.createObjectURL(new Blob([attachmentBytes(file.data)], { type: file.mime })); setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview('');
  }, [file?.sha256]);
  const read = async (input: File) => {
    const generation = ++request.current; setBusy(true); setError('');
    try {
      const next = await createAttachment(input);
      if (live.current && request.current === generation) { setFile(next); base.current = JSON.stringify(editor.getJSON()); }
    } catch (cause) { if (live.current && request.current === generation) setError(String(cause)); }
    finally { if (live.current && request.current === generation) setBusy(false); }
  };
  const refreshOwners = async () => {
    controller.current?.abort(); const pending = new AbortController(); controller.current = pending; setCatalogBusy(true); setCatalogError('');
    try { const value = await listInstalledAppViews(pending.signal); if (!pending.signal.aborted) setCatalog(value); }
    catch (cause) { if (!pending.signal.aborted) setCatalogError(String(cause)); }
    finally { if (controller.current === pending && live.current) setCatalogBusy(false); }
  };
  let text = '';
  if (file && (file.mime.startsWith('text/') || ['application/json', 'application/xml'].includes(file.mime))) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(attachmentBytes(file.data).slice(0, 16384)); }
    catch { text = t('incompleteUtf8Preview'); }
  }
  const openOwner = async (app: InstalledAppViews) => {
    if (navigating) return; setNavigating(app.app); setCatalogError('');
    try {
      const current = (await listInstalledAppViews()).find(item => item.app === app.app);
      if (!current?.enabled || !current.panels.length) throw new Error('The owner App is unavailable. Refresh installed Apps.');
      if (live.current) await requestAppShell('navigate', { path: `/apps/${current.app}/${current.panels[0].id}` });
    } catch (cause) { if (live.current) setCatalogError(String(cause)); }
    finally { if (live.current) setNavigating(''); }
  };
  return <Dialog title={t('previewFileImport')} closeLabel={t('closeAction')} size="lg" onClose={onClose}>
    <p>{t('fileIntakeHint')}</p>
    <div onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => {
      event.preventDefault(); if (!editor.isEditable || busy) return;
      if (event.dataTransfer.files.length !== 1) { setError(t('dropOneFile')); return; }
      void read(event.dataTransfer.files[0]);
    }}>
      <FilePicker label={t('chooseSourceFile')} emptyLabel={t('dropFileHere')} disabled={busy || !editor.isEditable} onFile={input => void read(input)} />
      {busy && <Button onClick={() => { request.current++; setBusy(false); }}>{t('cancelFileRead')}</Button>}
    </div>
    {file && <section aria-label={t('stagedFile')}>
      <Field label={t('notebookFilename')}>{control => <Input {...control} maxLength={255} value={file.filename} onChange={event => setFile({ ...file, filename: event.target.value })} />}</Field>
      <Field label={t('fileCaption')}>{control => <Textarea {...control} maxLength={2000} value={file.caption} onChange={event => setFile({ ...file, caption: event.target.value })} />}</Field>
      <p>{file.mime} · {attachmentBytes(file.data).length} bytes</p><p style={{ overflowWrap: 'anywhere' }}>SHA-256: {file.sha256}</p>
      {preview && <img src={preview} alt={file.filename} style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }} onError={() => { setPreview(''); setError(t('imagePreviewFailed')); }} />}
      {text && <Disclosure summary={t('plainTextPreview')} defaultOpen><pre className="notebook-science-json">{text}</pre></Disclosure>}
      {!preview && !text && <p>{t('embeddedFormatHint')}</p>}
      <div className="notebook-template-actions"><Button onClick={() => { request.current++; setFile(null); setError(''); }}>{t('discardStagedFile')}</Button>
        <Button variant="primary" disabled={busy || !editor.isEditable || !isAttachmentFilename(file.filename)} onClick={() => {
          if (applying.current || editor.isDestroyed || !editor.isEditable) return;
          if (JSON.stringify(editor.getJSON()) !== base.current) { setError(t('draftChangedAfterPreview')); return; }
          applying.current = true;
          try {
            const before = JSON.stringify(editor.getJSON()); onInsert([{ type: 'attachment', attrs: { ...file, blockId: crypto.randomUUID() } }]);
            if (JSON.stringify(editor.getJSON()) === before) throw new Error('The editor did not insert the file. The preview is retained.');
            onClose();
          } catch (cause) { setError(String(cause)); applying.current = false; }
        }}>{t('insertReviewedFile')}</Button></div>
    </section>}
    {error && <Feedback kind="error">{error}</Feedback>}
    <Disclosure summary={t('externalAccounts')}>
      <p>{t('externalAccountsHint')}</p>
      <Button busy={catalogBusy} disabled={catalogBusy} onClick={() => void refreshOwners()}>{t('checkImportOwners')}</Button>
      {catalog && ['connectors', 'data', 'paper-agent'].map(name => { const app = catalog.find(item => item.app === name); return <p key={name}>{app?.title || name} · {app?.enabled ? t('appInstalled') : app ? t('appDisabled') : t('appNotInstalled')} {app?.enabled && <Button disabled={!!navigating} busy={navigating === name} onClick={() => void openOwner(app)}>{t('openOwnerApp', { title: app.title })}</Button>}</p>; })}
      {catalogError && <Feedback kind="error">{catalogError}</Feedback>}
    </Disclosure>
  </Dialog>;
}
