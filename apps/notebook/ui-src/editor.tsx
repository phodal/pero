import { Node, type Editor, type JSONContent } from '@tiptap/core';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useState } from 'react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Feedback, FilePicker, Icon, IconButton, Toolbar } from '@pero/app-sdk/ui';
import type { NotebookDocument } from '@pero/notebook';
import { readWorkbook, writeWorkbook } from '@pero/notebook/workbook';
import { activeNotebookBlock, moveBlock, rememberWidgetFocus } from './block-order';
import { isClipboardWidget } from './clipboard-block';
import { NotebookIdentity } from './block-identity';
import { ExperimentView, EvidenceView, FindingView } from './research-blocks';
import { SpreadsheetView } from './spreadsheet';
import { nextWorksheetName, worksheetBlocks } from './worksheet-model';
import { messages } from './messages';

const widgets = [
  { name: 'spreadsheet', icon: 'table', defaults: { label: '', sheet: { rows: 5, columns: 5, cells: {} }, annotations: {} }, view: SpreadsheetView },
  { name: 'evidence', icon: 'document', defaults: { label: '', source: null, snapshot: null }, view: EvidenceView },
  { name: 'experiment', icon: 'flask', defaults: { label: '', source: null, snapshot: null }, view: ExperimentView },
  { name: 'finding', icon: 'search', defaults: { claim: '', limitations: '', evidenceIds: [] }, view: FindingView },
] as const;

const addressed = ['paragraph', 'heading', 'blockquote', 'horizontalRule', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
  ...widgets.map(widget => widget.name)];

function readAttribute(element: HTMLElement, key: string, fallback: unknown) {
  const raw = element.getAttribute(`data-notebook-${key.toLowerCase()}`);
  if (raw === null) return fallback;
  try { return JSON.parse(raw) as unknown; }
  catch { return undefined; }
}

