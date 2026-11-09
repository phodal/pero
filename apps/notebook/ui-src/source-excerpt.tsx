import { extractedSourceMimes } from '@pero/notebook/source-extraction';
import { verifiedAttachmentBytes } from '@pero/notebook/attachment';
import { SourceExtractionPicker, SourceExtractionDetails } from './source-extraction';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Disclosure, Feedback, Field, Input, Select, Textarea } from '@pero/app-sdk/ui';
import type { NotebookDocument, NotebookNode } from '@pero/notebook';
import { notebookLinkHash } from '@pero/notebook/workspace';
import { useNotebookContext } from './notebook-context';
import { createSourceExcerpt, isSourceExcerpt, readSourceExcerptAttachment, sameSourceExcerptAttachment, sourceExcerptAvailability,
  sourceExcerptSelection, sourceExcerptAttachments, verifySourceExcerpt, type SourceExcerpt, type SourceExcerptAttachment, type SourceExcerptAttributes, type SourceExcerptText } from '@pero/notebook/source-excerpt';
import { BlockFrame } from './block-frame';

export const sourceExcerptMessages = {
  title: { en: 'Source excerpt', zh: '来源摘录' }, insert: { en: 'Insert source excerpt', zh: '插入来源摘录' },
  configure: { en: 'Configure source excerpt', zh: '配置来源摘录' }, update: { en: 'Update excerpt', zh: '更新摘录' },
  label: { en: 'Excerpt label', zh: '摘录标题' }, source: { en: 'Source attachment', zh: '来源附件' },
  choose: { en: 'Choose an attachment', zh: '选择附件' }, close: { en: 'Close', zh: '关闭' }, cancel: { en: 'Cancel', zh: '取消' },
  empty: { en: 'Attach a text, PDF, image or Office file to this notebook, then choose the passage to retain.', zh: '请先向笔记附加文本、PDF、图片或 Office 文件，然后选择要保留的段落。' },
  scope: { en: 'Retains the full source text (up to 128 KiB) and your exact quote in this revision. Reads UTF-8 text directly; PDF, PNG/JPEG/WebP, DOCX/XLSX/PPTX require explicit local extraction. Derived text retains parser and source locations; OCR needs review. The source attachment is never changed.', zh: '在修订中保留完整来源文本（最多 128 KiB）及精确摘录。文本直接读取；PDF、图片和 Office 需明确本地提取，保留解析器和位置，OCR 需复核。不会修改来源附件。' },
  provenance: { en: 'Local source reference only. Integrity checks do not authenticate the author, origin or scientific claims.', zh: '仅为本地来源引用。完整性校验不验证作者、出处或科学结论。' },
  start: { en: 'Start offset (codepoints, inclusive)', zh: '起始偏移（码点，包含）' }, end: { en: 'End offset (codepoints, exclusive)', zh: '结束偏移（码点，不包含）' },
  full: { en: 'Source text (read-only)', zh: '来源文本（只读）' }, select: { en: 'Use highlighted text', zh: '使用高亮选区' },
  rangeHelp: { en: 'Highlight text above or enter offsets below. Offsets start at 0 and count Unicode codepoints; BOM and each CR/LF count separately.', zh: '高亮上方文本或输入下方偏移。偏移从 0 开始，按 Unicode 码点计数；BOM 和每个 CR/LF 分别计数。' },
  preview: { en: 'Selected quote', zh: '所选摘录' }, selectHint: { en: 'Select a nonempty passage to preview and insert.', zh: '选择非空段落以预览并插入。' },
  loading: { en: 'Checking source attachment…', zh: '正在校验来源附件…' }, checking: { en: 'Source digest unverified. Checking retained text…', zh: '来源摘要尚未验证，正在校验保留文本…' },
  verified: { en: 'Retained text integrity verified.', zh: '保留文本的完整性已验证。' }, invalid: { en: 'Retained source integrity failed. Download is disabled; choose a valid source to replace this excerpt.', zh: '保留来源的完整性校验失败。已禁用下载，请选择有效来源替换摘录。' },
  available: { en: 'Original attachment is available and unchanged.', zh: '原始附件可用且未改变。' }, changed: { en: 'Original attachment changed. This excerpt retains its pinned version.', zh: '原始附件已更改。此摘录保留其固定版本。' },
  missing: { en: 'Original attachment is no longer in this notebook. The retained text and quote remain available.', zh: '原始附件已不在此笔记中，保留文本及摘录仍可用。' },
  missingSection: { en: 'Original attachment is not in this editor section. Other notebook sections were not checked. The retained text and quote remain available.', zh: '此编辑区域中没有原始附件，尚未检查笔记的其他区域。保留文本及摘录仍可用。' },
  emptySection: { en: 'Attach a text, PDF, image or Office file to this editor section, then choose the passage to retain.', zh: '请先向此编辑区域附加文本、PDF、图片或 Office 文件，然后选择要保留的段落。' },
  download: { en: 'Download retained source', zh: '下载保留来源' }, details: { en: 'Source details and retained text', zh: '来源详情及保留文本' },
  showSource: { en: 'Locate original attachment', zh: '定位原始附件' }, retry: { en: 'Reload selected attachment', zh: '重新加载所选附件' },
  stale: { en: 'The source attachment changed or was removed. Reload it and select the passage again.', zh: '来源附件已改变或移除。请重新加载并选择段落。' },
  draftChanged: { en: 'This excerpt changed while you were editing. Close and reopen it before replacing.', zh: '编辑期间此摘录发生改变。请关闭并重新打开后替换。' },
  downloadFailed: { en: 'The download could not start. Try again.', zh: '未能开始下载，请重试。' },
};

