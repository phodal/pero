import { DatedSectionTools, NamedReferenceTools } from './notebook-reference-controls';
import { NotebookFileIntake } from './file-intake';
import { NotebookCommandTools, NOTEBOOK_SYMBOLS_EVENT } from './notebook-commands';
import { NOTEBOOK_PRINT_OPEN_EVENT } from './notebook-print';
import { NotebookContextProvider } from './notebook-context';
import { NotebookSourceExcerptTools } from './source-excerpt';
import { notebookHistoryGroup } from './editor-history';
import { NotebookEditorDiagnostics } from './editor-inspector';
import { NotebookScientificContentTools } from './scientific-content';
import { notebookExtensions, widgets } from './editor-extensions';
import { type Editor, type JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, FilePicker, Icon, IconButton } from '@pero/app-sdk/ui';
import type { NotebookDocument } from '@pero/notebook';
import { readWorkbook } from '@pero/notebook/workbook';
import { NotebookReferenceMentionPicker } from './reference-mention';
import { activeNotebookBlock, rememberWidgetFocus } from './block-order';
import { nextWorksheetName, worksheetBlocks } from './worksheet-model';
import { messages } from './messages';
import { contentBlockMessages, createAttachment } from './content-blocks';
import { NotebookSurface } from './editor-context-menu';
import { NotebookTextTools } from './text-tools';
import { NotebookWorkspace, type NotebookChrome } from './workspace-views';
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

function InsertMenu({ name, children }: { name: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const node = ref.current;
      const target = event.target;
      if (!node?.open || !(target instanceof Node) || node.contains(target) || node.parentElement?.contains(target)) return;
      if (target instanceof Element && target.closest('dialog')) return;
      node.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return <div className="notebook-insert">
    <Button variant="ghost" className="notebook-insert-trigger" onClick={() => {
      const node = ref.current;
      if (!node) return;
      node.open = !node.open;
      if (!node.open) return;
      node.ownerDocument.querySelectorAll('details.notebook-menu[open]').forEach(other => { if (other !== node) other.removeAttribute('open'); });
    }}>{name}<Icon name="chevron-down" size={12} /></Button>
    <details ref={ref} className="notebook-menu" data-menu="insert">
      <summary className="notebook-visually-hidden">{name}</summary>
      <div className="notebook-menu-panel">{children}</div>
    </details>
  </div>;
}

function EditorToolbar({ editor, historyControls, insertTools, entryId }: {
  historyControls?: DocumentHistoryControls; editor: Editor; insertTools?: ReactNode; entryId: string;
}) {
  const { t } = useAppI18n(messages);
  const status = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      canUndo: historyControls?.canUndo ?? instance.can().undo(),
      canRedo: historyControls?.canRedo ?? instance.can().redo(),
    }),
  });
  return <div className="notebook-commandbar">
    <div className="notebook-command-fixed">
      <Button variant="ghost" className="notebook-print-trigger" aria-label={t('printAction')} onClick={() => window.dispatchEvent(new CustomEvent(NOTEBOOK_PRINT_OPEN_EVENT, { detail: { entryId } }))}><Icon name="print" size={12} /><Icon name="chevron-down" size={12} /></Button>
      <span className="notebook-history">
        <IconButton label={t('undo')} disabled={!(historyControls?.canUndo ?? status.canUndo)} onClick={() => historyControls ? historyControls.undo() : editor.chain().focus().undo().run()}><Icon name="undo" /></IconButton>
        <IconButton label={t('redo')} disabled={!(historyControls?.canRedo ?? status.canRedo)} onClick={() => historyControls ? historyControls.redo() : editor.chain().focus().redo().run()}><Icon name="redo" /></IconButton>
      </span>
      {insertTools}
    </div>
    <span className="notebook-text-tools"><NotebookTextTools editor={editor} entryTools /></span>
  </div>;
}

