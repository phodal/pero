import { domSemantics } from './dom-semantics.ts';
import type { ViewportPoint } from './input.ts';
import type { BrowserRequest, FrameSelector, Locator, WaitCondition } from './request.ts';

type FormState = {
  disabled: boolean;
  checked?: boolean | 'mixed';
  value?: string;
  valueTruncated?: true;
  options?: { value: string; name: string; selected: boolean; disabled: boolean }[];
};
type ElementAction = 'click' | 'dblclick' | 'hover' | 'fill' | 'press' | 'typeSequentially' | 'scrollIntoView' | 'setChecked' | 'selectOption' | 'upload' | 'download';

export type BrowserNode = {
  role?: string;
  name?: string;
  text?: string;
  ref?: string;
  actions?: ElementAction[];
  state?: FormState;
};

export type DocumentCommand =
  | ({ observation: string; linksOnly?: true } & Extract<BrowserRequest, { action: 'observe' | 'locate' | 'wait' }>)
  | Extract<BrowserRequest, { action: Exclude<ElementAction, 'upload' | 'dblclick' | 'typeSequentially' | 'download'> | 'scroll' }>
  | (Extract<BrowserRequest, { action: 'download' }> & { linksOnly?: true })
  | (Extract<BrowserRequest, { action: 'dblclick' }> & { recheck?: true })
  | (Extract<BrowserRequest, { action: 'typeSequentially' }> & { recheck?: true })
  | { action: 'upload'; ref: string; files: { name: string; mediaType: string; base64: string }[] };

export type DocumentResult =
  | { kind: 'observation'; url: string; title: string; nodes: BrowserNode[]; truncated: boolean;
    frame?: FrameSelector[]; frameUrl?: string; frames: { selector: FrameSelector; sameOrigin: boolean }[] }
  | { kind: 'dispatched' | 'focused' | 'pending' }
  | { kind: 'point'; point: ViewportPoint; downloadUrl?: string }
  | { kind: 'download'; url: string; name?: string }
  | { kind: 'rejected'; reason: string };

