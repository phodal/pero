import { activeNotebookBlock, moveBlock } from './block-order';
import { NOTEBOOK_SYMBOLS_EVENT } from './notebook-commands';
import { messages as notebookMessages } from './messages';
import { messages as textToolMessages, NOTEBOOK_LINK_EVENT, notebookBlockStyles, notebookColorOptions } from './text-tools';
import type { Editor } from '@tiptap/core';
import { AllSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { useAppI18n } from '@pero/app-sdk';
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@pero/app-sdk/ui';
import type { ReactNode } from 'react';

const marks = ['bold', 'italic', 'underline', 'strike'] as const;
const headingLevels = [1, 2, 3, 4, 5, 6] as const;

function applyFormat(editor: Editor, format: string) {
  const command = editor.chain().focus();
  if (format.startsWith('heading-')) {
    command.clearNodes().setHeading({ level: Number(format.slice(8)) as typeof headingLevels[number] }).run();
    return;
  }
  switch (format) {
    case 'paragraph': command.clearNodes().setParagraph().run(); break;
    case 'bulletList': command.toggleBulletList().run(); break;
    case 'orderedList': command.toggleOrderedList().run(); break;
    case 'taskList': command.toggleTaskList().run(); break;
    case 'blockquote': command.toggleBlockquote().run(); break;
    case 'codeBlock': command.toggleCodeBlock().run(); break;
    default: break;
  }
}

function keepsNativeMenu(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, button, a, [role="listbox"], [role="menu"]');
}

/** Right-click and Shift+F10 on the notes page. Fields keep the browser menu. */
export function NotebookSurface({ editor, readonly, children }: { editor: Editor; readonly: boolean; children: ReactNode }) {
  if (readonly) return <div className="notebook-paper">{children}</div>;
  return <div className="notebook-paper">
    <ContextMenu>
      <ContextMenuTrigger asChild unstyled onContextMenuCapture={event => {
        if (keepsNativeMenu(event.target)) event.stopPropagation();
      }} onKeyDown={event => {
        if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
        if (keepsNativeMenu(event.target)) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 24, clientY: box.top + 24 }));
      }}>
        <div className="notebook-editor-surface">{children}</div>
      </ContextMenuTrigger>
      <NotebookEditingMenu editor={editor} />
    </ContextMenu>
  </div>;
}

function NotebookEditingMenu({ editor }: { editor: Editor }) {
  const { t } = useAppI18n(textToolMessages);
  const { t: notebook } = useAppI18n(notebookMessages);
  const status = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const { $from, $to } = instance.state.selection;
      let format = $from.parent.type.name === 'heading' ? `heading-${$from.parent.attrs.level}` : $from.parent.type.name;
      for (let depth = $from.depth; depth > 0; depth--) {
        const name = $from.node(depth).type.name;
        if (format === 'paragraph' && notebookBlockStyles.includes(name as typeof notebookBlockStyles[number])) format = name;
      }
      const block = activeNotebookBlock(instance);
      const inline = $from.parent.inlineContent && $to.parent.inlineContent;
      return {
        text: inline || instance.state.selection instanceof AllSelection,
        format,
        marks: marks.filter(mark => instance.isActive(mark)),
        tone: instance.getAttributes('textColor').tone ?? 'default',
        background: instance.getAttributes('textBackground').tone ?? 'default',
        link: instance.isActive('link'),
        canLink: inline && instance.can().setLink({ href: 'https://example.org' }),
        canMoveUp: block !== null && block.index > 0,
        canMoveDown: block !== null && block.index < block.parent.childCount - 1,
        backgroundMark: !!instance.schema.marks.textBackground,
      };
    },
  });
  const toggle = (mark: typeof marks[number]) => { editor.chain().focus().toggleMark(mark).run(); };
  return <ContextMenuContent aria-label={t('editing')}>
    {marks.map(mark => <ContextMenuCheckboxItem key={mark} checked={status.marks.includes(mark)} disabled={!status.text}
      onCheckedChange={() => toggle(mark)}>{t(mark)}</ContextMenuCheckboxItem>)}
    <ContextMenuSeparator />
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={!status.text}>{t('style')}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup value={status.format} onValueChange={format => applyFormat(editor, format)}>
          <ContextMenuRadioItem value="paragraph">{t('paragraph')}</ContextMenuRadioItem>
          {headingLevels.map(level => <ContextMenuRadioItem key={level} value={`heading-${level}`}>{t('heading', { level })}</ContextMenuRadioItem>)}
          {notebookBlockStyles.map(block => <ContextMenuRadioItem key={block} value={block}>{t(block)}</ContextMenuRadioItem>)}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={!status.text}>{t('textColor')}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup value={status.tone} onValueChange={tone => {
          const command = editor.chain().focus();
          if (tone === 'default') command.unsetMark('textColor').run();
          else command.setMark('textColor', { tone }).run();
        }}>
          {notebookColorOptions.map(tone => <ContextMenuRadioItem key={tone} value={tone}>{t(tone)}</ContextMenuRadioItem>)}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
    {status.backgroundMark && <ContextMenuSub>
      <ContextMenuSubTrigger disabled={!status.text}>{t('textBackground')}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup value={status.background} onValueChange={tone => {
          const command = editor.chain().focus();
          if (tone === 'default') command.unsetMark('textBackground').run();
          else command.setMark('textBackground', { tone }).run();
        }}>
          {notebookColorOptions.map(tone => <ContextMenuRadioItem key={tone} value={tone}>{t(tone)}</ContextMenuRadioItem>)}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>}
    <ContextMenuSeparator />
    <ContextMenuItem disabled={!status.canLink} onSelect={() => editor.view.dom.dispatchEvent(new CustomEvent(NOTEBOOK_LINK_EVENT))}>{t(status.link ? 'editLink' : 'insertLink')}</ContextMenuItem>
    <ContextMenuItem disabled={!status.text} onSelect={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>{t('clear')}</ContextMenuItem>
    <ContextMenuItem disabled={!status.text} onSelect={() => editor.view.dom.dispatchEvent(new CustomEvent(NOTEBOOK_SYMBOLS_EVENT))}>{t('symbols')}</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem disabled={!status.canMoveUp} onSelect={() => moveBlock(editor, -1)}>{notebook('up')}</ContextMenuItem>
    <ContextMenuItem disabled={!status.canMoveDown} onSelect={() => moveBlock(editor, 1)}>{notebook('down')}</ContextMenuItem>
  </ContextMenuContent>;
}
