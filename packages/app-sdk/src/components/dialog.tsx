// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React, { forwardRef, useCallback, useId, useLayoutEffect, useRef } from 'react';
import { Icon } from './icon';
import { IconButton } from './icon-button';
import { ensureUiStyles } from './ui-styles';

const DEFAULT_INITIAL_FOCUS = '.pero-ui-dialog-body :is(input:not([type="checkbox"]):not([type="hidden"]):not([aria-hidden="true"]),textarea,select,.pero-select-trigger):not(:disabled)';

type DialogBase = Omit<React.ComponentPropsWithoutRef<'dialog'>, 'title' | 'onSubmit' | 'onClose' | 'open' | 'children'> & {
  title: React.ReactNode;
  children?: React.ReactNode;
  /** sm ≈ confirm / single field, md ≈ short form, lg ≈ editor or detail. */
  size?: 'sm' | 'md' | 'lg';
  /** Right-edge detail surface; retains the modal's focus, Escape and restore behavior. */
  presentation?: 'modal' | 'drawer';
  /** Close intent. Staying mounted refuses the close. */
  onClose: () => void;
  /** When set, the frame is a native form so Enter and footer submit keep FormData and validation. */
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  /** Right-aligned footer actions. */
  footer?: React.ReactNode;
  /** Left-aligned footer slot. */
  footerStart?: React.ReactNode;
  /** Focused on open. Defaults to the first field in the body. */
  initialFocus?: string;
  /** Mounted dialogs open. Set false to keep the element without showModal. */
  open?: boolean;
  /**
   * Return focus to the control that was active before open.
   * False leaves that control untouched so an editor can restore its own selection.
   */
  restoreFocus?: boolean;
  /** Close only for a click outside the dialog border box. Padding inside the dialog does not close. */
  dismissOnBackdrop?: boolean;
  unstyled?: boolean;
  frameClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  closeButtonClassName?: string;
};

export type DialogProps = DialogBase & (
  | { closeButton?: true; closeLabel: string }
  | { closeButton: false; closeLabel?: string }
);

function focusableControls(root: HTMLElement) {
  const view = root.ownerDocument.defaultView;
  return [...root.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')].filter(node => {
    if (node.tabIndex < 0 || node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true' || node.closest('[hidden],[inert],dialog:not([open])')) return false;
    for (let ancestor: HTMLElement | null = node; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
      const style = view?.getComputedStyle(ancestor);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
      if (ancestor.localName === 'details' && !ancestor.hasAttribute('open') && !ancestor.querySelector('summary')?.contains(node)) return false;
    }
    return true;
  });
}

function classes(...names: Array<string | false | undefined>) {
  return names.filter(Boolean).join(' ');
}

function showModal(dialog: HTMLDialogElement) {
  if (dialog.open) return;
  try {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
      if (dialog.open) return;
    }
  } catch {
    // Engines without a top layer still expose the open dialog to popup containers.
  }
  dialog.setAttribute('open', '');
  dialog.open = true;
}

/**
 * Native top-layer modal. Mounting opens it; unmounting closes it while the
 * node is still connected. Callers render conditionally or pass `open`.
 */
export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(function Dialog({
  title, size = 'md', presentation = 'modal', className, onClose, onSubmit, footer, footerStart, initialFocus,
  closeLabel, closeButton = true, open = true, restoreFocus = true, dismissOnBackdrop = false, unstyled = false,
  frameClassName, headerClassName, bodyClassName, footerClassName, closeButtonClassName, children,
  onKeyDown, onCancel, onClick, ...rest
}, forwardedRef) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;
  const escapeSeen = useRef(false);

  const setDialog = useCallback((node: HTMLDialogElement | null) => {
    dialogRef.current = node;
    if (node) ensureUiStyles(node.ownerDocument);
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const doc = dialog.ownerDocument;
    const previous = doc.activeElement instanceof doc.defaultView!.HTMLElement ? doc.activeElement : null;
    showModal(dialog);
    const selector = initialFocusRef.current ?? DEFAULT_INITIAL_FOCUS;
    try {
      dialog.querySelector<HTMLElement>(selector)?.focus();
    } catch {
      // An invalid initialFocus selector leaves the focus showModal chose.
    }
    return () => {
      const activeBeforeClose = doc.activeElement instanceof doc.defaultView!.HTMLElement ? doc.activeElement : null;
      if (dialog.open) dialog.close();
      // Native restoration preserves an editor's selection. Opting out suppresses
      // our explicit focus replay, rather than replacing DOM focus methods.
      if (!restoreFocusRef.current || !dialog.isConnected) return;
      const other = [...doc.querySelectorAll('dialog')].find(node => node !== dialog && (node as HTMLDialogElement).open);
      if (other) {
        if (activeBeforeClose && !dialog.contains(activeBeforeClose) && other.contains(activeBeforeClose) && activeBeforeClose.isConnected && doc.activeElement !== activeBeforeClose) {
          activeBeforeClose.focus();
        }
        return;
      }
      if (previous?.isConnected && doc.activeElement !== previous) previous.focus();
    };
  }, [open]);

  const requestEscapeClose = () => {
    if (escapeSeen.current) return;
    escapeSeen.current = true;
    queueMicrotask(() => { escapeSeen.current = false; });
    onCloseRef.current();
  };

  const frame = <>
    <header className={classes('pero-ui-dialog-head', headerClassName)}>
      <h2 id={titleId}>{title}</h2>
      {closeButton && <IconButton type="button" variant="unstyled" className={classes('pero-ui-dialog-close', closeButtonClassName)} label={closeLabel ?? ''} onClick={() => onCloseRef.current()}><Icon name="close" size={16} /></IconButton>}
    </header>
    <div className={classes('pero-ui-dialog-body', bodyClassName)}>{children}</div>
    {(footer || footerStart) && <footer className={classes('pero-ui-dialog-foot', footerClassName)}>
      <div className="pero-ui-dialog-foot-start">{footerStart}</div>{footer}
    </footer>}
  </>;
  return <dialog
    {...rest}
    ref={setDialog}
    className={classes('pero-ui-dialog', className)}
    data-size={size}
    data-presentation={presentation}
    data-unstyled={unstyled || undefined}
    aria-labelledby={rest['aria-labelledby'] ?? titleId}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (event.key === 'Tab' && !event.defaultPrevented) {
        const items = focusableControls(event.currentTarget);
        const active = event.currentTarget.ownerDocument.activeElement;
        const boundary = event.shiftKey ? items[0] : items.at(-1);
        if (!items.length || active === boundary || active === event.currentTarget) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) : items[0])?.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      // One Escape is consumed here, including when a consumer already refused it.
      event.stopPropagation();
      if (event.defaultPrevented) return;
      event.preventDefault();
      requestEscapeClose();
    }}
    onCancel={event => {
      onCancel?.(event);
      event.stopPropagation();
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      requestEscapeClose();
    }}
    onClick={event => {
      onClick?.(event);
      if (event.defaultPrevented || !dismissOnBackdrop || event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const { clientX: x, clientY: y } = event;
      const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (!inside) onCloseRef.current();
    }}>
    {onSubmit ? <form className={classes('pero-ui-dialog-frame', frameClassName)} onSubmit={onSubmit}>{frame}</form>
      : <div className={classes('pero-ui-dialog-frame', frameClassName)}>{frame}</div>}
  </dialog>;
});
