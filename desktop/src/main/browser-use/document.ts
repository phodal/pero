import { domSemantics } from './dom-semantics.ts';

export type BrowserNode = {
  role?: string;
  name?: string;
  text?: string;
  ref?: string;
  actions?: ('click' | 'fill')[];
};

export type DocumentCommand =
  | { action: 'observe'; observation: string }
  | { action: 'click'; ref: string }
  | { action: 'fill'; ref: string; text: string };

export type DocumentResult =
  | { kind: 'observation'; url: string; title: string; nodes: BrowserNode[]; truncated: boolean }
  | { kind: 'dispatched' }
  | { kind: 'rejected'; reason: string };

// Serialized together with the Point-derived DOM semantics into an Electron
// isolated world. Refs hold DOM identity in that world, never a caller selector.
function useDocument(origin: string, command: DocumentCommand, semantics: ReturnType<typeof domSemantics>): DocumentResult {
  type Target = { node: HTMLElement; role: string; name: string };
  type Observation = { url: string; targets: Map<string, Target> };
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
    world.peroBrowserObservation = { url: location.href, targets };
    return { kind: 'observation', url: location.href, title: document.title.slice(0, 200), nodes, truncated: pending.length > 0 || scanned >= 3000 };
  }

  const observation = world.peroBrowserObservation;
  delete world.peroBrowserObservation;
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

  if (!canClick(node, target.role)) return reject('The target is unavailable for a click.');
  const link = node.closest<HTMLAnchorElement>('a[href]');
  const control = node.closest('button, input');
  const submit = (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) &&
    ['submit', 'image'].includes(control.type) ? control : undefined;
  const form = submit?.form;
  const baseTarget = document.querySelector('base[target]')?.getAttribute('target') || '_self';
  if (link && (link.hasAttribute('download') || (link.target || baseTarget).toLowerCase() !== '_self' || !inScope(link.href)))
    return reject('This link leaves the authorized tab or site.');
  if (form && ((submit?.getAttribute('formtarget') || form.target || baseTarget).toLowerCase() !== '_self' ||
      !inScope(submit?.getAttribute('formaction') ?? form.action)))
    return reject('This form leaves the authorized tab or site.');
  node.click();
  return { kind: 'dispatched' };
}

export function documentScript(origin: string, command: DocumentCommand) {
  return `(${useDocument.toString()})(${JSON.stringify(origin)}, ${JSON.stringify(command)}, (${domSemantics.toString()})())`;
}
