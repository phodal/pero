import { useRef, useState, type ReactNode } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useAppI18n } from '@pero/app-sdk';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Feedback, Icon, IconButton } from '@pero/app-sdk/ui';
import { moveBlock, rememberWidgetFocus, notebookBlockAt } from './block-order';
import { messages } from './messages';

type Kind = 'namedReference' | 'spreadsheet' | 'evidence' | 'experiment' | 'finding' | 'attachment' | 'inputTable' | 'registrationTable' | 'lookupTable' | 'savedSearch' | 'mixturePrep' | 'appCanvas' | 'sampleIntake' | 'reactionScheme' | 'chemical' | 'sourceExcerpt';
const icons = { namedReference: 'document', spreadsheet: 'table', evidence: 'document', experiment: 'flask', finding: 'search', attachment: 'file', inputTable: 'table', registrationTable: 'table', lookupTable: 'search', savedSearch: 'search', mixturePrep: 'flask', appCanvas: 'document', sampleIntake: 'flask', reactionScheme: 'flask', chemical: 'flask', sourceExcerpt: 'document' } as const;

export function BlockFrame({ view, kind, title, caption, actions, menuActions, children }: {
  view: NodeViewProps; kind: Kind; title?: ReactNode; caption?: ReactNode; actions?: ReactNode; menuActions?: ReactNode; children: ReactNode;
}) {
  const { t } = useAppI18n(messages);
  const element = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false), [displayError, setDisplayError] = useState('');
  const fullscreen = async () => {
    setDisplayError('');
    try {
      if (document.fullscreenElement === element.current) await document.exitFullscreen();
      else { setCollapsed(false); await element.current?.requestFullscreen(); }
    } catch (cause) { setDisplayError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const move = (direction: -1 | 1) => {
    const position = view.getPos();
    if (typeof position === 'number') moveBlock(view.editor, direction, position);
  };
  const topLevel = () => {
    const position = view.getPos();
    return typeof position === 'number' ? notebookBlockAt(view.editor, position) : null;
  };
  const block = topLevel();
  // A native input retains its own focus and selection inside a widget.
  const anchorBlock = () => rememberWidgetFocus(view.editor, view.node.attrs.blockId);
  return <NodeViewWrapper ref={element} role="group" aria-label={t(kind)} contentEditable={false} className="notebook-block" data-kind={kind} onFocusCapture={anchorBlock}
    data-selected={view.selected || undefined} data-collapsed={collapsed || undefined} data-notebook-block-id={view.node.attrs.blockId ?? undefined}>
    <div className="notebook-block-header">
      <div className="notebook-block-title">{kind !== 'spreadsheet' && <Icon name={icons[kind]} />}{title ?? <strong>{t(kind)}</strong>}{caption}</div>
      <div className="notebook-block-actions">
        {actions}
        {kind === 'spreadsheet' && <>
          <IconButton label={t('fullscreenBlock')} onClick={() => void fullscreen()}><Icon name="maximize" /></IconButton>
          <IconButton label={t(collapsed ? 'expandBlock' : 'collapseBlock')} onClick={() => setCollapsed(value => !value)}><Icon name={collapsed ? 'chevron-down' : 'chevron-up'} /></IconButton>
        </>}
        {<DropdownMenu>
          <DropdownMenuTrigger asChild><IconButton label={t('blockActions')}><Icon name="more" /></IconButton></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setCollapsed(value => !value)}>{t(collapsed ? 'expandBlock' : 'collapseBlock')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void fullscreen()}>{t('fullscreenBlock')}</DropdownMenuItem>
            {menuActions}
            {view.editor.isEditable && <>
            <DropdownMenuItem disabled={!block || block.index === 0} onSelect={() => move(-1)}>{t('up')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!block || block.index === block.parent.childCount - 1} onSelect={() => move(1)}>{t('down')}</DropdownMenuItem>
            <DropdownMenuItem danger onSelect={view.deleteNode}>{t('remove')}</DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
    </div>
    {displayError && <Feedback kind="error">{displayError}</Feedback>}
    <div className="notebook-block-content" hidden={collapsed}>{children}</div>
  </NodeViewWrapper>;
}
