import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Disclosure, Feedback, Field, FilePicker, NativeSelect } from '@pero/app-sdk/ui';
import type { NotebookNode } from '@pero/notebook';
import { procedureElapsed, type NotebookProcedureStep, type ProcedureChange } from '@pero/notebook/workspace';
import { notebookExtensions } from './editor-extensions';
import { NotebookTextTools } from './text-tools';
import { createAttachment } from './content-blocks';
import { nextWorksheetName } from './worksheet-model';

const messages = {
  format: { en: 'Step formatting', zh: '步骤格式' },
  image: { en: 'Insert image', zh: '插入图片' }, table: { en: 'Insert editable table', zh: '插入可编辑表格' },
  insertContent: { en: 'Insert image or table', zh: '插入图片或表格' },
  plate: { en: 'Insert well grid', zh: '插入孔位网格' }, plateSize: { en: 'Well grid size', zh: '孔位网格尺寸' },
  start: { en: 'Start timer', zh: '开始计时' }, pause: { en: 'Pause timer', zh: '暂停计时' }, reset: { en: 'Reset timer', zh: '重置计时' },
  elapsed: { en: 'Actual elapsed: {seconds} seconds', zh: '实际已计时：{seconds} 秒' },
  manual: { en: 'Manual wall-clock timer. It does not operate equipment or verify completion.', zh: '手动墙钟计时器，不操作设备或验证实验完成情况。' },
  running: { en: 'Running', zh: '计时中' }, stopped: { en: 'Stopped', zh: '已停止' },
  unsupported: { en: 'Choose a PNG, JPEG or WebP image.', zh: '请选择 PNG、JPEG 或 WebP 图片。' },
} as const;

/** Procedure steps, introductions and material notes use one Notes-backed editor. */
export function ProcedureStepEditor({ step, readonly, onChange }: {
  step: NotebookProcedureStep; readonly: boolean; onChange: (patch: Partial<NotebookProcedureStep>) => void;
}) {
  return <ProcedureRichEditor content={step.content} text={step.text} kind={step.kind ?? 'step'} readonly={readonly}
    onChange={content => onChange({ content, text: '' })} />;
}

