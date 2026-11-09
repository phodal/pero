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
    catch { text = 'This source is not a complete UTF-8 preview. Original bytes are retained. / 此来源无法完整按 UTF-8 预览，原始字节仍保留。'; }
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
    <p>Select or drop a local file, inspect its exact bytes and confirm insertion. Nothing is sent to an external account. Up to 512 KiB per file, within the 2 MiB Notebook limit. / 选择或拖入本地文件，检查内容后确认插入，不会发送到外部账号。单个文件最多 512 KiB，笔记总计最多 2 MiB。</p>
    <div onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => {
      event.preventDefault(); if (!editor.isEditable || busy) return;
      if (event.dataTransfer.files.length !== 1) { setError('Drop one local file at a time. / 每次请拖入一个本地文件。'); return; }
      void read(event.dataTransfer.files[0]);
    }}>
      <FilePicker label="Choose source file / 选择来源文件" emptyLabel="Or drop one file here / 或拖入一个文件" disabled={busy || !editor.isEditable} onFile={input => void read(input)} />
      {busy && <Button onClick={() => { request.current++; setBusy(false); }}>Cancel file read / 取消文件读取</Button>}
    </div>
    {file && <section aria-label="Staged file / 待导入文件">
      <Field label="Notebook filename / 笔记文件名">{control => <Input {...control} maxLength={255} value={file.filename} onChange={event => setFile({ ...file, filename: event.target.value })} />}</Field>
      <Field label="File caption / 文件说明">{control => <Textarea {...control} maxLength={2000} value={file.caption} onChange={event => setFile({ ...file, caption: event.target.value })} />}</Field>
      <p>{file.mime} · {attachmentBytes(file.data).length} bytes</p><p style={{ overflowWrap: 'anywhere' }}>SHA-256: {file.sha256}</p>
      {preview && <img src={preview} alt={file.filename} style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }} onError={() => { setPreview(''); setError('Image preview failed. The original bytes are still staged. / 图片预览失败，原始字节仍保留。'); }} />}
      {text && <Disclosure summary="Plain-text preview, first 16 KiB / 纯文本预览，前 16 KiB" defaultOpen><pre className="notebook-science-json">{text}</pre></Disclosure>}
      {!preview && !text && <p>This format is imported as an embedded file. Use source extraction after insertion for supported PDF, Office and OCR text. / 此格式按内嵌文件导入；插入后可提取支持的 PDF、Office 或 OCR 文本。</p>}
      <div className="notebook-template-actions"><Button onClick={() => { request.current++; setFile(null); setError(''); }}>Discard staged file / 放弃待导入文件</Button>
        <Button variant="primary" disabled={busy || !editor.isEditable || !isAttachmentFilename(file.filename)} onClick={() => {
          if (applying.current || editor.isDestroyed || !editor.isEditable) return;
          if (JSON.stringify(editor.getJSON()) !== base.current) { setError('The draft changed after preview. Choose the file again to confirm the current insertion target. / 预览后草稿已更改，请重新选择文件以确认当前插入位置。'); return; }
          applying.current = true;
          try {
            const before = JSON.stringify(editor.getJSON()); onInsert([{ type: 'attachment', attrs: { ...file, blockId: crypto.randomUUID() } }]);
            if (JSON.stringify(editor.getJSON()) === before) throw new Error('The editor did not insert the file. The preview is retained.');
            onClose();
          } catch (cause) { setError(String(cause)); applying.current = false; }
        }}>Insert reviewed file / 插入已复核文件</Button></div>
    </section>}
    {error && <Feedback kind="error">{error}</Feedback>}
    <Disclosure summary="External accounts and owning Apps / 外部账号与所属应用">
      <p>External account authentication is managed by Connectors. Notebook has no provider file-list, download or sync contract; it cannot claim a connected remote file was imported. Choose a downloaded local file above, or open the installed owner. / 外部账号认证由 Connectors 管理。Notebook 当前没有提供方文件列表、下载或同步协议，不能声称已从远程导入。可在上方选择已下载的本地文件，或打开已安装的所属应用。</p>
      <Button busy={catalogBusy} disabled={catalogBusy} onClick={() => void refreshOwners()}>Check installed import owners / 检查已安装导入应用</Button>
      {catalog && ['connectors', 'data', 'paper-agent'].map(name => { const app = catalog.find(item => item.app === name); return <p key={name}>{app?.title || name} · {app?.enabled ? 'Installed / 已安装' : app ? 'Disabled in Host / Host 中已禁用' : 'Not installed / 未安装'} {app?.enabled && <Button disabled={!!navigating} busy={navigating === name} onClick={() => void openOwner(app)}>Open {app.title} / 打开应用</Button>}</p>; })}
      {catalogError && <Feedback kind="error">{catalogError}</Feedback>}
    </Disclosure>
  </Dialog>;
}
