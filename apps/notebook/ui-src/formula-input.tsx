import { forwardRef, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Input } from '@pero/app-sdk/ui';
import { completeFormulaFunction, formulaCompletion, formulaHelp } from '@pero/notebook/formula-inspection';
import { inspectFormulaSyntax } from '@pero/notebook/formula-syntax';

const messages = {
  suggestions: { en: 'Formula function suggestions', zh: '公式函数建议' },
  hint: { en: 'Arrow keys choose a function. Enter or Tab inserts it; Escape dismisses.', zh: '方向键选择函数，Enter 或 Tab 插入，Escape 关闭。' },
};
type Props = ComponentPropsWithoutRef<typeof Input> & { value: string; onComplete(value: string): void };

/** Native input editing and selection remain authoritative. The decoration is
 * the existing engine's token stream, and suggestions use its identifier spans. */
export const FormulaInput = forwardRef<HTMLInputElement, Props>(function FormulaInput({ value, onComplete, ...props }, forwarded) {
  const { t } = useAppI18n(messages);
  const id = useId(), input = useRef<HTMLInputElement | null>(null);
  const [focused, focus] = useState(false), [composing, compose] = useState(false);
  const [caret, setCaret] = useState<number | null>(null), [chosen, choose] = useState(0), [dismissed, dismiss] = useState(false);
  const [scroll, setScroll] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const node = input.current, next = pendingCaret.current;
    if (!node || next === null) return;
    if (document.activeElement !== node) node.focus({ preventScroll: true });
    if (node.selectionStart !== next || node.selectionEnd !== next) node.setSelectionRange(next, next);
  });
  const formula = value.startsWith('=');
  const syntax = useMemo(() => formula ? inspectFormulaSyntax(value) : null, [value, formula]);
  const completion = useMemo(() => focused && !props.readOnly && !composing && !dismissed && caret !== null ? formulaCompletion(value, caret) : null,
    [value, caret, focused, composing, dismissed, props.readOnly]);
  const names = completion?.names ?? [], selected = Math.min(chosen, Math.max(0, names.length - 1));
  const selection = (node: HTMLInputElement) => { setCaret(node.selectionStart === node.selectionEnd ? node.selectionStart : null); setScroll(node.scrollLeft); };
  useEffect(() => { choose(0); }, [completion?.prefix]);
  useEffect(() => {
    if (!names.length) return;
    const locate = () => {
      const box = input.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(Math.max(box.width, 280), window.innerWidth - 16);
      setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(box.bottom + 4, window.innerHeight - 240)), width });
    };
    locate(); window.addEventListener('scroll', locate, true); window.addEventListener('resize', locate);
    return () => { window.removeEventListener('scroll', locate, true); window.removeEventListener('resize', locate); };
  }, [!!names.length]);
  useEffect(() => {
    if (names.length) document.getElementById(`${id}-${selected}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, !!names.length, id]);
  const accept = (name: string) => {
    if (caret === null || props.readOnly || composing) return;
    const replacement = completeFormulaFunction(value, caret, name);
    if (!replacement) return;
    pendingCaret.current = replacement.caret;
    onComplete(replacement.source); dismiss(true);
  };
  let offset = 0;
  const highlights = syntax?.tokens.map(token => {
    const before = value.slice(offset, token.start); offset = token.end;
    return <span key={token.start}>{before}<span data-formula-token={token.kind}>{token.text}</span></span>;
  });
  const content = <>
    <Input {...props} className={[props.className, formula && 'notebook-formula-source'].filter(Boolean).join(' ')} value={value} ref={node => { input.current = node; if (typeof forwarded === 'function') forwarded(node); else if (forwarded) forwarded.current = node; }}
      aria-autocomplete="list" aria-controls={names.length ? id : undefined} aria-activedescendant={names.length ? `${id}-${selected}` : undefined}
      onFocus={event => { focus(true); selection(event.currentTarget); props.onFocus?.(event); }}
      onBlur={event => { focus(false); dismiss(false); props.onBlur?.(event); }}
      onChange={event => { pendingCaret.current = null; dismiss(false); choose(0); selection(event.currentTarget); props.onChange?.(event); }}
      onSelect={event => {
        const node = event.currentTarget;
        if (pendingCaret.current !== null && (node.selectionStart !== pendingCaret.current || node.selectionEnd !== pendingCaret.current)) pendingCaret.current = null;
        selection(node); props.onSelect?.(event);
      }}
      onScroll={event => { setScroll(event.currentTarget.scrollLeft); props.onScroll?.(event); }}
      onCompositionStart={event => { compose(true); props.onCompositionStart?.(event); }}
      onCompositionEnd={event => { compose(false); selection(event.currentTarget); props.onCompositionEnd?.(event); }}
      onKeyDown={event => {
        if (!event.nativeEvent.isComposing && !composing && names.length && !event.ctrlKey && !event.metaKey && !event.altKey) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); event.stopPropagation(); choose((selected + (event.key === 'ArrowDown' ? 1 : names.length - 1)) % names.length); return;
          }
          if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
            event.preventDefault(); event.stopPropagation(); accept(names[selected]); return;
          }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); return; }
        }
        props.onKeyDown?.(event);
      }} />
    {formula && <div className={['pero-ui-input', props.className, 'notebook-formula-highlight'].filter(Boolean).join(' ')}
      data-unstyled={props.unstyled || undefined} aria-hidden="true"><span style={{ transform: `translateX(${-scroll}px)` }}>{highlights}{value.slice(offset)}</span></div>}
    {!!names.length && createPortal(<div id={id} role="listbox" aria-label={t('suggestions')} className="notebook-formula-completions" style={position}>
      <p className="notebook-note">{t('hint')}</p>
      {names.map((name, index) => <Button key={name} id={`${id}-${index}`} role="option" aria-selected={selected === index}
        variant="ghost" tabIndex={-1} onPointerDown={event => event.preventDefault()} onClick={() => accept(name)}>
        <span className="notebook-formula-name">{name}</span><span className="notebook-formula-syntax">{formulaHelp[name].syntax}</span><small>{formulaHelp[name].description}</small>
      </Button>)}
    </div>, document.body)}
  </>;
  return props.unstyled ? content : <div className="notebook-formula-input">{content}</div>;
});
