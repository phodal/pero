import { useEffect, useRef, useState } from 'react';
import { type Editor, type JSONContent } from '@tiptap/core';
import { useEditorState, type NodeViewProps } from '@tiptap/react';
import { useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback, Field, FilePicker, Input, Textarea } from '@pero/app-sdk/ui';
import type { NotebookDocument } from '@pero/notebook';
import { notebookExample, parseNamedReference } from '@pero/notebook/named-reference';
import { activeNotebookBlock } from './block-order';
import { BlockFrame } from './block-frame';
import { messages } from './messages';

export const NOTEBOOK_FORMULA_INSPECTOR_EVENT = 'pero:notebook-formula-inspector';

export function NamedReferenceView(view: NodeViewProps) {
  const { t } = useAppI18n(messages);
  const [editing, setEditing] = useState(false);
  return <BlockFrame view={view} kind="namedReference" title={<strong>{view.node.attrs.name}</strong>}
    actions={view.editor.isEditable && <Button variant="ghost" onClick={() => setEditing(true)}>{t('editNamedReference')}</Button>}>
    <p>{view.node.attrs.notes}</p><small>{t('namedReferenceKind')}</small>
    {editing && <ReferenceDialog initial={view.node.attrs} onClose={() => setEditing(false)} onInsert={attrs => { view.updateAttributes(attrs); setEditing(false); }} />}
  </BlockFrame>;
}

function ReferenceDialog({ initial, onClose, onInsert }: { initial?: Record<string, unknown>; onClose(): void; onInsert(attrs: Record<string, unknown>): void }) {
  const { t } = useAppI18n(messages);
  const [name, setName] = useState(String(initial?.name ?? '')), [notes, setNotes] = useState(String(initial?.notes ?? ''));
  const [error, setError] = useState('');
  return <Dialog title={t('namedReference')} closeLabel={t('closeNamedReference')} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); try { const reference = parseNamedReference({ kind: 'entry', name, notes }); onInsert({ ...reference }); } catch (cause) { setError(String(cause)); } }}>
      <Field label={t('namedReferenceName')}>{control => <Input {...control} required maxLength={200} value={name} onChange={event => setName(event.target.value)} />}</Field>
      <Field label={t('namedReferenceNotes')}>{control => <Textarea {...control} required maxLength={20000} value={notes} onChange={event => setNotes(event.target.value)} />}</Field>
      <p>{t('namedReferenceHint')}</p>
      {error && <Feedback kind="error">{error}</Feedback>}
      <Button type="submit" disabled={!name.trim() || !notes.trim()}>{t('applyNamedReference')}</Button>
      <Button type="button" onClick={onClose}>{t('cancelAction')}</Button>
    </form>
  </Dialog>;
}

export function NamedReferenceTools({ onInsert }: { onInsert(nodes: JSONContent[]): void }) {
  const { t } = useAppI18n(messages);
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" onClick={() => setOpen(true)}>{t('addNamedReference')}</Button>
    {open && <ReferenceDialog onClose={() => setOpen(false)} onInsert={attrs => { onInsert([{ type: 'namedReference', attrs }]); setOpen(false); }} />}</>;
}

export function DatedSectionTools({ onInsert }: { onInsert(nodes: JSONContent[]): void }) {
  const { t } = useAppI18n(messages);
  const [open, setOpen] = useState(false), [date, setDate] = useState(''), [label, setLabel] = useState('');
  return <><Button variant="ghost" onClick={() => { setDate(''); setLabel(''); setOpen(true); }}>{t('insertDatedSection')}</Button>
    {open && <Dialog title={t('datedSection')} closeLabel={t('closeDatedSection')} onClose={() => setOpen(false)}>
      <form onSubmit={event => { event.preventDefault(); if (!date) return; onInsert([{ type: 'section', attrs: { label, date }, content: [{ type: 'paragraph' }] }]); setOpen(false); }}>
        <Field label={t('sectionDate')}>{control => <Input {...control} required type="date" min="0001-01-01" max="9999-12-31" value={date} onChange={event => setDate(event.target.value)} />}</Field>
        <Field label={t('sectionName')}>{control => <Input {...control} maxLength={200} value={label} onChange={event => setLabel(event.target.value)} />}</Field>
        <Button type="submit" disabled={!date}>{t('insertDatedSection')}</Button><Button type="button" onClick={() => setOpen(false)}>{t('cancelAction')}</Button>
      </form>
    </Dialog>}</>;
}

