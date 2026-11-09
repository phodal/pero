import { useEffect, useState } from 'react';
import { Button, Dialog } from '@pero/app-sdk/ui';

export type NotebookCommand = 'save' | 'export' | 'print' | 'section' | 'symbols' | 'search';
export interface NotebookCommandHandlers { save?(): boolean | void; export?(): boolean | void; print?(): boolean | void; section?(): boolean | void; symbols?(): boolean | void; search?(): boolean | void }
export const NOTEBOOK_SYMBOLS_EVENT = 'pero:notebook-symbols-open';
/** App-local bindings never steal IME, modal, widget editing or Host shortcuts. */
export function notebookCommand(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'repeat' | 'defaultPrevented' | 'target'>, entryId: string, readonly: boolean): NotebookCommand | null {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || !(event.ctrlKey || event.metaKey) || !(event.target instanceof Element)) return null;
  const target = event.target;
  if (target.closest('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') || target.closest('[data-notebook-entry-id]')?.getAttribute('data-notebook-entry-id') !== entryId) return null;
  const key = event.key.toLowerCase();
  if (key === 's' && !event.shiftKey) return readonly ? null : 'save';
  if (key === 'p' && !event.shiftKey) return 'print';
  // Search already has a workspace owner. It is advertised here, not intercepted twice.
  if (readonly || event.shiftKey || !target.closest('.notebook-editor') || target.closest('input, textarea, select, [contenteditable="false"]')) return null;
  return key === '\\' ? 'section' : key === ';' ? 'symbols' : null;
}
export function NotebookCommandTools({ entryId, readonly = false, handlers }: { entryId: string; readonly?: boolean; handlers: NotebookCommandHandlers }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      const command = notebookCommand(event, entryId, readonly), handler = command && handlers[command];
      if (handler && handler() !== false) event.preventDefault();
    };
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, [entryId, readonly, handlers]);
  return <><Button variant="ghost" onClick={() => setOpen(true)}>Keyboard shortcuts / 快捷键</Button>{open && <Dialog title="Notebook shortcuts / 笔记快捷键" closeLabel="Close shortcuts / 关闭快捷键" onClose={() => setOpen(false)} size="md">
    <p>Use Command on macOS, Control elsewhere. Commands apply only to the focused notebook; text and grid editing keep their own shortcuts. / macOS 使用 Command，其他系统使用 Control；仅作用于当前笔记。</p>
    <dl>
      {handlers.save && <><dt>⌘ / Ctrl + S</dt><dd>Save a new revision / 保存新版本</dd></>}
      {handlers.export && <><dt>Tools → Export current JSON</dt><dd>Export includes unsaved edits. Ctrl/Command + Shift + S remains the text strike shortcut. / 导出包含未保存编辑；Ctrl/Command + Shift + S 保留删除线格式快捷键。</dd></>}
      {handlers.print && <><dt>⌘ / Ctrl + P</dt><dd>Print configuration and preview / 打印设置与预览</dd></>}
      {handlers.section && <><dt>⌘ / Ctrl + \</dt><dd>Insert a section at the active text editor / 在当前文本编辑器插入章节</dd></>}
      {handlers.symbols && <><dt>⌘ / Ctrl + ;</dt><dd>Insert a symbol at the text selection / 在所选文本处插入符号</dd></>}
      <dt>⌘ / Ctrl + Z · Shift + Z</dt><dd>Document undo / redo; local form fields retain native history / 文档撤销与重做，表单保留原生历史</dd>
      <dt>⌘ / Ctrl + Shift + F</dt><dd>Search this notebook / 搜索当前笔记</dd>
      <dt>Escape</dt><dd>Close the active menu/dialog or cancel a grid edit / 关闭当前菜单、窗口或取消表格编辑</dd>
      <dt>Section actions → Copy section link</dt><dd>Stable entry and section link; opening it reveals the section / 稳定条目与章节链接，打开后展开目标</dd>
    </dl>
  </Dialog>}</>;
}
