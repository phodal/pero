import { useEffect, useRef, useState } from 'react';
import { type Editor, type JSONContent } from '@tiptap/core';
import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { useAppApi } from '@pero/app-sdk';
import { Button, Dialog, Feedback, Field, FilePicker, Input, Textarea } from '@pero/app-sdk/ui';
import type { NotebookDocument } from '@pero/notebook';
import { notebookExample, parseNamedReference } from '@pero/notebook/named-reference';
import { activeNotebookBlock } from './block-order';
import { BlockFrame } from './block-frame';

export const NOTEBOOK_FORMULA_INSPECTOR_EVENT = 'pero:notebook-formula-inspector';
export function NamedReferenceView(view: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  return <BlockFrame view={view} kind="namedReference" title={<strong>{view.node.attrs.name}</strong>}
    actions={view.editor.isEditable && <Button variant="ghost" onClick={() => setEditing(true)}>Edit reference / 编辑引用</Button>}>
    <p>{view.node.attrs.notes}</p><small>Entry reference · Human-authored notes / 条目引用 · 手写笔记</small>
    {editing && <ReferenceDialog initial={view.node.attrs} onClose={() => setEditing(false)} onInsert={attrs => { view.updateAttributes(attrs); setEditing(false); }} />}
  </BlockFrame>;
}
function ReferenceDialog({ initial, onClose, onInsert }: { initial?: Record<string, unknown>; onClose(): void; onInsert(attrs: Record<string, unknown>): void }) {
  const [name, setName] = useState(String(initial?.name ?? '')), [notes, setNotes] = useState(String(initial?.notes ?? ''));
  const [error, setError] = useState('');
  return <Dialog title="Named reference / 命名引用" closeLabel="Close reference / 关闭引用" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); try { const reference = parseNamedReference({ kind: 'entry', name, notes }); onInsert({ ...reference }); } catch (cause) { setError(String(cause)); } }}>
      <Field label="Reference name / 引用名称">{control => <Input {...control} required maxLength={200} value={name} onChange={event => setName(event.target.value)} />}</Field>
      <Field label="Reference notes / 引用笔记">{control => <Textarea {...control} required maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} />}</Field>
      <p>This is an entry card, not a pinned scientific citation. / 这是条目卡片，并非固定版本的科学引文。</p>
      {error && <Feedback kind="error">{error}</Feedback>}
      <Button type="submit" disabled={!name.trim() || !notes.trim()}>Apply reference / 应用引用</Button>
      <Button type="button" onClick={onClose}>Cancel / 取消</Button>
    </form>
  </Dialog>;
}
export function NamedReferenceTools({ onInsert }: { onInsert(nodes: JSONContent[]): void }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" onClick={() => setOpen(true)}>Add named reference / 添加命名引用</Button>
    {open && <ReferenceDialog onClose={() => setOpen(false)} onInsert={attrs => { onInsert([{ type: 'namedReference', attrs }]); setOpen(false); }} />}</>;
}
export function DatedSectionTools({ onInsert }: { onInsert(nodes: JSONContent[]): void }) {
  const [open, setOpen] = useState(false), [date, setDate] = useState(''), [label, setLabel] = useState('');
  return <><Button variant="ghost" onClick={() => { setDate(''); setLabel(''); setOpen(true); }}>Insert dated section / 插入日期章节</Button>
    {open && <Dialog title="Dated section / 日期章节" closeLabel="Close dated section / 关闭日期章节" onClose={() => setOpen(false)}>
      <form onSubmit={event => { event.preventDefault(); if (!date) return; onInsert([{ type: 'section', attrs: { label, date }, content: [{ type: 'paragraph' }] }]); setOpen(false); }}>
        <Field label="Section date / 章节日期">{control => <Input {...control} required type="date" min="0001-01-01" max="9999-12-31" value={date} onChange={event => setDate(event.target.value)} />}</Field>
        <Field label="Section name / 章节名称">{control => <Input {...control} maxLength={200} value={label} onChange={event => setLabel(event.target.value)} />}</Field>
        <Button type="submit" disabled={!date}>Insert dated section / 插入日期章节</Button><Button type="button" onClick={() => setOpen(false)}>Cancel / 取消</Button>
      </form>
    </Dialog>}</>;
}

