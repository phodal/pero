import { domSemantics } from './dom-semantics.ts';
import type { BrowserKey, ViewportPoint } from './input.ts';

export type BrowserNode = {
  role?: string;
  name?: string;
  text?: string;
  ref?: string;
  actions?: ('click' | 'fill' | 'press')[];
};

export type DocumentCommand =
  | { action: 'observe'; observation: string }
  | { action: 'click'; ref: string }
  | { action: 'press'; ref: string; key: BrowserKey }
  | { action: 'scroll'; observationId: string }
  | { action: 'fill'; ref: string; text: string };

export type DocumentResult =
  | { kind: 'observation'; url: string; title: string; nodes: BrowserNode[]; truncated: boolean }
  | { kind: 'dispatched' | 'focused' }
  | { kind: 'point'; point: ViewportPoint }
  | { kind: 'rejected'; reason: string };

// Serialized together with the Point-derived DOM semantics into an Electron
// isolated world. Refs hold DOM identity in that world, never a caller selector.
function useDocument(origin: string, command: DocumentCommand, semantics: ReturnType<typeof domSemantics>): DocumentResult {
  type Target = { node: HTMLElement; role: string; name: string };
  type Observation = { id: string; url: string; targets: Map<string, Target> };
  const world = globalThis as typeof globalThis & { peroBrowserObservation?: Observation };
  const reject = (reason: string): DocumentResult => ({ kind: 'rejected', reason });
  if (location.origin !== origin) return reject('The page left the authorized site.');

  const canFill = (node: Element) =>
    ((node instanceof HTMLInputElement && ['text', 'search', 'email', 'tel', 'url'].includes(node.type)) ||
      node instanceof HTMLTextAreaElement) && !node.readOnly && !node.disabled &&
    !node.autocomplete.split(/\s+/).some(token => ['current-password', 'new-password', 'one-time-code'].includes(token));
  const sensitive = (node: Element) => node instanceof HTMLInputElement && ['password', 'file', 'hidden'].includes(node.type);
  const canClick = (node: Element, role: string) =>
    node instanceof HTMLElement && !sensitive(node) && !node.matches(':disabled') &&
    !node.closest('[aria-disabled="true"]') && ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem'].includes(role);
  const inScope = (url: string) => {
    if (!URL.canParse(url, document.baseURI)) return false;
    const target = new URL(url, document.baseURI);
    return target.origin === origin && !target.username && !target.password && ['https:', 'http:'].includes(target.protocol);
  };

  function hitAt({ x, y }: ViewportPoint): Element | null {
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const nested = hit.shadowRoot.elementFromPoint(x, y);
      if (!nested || nested === hit) break;
      hit = nested;
    }
    return hit;
  }

  if (command.action === 'observe') {
    const targets = new Map<string, Target>();
    const nodes: BrowserNode[] = [];
    const pending: Element[] = document.body ? [document.body] : [];
    let scanned = 0;
    while (pending.length && scanned < 3000 && nodes.length < 160) {
      scanned++;
      const node = pending.pop()!;
      if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED'].includes(node.tagName) ||
          sensitive(node) || semantics.hidden(node)) continue;
      const children = (node.shadowRoot || node).children;
      for (let i = Math.min(children.length, 3001 - pending.length - scanned) - 1; i >= 0; i--) pending.push(children[i]);
      const role = semantics.role(node);
      const actions: NonNullable<BrowserNode['actions']> = [];
      if (canClick(node, role)) actions.push('click');
      if (canFill(node)) actions.push('fill');
      if (actions.length && node instanceof HTMLElement && (node.tabIndex >= 0 || node.hasAttribute('tabindex'))) actions.push('press');
      const name = role ? semantics.name(node).slice(0, 160) : '';
      const text = semantics.normalize(Array.from(node.childNodes)
        .filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.nodeValue).join(' ')).slice(0, 240);
      if ((!name && !text && !actions.length) || !semantics.visible(node)) continue;
      const entry: BrowserNode = { ...(role && { role }), ...(name && { name }), ...(text && text !== name && { text }) };
      if (actions.length && node instanceof HTMLElement) {
        entry.ref = `${command.observation}:${nodes.length + 1}`;
        entry.actions = actions;
        targets.set(entry.ref, { node, role, name });
      }
      nodes.push(entry);
    }
    world.peroBrowserObservation = { id: command.observation, url: location.href, targets };
    return { kind: 'observation', url: location.href, title: document.title.slice(0, 200), nodes, truncated: pending.length > 0 || scanned >= 3000 };
  }

  const observation = world.peroBrowserObservation;
  delete world.peroBrowserObservation;
  if (command.action === 'scroll') {
    if (observation?.id !== command.observationId || observation.url !== location.href)
      return reject('The observation is stale. Observe the tab again.');
    for (const [x, y] of [[.5, .5], [.25, .5], [.75, .5], [.5, .25], [.5, .75]]) {
      const point = { x: Math.floor(innerWidth * x), y: Math.floor(innerHeight * y) };
      const hit = hitAt(point);
      if (hit && !['IFRAME', 'FRAME', 'OBJECT', 'EMBED'].includes(hit.tagName))
        return { kind: 'point', point };
    }
    return reject('The page viewport has no main-document scroll target.');
  }
  const target = observation?.targets.get(command.ref);
  if (!target || observation?.url !== location.href || !target.node.isConnected ||
      semantics.hidden(target.node) || !semantics.visible(target.node) ||
      semantics.role(target.node) !== target.role || semantics.name(target.node).slice(0, 160) !== target.name)
    return reject('The reference is stale. Observe the tab again.');

  const node = target.node;
  if (command.action === 'fill') {
    if (!canFill(node)) return reject('The target is not an editable plain-text field.');
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, command.text);
    node.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return { kind: 'dispatched' };
  }

  const clickable = canClick(node, target.role);
  if (command.action === 'click' && !clickable) return reject('The target is unavailable for a click.');
  if (command.action === 'press' && (!clickable && !canFill(node)))
    return reject('The target is unavailable for a key press.');
  if (command.action === 'click' || command.key === 'Enter' || command.key === 'Space') {
    // Check native link activation and form submission before sending input.
    let parent: Element | null = node;
    let link: HTMLAnchorElement | undefined;
    let control: HTMLInputElement | HTMLButtonElement | undefined;
    while (parent) {
      if (!link && parent instanceof HTMLAnchorElement && parent.hasAttribute('href')) link = parent;
      if (!control && (parent instanceof HTMLInputElement || parent instanceof HTMLButtonElement)) control = parent;
      parent = semantics.parent(parent);
    }
    let submit = control && ['submit', 'image'].includes(control.type) ? control : undefined;
    const implicitForm = command.action === 'press' && command.key === 'Enter' && control instanceof HTMLInputElement
      ? control.form : null;
    if (!submit && implicitForm) {
      submit = Array.from(document.querySelectorAll('button, input')).find((element): element is HTMLButtonElement | HTMLInputElement =>
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        element.form === implicitForm && ['submit', 'image'].includes(element.type));
    }
    const form = submit?.form || implicitForm;
    const baseTarget = document.querySelector('base[target]')?.getAttribute('target') || '_self';
    if (link && (link.hasAttribute('download') || (link.target || baseTarget).toLowerCase() !== '_self' || !inScope(link.href)))
      return reject('This link leaves the authorized tab or site.');
    if (form && ((submit?.getAttribute('formtarget') || form.target || baseTarget).toLowerCase() !== '_self' ||
        !inScope(submit?.getAttribute('formaction') ?? form.action)))
      return reject('This form leaves the authorized tab or site.');
  }

  if (command.action === 'press') {
    node.focus({ preventScroll: true });
    const root = node.getRootNode();
    if (!(root instanceof Document || root instanceof ShadowRoot) || root.activeElement !== node)
      return reject('The observed element could not receive keyboard focus.');
    return { kind: 'focused' };
  }

  const rect = node.getBoundingClientRect();
  const left = Math.max(0, rect.left), right = Math.min(rect.right, innerWidth);
  const top = Math.max(0, rect.top), bottom = Math.min(rect.bottom, innerHeight);
  if (right <= left || bottom <= top) return reject('The element is outside the viewport. Scroll and observe again.');
  const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
  for (let hit = hitAt(point); hit; hit = semantics.parent(hit)) {
    if (hit === node) return { kind: 'point', point };
    if (sensitive(hit) || ['IFRAME', 'FRAME', 'OBJECT', 'EMBED'].includes(hit.tagName) ||
        canClick(hit, semantics.role(hit)) || canFill(hit)) break;
  }
  return reject('The element is covered or cannot receive pointer input.');
}

export function documentScript(origin: string, command: DocumentCommand) {
  return `(${useDocument.toString()})(${JSON.stringify(origin)}, ${JSON.stringify(command)}, (${domSemantics.toString()})())`;
}
