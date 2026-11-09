import { notebookHistoryGroup } from './editor-history';
import { notebookExtensions, widgets } from './editor-extensions';
import { type Editor, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { useEffect, useState, type ReactNode } from 'react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, Feedback, FilePicker, Icon, IconButton, Toolbar } from '@pero/app-sdk/ui';
import type { NotebookDocument } from '@pero/notebook';
import { readWorkbook, writeWorkbook } from '@pero/notebook/workbook';
import { activeNotebookBlock, moveBlock, rememberWidgetFocus } from './block-order';
import { nextWorksheetName, worksheetBlocks } from './worksheet-model';
import { messages } from './messages';
import { contentBlockMessages, createAttachment } from './content-blocks';
import { NotebookTextTools } from './text-tools';
import { NotebookWorkspace } from './workspace-views';
import { NotebookScienceTools } from './science-tools';
import { createStructuredTable } from '@pero/notebook/structured-table';
import { NotebookTemplateTools } from './template-tools';
import { NotebookSavedSearchTools } from './saved-search';

function insertBlocks(editor: Editor, insert: JSONContent[]) {
  const block = activeNotebookBlock(editor);
  const end = block ? block.start + block.node.nodeSize - (block.node.type.name === 'section' ? 1 : 0) : editor.state.doc.content.size;
  const parentEnd = block?.node.type.name === 'section' ? end : block ? block.parentStart + block.parent.content.size : editor.state.doc.content.size;
  const blocks = end === parentEnd ? [...insert, { type: 'paragraph' }] : insert;
  // Tiptap's deferred focus can take focus back from a newly inserted widget input.
  return editor.commands.insertContentAt(end, blocks);
}

export type DocumentHistoryControls = { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };

function EditorToolbar({ editor, document, onCreateEntry, entryId, revision, historyControls }: { historyControls?: DocumentHistoryControls; editor: Editor; document: NotebookDocument; entryId: string; revision: number; onCreateEntry?: (document: NotebookDocument) => Promise<void> }) {
  const { t } = useAppI18n(messages);
  const { t: contentT } = useAppI18n(contentBlockMessages);
  const [importing, setImporting] = useState(false), [error, setError] = useState('');
  const status = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const block = activeNotebookBlock(instance);
      return {
        canUndo: historyControls?.canUndo ?? instance.can().undo(),
        canRedo: historyControls?.canRedo ?? instance.can().redo(),
        canMoveUp: block !== null && block.index > 0,
        canMoveDown: block !== null && block.index < block.parent.childCount - 1,
        hasSheets: worksheetBlocks(instance.state.doc).length > 0,
      };
    },
  });
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
    <NotebookTextTools editor={editor} />
    <NotebookScienceTools editor={editor} getTarget={() => ({ entryId, revision })} onInsert={nodes => { insertBlocks(editor, nodes); }} />
    <NotebookTemplateTools editor={editor} document={document} onCreateEntry={onCreateEntry} />
    <NotebookSavedSearchTools editor={editor} />
    <span className="notebook-toolbar-divider" />
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost"><Icon name="plus" /> {t('insert')}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => insertBlocks(editor, [{ type: 'section', attrs: { label: '', date: '' }, content: [{ type: 'paragraph' }] }])}>{t('section')}</DropdownMenuItem>
        <DropdownMenuSub><DropdownMenuSubTrigger>{t('wellPlate')}</DropdownMenuSubTrigger><DropdownMenuSubContent>
          {[[2, 3], [4, 6], [6, 8], [8, 12], [16, 24], [32, 48]].map(([rows, columns]) => <DropdownMenuItem key={rows} onSelect={() => insertBlocks(editor, [{ type: 'spreadsheet', attrs: { label: nextWorksheetName(editor.state.doc), sheet: { rows, columns, cells: {} } } }])}>
            {t('plateGeometry', { wells: rows * columns, rows, columns })}
          </DropdownMenuItem>)}
        </DropdownMenuSubContent></DropdownMenuSub>
        {widgets.filter(widget => widget.name !== 'attachment' && widget.name !== 'savedSearch').map(widget => <DropdownMenuItem key={widget.name} onSelect={() => insertBlocks(editor, [{
          type: widget.name, attrs: widget.name === 'spreadsheet' ? { label: nextWorksheetName(editor.state.doc) } : ['inputTable', 'registrationTable'].includes(widget.name) ? { table: createStructuredTable(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()), receipts: [] } : undefined,
        }])}><Icon name={widget.icon} />{t(widget.name)}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    <FilePicker compact label={t('attachment')} emptyLabel="" variant="ghost" busy={importing} onFile={file => {
      setImporting(true); setError('');
      void createAttachment(file, contentT).then(attrs => { if (!editor.isDestroyed) insertBlocks(editor, [{ type: 'attachment', attrs }]); })
        .catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setImporting(false));
    }} />
    <FilePicker compact label={t('importExcel')} emptyLabel="" accept=".xlsx" variant="ghost" busy={importing} onFile={file => void importExcel(file)} />
    {status.hasSheets && <Button variant="ghost" onClick={() => void exportExcel()}>{t('exportWorkbook')}</Button>}
    <span className="notebook-toolbar-divider" />
    <IconButton label={t('up')} disabled={!status.canMoveUp} onClick={() => moveBlock(editor, -1)}><Icon name="up" /></IconButton>
    <IconButton label={t('down')} disabled={!status.canMoveDown} onClick={() => moveBlock(editor, 1)}><Icon name="down" /></IconButton>
    <IconButton label={t('undo')} disabled={!(historyControls?.canUndo ?? status.canUndo)} onClick={() => historyControls ? historyControls.undo() : editor.chain().focus().undo().run()}><Icon name="undo" /></IconButton>
    <IconButton label={t('redo')} disabled={!(historyControls?.canRedo ?? status.canRedo)} onClick={() => historyControls ? historyControls.redo() : editor.chain().focus().redo().run()}><Icon name="redo" /></IconButton>
  </Toolbar>{error && <Feedback kind="error">{error}</Feedback>}</>;
}