export function ProcedureRichEditor({ content, text = '', kind, label, readonly, onChange }: {
  content?: NotebookNode; text?: string; kind?: NotebookProcedureStep['kind']; label?: string;
  readonly: boolean; onChange: (content: NotebookNode) => void;
}) {
  const { t } = useAppI18n(messages);
  const [error, setError] = useState(''), [plateSize, setPlateSize] = useState('8x12');
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(onChange); latest.current = onChange;
  const legacyBlockId = useRef(crypto.randomUUID());
  const initial = useMemo(() => content ?? { type: 'doc', content: [{ type: kind === 'header' ? 'heading' : 'paragraph',
    attrs: { blockId: legacyBlockId.current, ...(kind === 'header' ? { level: 2 } : {}) },
    ...(text ? { content: [{ type: 'text', text: text }] } : {}),
  }] }, [content, text, kind]);
  const editor = useEditor({ extensions: notebookExtensions.map(extension => extension.name === 'starterKit' ? extension.configure({ undoRedo: false }) : extension), content: initial, editable: !readonly,
    editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': label ?? t('format'), class: 'notebook-prose notebook-procedure-prose' } },
    onUpdate: ({ editor: instance }) => latest.current(instance.getJSON() as NotebookNode),
  });
  useEffect(() => { editor?.setEditable(!readonly, false); }, [editor, readonly]);
  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(initial)) {
      const selection = editor.state.selection;
      editor.commands.setContent(initial, { emitUpdate: false });
      const doc = editor.state.doc;
      const anchor = Math.min(selection.anchor, doc.content.size), head = Math.min(selection.head, doc.content.size);
      const node = doc.nodeAt(anchor);
      const restored = selection instanceof NodeSelection && node && NodeSelection.isSelectable(node)
        ? NodeSelection.create(doc, anchor)
        : TextSelection.between(doc.resolve(anchor), doc.resolve(head));
      editor.view.dispatch(editor.state.tr.setSelection(restored));
    }
  }, [editor, initial]);
  useEffect(() => {
    const element = container.current;
    if (!element || !editor) return;
    let frame = 0;
    const reveal = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      let found: number | null = null;
      editor.state.doc.descendants((node, pos) => { if (node.attrs.blockId === id) { found = pos; return false; } });
      if (found === null) return;
      const pos: number = found, node = editor.state.doc.nodeAt(pos)!;
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) dom.dispatchEvent(new CustomEvent('notebook-reveal', { bubbles: true }));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.isSelectable(node) ? NodeSelection.create(editor.state.doc, pos) : Selection.near(editor.state.doc.resolve(pos))).scrollIntoView());
        editor.view.focus();
        if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'center' });
      });
    };
    element.addEventListener('notebook-focus-rich', reveal);
    return () => { cancelAnimationFrame(frame); element.removeEventListener('notebook-focus-rich', reveal); };
  }, [editor]);
  if (!editor) return null;
  const insertImage = async (file: File) => {
    setError('');
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('unsupported'));
      const attrs = await createAttachment(file);
      if (!editor.isDestroyed && editor.isEditable) editor.commands.insertContentAt(editor.state.doc.content.size, [{ type: 'attachment', attrs }, { type: 'paragraph' }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className="notebook-procedure-content" ref={container}>
    {!readonly && <div className="notebook-procedure-tools">
      <NotebookTextTools editor={editor} />
      {(!kind || kind === 'image' || kind === 'table') && <Disclosure variant="inline" summary={t('insertContent')}>
      {(!kind || kind === 'image') && <FilePicker label={t('image')} accept="image/png,image/jpeg,image/webp" emptyLabel="" onFile={file => void insertImage(file)} />}
      {(!kind || kind === 'table') && <><Field label={t('plateSize')}>{control => <NativeSelect {...control} value={plateSize} onChange={event => setPlateSize(event.target.value)}>
        {[['4x6', '24 (4 × 6)'], ['8x12', '96 (8 × 12)'], ['16x24', '384 (16 × 24)'], ['32x48', '1536 (32 × 48)']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </NativeSelect>}</Field><Button variant="ghost" onClick={() => { const [rows, columns] = plateSize.split('x').map(Number); editor.commands.insertContentAt(editor.state.doc.content.size,
        [{ type: 'spreadsheet', attrs: { label: nextWorksheetName(editor.state.doc), sheet: { rows, columns, cells: {} } } }, { type: 'paragraph' }]); }}>{t('plate')}</Button></>}
      {(!kind || kind === 'table') && <Button variant="ghost" onClick={() => editor.commands.insertContentAt(editor.state.doc.content.size,
        [{ type: 'spreadsheet', attrs: { label: '', sheet: { rows: 3, columns: 3, cells: {} } } }, { type: 'paragraph' }])}>{t('table')}</Button>}
      </Disclosure>}
    </div>}
    {error && <Feedback kind="error">{error}</Feedback>}
    <EditorContent editor={editor} />
  </div>;
}

export function ProcedureTimerView({ step, readonly, onAction }: {
  step: NotebookProcedureStep; readonly: boolean; onAction: (action: Extract<ProcedureChange, { type: 'timer' }>['action'], now: number) => void;
}) {
  const { t } = useAppI18n(messages);
  const [now, setNow] = useState(Date.now);
  const running = step.timer?.startedAt != null;
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [running, step.timer]);
  return <div className="notebook-workspace-form">
    <p className="notebook-workspace-hint">{t('manual')}</p>
    <div className="notebook-workspace-actions"><output>{t('elapsed', { seconds: (procedureElapsed(step.timer, now) / 1000).toFixed(1) })}</output>
      <Badge>{t(running ? 'running' : 'stopped')}</Badge>
      {!readonly && <>{(['start', 'pause', 'reset'] as const).map(action => <Button key={action} variant="ghost"
        disabled={(action === 'start' && running) || (action === 'pause' && !running)} onClick={() => onAction(action, Date.now())}>{t(action)}</Button>)}</>}
    </div>
  </div>;
}
