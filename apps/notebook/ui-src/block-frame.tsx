import type { ReactNode } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useAppI18n } from '@pero/app-sdk';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon, IconButton } from '@pero/app-sdk/ui';
import { moveBlock, rememberWidgetFocus, topLevelBlock } from './block-order';
import { messages } from './messages';

type Kind = 'spreadsheet' | 'evidence' | 'experiment' | 'finding';
const icons = { spreadsheet: 'table', evidence: 'document', experiment: 'flask', finding: 'search' } as const;

export function BlockFrame({ view, kind, caption, actions, children }: {
  view: NodeViewProps; kind: Kind; caption?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  const { t } = useAppI18n(messages);
  const move = (direction: -1 | 1) => {
    const position = view.getPos();
    if (typeof position === 'number') moveBlock(view.editor, direction, position);
  };
  const topLevel = () => {
    const position = view.getPos();
    return typeof position === 'number' ? topLevelBlock(view.editor, position) : null;
  };
  const block = topLevel();
  // A native input retains its own focus and selection inside a widget.
  const anchorBlock = () => rememberWidgetFocus(view.editor, view.node.attrs.blockId);
  return <NodeViewWrapper contentEditable={false} className="notebook-block" data-kind={kind} onFocusCapture={anchorBlock}
    data-selected={view.selected || undefined} data-notebook-block-id={view.node.attrs.blockId ?? undefined}>
    <div className="notebook-block-header">
      <div className="notebook-block-title"><Icon name={icons[kind]} /><strong>{t(kind)}</strong>{caption}</div>
      <div className="notebook-block-actions">
        {actions}
        {view.editor.isEditable && <DropdownMenu>
          <DropdownMenuTrigger asChild><IconButton label={t('blockActions')}><Icon name="more" /></IconButton></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!block || block.index === 0} onSelect={() => move(-1)}>{t('up')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!block || block.index === view.editor.state.doc.childCount - 1} onSelect={() => move(1)}>{t('down')}</DropdownMenuItem>
            <DropdownMenuItem danger onSelect={view.deleteNode}>{t('remove')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
    </div>
    <div className="notebook-block-content">{children}</div>
  </NodeViewWrapper>;
}
