import { useEffect, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog } from '@pero/app-sdk/ui';
import { messages } from './messages';

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
  const { t } = useAppI18n(messages);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      const command = notebookCommand(event, entryId, readonly), handler = command && handlers[command];
      if (handler && handler() !== false) event.preventDefault();
    };
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, [entryId, readonly, handlers]);
  return <><Button variant="ghost" onClick={() => setOpen(true)}>{t('keyboardShortcuts')}</Button>{open && <Dialog title={t('notebookShortcuts')} closeLabel={t('closeShortcuts')} onClose={() => setOpen(false)} size="md">
    <p>{t('shortcutsHint')}</p>
    <dl>
      {handlers.save && <><dt>⌘ / Ctrl + S</dt><dd>{t('shortcutSave')}</dd></>}
      {handlers.export && <><dt>Tools → Export current JSON</dt><dd>{t('shortcutExport')}</dd></>}
      {handlers.print && <><dt>⌘ / Ctrl + P</dt><dd>{t('shortcutPrint')}</dd></>}
      {handlers.section && <><dt>⌘ / Ctrl + \</dt><dd>{t('shortcutSection')}</dd></>}
      {handlers.symbols && <><dt>⌘ / Ctrl + ;</dt><dd>{t('shortcutSymbols')}</dd></>}
      <dt>⌘ / Ctrl + Z · Shift + Z</dt><dd>{t('shortcutUndo')}</dd>
      <dt>⌘ / Ctrl + Shift + F</dt><dd>{t('shortcutSearch')}</dd>
      <dt>Escape</dt><dd>{t('shortcutEscape')}</dd>
      <dt>Section actions → Copy section link</dt><dd>{t('shortcutSectionLink')}</dd>
    </dl>
  </Dialog>}</>;
}
