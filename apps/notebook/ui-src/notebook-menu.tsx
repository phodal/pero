import { useState, type ReactNode } from 'react';
import { Icon, Popover } from '@pero/app-sdk/ui';

/** Rich notebook tools retain their dialogs and drafts when the popup closes. */
export function NotebookMenu({ name, menu, children, caret = false, label, icon, triggerClassName, closeOnSelect = false }: {
  name: string; menu: string; children: ReactNode | ((close: () => void) => ReactNode);
  caret?: boolean; label?: string; icon?: string; triggerClassName?: string; closeOnSelect?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  return <div ref={setAnchor} className="notebook-menu-anchor" data-notebook-menu={menu} data-icon={icon || undefined}>
    <Popover label={label ? `${label} ${name}` : name} trigger={<>
      {icon ? <Icon name={icon} size={16} /> : name}
      {caret && <Icon name="chevron-down" size={12} />}
    </>} triggerVariant="ghost" triggerClassName={triggerClassName} align={menu === 'insert' ? 'start' : 'end'} popupRole={menu === 'insert' ? 'menu' : 'dialog'}
      contentClassName={`notebook-menu-panel notebook-menu-${menu}-panel`} keepMounted container={menu === 'view' ? anchor : undefined}>
      {close => <div className="notebook-menu-items" data-notebook-menu-panel={menu} onClick={event => {
        if (closeOnSelect && event.target instanceof Element && event.target.closest('button, [role="tab"]')) close();
      }} onKeyDown={event => {
        if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest('dialog[open]')) return;
        const submenu = event.target.closest<HTMLDetailsElement>('details.notebook-submenu[open]');
        if (!submenu || !['Escape', 'ArrowLeft'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        submenu.open = false;
        submenu.querySelector<HTMLElement>(':scope > summary')?.focus();
      }}>{typeof children === 'function' ? children(close) : children}</div>}
    </Popover>
  </div>;
}
