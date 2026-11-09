import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { useAppI18n } from '@pero/app-sdk';
import { Badge, Button, Feedback, FilePicker, Toolbar } from '@pero/app-sdk/ui';
import type { NotebookNode } from '@pero/notebook';
import { procedureElapsed, type NotebookProcedureStep, type ProcedureChange } from '@pero/notebook/workspace';
import { notebookExtensions } from './editor-extensions';
import { NotebookTextTools } from './text-tools';
import { createAttachment } from './content-blocks';

const messages = {
  format: { en: 'Step formatting', zh: '步骤格式' },
  image: { en: 'Insert image', zh: '插入图片' }, table: { en: 'Insert editable table', zh: '插入可编辑表格' },
  start: { en: 'Start timer', zh: '开始计时' }, pause: { en: 'Pause timer', zh: '暂停计时' }, reset: { en: 'Reset timer', zh: '重置计时' },
  elapsed: { en: 'Actual elapsed: {seconds} seconds', zh: '实际已计时：{seconds} 秒' },
  manual: { en: 'Manual wall-clock timer. It does not operate equipment or verify completion.', zh: '手动墙钟计时器，不操作设备或验证实验完成情况。' },
  running: { en: 'Running', zh: '计时中' }, stopped: { en: 'Stopped', zh: '已停止' },
  unsupported: { en: 'Choose a PNG, JPEG or WebP image.', zh: '请选择 PNG、JPEG 或 WebP 图片。' },
} as const;

/** A focused editor using the Notes block/formatting owners, without workspace recursion. */
export function ProcedureStepEditor({ step, readonly, onChange }: {
  step: NotebookProcedureStep; readonly: boolean; onChange: (patch: Partial<NotebookProcedureStep>) => void;
}) {
  const { t } = useAppI18n(messages);
  const [error, setError] = useState('');
  const latest = useRef(onChange); latest.current = onChange;
  const legacyBlockId = useRef(crypto.randomUUID());
  const initial = useMemo(() => step.content ?? { type: 'doc', content: [{ type: step.kind === 'header' ? 'heading' : 'paragraph',
    attrs: { blockId: legacyBlockId.current, ...(step.kind === 'header' ? { level: 2 } : {}) },
    ...(step.text ? { content: [{ type: 'text', text: step.text }] } : {}),
  }] }, [step.content, step.text, step.kind]);
  const editor = useEditor({ extensions: notebookExtensions.map(extension => extension.name === 'starterKit' ? extension.configure({ undoRedo: false }) : extension), content: initial, editable: !readonly,
    editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('format'), class: 'notebook-prose notebook-procedure-prose' } },
    onUpdate: ({ editor: instance }) => latest.current({ content: instance.getJSON() as NotebookNode, text: '' }),
  });
  useEffect(() => { editor?.setEditable(!readonly); }, [editor, readonly]);
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
  if (!editor) return null;
  const insertImage = async (file: File) => {
    setError('');
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('unsupported'));
      const attrs = await createAttachment(file);
      if (!editor.isDestroyed && editor.isEditable) editor.commands.insertContentAt(editor.state.doc.content.size, [{ type: 'attachment', attrs }, { type: 'paragraph' }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className="notebook-procedure-content">
    {!readonly && <Toolbar role="group" aria-label={t('format')} className="notebook-toolbar">
      <NotebookTextTools editor={editor} />
      {step.kind === 'image' && <FilePicker label={t('image')} accept="image/png,image/jpeg,image/webp" emptyLabel="" onFile={file => void insertImage(file)} />}
      {step.kind === 'table' && <Button variant="ghost" onClick={() => editor.commands.insertContentAt(editor.state.doc.content.size,
        [{ type: 'spreadsheet', attrs: { label: '', sheet: { rows: 3, columns: 3, cells: {} } } }, { type: 'paragraph' }])}>{t('table')}</Button>}
    </Toolbar>}
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
