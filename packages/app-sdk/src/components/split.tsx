import { Children, Fragment, isValidElement, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode, type RefObject } from 'react';
import { keyboardSize, paneLimit, readStoredSizes, resizeDelta, separatorPane, shownPaneSize, type SplitPaneSpec } from '../split';

export type SplitPaneProps = Omit<HTMLAttributes<HTMLElement>, 'id'> & {
  id: string;
  /** Width in pixels. Omit on the pane that fills the remaining space. */
  size?: number;
  min?: number;
  /** Share of the stacked frame. Defaults to 42%. */
  stackedBasis?: string;
  resizeLabel?: string;
  as?: 'div' | 'section' | 'aside';
};

/** A column declared for `Split`. Rendered by the parent split. */
export function SplitPane(_props: SplitPaneProps) {
  return null;
}

type SplitProps = HTMLAttributes<HTMLDivElement> & {
  /** localStorage key. A legacy single number is kept for one sized pane. */
  storageKey?: string;
  /** Stack the panes and hide separators below this width. */
  collapseBelow?: number;
};

function isSplitPane(node: ReactNode): node is ReactElement<SplitPaneProps> {
  return isValidElement(node) && node.type === SplitPane;
}

function specsFrom(children: ReactNode): { node: ReactElement<SplitPaneProps>; spec: SplitPaneSpec }[] {
  return Children.toArray(children).flatMap(node => {
    if (!isSplitPane(node)) return [];
    const props = node.props;
    return [{ node, spec: { id: props.id, size: props.size ?? null, min: props.min ?? 160 } }];
  });
}

function readInitial(storageKey: string | undefined, specs: readonly SplitPaneSpec[]) {
  if (!storageKey) return readStoredSizes(null, specs);
  try { return readStoredSizes(localStorage.getItem(storageKey), specs); } catch { return readStoredSizes(null, specs); }
}

/**
 * Side-by-side panes with a draggable separator before each sized pane.
 * One pane omits `size` and takes the leftover width.
 */
export function Split({ children, storageKey, collapseBelow = 0, className = '', ...props }: SplitProps) {
  const splitRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; side: 'start' | 'end'; x: number; width: number } | null>(null);
  const declared = specsFrom(children);
  const panes = declared.filter(pane => !pane.node.props.hidden);
  const specs = panes.map(pane => pane.spec);
  const [sizes, setSizes] = useState(() => readInitial(storageKey, declared.map(pane => pane.spec)));
  const [container, setContainer] = useState(0);
  const [stacked, setStacked] = useState(false);
  const [resizing, setResizing] = useState(false);

  useLayoutEffect(() => {
    const element = splitRef.current;
    if (!element) return;
    const measure = () => {
      setContainer(element.clientWidth);
      setStacked(collapseBelow > 0 && element.clientWidth < collapseBelow);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [collapseBelow]);

  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(sizes)); } catch { /* storage can be unavailable */ }
  }, [storageKey, sizes]);

  function shown(id: string) {
    const pane = specs.find(item => item.id === id);
    if (!pane || pane.size == null) return 0;
    const preferred = sizes[id] ?? pane.size;
    const max = container > 0 ? paneLimit(specs, id, sizes, container) : preferred;
    return shownPaneSize(preferred, pane.min, max);
  }

  function resizeTo(id: string, next: number) {
    const pane = specs.find(item => item.id === id);
    const element = splitRef.current;
    if (!pane || pane.size == null || !element) return;
    const width = shownPaneSize(next, pane.min, paneLimit(specs, id, sizes, element.clientWidth));
    setSizes(current => ({ ...current, [id]: width }));
  }

  return <div {...props} ref={splitRef} className={['pero-ui-split', className].filter(Boolean).join(' ')} data-stacked={stacked ? '' : undefined} data-resizing={resizing ? '' : undefined}>
    {panes.map(({ node, spec }, index) => {
      const previous = panes[index - 1]?.spec;
      const target = previous ? separatorPane(previous, spec) : null;
      const width = spec.size == null ? undefined : shown(spec.id);
      const { id, size, min, stackedBasis, resizeLabel, as, className: paneClass, style, children: paneChildren, ...rest } = node.props;
      const Tag = as ?? 'div';
      const paneStyle = {
        ...style,
        ...(width == null ? {} : { '--pero-split-size': `${width}px`, '--pero-split-stacked': stackedBasis ?? '42%' }),
      } as CSSProperties;
      return <Fragment key={id}>
        {target ? <Separator split={splitRef} target={target} label={panes.find(pane => pane.spec.id === target.id)?.node.props.resizeLabel ?? `Resize ${target.id}`} min={specs.find(item => item.id === target.id)?.min ?? 160} max={container > 0 ? paneLimit(specs, target.id, sizes, container) : width ?? 0} value={shown(target.id)} disabled={stacked} onResize={next => resizeTo(target.id, next)} onReset={() => {
          const pane = specs.find(item => item.id === target.id);
          if (pane?.size != null) setSizes(current => ({ ...current, [pane.id]: pane.size! }));
        }} onDrag={setResizing} drag={drag} /> : null}
        <Tag {...rest} id={id} className={['pero-ui-split-pane', paneClass].filter(Boolean).join(' ')} data-sized={spec.size == null ? undefined : ''} style={paneStyle}>{paneChildren}</Tag>
      </Fragment>;
    })}
  </div>;
}

function Separator({ split, target, label, min, max, value, disabled, onResize, onReset, onDrag, drag }: {
  split: RefObject<HTMLDivElement | null>;
  target: { id: string; side: 'start' | 'end' };
  label: string;
  min: number;
  max: number;
  value: number;
  disabled: boolean;
  onResize(next: number): void;
  onReset(): void;
  onDrag(active: boolean): void;
  drag: RefObject<{ id: string; side: 'start' | 'end'; x: number; width: number } | null>;
}) {
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: target.id, side: target.side, x: event.clientX, width: value };
    onDrag(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.id !== target.id || !split.current) return;
    const rtl = getComputedStyle(split.current).direction === 'rtl';
    onResize(current.width + resizeDelta(current.side, event.clientX - current.x, rtl));
  }

  function endDrag() {
    if (!drag.current || drag.current.id !== target.id) return;
    drag.current = null;
    onDrag(false);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!split.current || disabled) return;
    const rtl = getComputedStyle(split.current).direction === 'rtl';
    const next = keyboardSize(value, event.key, event.shiftKey, rtl, target.side, min, max);
    if (next == null) return;
    event.preventDefault();
    onResize(next);
  }

  if (disabled) return null;
  return <div
    className="pero-ui-split-handle"
    role="separator"
    aria-orientation="vertical"
    aria-label={label}
    aria-controls={target.id}
    aria-valuemin={Math.round(min)}
    aria-valuemax={Math.round(max)}
    aria-valuenow={Math.round(value)}
    tabIndex={0}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={endDrag}
    onPointerCancel={endDrag}
    onLostPointerCapture={endDrag}
    onDoubleClick={onReset}
    onKeyDown={onKeyDown}
  />;
}