function NotebookInsertTools({ editor, document, onCreateEntry, entryId, revision }: {
  editor: Editor; document: NotebookDocument; entryId: string; revision: number;
  onCreateEntry?: (document: NotebookDocument) => Promise<void>;
}) {
  const { t } = useAppI18n(messages);
  const { t: contentT } = useAppI18n(contentBlockMessages);
  const [importing, setImporting] = useState(false), [error, setError] = useState('');
  const importExcel = async (file: File) => {
    setImporting(true); setError('');
    try {
      const sheets = await readWorkbook(await file.arrayBuffer());
      if (editor.isDestroyed) return;
      const names = new Set(worksheetBlocks(editor.state.doc).map(block => block.name.toLowerCase()));
      if (sheets.some(({ name }) => names.has(name.toLowerCase()))) { setError(t('workbookNameConflict')); return; }
      if (!insertBlocks(editor, sheets.map(({ name, sheet }) => ({ type: 'spreadsheet', attrs: { label: name, sheet } })))) setError(t('workbookInsertFailed'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setImporting(false); }
  };
  const closeMenu = (node: HTMLElement) => node.closest('details')?.removeAttribute('open');
  const widgetButton = (name: string) => {
    const widget = widgets.find(item => item.name === name);
    if (!widget) return null;
    return <Button variant="ghost" role="menuitem" key={widget.name} onClick={event => {
      insertBlocks(editor, [{
        type: widget.name, attrs: widget.name === 'spreadsheet' ? {
          label: nextWorksheetName(editor.state.doc),
          columnWidths: Object.fromEntries(Array.from({ length: widget.defaults.sheet.columns }, (_, column) => [column, 160])),
          rowHeights: Object.fromEntries(Array.from({ length: widget.defaults.sheet.rows }, (_, row) => [row, 38])),
        } : ['inputTable', 'registrationTable'].includes(widget.name) ? { table: createStructuredTable(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()), receipts: [] } : undefined,
      }]);
      closeMenu(event.currentTarget);
    }}><Icon name={widget.icon} />{t(widget.name)}</Button>;
  };
  return <>
    <Button variant="ghost" role="menuitem" onClick={event => {
      insertBlocks(editor, [{ type: 'section', attrs: { label: '', date: '' }, content: [{ type: 'paragraph' }] }]);
      closeMenu(event.currentTarget);
    }}>{t('section')}</Button>
    {widgetButton('spreadsheet')}
    <details className="notebook-submenu">
      <summary>{t('wellPlate')}</summary>
      {[[2, 3], [4, 6], [6, 8], [8, 12], [16, 24], [32, 48]].map(([rows, columns]) => <Button variant="ghost" role="menuitem" key={rows} onClick={event => {
        insertBlocks(editor, [{ type: 'spreadsheet', attrs: { label: nextWorksheetName(editor.state.doc), sheet: { rows, columns, cells: {} } } }]);
        const menu = event.currentTarget.closest('details.notebook-menu');
        event.currentTarget.closest('details.notebook-submenu')?.removeAttribute('open');
        menu?.removeAttribute('open');
      }}>{t('plateGeometry', { wells: rows * columns, rows, columns })}</Button>)}
    </details>
    <FilePicker compact label={t('attachment')} emptyLabel="" variant="ghost" busy={importing} onFile={file => {
      setImporting(true); setError('');
      void createAttachment(file, contentT).then(attrs => { if (!editor.isDestroyed) insertBlocks(editor, [{ type: 'attachment', attrs }]); })
        .catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setImporting(false));
    }} />
    {widgetButton('chemical')}
    {widgetButton('reactionScheme')}
    <div className="notebook-menu-rule" role="separator" />
    {widgetButton('evidence')}
    {widgetButton('experiment')}
    {widgetButton('finding')}
    <details className="notebook-submenu">
      <summary>{t('moreBlocks')}</summary>
      {['sourceExcerpt', 'sampleIntake', 'appCanvas', 'mixturePrep', 'inputTable', 'registrationTable', 'lookupTable'].map(name => widgetButton(name))}
      <p className="notebook-menu-label">{t('insertDocument')}</p>
      <DatedSectionTools onInsert={nodes => { insertBlocks(editor, nodes); }} />
      <NamedReferenceTools onInsert={nodes => { insertBlocks(editor, nodes); }} />
      {editor.schema.nodes.referenceMention && <NotebookReferenceMentionPicker editor={editor} />}
      <NotebookSourceExcerptTools editor={editor} onInsert={nodes => { insertBlocks(editor, nodes); }} />
      <p className="notebook-menu-label">{t('insertScience')}</p>
      <NotebookScientificContentTools onInsert={nodes => insertBlocks(editor, nodes)} />
      <NotebookScienceTools editor={editor} getTarget={() => ({ entryId, revision })} onInsert={nodes => { insertBlocks(editor, nodes); }} />
      <p className="notebook-menu-label">{t('insertLibrary')}</p>
      <NotebookFileIntake editor={editor} onInsert={nodes => { insertBlocks(editor, nodes); }} />
      <NotebookTemplateTools editor={editor} document={document} onCreateEntry={onCreateEntry} />
      <NotebookSavedSearchTools editor={editor} />
      <FilePicker compact label={t('importExcel')} emptyLabel="" accept=".xlsx" variant="ghost" busy={importing} onFile={file => void importExcel(file)} />
    </details>
    {error && <Feedback kind="error">{error}</Feedback>}
  </>;
}

export function NotebookEditor({ content, document: entryDocument, onDocumentChange, onCreateEntry, entryId, revision, readonly = false, onChange, historyControls, onSave, onReplaceDocument, chrome }: {
  content: NotebookDocument['content']; document: NotebookDocument; onDocumentChange?: (change: Partial<NotebookDocument>) => void;
  onCreateEntry?: (document: NotebookDocument) => Promise<void>; entryId: string; revision: number;
  historyControls?: DocumentHistoryControls;
  onReplaceDocument?(document: NotebookDocument): void;
  onSave?(): void; chrome?: NotebookChrome; readonly?: boolean; onChange?: (content: NotebookDocument['content'], historyGroup: string | null) => void;
}) {
  const { t } = useAppI18n(messages);
  const documentRef = useRef(entryDocument); documentRef.current = entryDocument;
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
    const selection = editor.state.selection;
    editor.commands.setContent(content, { emitUpdate: false });
    const doc = editor.state.doc;
    const anchor = Math.min(selection.anchor, doc.content.size), head = Math.min(selection.head, doc.content.size);
    const node = doc.nodeAt(anchor);
    const restored = selection instanceof NodeSelection && node && NodeSelection.isSelectable(node)
      ? NodeSelection.create(doc, anchor)
      : TextSelection.between(doc.resolve(anchor), doc.resolve(head));
    editor.view.dispatch(editor.state.tr.setSelection(restored));
  }, [editor, content]);
  if (!editor) return null;
  return <NotebookContextProvider value={{ entryId, revision, readonly, document: entryDocument,
    getDocument: () => ({ ...documentRef.current, content: editor.getJSON() as NotebookDocument['content'] }) }}>
    <NotebookWorkspace editor={editor} entryId={entryId} revision={revision} document={entryDocument} readonly={readonly} onChange={change => onDocumentChange?.(change)}
      onReplaceDocument={readonly ? undefined : onReplaceDocument} chrome={chrome} historyControls={historyControls}
        tools={!readonly && <EditorToolbar historyControls={historyControls} editor={editor} entryId={entryId}
        insertTools={<InsertMenu name={t('insertWord')}>
          <NotebookInsertTools editor={editor} document={entryDocument} entryId={entryId} revision={revision} onCreateEntry={onCreateEntry} />
        </InsertMenu>} />}
      helpTools={<>
        <NotebookCommandTools entryId={entryId} readonly={readonly} handlers={{ save: onSave,
          export: () => downloadFile('Notebook.json', JSON.stringify({ ...documentRef.current, content: editor.getJSON() }, null, 2), 'application/json'),
          print: () => { window.dispatchEvent(new CustomEvent(NOTEBOOK_PRINT_OPEN_EVENT, { detail: { entryId } })); },
          ...(!readonly ? { section: () => insertBlocks(editor, [{ type: 'section', content: [{ type: 'paragraph' }] }]),
            symbols: () => { editor.view.dom.dispatchEvent(new CustomEvent(NOTEBOOK_SYMBOLS_EVENT)); } } : {}),
        }} />
        {!readonly && <NotebookEditorDiagnostics editor={editor} />}
      </>}>
      <NotebookSurface editor={editor} readonly={readonly}><EditorContent className="notebook-editor" editor={editor} /></NotebookSurface>
    </NotebookWorkspace></NotebookContextProvider>;
}