export function NotebookReplacementTools({ getDocument, onReplace }: { getDocument(): NotebookDocument; onReplace(document: NotebookDocument): void }) {
  const api = useAppApi();
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(''), [error, setError] = useState('');
  const pending = useRef(false), mounted = useRef(true);
  const latest = useRef({ getDocument, onReplace }); latest.current = { getDocument, onReplace };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const importCurrent = async (file: File) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setFeedback('');
    const before = JSON.stringify(getDocument());
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Notebook JSON must be at most 2 MiB.');
      const parsed: unknown = JSON.parse(await file.text());
      const { document } = await api.post<{ document: NotebookDocument }>('/api/document/validate', { document: parsed });
      if (!mounted.current) return;
      if (JSON.stringify(latest.current.getDocument()) !== before) throw new Error('The draft changed during import. Choose the file again to replace the latest draft.');
      latest.current.onReplace(document); setFeedback('Current document replaced. Undo restores the previous draft. / 已替换当前文档，可撤销恢复。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="notebook-workspace-actions">
    <FilePicker compact label="Replace current JSON / 替换当前 JSON" emptyLabel="" accept=".json,application/json" variant="ghost" busy={busy} onFile={file => void importCurrent(file)} />
    <Button variant="ghost" disabled={busy} onClick={() => setConfirm(true)}>Restore Pero example / 恢复 Pero 示例</Button>
    {feedback && <Feedback kind="success">{feedback}</Feedback>}{error && <Feedback kind="error">{error}</Feedback>}
    {confirm && <Dialog title="Restore Pero example / 恢复 Pero 示例" closeLabel="Close example restore / 关闭示例恢复" onClose={() => setConfirm(false)}>
      <p>Replace the entire current draft with the original Pero example? This is one undoable change; saved revisions remain available. / 将当前草稿替换为 Pero 原创示例？可一次撤销，已保存版本仍可查看。</p>
      <Button onClick={() => { try { onReplace(notebookExample(() => crypto.randomUUID())); setConfirm(false); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setConfirm(false); } }}>Replace with example / 替换为示例</Button>
      <Button onClick={() => setConfirm(false)}>Cancel / 取消</Button>
    </Dialog>}
  </div>;
}

export function NotebookStatusBar({ editor }: { editor: Editor }) {
  const status = useEditorState({ editor, selector: ({ editor }) => {
    let sections = 0; editor.state.doc.descendants(node => { if (node.type.name === 'section') sections++; });
    const point = editor.state.selection.$from;
    const ancestors = Array.from({ length: point.depth }, (_, index) => point.node(index + 1).type.name);
    return { sections, list: [...ancestors].reverse().find(name => ['bulletList', 'orderedList', 'taskList'].includes(name)) ?? 'none',
      indent: ancestors.filter(name => ['listItem', 'taskItem'].includes(name)).length };
  } });
  const [notice, setNotice] = useState('');
  return <footer className="notebook-workspace-actions" aria-label="Notebook status / 笔记状态">
    <output>Sections / 章节: {status.sections} · List / 列表: {status.list} · Indent / 缩进: {status.indent}</output>
    <Button variant="ghost" onClick={() => {
      const block = activeNotebookBlock(editor);
      if (block?.node.type.name !== 'spreadsheet') { setNotice('Select a worksheet cell first. / 请先选择工作表单元格。'); return; }
      editor.view.dom.dispatchEvent(new CustomEvent(NOTEBOOK_FORMULA_INSPECTOR_EVENT, { detail: block.node.attrs.blockId })); setNotice('');
    }}>Toggle active formula inspector / 切换当前公式检查器</Button>
    {notice && <span role="status">{notice}</span>}
  </footer>;
}
