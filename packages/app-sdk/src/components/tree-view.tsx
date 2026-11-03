// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React from 'react';
import { Tree, TreeItem, TreeItemContent, I18nProvider, Button as AriaButton } from 'react-aria-components';
import { Icon } from './icon';
import { Button } from './button';
import { ensureUiStyles } from './ui-styles';

export type TreeViewNode = { id: string; text: string; children?: TreeViewNode[] };

export type TreeViewProps<T extends TreeViewNode> = {
  nodes: readonly T[];
  label: string;
  expandedKeys?: Iterable<string>;
  selectedKey?: string;
  /** React Aria Tree multiple selection: several rows stay selected together. */
  selectionMode?: 'single' | 'multiple';
  selectedKeys?: Iterable<string>;
  onExpandedChange?: (keys: Set<string>) => void;
  onSelect?: (id: string) => void;
  onSelectionChange?: (keys: Set<string>) => void;
  /** Activate a row (for example Enter) separately from moving selection. */
  onAction?: (id: string) => void;
  renderItem?: (node: T, state: { hasChildItems: boolean; isExpanded: boolean; level: number }) => React.ReactNode;
  locale?: string;
  className?: string;
};

/** Hierarchical selection backed by React Aria Tree. The caller owns expansion and what a row shows. */
export function TreeView<T extends TreeViewNode>({ nodes, label, expandedKeys, selectedKey, selectionMode = 'single', selectedKeys, onExpandedChange, onSelect, onSelectionChange, onAction, renderItem, locale, className }: TreeViewProps<T>) {
  const render = (items: readonly T[]): React.ReactNode => items.map(node => <TreeItem key={node.id} id={node.id} textValue={node.text} onAction={onAction ? () => onAction(node.id) : undefined} className="pero-ui-file-tree-item">
    <TreeItemContent>{state => <div className="pero-ui-file-tree-row" style={{ paddingInlineStart: `${(state.level - 1) * 12}px` }}>
      {state.hasChildItems ? <Button asChild variant="ghost" className="pero-ui-file-tree-toggle"><AriaButton slot="chevron" aria-label={node.text}><Icon name={state.isExpanded ? 'chevron-down' : 'chevron-right'} size={14} /></AriaButton></Button> : <span className="pero-ui-file-tree-spacer" />}
      {renderItem ? renderItem(node, state) : <span className="pero-ui-file-tree-name">{node.text}</span>}
    </div>}</TreeItemContent>
    {node.children?.length ? render(node.children as T[]) : null}
  </TreeItem>);
  return <I18nProvider locale={locale}><Tree aria-label={label} className={['pero-ui-file-tree', className].filter(Boolean).join(' ')}
    ref={node => { if (node) ensureUiStyles(node.ownerDocument); }} selectionMode={selectionMode} selectionBehavior="replace"
    expandedKeys={expandedKeys} selectedKeys={selectionMode === 'multiple' ? selectedKeys : (selectedKey ? [selectedKey] : [])}
    onExpandedChange={keys => onExpandedChange?.(new Set([...keys].map(String)))}
    onSelectionChange={keys => {
      if (keys === 'all') return;
      const next = new Set([...keys].map(String));
      if (selectionMode === 'multiple') onSelectionChange?.(next);
      else {
        const id = [...next][0];
        if (id) onSelect?.(id);
      }
    }}>
    {render(nodes)}
  </Tree></I18nProvider>;
}
