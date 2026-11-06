// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import { EmptyState as SelectEmptyState } from './empty-state';
import React, { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icon';
import { resolvePopupContainer } from './popup-container';
import { ensureSelectStyles } from './select-styles.mjs';
import { ensureUiStyles } from './ui-styles';

export type SelectOption = { value: string; label: string; group?: string; disabled?: boolean; hint?: string; /** Nest under a parent for tree-like menus (0 = root). */ depth?: number };
export type SelectProps = {
  value: string; options: SelectOption[]; onChange: (value: string) => void; label: string;
  id?: string; disabled?: boolean; placeholder?: string; className?: string; triggerClassName?: string; panelClassName?: string;
  /** Replaces the selected option label in the trigger. */
  triggerLabel?: string;
  /** Tooltip for the trigger. Falls back to the selected option hint. */
  title?: string;
  leading?: React.ReactNode;
  /** Replaces the chevron when the caller has another trailing marker. */
  trailing?: React.ReactNode;
  /** Actions rendered under the list, outside the listbox. */
  footer?: React.ReactNode;
  /** Draw `hint` as a second line. Hints stay in the accessible name and search either way. */
  showHint?: boolean;
  /** Force the search field on or off. Otherwise it appears after `searchAfter` options. */
  searchable?: boolean;
  /** Smallest popup width. Defaults to 160px for short choices, 260px when searchable. `0` follows the trigger. */
  menuMinWidth?: number;
  /** Controlled open state. Omit both `open` and `onOpenChange` to let the selector own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  searchAfter?: number; searchLabel?: string; emptyLabel?: string; align?: 'start' | 'end';
  container?: HTMLElement | null;
  /** Participate in native form validation and submission. */
  required?: boolean; name?: string;
  'aria-describedby'?: React.AriaAttributes['aria-describedby'];
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
};

/** A controlled, theme-aware selector shared by the shell and same-document Apps. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select({
  value, options, onChange, label, id, disabled, placeholder, className = '', triggerClassName = '', panelClassName = '',
  triggerLabel, title, leading, trailing, footer, showHint = false, searchable, menuMinWidth, open: openProp, onOpenChange,
  searchAfter = 8, searchLabel = label, emptyLabel = '—', align = 'start', container, required, name,
  'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid,
}, forwardedRef) {
  const uid = useId(), listId = `${uid}-list`;
  const controlled = openProp !== undefined;
  const [innerOpen, setInnerOpen] = useState(false), [filter, setFilter] = useState(''), [active, setActive] = useState('');
  const [invalid, setInvalid] = useState(false), [keyboardActive, setKeyboardActive] = useState(false);
  const open = openProp ?? innerOpen;
  const trigger = useRef<HTMLButtonElement | null>(null), panel = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), wasOpen = useRef(false);
  const setOpen = useCallback((next: boolean) => {
    if (!controlled) setInnerOpen(next);
    onOpenChange?.(next);
  }, [controlled, onOpenChange]);
  const setTrigger = useCallback((node: HTMLButtonElement | null) => {
    trigger.current = node;
    if (node) { ensureSelectStyles(node.ownerDocument); ensureUiStyles(node.ownerDocument); }
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const canSearch = searchable ?? options.length > searchAfter;
  const shown = options.filter(o => !filter.trim() || `${o.label} ${o.group ?? ''} ${o.hint ?? ''}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const enabled = shown.filter(o => !o.disabled);
  const current = enabled.find(o => o.value === active) ?? enabled.find(o => o.value === value) ?? enabled[0];
  const optionId = (option: SelectOption) => `${uid}-option-${options.indexOf(option)}`;
  const close = useCallback((restore = false) => { setOpen(false); setFilter(''); if (restore) trigger.current?.focus(); }, [setOpen]);
  const show = (keyboard = false) => { if (!disabled) { setKeyboardActive(keyboard); setFilter(''); setActive(value); setOpen(true); } };
  const choose = (option?: SelectOption) => { if (!option || option.disabled || disabled) return; close(true); if (option.value !== value) onChange(option.value); };

  const portal = trigger.current ? resolvePopupContainer(trigger.current, container) : null;

  useEffect(() => {
    if (open && !wasOpen.current) { setFilter(''); setActive(value); }
    wasOpen.current = !!open;
  }, [open, value]);
  useEffect(() => { if (disabled && open) close(); }, [disabled, open, close]);
  useEffect(() => { setInvalid(false); }, [value, required]);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const anchor = trigger.current, popup = panel.current, doc = anchor.ownerDocument, win = doc.defaultView!;
    const viewport = win.visualViewport;
    const place = () => {
      const rect = anchor.getBoundingClientRect(), css = win.getComputedStyle(anchor);
      const theme = {
        bg: ['--pero-select-bg', '--pero-surface', '--dsw-alias-bg-base'], ink: ['--pero-select-ink', '--pero-text', '--dsw-alias-label-primary'],
        border: ['--pero-select-border', '--pero-border-control', '--pero-border', '--dsw-alias-border-primary'],
        muted: ['--pero-select-muted', '--pero-text-secondary', '--pero-muted', '--dsw-alias-label-secondary'],
        selected: ['--pero-select-selected', '--pero-accent-soft'], 'selected-ink': ['--pero-select-selected-ink', '--pero-accent-text'],
        hover: ['--pero-select-hover', '--pero-surface-hover', '--pero-hover', '--dsw-alias-interactive-bg-hover'], accent: ['--pero-select-accent', '--pero-focus', '--pero-action', '--pero-accent', '--pero-accent-color', '--dsw-alias-button-info-fill', '--dsw-alias-brand-primary'],
      };
      const defaults = { bg: css.backgroundColor, ink: css.color, border: css.borderTopColor, muted: css.color, selected: 'color-mix(in srgb, currentColor 8%, transparent)', 'selected-ink': css.color, hover: 'color-mix(in srgb, currentColor 10%, transparent)', accent: css.color };
      for (const [key, tokens] of Object.entries(theme)) {
        popup.style.setProperty(`--pero-select-${key}`, tokens.map(token => css.getPropertyValue(token).trim()).find(Boolean) ?? defaults[key as keyof typeof defaults]);
      }
      popup.style.fontFamily = css.fontFamily;
      popup.style.fontSize = css.fontSize;
      for (const token of ['--pero-font-body', '--pero-font-caption', '--pero-control-height', '--pero-row-menu']) {
        popup.style.setProperty(token, css.getPropertyValue(token));
      }
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8, topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? win.innerWidth) - 16, bottomEdge = topEdge + (viewport?.height ?? win.innerHeight) - 16;
      if (rect.bottom < topEdge || rect.top > bottomEdge || rect.right < leftEdge || rect.left > rightEdge) { close(); return; }
      const width = Math.min(Math.max(rect.width, menuMinWidth ?? (canSearch ? 260 : 160)), Math.max(0, rightEdge - leftEdge));
      const below = Math.max(0, bottomEdge - rect.bottom - 5), above = Math.max(0, rect.top - topEdge - 5);
      const up = below < 200 && above > below, maxHeight = Math.min(360, up ? above : below);
      popup.style.width = `${width}px`; popup.style.maxHeight = `${maxHeight}px`;
      const footerEl = popup.querySelector<HTMLElement>('.pero-select-footer');
      const searchEl = popup.querySelector<HTMLElement>('.pero-select-search');
      const listEl = popup.querySelector<HTMLElement>('.pero-select-list');
      if (listEl && footerEl) {
        const chrome = footerEl.offsetHeight + (searchEl ? searchEl.offsetHeight + 5 : 0) + 10;
        listEl.style.maxHeight = `${Math.max(72, maxHeight - chrome)}px`;
      } else if (listEl) listEl.style.maxHeight = '';
      const height = popup.getBoundingClientRect().height;
      popup.style.left = `${Math.max(leftEdge, Math.min(align === 'end' ? rect.right - width : rect.left, rightEdge - width))}px`;
      popup.style.top = `${up ? Math.max(topEdge, rect.top - height - 5) : Math.max(topEdge, rect.bottom + 5)}px`;
      popup.style.visibility = 'visible';
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(anchor); observer.observe(popup);
    const themeObserver = new MutationObserver(place);
    for (let ancestor = anchor.parentElement; ancestor; ancestor = ancestor.parentElement) themeObserver.observe(ancestor, { attributes: true });
    win.addEventListener('resize', place); win.addEventListener('scroll', place, true);
    viewport?.addEventListener('resize', place); viewport?.addEventListener('scroll', place);
    return () => { observer.disconnect(); themeObserver.disconnect(); win.removeEventListener('resize', place); win.removeEventListener('scroll', place, true); viewport?.removeEventListener('resize', place); viewport?.removeEventListener('scroll', place); };
  }, [open, align, close, portal, menuMinWidth, canSearch]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const doc = trigger.current.ownerDocument;
    const outside = (e: Event) => { if (!trigger.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) close(); };
    doc.addEventListener('pointerdown', outside); doc.addEventListener('focusin', outside);
    (canSearch ? search.current : list.current)?.focus({ preventScroll: true });
    return () => { doc.removeEventListener('pointerdown', outside); doc.removeEventListener('focusin', outside); };
  }, [open, canSearch, close, portal]);
  useEffect(() => { if (open && current) trigger.current?.ownerDocument.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' }); }, [open, current?.value, filter]);

  function footerItems() {
    const root = panel.current?.querySelector('.pero-select-footer');
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')];
  }
  function key(e: React.KeyboardEvent) {
    const inFooter = !!panel.current?.querySelector('.pero-select-footer')?.contains(e.target as Node);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') {
      const items = footerItems();
      const index = items.indexOf(e.target as HTMLElement);
      if (!e.shiftKey && e.target === search.current && items.length) { e.preventDefault(); items[0].focus(); }
      else if (!e.shiftKey && index >= 0 && index < items.length - 1) { e.preventDefault(); items[index + 1].focus(); }
      else if (e.shiftKey && index === 0 && search.current) { e.preventDefault(); search.current.focus(); }
      else if (e.shiftKey && index > 0) { e.preventDefault(); items[index - 1].focus(); }
      else { trigger.current?.focus(); close(); }
    } else if (inFooter) return;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); setKeyboardActive(true); const at = enabled.findIndex(o => o.value === current?.value);
      setActive(enabled[(at + (e.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]?.value ?? '');
    } else if ((e.key === 'Home' || e.key === 'End') && e.target !== search.current) {
      e.preventDefault(); setKeyboardActive(true); setActive((e.key === 'Home' ? enabled[0] : enabled.at(-1))?.value ?? '');
    } else if (e.key === 'Enter' || (e.key === ' ' && e.target !== search.current)) { e.preventDefault(); choose(current); }
    else if (!canSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const at = enabled.findIndex(o => o.value === current?.value), ordered = [...enabled.slice(at + 1), ...enabled.slice(0, at + 1)];
      const match = ordered.find(o => o.label.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()));
      if (match) { e.preventDefault(); setKeyboardActive(true); setActive(match.value); }
    }
  }
  const groups = [...new Set(shown.map(o => o.group ?? ''))];
  const shownLabel = triggerLabel ?? options.find(o => o.value === value)?.label ?? placeholder ?? label;
  return <span className={`pero-select ${className}`}>
    {(required || name) && <input className="pero-ui-visually-hidden" aria-hidden="true" tabIndex={-1}
      required={required} name={name} value={value} disabled={disabled} onChange={() => {}}
      onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }} />}
    <button ref={setTrigger} id={id} type="button" className={`pero-select-trigger ${triggerClassName}`} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-describedby={ariaDescribedBy} aria-required={required || undefined} aria-invalid={ariaInvalid ?? (invalid || undefined)} disabled={disabled}
      data-values={JSON.stringify(options.map(o => o.value))} data-value={value} title={title ?? options.find(o => o.value === value)?.hint}
      onClick={() => open ? close(true) : show()} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(true); } }}>
      {leading}{<span className="pero-select-value">{shownLabel}</span>}{trailing ? <span className="pero-select-trailing">{trailing}</span> : <Icon name="chevron-down" size={12} strokeWidth={2} />}
    </button>
    {open && portal && createPortal(<div className={['pero-select-panel', panelClassName].filter(Boolean).join(' ')} data-pane-overlay="" ref={panel} style={{ visibility: 'hidden' }} onKeyDown={key}>
      {canSearch && <input ref={search} className="pero-select-search" type="search" role="combobox" aria-label={searchLabel} aria-expanded="true" aria-controls={listId} aria-activedescendant={current ? optionId(current) : undefined} autoComplete="off" placeholder={searchLabel} value={filter} onChange={e => { setFilter(e.target.value); setActive(''); }} />}
      <div ref={list} id={listId} role="listbox" className="pero-select-list" aria-label={label} tabIndex={canSearch ? -1 : 0} aria-activedescendant={current ? optionId(current) : undefined}>
        {groups.map(group => <div key={group} role={group ? 'group' : undefined} aria-label={group || undefined}>
          {group && <div className="pero-select-group-label" aria-hidden="true">{group}</div>}
          {shown.filter(o => (o.group ?? '') === group).map(o => <div key={o.value} id={optionId(o)} role="option" className="pero-select-option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined} data-value={o.value} data-depth={o.depth && o.depth > 0 ? o.depth : undefined} data-active={o.value === current?.value} data-keyboard-active={keyboardActive && o.value === current?.value || undefined} title={o.hint ?? o.label}
            onPointerMove={() => { setKeyboardActive(false); if (!o.disabled) setActive(o.value); }} onMouseDown={e => e.preventDefault()} onClick={() => choose(o)}>
            {showHint && o.hint ? <span className="pero-select-option-copy"><span>{o.label}</span><small>{o.hint}</small></span> : <span>{o.label}</span>}
            {o.value === value && <Icon name="check" size={14} strokeWidth={2} />}
          </div>)}
        </div>)}
        {!shown.length && <SelectEmptyState as="p" unstyled className="pero-select-empty" role="status">{emptyLabel}</SelectEmptyState>}
      </div>
      {footer ? <div className="pero-select-footer">{footer}</div> : null}
    </div>, portal)}
  </span>;
});
