import { notebookLinkHash } from '@pero/notebook/workspace';
import { Node } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type NodeViewProps } from '@tiptap/react';
import { useEffect, useId, useRef, useState } from 'react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Feedback, Icon, IconButton, Input, Textarea } from '@pero/app-sdk/ui';
import { attachmentLimits, deriveImageAttachment, verifiedAttachmentBytes, isAttachmentFilename, isAttachmentMime, isPreviewImage, type AttachmentAttributes } from '@pero/notebook/attachment';
import { BlockFrame } from './block-frame';
import { moveBlock, rememberWidgetFocus, topLevelBlock } from './block-order';
import { messages } from './messages';
import { RasterEditDialog, rasterEditPlan } from './raster-edit';
import { ImageHistory } from './image-history';

export { attachmentDefaults, attachmentLimits, type AttachmentAttributes } from '@pero/notebook/attachment';

export const contentBlockMessages = {
  section: { en: 'Section', zh: '章节' },
  sectionTitle: { en: 'Section title', zh: '章节标题' },
  sectionDate: { en: 'Section date', zh: '章节日期' },
  sectionDateInvalid: { en: 'Enter a valid date between 0001-01-01 and 9999-12-31.', zh: '请输入 0001-01-01 至 9999-12-31 之间的有效日期。' },
  collapseSection: { en: 'Collapse section', zh: '收起章节' },
  expandSection: { en: 'Expand section', zh: '展开章节' },
  copySection: { en: 'Copy section', zh: '复制章节' },
  copySectionLink: { en: 'Copy section link', zh: '复制章节链接' },
  sectionLinkScope: { en: 'This link locates the section in the currently open notebook.', zh: '此链接用于定位当前打开笔记中的章节。' },
  sectionCopied: { en: 'Section copied with its blocks.', zh: '已复制章节及其内容块。' },
  sectionLinkCopied: { en: 'Link copied for this open notebook.', zh: '已复制当前打开笔记中的章节链接。' },
  clipboardFailed: { en: 'Could not copy. Allow clipboard access and try again.', zh: '未能复制，请允许剪贴板访问后重试。' },
  editImage: { en: 'Edit image', zh: '编辑图片' },
  imageEditFailed: { en: 'This image cannot be edited. Supported images must be at most 8,192 pixels per side and 16 megapixels.', zh: '无法编辑此图片。支持的图片每边最多 8,192 像素，总计 1,600 万像素。' },
  attachment: { en: 'Attachment', zh: '附件' },
  attachmentCaption: { en: 'Attachment caption', zh: '附件说明' },
  attachmentDownload: { en: 'Download file', zh: '下载文件' },
  attachmentSize: { en: '{size} KiB', zh: '{size} KiB' },
  attachmentLimits: { en: 'Up to 512 KiB per file. Files are embedded in revisions within the 2 MiB notebook limit; previous revisions retain removed files.', zh: '每个文件最多 512 KiB，文件随修订保存并计入笔记的 2 MiB 上限；移除文件不会删除旧修订中的内容。' },
  attachmentPreviewTypes: { en: 'PNG, JPEG and WebP images can be previewed. Other files are download-only.', zh: 'PNG、JPEG 和 WebP 图片可预览，其他文件仅供下载。' },
  attachmentTooLarge: { en: 'This file exceeds the 512 KiB attachment limit.', zh: '此文件超出附件的 512 KiB 上限。' },
  attachmentTypeUnsupported: { en: 'Image attachments must be PNG, JPEG or WebP.', zh: '图片附件必须为 PNG、JPEG 或 WebP 格式。' },
  attachmentNameInvalid: { en: 'Use a file name of up to 255 characters without path separators or control characters.', zh: '文件名最多 255 个字符，不能包含路径分隔符或控制字符。' },
  attachmentVerifying: { en: 'Checking file integrity…', zh: '正在校验文件完整性…' },
  attachmentInvalid: { en: 'File integrity could not be verified. Preview and download are unavailable; remove and attach the original file again.', zh: '未能验证文件完整性，暂不可预览或下载；请移除此附件并重新附加原文件。' },
  attachmentPreviewFailed: { en: 'This image could not be previewed. You can still download the original file.', zh: '此图片无法预览，仍可下载原文件。' },
  attachmentDownloadFailed: { en: 'The download could not start. Try again.', zh: '未能开始下载，请重试。' },
} as const;