// Serialized into the top document's isolated world. Keep frame traversal,
// locator matching, form admission and captured DOM refs in this world.
function useDocument(origin: string, command: DocumentCommand, semantics: ReturnType<typeof domSemantics>): DocumentResult {
  type Frame = { element: HTMLIFrameElement; document: Document };
  type Target = { node: HTMLElement; role: string; name: string };
  type Observation = { id: string; url: string; chain: Frame[]; targets: Map<string, Target> };
  const world = globalThis as typeof globalThis & { peroBrowserObservation?: Observation };
  const reject = (reason: string): DocumentResult => ({ kind: 'rejected', reason });
  if (location.origin !== origin) return reject('The page left the authorized site.');

  const { tag, html, hidden, visible, role, name, normalize, editingHost } = semantics;
  const frameTags = ['IFRAME', 'FRAME', 'OBJECT', 'EMBED'];
  const sensitive = (node: Element) => tag(node, 'input') &&
    (['password', 'hidden'].includes(node.type) ||
      node.autocomplete.toLowerCase().split(/\s+/).some(token => ['current-password', 'new-password', 'one-time-code'].includes(token)));
  const disabled = (node: Element) => node.matches(':disabled') || !!node.closest('[aria-disabled="true"]');
  const plainText = (node: Element): node is HTMLInputElement | HTMLTextAreaElement =>
    (tag(node, 'textarea') || (tag(node, 'input') && ['text', 'search', 'email', 'tel', 'url'].includes(node.type))) &&
    !sensitive(node);
  const editable = (node: Element) => !disabled(node) &&
    ((plainText(node) && !node.readOnly) || (editingHost(node) && node.getAttribute('aria-readonly') !== 'true'));
  const fieldValue = (node: Element) => plainText(node) || tag(node, 'select') ? node.value :
    editingHost(node) ? node.innerText : undefined;
  const fileInput = (node: Element): node is HTMLInputElement => tag(node,'input') && node.type === 'file';
  const checkable = (node: Element): node is HTMLInputElement =>
    tag(node, 'input') && ['checkbox', 'radio'].includes(node.type);
  const clickable = (node: Element, nodeRole: string) =>
    html(node) && !fileInput(node) && !sensitive(node) && !disabled(node) &&
    ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem'].includes(nodeRole);
  const pointerTarget = (node: Element, nodeRole: string, nodeName: string) =>
    html(node) && !fileInput(node) && !sensitive(node) && (nodeRole || nodeName || node.hasAttribute('data-testid') ||
      Array.from(node.childNodes).some(child => child.nodeType === 3 && child.nodeValue?.trim()));
  const state = (node: Element): FormState => {
    const fields: FormState = { disabled: disabled(node) };
    if (checkable(node)) fields.checked = node.indeterminate ? 'mixed' : node.checked;
    else if (['true', 'false', 'mixed'].includes(node.getAttribute('aria-checked') || '')) {
      const checked = node.getAttribute('aria-checked');
      fields.checked = checked === 'mixed' ? 'mixed' : checked === 'true';
    }
    const value = fieldValue(node);
    if (value !== undefined) {
      fields.value = value.slice(0, 512);
      if (value.length > 512) fields.valueTruncated = true;
    }
    if (tag(node, 'select')) fields.options = Array.from(node.options).slice(0, 64).map(option => ({
      value: option.value.slice(0, 512), name: normalize(option.label).slice(0, 160),
      selected: option.selected, disabled: disabled(option),
    }));
    return fields;
  };

  function walk(doc: Document, scope?: Element) {
    const nodes: Element[] = [];
    const pending: Element[] = scope ? [scope] : doc.body ? [doc.body] : [];
    while (pending.length && nodes.length < 3000) {
      const node = pending.pop()!;
      nodes.push(node);
      if ([...frameTags, 'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(node.tagName)) continue;
      const assigned = tag(node, 'slot') ? node.assignedElements({ flatten: true }) : [];
      const children = assigned.length ? assigned : (node.shadowRoot || node).children;
      for (let i = Math.min(children.length, 3001 - pending.length - nodes.length) - 1; i >= 0; i--) pending.push(children[i]);
    }
    return { nodes, truncated: pending.length > 0 };
  }

  const frameLabel = (node: HTMLIFrameElement, by: FrameSelector['by']) =>
    by === 'title' ? normalize(node.getAttribute('title')) : node.getAttribute('data-testid') || '';
  const sameOrigin = (doc: Document | null): doc is Document => doc?.defaultView?.origin === origin;
  const isVisible = (element: Element) => !hidden(element) && visible(element);
  function hitAt(doc: Document, { x, y }: ViewportPoint): Element | null {
    let hit = doc.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const nested = hit.shadowRoot.elementFromPoint(x, y);
      if (!nested || nested === hit) break;
      hit = nested;
    }
    return hit;
  }
  function topPoint(point: ViewportPoint, chain: Frame[]): ViewportPoint | undefined {
    for (let i = chain.length - 1; i >= 0; i--) {
      const { element } = chain[i];
      const rect = element.getBoundingClientRect();
      // CDP uses top-document CSS coordinates. Avoid guessing a point through
      // an iframe with CSS scaling, rotation, or padding.
      const style = getComputedStyle(element);
      if (style.transform !== 'none' ||
          Math.abs(rect.width - element.offsetWidth) > 1 || Math.abs(rect.height - element.offsetHeight) > 1 ||
          [style.paddingLeft, style.paddingTop, style.paddingRight, style.paddingBottom].some(value => parseFloat(value))) return;
      point = { x: rect.left + element.clientLeft + point.x, y: rect.top + element.clientTop + point.y };
      if (hitAt(element.ownerDocument, point) !== element) return;
    }
    return point;
  }

  if (command.action === 'observe' || command.action === 'locate' || command.action === 'wait') {
    delete world.peroBrowserObservation;
    let doc = document;
    const chain: Frame[] = [];
    for (const selector of command.frame || []) {
      const visited = walk(doc);
      const matched = visited.nodes.filter((node): node is HTMLIFrameElement =>
        tag(node, 'iframe') && frameLabel(node, selector.by) === selector.value);
      if (matched.length > 1 || visited.truncated) return reject('The iframe locator is ambiguous.');
      const element = matched[0];
      if (!element) return command.action === 'wait' ? { kind: 'pending' } : reject('The iframe was not found.');
      const inner = element.contentDocument;
      if (!sameOrigin(inner)) return reject('The iframe is outside the authorized origin.');
      if (!isVisible(element)) return command.action === 'wait' ? { kind: 'pending' } : reject('The iframe is hidden.');
      chain.push({ element, document: inner });
      doc = inner;
    }

    const visited = walk(doc);
    const observationId = command.observation;
    const targets = new Map<string, Target>();
    const nodes: BrowserNode[] = [];
    function describe(node: Element) {
      const nodeRole = role(node);
      const nodeName = name(node).slice(0, 160);
      const text = normalize(Array.from(node.childNodes)
        .filter(child => child.nodeType === 3).map(child => child.nodeValue).join(' ')).slice(0, 240);
      const actions: ElementAction[] = [];
      const isControl = clickable(node, nodeRole) || editable(node) || checkable(node) || tag(node, 'select') ||
        /^(button|textbox|searchbox|checkbox|radio|switch|combobox|listbox)$/.test(nodeRole);
      if (clickable(node, nodeRole)) actions.push('click');
      if (editable(node)) actions.push('fill', 'typeSequentially');
      if (actions.length && html(node) && (node.tabIndex >= 0 || node.hasAttribute('tabindex'))) actions.push('press');
      if (checkable(node) && !disabled(node)) actions.push('setChecked');
      if (tag(node, 'select') && !disabled(node)) actions.push('selectOption');
      if (fileInput(node) && !disabled(node)) actions.push('upload');
      if ((tag(node, 'a') && node.hasAttribute('href')) || (!('linksOnly' in command && command.linksOnly) && nodeRole === 'button' && clickable(node, nodeRole))) actions.push('download');
      if (pointerTarget(node, nodeRole, nodeName)) {
        actions.push('hover');
        if (!disabled(node)) actions.push('dblclick');
      }
      const entry: BrowserNode = { ...(nodeRole && { role: nodeRole }), ...(nodeName && { name: nodeName }),
        ...(text && text !== nodeName && { text }), ...(isControl && { state: state(node) }) };
      if (actions.length && html(node)) {
        actions.push('scrollIntoView');
        entry.ref = `${observationId}:${nodes.length + 1}`;
        entry.actions = actions;
        targets.set(entry.ref, { node, role: nodeRole, name: nodeName });
      }
      if (Object.keys(entry).length) nodes.push(entry);
    }

    const publicNode = (node: Element) => !sensitive(node) &&
      ![...frameTags, 'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(node.tagName);
    if (command.action === 'observe') {
      for (const node of visited.nodes) {
        if (nodes.length >= 160) break;
        if (publicNode(node) && isVisible(node)) describe(node);
      }
    } else {
      const matchesLocator = (node: Element, locator: Locator) => {
        if (!publicNode(node)) return false;
        if (locator.by === 'role') return role(node) === locator.role &&
          (locator.name === undefined || name(node, true) === normalize(locator.name));
        if (locator.by === 'label') return semantics.label(node) === normalize(locator.value);
        if (locator.by === 'testId') return node.getAttribute('data-testid') === locator.value;
        if (locator.by === 'placeholder') return normalize(node.getAttribute('placeholder')) === normalize(locator.value);
        return semantics.text(node, false) === normalize(locator.value) &&
          !Array.from(node.children).some(child => semantics.text(child, false) === normalize(locator.value));
      };
      let search = visited;
      if (command.within) {
        const within = command.within;
        const scopes = visited.nodes.filter(node => isVisible(node) && matchesLocator(node, within));
        if (scopes.length > 1 || visited.truncated) return reject('The locator scope is ambiguous.');
        if (!scopes.length) return command.action === 'wait' ? { kind: 'pending' } : reject('The locator scope was not found.');
        search = walk(doc, scopes[0]);
        search.nodes.shift();
      }
      const candidates = search.nodes.filter(node => matchesLocator(node, command.locator));
      const waitingForHidden = command.action === 'wait' && command.condition.kind === 'hidden';
      const matches = waitingForHidden ? candidates : candidates.filter(isVisible);
      if (matches.length > 1 || search.truncated) return reject('The locator is ambiguous. Use a more specific locator or frame.');
      const node = matches[0];
      const shown = !!node && (!waitingForHidden || isVisible(node));
      if (command.action === 'locate' && !shown) return reject('The locator did not match a visible element.');
      if (command.action === 'wait') {
        const condition: WaitCondition = command.condition;
        let matched = false;
        if (condition.kind === 'hidden') matched = !shown;
        else if (shown) {
          switch (condition.kind) {
            case 'visible': matched = true; break;
            case 'enabled': matched = !disabled(node); break;
            case 'checked': matched = state(node).checked === condition.value; break;
            case 'value': matched = fieldValue(node) === condition.value; break;
            case 'text': matched = semantics.text(node, false) === normalize(condition.value); break;
          }
        }
        if (!matched) return { kind: 'pending' };
      }
      if (shown) describe(node);
    }

    const frames: { selector: FrameSelector; sameOrigin: boolean }[] = [];
    for (const node of visited.nodes) {
      if (frames.length >= 32) break;
      if (!tag(node, 'iframe') || !isVisible(node)) continue;
      const title = frameLabel(node, 'title'), testId = frameLabel(node, 'testId');
      const selector: FrameSelector | undefined = testId && testId.length <= 256 && testId.trim() === testId
        ? { by: 'testId', value: testId } : title && title.length <= 256 ? { by: 'title', value: title } : undefined;
      if (selector) frames.push({ selector, sameOrigin: sameOrigin(node.contentDocument) });
    }
    world.peroBrowserObservation = { id: command.observation, url: doc.URL, targets, chain };
    return { kind: 'observation', url: location.href, title: doc.title.slice(0, 200), nodes,
      truncated: visited.truncated || nodes.length === 160, frames,
      ...(chain.length && { frame: command.frame, frameUrl: doc.URL }) };
  }

  const observation = world.peroBrowserObservation;
  delete world.peroBrowserObservation;
  if (!observation) return reject('The observation is stale. Observe the tab again.');
  const chain = observation.chain;
  let doc = document;
  for (const frame of chain) {
    if (!frame.element.isConnected || frame.element.ownerDocument !== doc ||
        frame.element.contentDocument !== frame.document || !sameOrigin(frame.document) || !isVisible(frame.element))
      return reject('The iframe changed. Observe it again.');
    doc = frame.document;
  }
  if (observation.url !== doc.URL) return reject('The observation is stale. Observe the tab again.');
  const viewport = doc.defaultView!;
  if (command.action === 'scroll') {
    if (observation.id !== command.observationId) return reject('The observation is stale. Observe the tab again.');
    for (const [x, y] of [[.5, .5], [.25, .5], [.75, .5], [.5, .25], [.5, .75]]) {
      const point = { x: Math.floor(viewport.innerWidth * x), y: Math.floor(viewport.innerHeight * y) };
      const hit = hitAt(doc, point);
      if (!hit || frameTags.includes(hit.tagName)) continue;
      const translated = topPoint(point, chain);
      if (translated) return { kind: 'point', point: translated };
    }
    return reject('The selected document has no visible scroll target.');
  }

  const target = observation.targets.get(command.ref);
  if (!target || target.node.ownerDocument !== doc || !target.node.isConnected ||
      hidden(target.node) || !visible(target.node) || sensitive(target.node) ||
      role(target.node) !== target.role || name(target.node).slice(0, 160) !== target.name)
    return reject('The reference is stale. Observe the tab again.');

  const node = target.node;
  if (command.action === 'scrollIntoView') {
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    return { kind: 'dispatched' };
  }
  const change = () => {
    node.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (command.action === 'upload') {
    if (!fileInput(node) || disabled(node)) return reject('Choose an enabled file input.');
    if (!node.multiple && command.files.length > 1) return reject('The file input accepts one attachment.');
    const transfer = new DataTransfer();
    for (const file of command.files) {
      const bytes = Uint8Array.from(atob(file.base64), byte => byte.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: file.mediaType }));
    }
    node.files = transfer.files;
    change();
    return { kind: 'dispatched' };
  }
  let downloadUrl: string | undefined;
  if (command.action === 'download') {
    if (tag(node, 'a') && node.hasAttribute('href') && !disabled(node)) {
      if (!node.href.startsWith('blob:')) return { kind: 'download', url: node.href, name: node.download || undefined };
      if (!URL.canParse(node.href) || new URL(node.href).origin !== origin || !node.hasAttribute('download'))
        return reject('Choose a same-origin Blob link with a download attribute.');
      if (command.linksOnly) return { kind: 'download', url: node.href, name: node.download || undefined };
      downloadUrl = node.href;
    } else if (command.linksOnly || target.role !== 'button' || !clickable(node, target.role)) {
      return reject(command.linksOnly ? 'Choose an observed download link.' : 'Choose an observed download link or enabled button.');
    }
  }
  if (command.action === 'fill') {
    if (!editable(node)) return reject('The target is not an editable plain-text field.');
    if (editingHost(node)) node.innerText = command.text;
    else {
      const prototype = tag(node, 'textarea') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, command.text);
    }
    change();
    return { kind: 'dispatched' };
  }
  if (command.action === 'setChecked') {
    if (!checkable(node) || disabled(node) || (node.type === 'radio' && !command.checked))
      return reject('The target cannot be set to the requested checked state.');
    if (node.checked !== command.checked || node.indeterminate) {
      node.checked = command.checked;
      node.indeterminate = false;
      change();
    }
    return { kind: 'dispatched' };
  }
  if (command.action === 'selectOption') {
    if (!tag(node, 'select') || disabled(node)) return reject('The target is not an enabled select.');
    const values = Array.isArray(command.value) ? command.value : [command.value];
    if (!node.multiple && values.length !== 1) return reject('A single select requires exactly one option.');
    const wanted = new Set(values);
    const options = Array.from(node.options);
    const matches = options.filter(option => wanted.has(option.value));
    if (matches.length !== values.length || new Set(matches.map(option => option.value)).size !== values.length || matches.some(disabled))
      return reject('An option is missing, ambiguous or disabled.');
    if (options.some(option => option.selected !== wanted.has(option.value))) {
      if (node.multiple) for (const option of options) option.selected = wanted.has(option.value);
      else matches[0].selected = true;
      change();
    }
    return { kind: 'dispatched' };
  }

  if (command.action === 'click' && !clickable(node, target.role)) return reject('The target is unavailable for a click.');
  if ((command.action === 'hover' || command.action === 'dblclick') &&
      (!pointerTarget(node, target.role, target.name) || (command.action === 'dblclick' && disabled(node))))
    return reject('The target is unavailable for that pointer input.');
  if (command.action === 'press' && !clickable(node, target.role) && !editable(node))
    return reject('The target is unavailable for a key press.');
  if (command.action === 'typeSequentially' && !editable(node)) return reject('The target is not an editable plain-text field.');
  if (command.action === 'click' || command.action === 'dblclick' || command.action === 'download' ||
      (command.action === 'press' && (command.key === 'Enter' || command.key === 'Space'))) {
    const inScope = (url: string) => {
      if (!URL.canParse(url, doc.baseURI)) return false;
      const target = new URL(url, doc.baseURI);
      return target.origin === origin && !target.username && !target.password && ['https:', 'http:'].includes(target.protocol);
    };
    let link: HTMLAnchorElement | undefined;
    let control: HTMLButtonElement | HTMLInputElement | undefined;
    for (let parent: Element | null = node; parent; parent = semantics.parent(parent)) {
      if (!link && tag(parent, 'a') && parent.hasAttribute('href')) link = parent;
      if (!control && (tag(parent, 'input') || tag(parent, 'button'))) control = parent;
    }
    let submit = control && ['submit', 'image'].includes(control.type) ? control : undefined;
    const implicitForm = command.action === 'press' && command.key === 'Enter' && tag(control, 'input') ? control.form : null;
    const formRoot = implicitForm?.getRootNode();
    if (!submit && formRoot && semantics.rootWithIds(formRoot))
      submit = Array.from(formRoot.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input'))
        .find(element => element.form === implicitForm && ['submit', 'image'].includes(element.type));
    const form = submit?.form || implicitForm;
    const baseTarget = doc.querySelector('base[target]')?.getAttribute('target') || '_self';
    if (link) {
      const target = (link.target || baseTarget).toLowerCase();
      const popup = target === '_blank' && (command.action === 'click' || command.action === 'press');
      if ((target !== '_self' && !popup) || (downloadUrl ? link.href !== downloadUrl : link.hasAttribute('download') || !inScope(link.href)))
        return reject('This link leaves the authorized tab or site.');
    }
    if (form && ((submit?.getAttribute('formtarget') || form.target || baseTarget).toLowerCase() !== '_self' ||
        !inScope(submit?.getAttribute('formaction') ?? form.action)))
      return reject('This form leaves the authorized tab or site.');
  }

  if (command.action === 'press' || command.action === 'typeSequentially') {
    if (command.action === 'press' || !command.recheck) node.focus({ preventScroll: true });
    const root = node.getRootNode();
    if (!semantics.rootWithIds(root) || root.activeElement !== node)
      return reject('The observed element could not receive keyboard focus.');
    for (const { element } of chain) {
      const parentRoot = element.getRootNode();
      if (!semantics.rootWithIds(parentRoot) || parentRoot.activeElement !== element)
        return reject('The iframe could not receive keyboard focus.');
    }
    if (command.action === 'typeSequentially') world.peroBrowserObservation = observation;
    return { kind: 'focused' };
  }

  const rect = node.getBoundingClientRect();
  const left = Math.max(0, rect.left), right = Math.min(rect.right, viewport.innerWidth);
  const top = Math.max(0, rect.top), bottom = Math.min(rect.bottom, viewport.innerHeight);
  if (right <= left || bottom <= top) return reject('The element is outside the viewport. Scroll and observe again.');
  const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
  for (let hit = hitAt(doc, point); hit; hit = semantics.parent(hit)) {
    if (hit === node) {
      const translated = topPoint(point, chain);
      if (!translated) return reject('The iframe is covered or transformed.');
      if (command.action === 'dblclick' && !command.recheck) world.peroBrowserObservation = observation;
      return { kind: 'point', point: translated, ...(downloadUrl && { downloadUrl }) };
    }
    if (sensitive(hit) || fileInput(hit) || frameTags.includes(hit.tagName) || clickable(hit, role(hit)) || editable(hit)) break;
  }
  return reject('The element is covered or cannot receive pointer input.');
}

export function documentScript(origin: string, command: DocumentCommand) {
  return `(${useDocument.toString()})(${JSON.stringify(origin)}, ${JSON.stringify(command)}, (${domSemantics.toString()})())`;
}