export function NotebookReplacementTools({ getDocument, onReplace, layout = 'bar' }: {
  getDocument(): NotebookDocument; onReplace(document: NotebookDocument): void; layout?: 'bar' | 'menu';
}) {
  const { t } = useAppI18n(messages);
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
      latest.current.onReplace(document); setFeedback(t('documentReplaced'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className={layout === 'menu' ? 'notebook-replacement-menu' : 'notebook-workspace-actions'}>
    <FilePicker compact label={t('replaceCurrentJson')} emptyLabel="" accept=".json,application/json" variant="ghost" busy={busy} onFile={file => void importCurrent(file)} />
    <Button variant="ghost" disabled={busy} onClick={() => setConfirm(true)}>{t('restoreExample')}</Button>
    {feedback && <Feedback kind="success">{feedback}</Feedback>}{error && <Feedback kind="error">{error}</Feedback>}
    {confirm && <Dialog title={t('restoreExample')} closeLabel={t('closeExampleRestore')} onClose={() => setConfirm(false)}>
      <p>{t('restoreExampleHint')}</p>
      <Button onClick={() => { try { onReplace(notebookExample(() => crypto.randomUUID())); setConfirm(false); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setConfirm(false); } }}>{t('replaceWithExample')}</Button>
      <Button onClick={() => setConfirm(false)}>{t('cancelAction')}</Button>
    </Dialog>}
  </div>;
}

export function NotebookStatusBar({ editor, variant = 'bar' }: { editor: Editor; variant?: 'bar' | 'output' | 'toggle' }) {
  const { t } = useAppI18n(messages);
  const status = useEditorState({ editor, selector: ({ editor }) => {
    let sections = 0; editor.state.doc.descendants(node => { if (node.type.name === 'section') sections++; });
    const point = editor.state.selection.$from;
    const ancestors = Array.from({ length: point.depth }, (_, index) => point.node(index + 1).type.name);
    return { sections, list: [...ancestors].reverse().find(name => ['bulletList', 'orderedList', 'taskList'].includes(name)) ?? 'none',
      indent: ancestors.filter(name => ['listItem', 'taskItem'].includes(name)).length };
  } });
  const [notice, setNotice] = useState('');
  const toggle = <Button variant="ghost" aria-label={t('toggleFormulaInspector')} title={t('toggleFormulaInspector')} onClick={() => {
    const block = activeNotebookBlock(editor);
    if (block?.node.type.name !== 'spreadsheet') { setNotice(t('selectWorksheetFirst')); return; }
    editor.view.dom.dispatchEvent(new CustomEvent(NOTEBOOK_FORMULA_INSPECTOR_EVENT, { detail: block.node.attrs.blockId })); setNotice('');
  }}>fx</Button>;
  if (variant === 'toggle') return <>{toggle}{notice && <span role="status">{notice}</span>}</>;
  const summary = <output>{t('statusSummary', status)}</output>;
  if (variant === 'output') return <footer className="notebook-status-bar" aria-label={t('notebookStatus')}><output>{t('sectionCount', { sections: status.sections })}</output></footer>;
  return <footer className="notebook-status-bar notebook-workspace-actions" aria-label={t('notebookStatus')}>
    {summary}{toggle}{notice && <span role="status">{notice}</span>}
  </footer>;
}