export function NotebookEditor({ content, document: entryDocument, onDocumentChange, onCreateEntry, entryId, revision, readonly = false, onChange, header, historyControls }: {
  content: NotebookDocument['content']; document: NotebookDocument; onDocumentChange?: (change: Partial<NotebookDocument>) => void;
  onCreateEntry?: (document: NotebookDocument) => Promise<void>; entryId: string; revision: number;
  historyControls?: DocumentHistoryControls;
  header?: ReactNode; readonly?: boolean; onChange?: (content: NotebookDocument['content'], historyGroup: string | null) => void;
}) {
  const { t } = useAppI18n(messages);
  const editor = useEditor({
    extensions: historyControls ? notebookExtensions.map(extension => extension.name === 'starterKit' ? extension.configure({ undoRedo: false }) : extension) : notebookExtensions,
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
    onUpdate: ({ editor: instance, transaction }) => onChange?.(instance.getJSON() as NotebookDocument['content'], notebookHistoryGroup(transaction)),
  });
  useEffect(() => {
    if (!editor || JSON.stringify(editor.getJSON()) === JSON.stringify(content)) return;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(content, { emitUpdate: false });
    const end = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
  }, [editor, content]);
  if (!editor) return null;
  return <NotebookWorkspace editor={editor} entryId={entryId} revision={revision} document={entryDocument} readonly={readonly} onChange={change => onDocumentChange?.(change)}>
    {!readonly && <EditorToolbar historyControls={historyControls} editor={editor} entryId={entryId} revision={revision} document={entryDocument} onCreateEntry={onCreateEntry} />}
    <div className="notebook-paper">{header}<EditorContent className="notebook-editor" editor={editor} /></div>
  </NotebookWorkspace>;
}