type AttachmentErrorKey = 'attachmentTooLarge' | 'attachmentTypeUnsupported' | 'attachmentNameInvalid';

/** Only local File bytes enter the revision, never the selected path or a remote URL. */
export async function createAttachment(file: File, translate: (key: AttachmentErrorKey) => string = key => contentBlockMessages[key].en): Promise<AttachmentAttributes> {
  if (file.size > attachmentLimits.bytes) throw new Error(translate('attachmentTooLarge'));
  if (!isAttachmentFilename(file.name)) throw new Error(translate('attachmentNameInvalid'));
  const mime = file.type.toLowerCase() || 'application/octet-stream';
  if (!isAttachmentMime(mime)) throw new Error(translate('attachmentTypeUnsupported'));
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > attachmentLimits.bytes) throw new Error(translate('attachmentTooLarge'));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return {
    filename: file.name, mime, data: btoa(binary), caption: '',
    sha256: Array.from(digest, value => value.toString(16).padStart(2, '0')).join(''),
  };
}

function isSectionDate(date: string): boolean {
  if (date === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-')) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function shownSectionDate(date: string, locale: string) {
  if (!isSectionDate(date) || date === '') return '';
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(parsed) : '';
}

function SectionView(view: NodeViewProps) {
  const { t, locale } = useAppI18n(contentBlockMessages);
  const { t: common } = useAppI18n(messages);
  const { label, date, blockId } = view.node.attrs as { label: string; date: string; blockId: string | null };
  const [expanded, setExpanded] = useState(true);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<'sectionCopied' | 'sectionLinkCopied' | 'clipboardFailed' | null>(null);
  const [dateError, setDateError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const dateErrorId = useId();
  const anchor = blockId ? `notebook-block-${blockId}` : undefined;
  const editable = view.editor.isEditable;
  const position = view.getPos();
  const located = typeof position === 'number' ? topLevelBlock(view.editor, position) : null;
  const topLevel = located?.node === view.node ? located : null;

  useEffect(() => {
    const wrapper = container.current;
    const revealNestedBlock = () => setExpanded(true);
    wrapper?.addEventListener('notebook-reveal', revealNestedBlock);
    const reveal = () => {
      if (!anchor || window.location.hash !== `#${anchor}`) return;
      setExpanded(true);
      container.current?.scrollIntoView({ block: 'start' });
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    return () => {
      window.removeEventListener('hashchange', reveal);
      wrapper?.removeEventListener('notebook-reveal', revealNestedBlock);
    };
  }, [anchor]);

  const copy = async (link: boolean) => {
    setCopying(true);
    setNotice(null);
    try {
      if (link) {
        if (!anchor) throw new Error('Section identity is not available.');
        const url = new URL(window.location.href);
        const entryId = container.current?.closest('[data-notebook-entry-id]')?.getAttribute('data-notebook-entry-id');
        url.hash = entryId && blockId ? notebookLinkHash(entryId, blockId) : anchor;
        await navigator.clipboard.writeText(url.href);
      } else {
        const copied = view.editor.view.serializeForClipboard(new Slice(Fragment.from(view.node), 0, 0));
        const text = [label, date, copied.text].filter(Boolean).join('\n');
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([copied.dom.innerHTML], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
      }
      setNotice(link ? 'sectionLinkCopied' : 'sectionCopied');
    } catch { setNotice('clipboardFailed'); }
    finally { setCopying(false); }
  };

  const shownDate = shownSectionDate(date, locale);
  return <NodeViewWrapper ref={container} className="notebook-block notebook-section" data-kind="section" role="group"
    aria-label={label || t('section')} id={anchor} data-selected={view.selected || undefined} data-notebook-block-id={blockId ?? undefined}>
    <div className="notebook-daybar" contentEditable={false} onFocusCapture={() => rememberWidgetFocus(view.editor, blockId ?? undefined)}>
      <IconButton label={t(expanded ? 'collapseSection' : 'expandSection')} aria-expanded={expanded} aria-controls={contentId}
        onClick={() => setExpanded(value => !value)}><Icon name={expanded ? 'chevron-down' : 'chevron-right'} /></IconButton>
      <span className="notebook-daychip">
        <Icon name="calendar" size={14} />
        <span className="notebook-daytext" aria-hidden="true">{shownDate || t('sectionDate')}</span>
        {editable ? <Input className="notebook-section-date" type="date" aria-label={t('sectionDate')} value={date} min="0001-01-01" max="9999-12-31"
          aria-invalid={dateError || undefined} aria-describedby={dateError ? dateErrorId : undefined}
          onChange={event => {
            const value = event.target.value;
            const valid = isSectionDate(value);
            setDateError(!valid);
            if (valid) view.updateAttributes({ date: value });
          }} /> : date && <time className="notebook-visually-hidden" dateTime={date}>{shownDate}</time>}
      </span>
      {editable ? <Input unstyled className="notebook-block-name" aria-label={t('sectionTitle')} placeholder={t('section')}
        maxLength={200} value={label} onChange={event => view.updateAttributes({ label: event.target.value })} /> : <strong>{label || t('section')}</strong>}
      <span className="notebook-dayactions">
        <IconButton label={t('copySectionLink')} disabled={copying || !anchor} title={t('sectionLinkScope')} onClick={() => void copy(true)}><Icon name="link" /></IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><IconButton label={common('blockActions')}><Icon name="gear" /></IconButton></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={copying} onSelect={() => void copy(false)}>{t('copySection')}</DropdownMenuItem>
          <DropdownMenuItem disabled={copying || !anchor} title={t('sectionLinkScope')} onSelect={() => void copy(true)}>{t('copySectionLink')}</DropdownMenuItem>
          {editable && <>
            <DropdownMenuItem disabled={!topLevel || topLevel.index === 0} onSelect={() => typeof position === 'number' && moveBlock(view.editor, -1, position)}>{common('up')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!topLevel || topLevel.index === view.editor.state.doc.childCount - 1} onSelect={() => typeof position === 'number' && moveBlock(view.editor, 1, position)}>{common('down')}</DropdownMenuItem>
            <DropdownMenuItem danger onSelect={view.deleteNode}>{common('remove')}</DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      </span>
    </div>
    {dateError && <div contentEditable={false}><Feedback id={dateErrorId} kind="error">{t('sectionDateInvalid')}</Feedback></div>}
    {notice && <div contentEditable={false}><Feedback kind={notice === 'clipboardFailed' ? 'error' : 'success'}>{t(notice)}</Feedback></div>}
    <NodeViewContent id={contentId} className="notebook-block-content notebook-section-content" hidden={!expanded}
      onFocusCapture={() => rememberWidgetFocus(view.editor)} />
  </NodeViewWrapper>;
}

export const Section = Node.create({
  name: 'section', group: 'block', content: 'block+', defining: true, isolating: true,
  addAttributes() {
    return {
      label: { default: '', rendered: false, parseHTML: () => null },
      date: { default: '', rendered: false, parseHTML: () => null },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-notebook-block="section"]', getAttrs: element => {
      const label = element.getAttribute('data-notebook-label') ?? '';
      const date = element.getAttribute('data-notebook-date') ?? '';
      return Array.from(label).length <= 200 && isSectionDate(date) ? { label, date } : false;
    } }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['section', { ...HTMLAttributes, 'data-notebook-block': 'section',
      'data-notebook-label': node.attrs.label, 'data-notebook-date': node.attrs.date }, 0];
  },
  addNodeView() { return ReactNodeViewRenderer(SectionView); },
});

type VerifiedAttachment = { filename: string; data: string; mime: string; sha256: string; derivation: AttachmentAttributes['derivation']; bytes: Uint8Array<ArrayBuffer>; preview: string | null };

export function AttachmentView(view: NodeViewProps) {
  const { t } = useAppI18n(contentBlockMessages);
  const { filename, mime, data, caption, sha256, derivation } = view.node.attrs as AttachmentAttributes;
  const [verified, setVerified] = useState<VerifiedAttachment | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const editable = useEditorState({ editor: view.editor, selector: ({ editor }) => editor.isEditable });
  const [imageEdit, setImageEdit] = useState<{ width: number; height: number; sha256: string } | null>(null);
  const [editError, setEditError] = useState(false);
  const [openingEdit, setOpeningEdit] = useState(false);
  // A previous attachment must never be presented as the current file during verification.
  const current = verified && verified.filename === filename && verified.data === data && verified.mime === mime && verified.sha256 === sha256 && verified.derivation === derivation ? verified : null;

  useEffect(() => {
    let live = true;
    let preview: string | null = null;
    setInvalid(false);
    setPreviewFailed(false);
    setDownloadFailed(false);
    const verify = async () => {
      const bytes = await verifiedAttachmentBytes({ filename, mime, data, caption: '', sha256, derivation });
      if (!live) return;
      if (isPreviewImage(mime)) preview = URL.createObjectURL(new Blob([bytes], { type: mime }));
      setVerified({ filename, data, mime, sha256, derivation, bytes, preview });
    };
    void verify().catch(() => { if (live) setInvalid(true); });
    return () => { live = false; if (preview) URL.revokeObjectURL(preview); };
  }, [filename, mime, data, sha256, derivation]);

  const openImageEdit = async () => {
    if (!current || !editable) return;
    setEditError(false); setOpeningEdit(true);
    try {
      const image = await createImageBitmap(new Blob([current.bytes], { type: mime }));
      try {
        rasterEditPlan(image.width, image.height, { x: 0, y: 0, width: image.width, height: image.height,
          outputWidth: image.width, outputHeight: image.height, rotation: 0 });
        setImageEdit({ width: image.width, height: image.height, sha256 });
      } finally { image.close(); }
    } catch { setEditError(true); }
    finally { setOpeningEdit(false); }
  };

  const download = () => {
    if (!current) return;
    setDownloadFailed(false);
    try { downloadFile(filename, current.bytes, 'application/octet-stream'); }
    catch { setDownloadFailed(true); }
  };

  return <BlockFrame view={view} kind="attachment" title={<strong>{filename || t('attachment')}</strong>}
    caption={current && <span className="notebook-note">{t('attachmentSize', { size: Math.ceil(current.bytes.byteLength / 1024) })}</span>}
    actions={<><Button variant="ghost" disabled={!current} onClick={download}><Icon name="download" />{t('attachmentDownload')}</Button>
      {editable && current?.preview && <Button variant="ghost" busy={openingEdit} onClick={() => void openImageEdit()}>{t('editImage')}</Button>}</>}>
    {invalid ? <Feedback kind="error">{t('attachmentInvalid')}</Feedback> : !current && <Feedback kind="info">{t('attachmentVerifying')}</Feedback>}
    {current?.preview && !previewFailed && <img className="notebook-attachment-preview" src={current.preview} alt={caption || filename}
      onError={() => setPreviewFailed(true)} />}
    {previewFailed && <Feedback kind="info">{t('attachmentPreviewFailed')}</Feedback>}
    {editError && <Feedback kind="error">{t('imageEditFailed')}</Feedback>}
    {editable && imageEdit?.sha256 === sha256 && current?.preview && <RasterEditDialog
      width={imageEdit.width} height={imageEdit.height} preview={current.preview}
      source={new Blob([current.bytes], { type: mime })} onClose={() => setImageEdit(null)}
      onApply={async (blob, edit) => {
        const derived = await createAttachment(new File([blob], `${filename.replace(/\.[^.]+$/, '').slice(0, 230)}-edited.png`, { type: 'image/png' }));
        const position = view.getPos();
        const node = typeof position === 'number' ? view.editor.state.doc.nodeAt(position) : null;
        if (!view.editor.isEditable || !node || node.attrs.sha256 !== sha256 || node.attrs.data !== data || node.attrs.derivation !== derivation) throw new Error('The attachment changed. Reopen the image editor.');
        view.editor.view.dispatch(closeHistory(view.editor.state.tr).setNodeMarkup(position!, undefined, {
          ...node.attrs, ...deriveImageAttachment({ filename, mime, data, sha256, caption: node.attrs.caption, derivation },
            derived, imageEdit.width, imageEdit.height, edit),
        }));
      }} />}
    {current && derivation && <ImageHistory derivation={derivation} />}
    {downloadFailed && <Feedback kind="error">{t('attachmentDownloadFailed')}</Feedback>}
    {editable ? <label className="notebook-field">{t('attachmentCaption')}
      <Textarea rows={2} maxLength={attachmentLimits.caption} value={caption} onChange={event => view.updateAttributes({ caption: event.target.value })} />
    </label> : caption && <p className="notebook-attachment-caption">{caption}</p>}
    <p className="notebook-note">{t('attachmentLimits')}</p>
  </BlockFrame>;
}
