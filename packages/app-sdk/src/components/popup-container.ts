// Adapted from Point App SDK d95f9118e (Apache-2.0).
/** Shared owning-document and native top-layer policy for anchored controls. */
function isOpenDialog(element: Element): element is HTMLDialogElement {
  return element.localName === 'dialog' && ((element as HTMLDialogElement).open === true || element.hasAttribute('open'));
}

/** Top-layer modal dialog when the engine supports :modal. JSDOM has no top layer; open is enough there. */
export function topLayerDialog(doc: Document): HTMLElement | null {
  const dialogs = doc.querySelectorAll('dialog');
  for (let index = dialogs.length - 1; index >= 0; index -= 1) {
    const dialog = dialogs[index];
    try {
      if (dialog.matches(':modal')) return dialog as HTMLElement;
    } catch {
      return null;
    }
  }
  return null;
}

function nearestOpenDialog(trigger: HTMLElement): HTMLElement | null {
  let current = trigger.parentElement;
  while (current) {
    if (isOpenDialog(current)) {
      const top = topLayerDialog(trigger.ownerDocument);
      if (top && top.contains(trigger)) return top;
      return current;
    }
    current = current.parentElement;
  }
  const top = topLayerDialog(trigger.ownerDocument);
  return top && top.contains(trigger) ? top : null;
}

export function resolvePopupContainer(trigger: HTMLElement, explicit?: HTMLElement | null) {
  if (explicit) return explicit;
  const nested = trigger.closest<HTMLElement>('[data-pero-popup-container]');
  if (nested) return nested;
  const dialog = nearestOpenDialog(trigger);
  if (dialog) return dialog;
  const workbench = trigger.closest('.pero-workbench');
  if (workbench instanceof trigger.ownerDocument.defaultView!.HTMLElement) return workbench;
  return trigger.ownerDocument.body;
}