function useAttachments(editor: Editor) {
  const context = useNotebookContext(), latest = useRef(context); latest.current = context;
  const [, changed] = useState(0);
  useEffect(() => { const update = () => changed(value => value + 1); editor.on('transaction', update); return () => { editor.off('transaction', update); }; }, [editor]);
  const getAttachments = () => sourceExcerptAttachments(latest.current?.getDocument() ?? { content: editor.getJSON() as NotebookDocument['content'] });
  return { context, candidates: sourceExcerptAttachments(context?.document ?? { content: editor.getJSON() as NotebookDocument['content'] }), getAttachments };
}

function SourceExcerptComposer({ editor, initial, onConfirm, onCancel }: {
  editor: Editor; initial?: SourceExcerptAttributes; onConfirm(value: SourceExcerptAttributes): void; onCancel(): void;
}) {
  const { t } = useAppI18n(sourceExcerptMessages), { context, candidates: options, getAttachments } = useAttachments(editor);
  const [selected, setSelected] = useState(initial?.excerpt?.source.blockId ?? ''), [label, setLabel] = useState(initial?.label ?? '');
  const [loaded, setLoaded] = useState<{ candidate: SourceExcerptAttachment; snapshot: SourceExcerptText } | null>(null);
  const [start, setStart] = useState('0'), [end, setEnd] = useState('0'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(0), preview = useRef<HTMLTextAreaElement>(null), submitted = useRef(false);
  const find = (id: string) => { const matches = getAttachments().filter(item => item.blockId === id); return matches.length === 1 ? matches[0] : undefined; };
  useEffect(() => () => { request.current++; }, []);
  const load = async (id: string) => {
    const generation = ++request.current;
    setSelected(id); setLoaded(null); setStart('0'); setEnd('0'); setError(''); setBusy(true);
    const candidate = find(id);
    try {
      if (!candidate) throw new Error(t('stale'));
      if (extractedSourceMimes.has(candidate.attachment.mime)) return;
      const snapshot = await readSourceExcerptAttachment(candidate);
      if (request.current !== generation) return;
      if (!sameSourceExcerptAttachment(candidate, find(id))) throw new Error(t('stale'));
      setLoaded({ candidate, snapshot });
      if (initial?.excerpt && initial.excerpt.source.blockId === id && initial.excerpt.version === snapshot.source.sha256) {
        setStart(String(initial.excerpt.start)); setEnd(String(initial.excerpt.end));
      }
    } catch (cause) { if (request.current === generation) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (request.current === generation) setBusy(false); }
  };
  useEffect(() => { if (selected) void load(selected); }, []);
  let excerpt: SourceExcerpt | null = null;
  if (loaded && /^\d+$/.test(start) && /^\d+$/.test(end)) {
    try { excerpt = createSourceExcerpt(loaded.snapshot, Number(start), Number(end)); } catch { /* The range stays editable until valid. */ }
  }
  const stale = !!loaded && !sameSourceExcerptAttachment(loaded.candidate, options.find(item => item.blockId === selected));
  const confirm = () => {
    if (submitted.current || !excerpt || !loaded || !editor.isEditable) return;
    setError('');
    try {
      if (!sameSourceExcerptAttachment(loaded.candidate, find(selected))) throw new Error(t('stale'));
      onConfirm({ label, excerpt }); submitted.current = true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <Dialog title={t(initial?.excerpt ? 'update' : 'insert')} closeLabel={t('close')} onClose={onCancel}>
    <p className="notebook-note">{t('scope')}</p>
    {!options.length && <Feedback kind="info">{t(context ? 'empty' : 'emptySection')}</Feedback>}
    <Field label={t('label')}>{control => <Input {...control} value={label} maxLength={200} onChange={event => setLabel(event.target.value)} />}</Field>
    <Select label={t('source')} placeholder={t('choose')} value={selected} options={options.map(item => ({ value: item.blockId, label: `${item.attachment.filename} · ${item.attachment.mime}` }))} onChange={id => void load(id)} />
    {busy && <Feedback kind="info">{t('loading')}</Feedback>}
    {error && <Feedback kind="error">{error}</Feedback>}
    {stale && <Feedback kind="warning">{t('stale')}</Feedback>}
    {selected && <Button disabled={busy} onClick={() => void load(selected)}>{t('retry')}</Button>}
    {selected && extractedSourceMimes.has(find(selected)?.attachment.mime ?? '') && <SourceExtractionPicker key={`${selected}:${find(selected)?.attachment.sha256}:${find(selected)?.attachment.data}`} file={find(selected)!.attachment} onReset={() => setLoaded(null)} onExtract={result => {
      const candidate = find(selected); if (!candidate || candidate.attachment.sha256 !== result.extraction.original.sha256) { setError(t('stale')); return; }
      setLoaded({ candidate, snapshot: { ...result, source: { blockId: selected, filename: candidate.attachment.filename, mime: candidate.attachment.mime, sha256: candidate.attachment.sha256 } } }); setStart('0'); setEnd('0'); setError('');
    }} />}
    {loaded && <>
      <Field label={t('full')}>{control => <Textarea {...control} ref={preview} readOnly rows={10} value={loaded.snapshot.text} />}</Field>
      <p className="notebook-note">{t('rangeHelp')}</p>
      <Button onClick={() => {
        if (!preview.current) return;
        try { const range = sourceExcerptSelection(loaded.snapshot.text, preview.current.selectionStart, preview.current.selectionEnd); setStart(String(range.start)); setEnd(String(range.end)); setError(''); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      }}>{t('select')}</Button>
      <div className="notebook-science-fields">
        <Field label={t('start')}>{control => <Input {...control} type="number" min={0} step={1} value={start} onChange={event => setStart(event.target.value)} />}</Field>
        <Field label={t('end')}>{control => <Input {...control} type="number" min={1} step={1} value={end} onChange={event => setEnd(event.target.value)} />}</Field>
      </div>
      {loaded.snapshot.extraction && <SourceExtractionDetails extraction={loaded.snapshot.extraction} start={Number(start)} end={Number(end)} />}
      <strong>{t('preview')}</strong>
      {excerpt ? <blockquote className="notebook-snapshot-quote" style={{ whiteSpace: 'pre-wrap' }}>{excerpt.quote}</blockquote> : <p>{t('selectHint')}</p>}
    </>}
    <div className="notebook-science-actions"><Button variant="primary" disabled={!excerpt || busy || stale || !editor.isEditable} onClick={confirm}>{t(initial?.excerpt ? 'update' : 'insert')}</Button><Button onClick={onCancel}>{t('cancel')}</Button></div>
  </Dialog>;
}

export function NotebookSourceExcerptTools({ editor, onInsert }: { editor: Editor; onInsert(nodes: NotebookNode[]): void }) {
  const [open, setOpen] = useState(false), { t } = useAppI18n(sourceExcerptMessages);
  useAttachments(editor);
  if (!editor.isEditable) return null;
  return <><Button onClick={() => setOpen(true)}>{t('insert')}</Button>{open && <SourceExcerptComposer editor={editor} onCancel={() => setOpen(false)} onConfirm={value => { onInsert([{ type: 'sourceExcerpt', attrs: { ...value } }]); setOpen(false); }} />}</>;
}

export function SourceExcerptView(view: NodeViewProps) {
  const { t } = useAppI18n(sourceExcerptMessages), { context, candidates } = useAttachments(view.editor);
  const { label, excerpt } = view.node.attrs as SourceExcerptAttributes;
  const [verified, setVerified] = useState<SourceExcerpt | null>(null), [failed, setFailed] = useState<unknown>(null), [downloadError, setDownloadError] = useState(false);
  const [editing, setEditing] = useState<{ attrs: SourceExcerptAttributes; captured: string } | null>(null);
  useEffect(() => {
    let live = true; setFailed(null); setDownloadError(false);
    if (excerpt) void verifySourceExcerpt(excerpt).then(value => { if (live) setVerified(value); }, () => { if (live) setFailed(excerpt); });
    return () => { live = false; };
  }, [excerpt]);
  const current = verified === excerpt ? verified : null, validShape = isSourceExcerpt(excerpt);
  const [originalChecked, setOriginalChecked] = useState<{ data: string; sha256: string; valid: boolean } | null>(null);
  const original = current && candidates.find(candidate => candidate.blockId === current.source.blockId)?.attachment;
  useEffect(() => { let live = true; if (original && current?.extraction) void verifiedAttachmentBytes(original).then(() => { if (live) setOriginalChecked({ data: original.data, sha256: original.sha256, valid: true }); }, () => { if (live) setOriginalChecked({ data: original.data, sha256: original.sha256, valid: false }); }); return () => { live = false; }; }, [original?.data, original?.sha256, !!current?.extraction]);
  const provisional = current ? sourceExcerptAvailability(current, candidates) : null;
  const availability = provisional === 'available' && current?.extraction ? (originalChecked?.data === original?.data && originalChecked?.sha256 === original?.sha256 ? originalChecked?.valid ? 'available' : 'changed' : null) : provisional;
  const edit = () => setEditing({ attrs: { label, excerpt }, captured: JSON.stringify({ label, excerpt }) });
  const download = () => {
    if (!current) return;
    try { downloadFile(current.extraction ? `${current.source.filename}.extracted.txt` : current.source.filename, new TextEncoder().encode(current.text), 'application/octet-stream'); setDownloadError(false); }
    catch { setDownloadError(true); }
  };
  return <BlockFrame view={view} kind="sourceExcerpt" title={<strong>{label || t('title')}</strong>}>
    {!excerpt ? <p>{t(context ? 'empty' : 'emptySection')}</p> : <>
      {validShape && <><blockquote className="notebook-snapshot-quote" style={{ whiteSpace: 'pre-wrap' }}>{excerpt.quote}</blockquote><p>{excerpt.source.filename} · [{excerpt.start}, {excerpt.end})</p></>}
      {failed === excerpt ? <Feedback kind="error">{t('invalid')}</Feedback> : <Feedback kind={current ? 'success' : 'info'}>{t(current ? 'verified' : 'checking')}</Feedback>}
      <p className="notebook-note">{t('provenance')}</p>
      {availability && <p role="status">{t(availability === 'missing' && !context ? 'missingSection' : availability)}</p>}
      <div className="notebook-science-actions"><Button disabled={!current} onClick={download}>{t('download')}</Button>
        {availability === 'available' && current && <Button onClick={() => {
          if (context) {
            const hash = notebookLinkHash(context.entryId, current.source.blockId);
            if (window.location.hash === hash) window.dispatchEvent(new window.HashChangeEvent('hashchange'));
            else window.location.hash = hash;
            return;
          }
          const target = view.editor.view.dom.querySelector(`[data-notebook-block-id="${CSS.escape(current.source.blockId)}"]`);
          target?.dispatchEvent(new Event('notebook-reveal', { bubbles: true }));
          requestAnimationFrame(() => { if (target?.isConnected) target.scrollIntoView({ block: 'center' }); });
        }}>{t('showSource')}</Button>}
      </div>
      {downloadError && <Feedback kind="error">{t('downloadFailed')}</Feedback>}
      {current?.extraction && <SourceExtractionDetails extraction={current.extraction} start={current.start} end={current.end} />}
      {validShape && <Disclosure summary={t('details')}><dl className="notebook-reference-details">
        <div><dt>Block ID</dt><dd><code>{excerpt.source.blockId}</code></dd></div><div><dt>MIME</dt><dd>{excerpt.source.mime}</dd></div>
        <div><dt>SHA-256 / version</dt><dd><code>{excerpt.version}</code></dd></div></dl>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}>{excerpt.text}</pre>
      </Disclosure>}
    </>}
    {view.editor.isEditable && <Button onClick={edit}>{t(excerpt ? 'update' : 'configure')}</Button>}
    {view.editor.isEditable && editing && <SourceExcerptComposer editor={view.editor} initial={editing.attrs} onCancel={() => setEditing(null)} onConfirm={attrs => {
      const position = view.getPos(), node = typeof position === 'number' ? view.editor.state.doc.nodeAt(position) : null;
      if (!node || node.type.name !== 'sourceExcerpt' || JSON.stringify({ label: node.attrs.label, excerpt: node.attrs.excerpt }) !== editing.captured) throw new Error(t('draftChanged'));
      view.updateAttributes(attrs); setEditing(null);
    }} />}
  </BlockFrame>;
}
