// Adapted from Point App SDK d95f9118e (Apache-2.0).
import React, { useId, useLayoutEffect } from 'react';
import { ensureUiStyles } from './ui-styles';

export type Suggestion = { id: string; label: string; hint?: string };

export type SuggestionListProps = {
  options: readonly Suggestion[];
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onSelect: (option: Suggestion) => void;
  label: string;
  id?: string;
  className?: string;
  /** `multiple` keeps the list open for toggles; Enter confirms through `onConfirm`. */
  selectionMode?: 'single' | 'multiple';
  selectedIds?: readonly string[];
  onToggle?: (option: Suggestion) => void;
  onConfirm?: (options: Suggestion[]) => void;
};

/** Compact listbox. The caller keeps focus in the input and routes keys through `suggestionListKey`. */
export function SuggestionList({
  options, activeIndex, onActiveIndex, onSelect, label, id, className,
  selectionMode = 'single', selectedIds = [], onToggle, onConfirm,
}: SuggestionListProps) {
  const generatedId = useId();
  const listId = id ?? generatedId;
  const active = options[activeIndex];
  const selected = new Set(selectedIds);
  useLayoutEffect(() => {
    if (!active) return;
    const node = document.getElementById(`${listId}-option-${active.id}`);
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [listId, active?.id, options.length]);
  if (!options.length) return null;
  const choose = (option: Suggestion) => {
    if (selectionMode === 'multiple') onToggle?.(option);
    else onSelect(option);
  };
  return <ul id={listId} role="listbox" aria-label={label} aria-multiselectable={selectionMode === 'multiple' || undefined}
    className={['pero-ui-suggestion-list', className].filter(Boolean).join(' ')}
    ref={node => { if (node) ensureUiStyles(node.ownerDocument); }}
    data-confirm={selectionMode === 'multiple' ? '1' : undefined}
    onKeyDown={event => {
      if (selectionMode !== 'multiple' || event.key !== 'Enter' || !onConfirm) return;
      // Focus stays on the input; this only helps if the list itself receives a key.
      event.preventDefault();
      onConfirm(options.filter(option => selected.has(option.id)));
    }}>
    {options.map((option, index) => {
      const checked = selectionMode === 'multiple' ? selected.has(option.id) : index === activeIndex;
      return <li key={option.id} role="presentation">
        <button type="button" id={`${listId}-option-${option.id}`} role="option" aria-selected={checked}
          data-active={index === activeIndex || undefined}
          className="pero-ui-suggestion-option" onMouseDown={event => { event.preventDefault(); choose(option); }}
          onMouseEnter={() => onActiveIndex(index)}>
          {selectionMode === 'multiple' ? <span className="pero-ui-suggestion-check" aria-hidden="true">{checked ? '✓' : ''}</span> : null}
          <span className="pero-ui-suggestion-label">{option.label}</span>
          {option.hint ? <span className="pero-ui-suggestion-hint">{option.hint}</span> : null}
        </button>
      </li>;
    })}
  </ul>;
}

/** Arrow keys move the active row; Space toggles in multiple mode; Enter and Tab choose. */
export function suggestionListKey(event: { key: string; preventDefault(): void }, state: {
  count: number; index: number; setIndex: (index: number) => void; select: () => void; close: () => void;
  selectionMode?: 'single' | 'multiple'; toggle?: () => void; confirm?: () => void;
}): boolean {
  if (!state.count) return false;
  if (event.key === 'ArrowDown') { event.preventDefault(); state.setIndex((state.index + 1) % state.count); return true; }
  if (event.key === 'ArrowUp') { event.preventDefault(); state.setIndex((state.index - 1 + state.count) % state.count); return true; }
  if (event.key === 'Home') { event.preventDefault(); state.setIndex(0); return true; }
  if (event.key === 'End') { event.preventDefault(); state.setIndex(state.count - 1); return true; }
  if (state.selectionMode === 'multiple' && event.key === ' ') { event.preventDefault(); state.toggle?.(); return true; }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    if (state.selectionMode === 'multiple') state.confirm?.();
    else state.select();
    return true;
  }
  if (event.key === 'Escape') { event.preventDefault(); state.close(); return true; }
  return false;
}