const extensions = [
  StarterKit.configure({ link: false, underline: false, trailingNode: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  ...widgets.map(widget => Node.create({
    name: widget.name,
    group: 'block',
    atom: true,
    selectable: true,
    addAttributes() {
      return Object.fromEntries(Object.entries(widget.defaults).map(([key, value]) => [key, {
        default: value, rendered: false, parseHTML: () => null,
      }]));
    },
    parseHTML() {
      return [{
        tag: `div[data-notebook-block="${widget.name}"]`,
        getAttrs: (element: HTMLElement) => {
          const attrs = Object.fromEntries(Object.entries(widget.defaults).map(([key, value]) => [
            key, readAttribute(element, key, value),
          ]));
          return isClipboardWidget(widget.name, attrs) ? attrs : false;
        },
      }];
    },
    renderHTML({ node, HTMLAttributes }) {
      return ['div', {
        ...HTMLAttributes,
        'data-notebook-block': widget.name,
        ...Object.fromEntries(Object.keys(widget.defaults).map(key => [`data-notebook-${key.toLowerCase()}`, JSON.stringify(node.attrs[key])])),
      }];
    },
    renderText() { return `[${messages[widget.name].en}]`; },
    addNodeView() { return ReactNodeViewRenderer(widget.view); },
  })),
  NotebookIdentity.configure({ attributeName: 'blockId', types: addressed }),
];

function insertBlocks(editor: Editor, insert: JSONContent[]) {
  const block = activeNotebookBlock(editor);
  const end = block ? block.start + block.node.nodeSize : editor.state.doc.content.size;
  const blocks = end === editor.state.doc.content.size ? [...insert, { type: 'paragraph' }] : insert;
  // Tiptap's deferred focus can take focus back from a newly inserted widget input.
  return editor.commands.insertContentAt(end, blocks);
}

const formats = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock'] as const;
const marks = ['bold', 'italic', 'strike', 'code'] as const;
const markIcons = { bold: 'bold', italic: 'italic', code: 'code' } as const;

function EditorToolbar({ editor }: { editor: Editor }) {
  const { t } = useAppI18n(messages);
  const [importing, setImporting] = useState(false), [error, setError] = useState('');
  const status = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const block = activeNotebookBlock(instance);
      return {
        format: formats.find(type => type !== 'paragraph' && instance.isActive(type)) ?? 'paragraph',
        activeMarks: marks.filter(type => instance.isActive(type)),
        canUndo: instance.can().undo(),
        canRedo: instance.can().redo(),
        canMoveUp: block !== null && block.index > 0,
        canMoveDown: block !== null && block.index < instance.state.doc.childCount - 1,
        hasSheets: worksheetBlocks(instance.state.doc).length > 0,
      };
    },
  });
  const chooseFormat = (name: typeof formats[number]) => {
    const command = editor.chain().focus();
    switch (name) {
      case 'paragraph': command.setParagraph().run(); break;
      case 'heading': command.toggleHeading({ level: 2 }).run(); break;
      case 'bulletList': command.toggleBulletList().run(); break;
      case 'orderedList': command.toggleOrderedList().run(); break;
      case 'taskList': command.toggleTaskList().run(); break;
      case 'blockquote': command.toggleBlockquote().run(); break;
      case 'codeBlock': command.toggleCodeBlock().run(); break;
    }
  };
  const importExcel = async (file: File) => {
    setImporting(true);
    setError('');
    try {
      const sheets = await readWorkbook(await file.arrayBuffer());
      if (editor.isDestroyed) return;
      const names = new Set(worksheetBlocks(editor.state.doc).map(block => block.name.toLowerCase()));
      if (sheets.some(({ name }) => names.has(name.toLowerCase()))) {
        setError(t('workbookNameConflict'));
        return;
      }
      if (!editor.isDestroyed && !insertBlocks(editor, sheets.map(({ name, sheet }) => ({ type: 'spreadsheet', attrs: { label: name, sheet } })))) {
        setError(t('workbookInsertFailed'));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setImporting(false); }
  };
  const exportExcel = async () => {
    setError('');
    const sheets = worksheetBlocks(editor.state.doc);
    if (new Set(sheets.map(({ name }) => name.toLowerCase())).size !== sheets.length) {
      setError(t('workbookNameConflict'));
      return;
    }
    try {
      downloadFile('Notebook.xlsx', await writeWorkbook(sheets),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <><Toolbar className="notebook-toolbar" role="group" aria-label={t('format')}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" aria-label={t('format')}>{t(status.format)} <Icon name="chevron-down" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {formats.map(name => <DropdownMenuItem key={name} onSelect={() => chooseFormat(name)}>{t(name)}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    {marks.map(mark => <IconButton key={mark} label={t(mark)} aria-pressed={status.activeMarks.includes(mark)}
      onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().toggleMark(mark).run()}>
      {mark === 'strike' ? <s aria-hidden="true">S</s> : <Icon name={markIcons[mark]} />}
    </IconButton>)}
    <span className="notebook-toolbar-divider" />
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost"><Icon name="plus" /> {t('insert')}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {widgets.map(widget => <DropdownMenuItem key={widget.name} onSelect={() => insertBlocks(editor, [{
          type: widget.name, attrs: widget.name === 'spreadsheet' ? { label: nextWorksheetName(editor.state.doc) } : undefined,
        }])}><Icon name={widget.icon} />{t(widget.name)}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    <FilePicker compact label={t('importExcel')} emptyLabel="" accept=".xlsx" variant="ghost" busy={importing} onFile={file => void importExcel(file)} />
    {status.hasSheets && <Button variant="ghost" onClick={() => void exportExcel()}>{t('exportWorkbook')}</Button>}
    <span className="notebook-toolbar-divider" />
    <IconButton label={t('up')} disabled={!status.canMoveUp} onClick={() => moveBlock(editor, -1)}><Icon name="up" /></IconButton>
    <IconButton label={t('down')} disabled={!status.canMoveDown} onClick={() => moveBlock(editor, 1)}><Icon name="down" /></IconButton>
    <IconButton label={t('undo')} disabled={!status.canUndo} onClick={() => editor.chain().focus().undo().run()}><Icon name="undo" /></IconButton>
    <IconButton label={t('redo')} disabled={!status.canRedo} onClick={() => editor.chain().focus().redo().run()}><Icon name="redo" /></IconButton>
  </Toolbar>{error && <Feedback kind="error">{error}</Feedback>}</>;
}

export function NotebookEditor({ content, readonly = false, onChange }: {
  content: NotebookDocument['content']; readonly?: boolean; onChange?: (content: NotebookDocument['content']) => void;
}) {
  const { t } = useAppI18n(messages);
  const editor = useEditor({
    extensions,
    content,
    editable: !readonly,
    editorProps: {
      attributes: { 'aria-label': t('body'), 'aria-multiline': 'true', role: 'textbox', class: 'notebook-prose' },
      handleDOMEvents: {
        focus(view, event) {
          if (event.target === view.dom && editor) rememberWidgetFocus(editor);
          return false;
        },
      },
    },
    onUpdate: ({ editor: instance }) => onChange?.(instance.getJSON() as NotebookDocument['content']),
  });
  if (!editor) return null;
  return <>
    {!readonly && <EditorToolbar editor={editor} />}
    <EditorContent className="notebook-editor" editor={editor} />
  </>;
}
