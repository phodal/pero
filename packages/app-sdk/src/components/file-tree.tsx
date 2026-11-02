// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { useMemo } from 'react';
import { Tree, TreeItem, TreeItemContent, I18nProvider, Button as AriaButton } from 'react-aria-components';
import { Icon } from './icon';
import { Button } from './button';
import { ensureUiStyles } from './ui-styles';

export type FileTreeProps = {
  paths: readonly string[];
  selectedPath?: string;
  onSelect: (path: string) => void;
  label: string;
  controls?: string;
  locale?: string;
  className?: string;
};
type Entry = { id: string; name: string; path?: string; children: Map<string, Entry> };

/** A controlled path navigator backed by React Aria's keyboard, focus and tree semantics. No IO. */
export function FileTree({ paths, selectedPath, onSelect, label, controls, locale, className }: FileTreeProps) {
  const { roots, folders } = useMemo(() => {
    const roots = new Map<string, Entry>(), folders: string[] = [];
    for (const path of paths) {
      let children = roots, parent = '';
      const parts = path.split('/');
      parts.forEach((name, i) => {
        const full = parent ? `${parent}/${name}` : name;
        const folder = i < parts.length - 1;
        const id = `${folder ? 'folder' : 'file'}:${full}`;
        let entry = children.get(id);
        if (!entry) {
          entry = { id, name, path: folder ? undefined : path, children: new Map() };
          children.set(id, entry);
          if (folder) folders.push(id);
        }
        children = entry.children; parent = full;
      });
    }
    return { roots, folders };
  }, [paths]);
  const render = (entries: Map<string, Entry>): React.ReactNode => [...entries.values()].map(entry => <TreeItem key={entry.id} id={entry.id} textValue={entry.name} aria-label={entry.path ?? entry.name} className="pero-ui-file-tree-item">
    <TreeItemContent>{({ hasChildItems, isExpanded, level }) => <div className="pero-ui-file-tree-row" style={{ paddingInlineStart: `${(level - 1) * 12}px` }} title={entry.path ?? entry.name}>
      {hasChildItems ? <Button asChild variant="ghost" className="pero-ui-file-tree-toggle"><AriaButton slot="chevron" aria-label={entry.name}><Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={14} /></AriaButton></Button> : <span className="pero-ui-file-tree-spacer" />}
      {hasChildItems ? <Icon family="shell" name="project" size={14} /> : <Icon name="file" size={14} />}<span className="pero-ui-file-tree-name">{entry.name}</span>
    </div>}</TreeItemContent>
    {render(entry.children)}
  </TreeItem>);
  return <I18nProvider locale={locale}><Tree aria-label={label} aria-controls={controls} className={['pero-ui-file-tree', className].filter(Boolean).join(' ')}
    ref={node => { if (node) ensureUiStyles(node.ownerDocument); }} selectionMode="single" selectionBehavior="replace" defaultExpandedKeys={folders}
    selectedKeys={selectedPath ? [`file:${selectedPath}`] : []} onSelectionChange={keys => {
      if (keys === 'all') return;
      const id = [...keys][0];
      if (typeof id === 'string' && id.startsWith('file:')) onSelect(id.slice(5));
    }}>
    {render(roots)}
  </Tree></I18nProvider>;
}
