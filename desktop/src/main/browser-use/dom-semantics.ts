// Adapted from Point browser/src/browser-dom-semantics.mjs at 2449d4b98.
// Serialized into the Pero browser isolated world. Keep the factory self-contained.
export function domSemantics() {
  const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
  // Use DOM brands that work for nodes from other same-origin frame realms.
  function tag<K extends keyof HTMLElementTagNameMap>(node: Element | null | undefined, localName: K): node is HTMLElementTagNameMap[K] {
    return node?.namespaceURI === 'http://www.w3.org/1999/xhtml' && node.localName === localName;
  }
  const html = (node: Element): node is HTMLElement => node.namespaceURI === 'http://www.w3.org/1999/xhtml';
  const rootWithIds = (node: Node): node is Document | ShadowRoot =>
    node.nodeType === 9 || (node.nodeType === 11 && 'host' in node);
  const parent = (node: Element): Element | null => {
    const root = node.getRootNode();
    return node.assignedSlot || node.parentElement || (root.nodeType === 11 && rootWithIds(root) ? (root as ShadowRoot).host : null);
  };
  function editingHost(node: Element): node is HTMLElement {
    if (!html(node) || !node.hasAttribute('contenteditable') || !node.isContentEditable) return false;
    const ancestor = parent(node);
    return !ancestor || !html(ancestor) || !ancestor.isContentEditable;
  }
  function children(node: Node): Node[] {
    if (node.nodeType === 1 && tag(node as Element, 'slot')) {
      const assigned = (node as HTMLSlotElement).assignedNodes({ flatten: true });
      if (assigned.length) return assigned;
    }
    return Array.from(((node.nodeType === 1 && (node as Element).shadowRoot) || node).childNodes);
  }
  function hidden(node: Element) {
    for (let n: Element | null = node; n?.nodeType === 1; n = parent(n)) {
      if (n.hasAttribute('hidden') || n.hasAttribute('inert') || n.getAttribute('aria-hidden') === 'true') return true;
      const style = getComputedStyle(n);
      if (style.display === 'none' || style.contentVisibility === 'hidden') return true;
    }
    const style = getComputedStyle(node);
    return style.visibility === 'hidden' || style.visibility === 'collapse';
  }
  function visible(node: Element) {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none';
  }
  function text(node: Node, includeHidden = true, seen = new Set<Node>()): string {
    if (seen.has(node)) return '';
    seen.add(node);
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType === 1 && (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes((node as Element).tagName) || (!includeHidden && hidden(node as Element)))) return '';
    return normalize(children(node).map(child => text(child, includeHidden, seen)).join(' '));
  }
  const roles = new Set(('alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem').split(' '));
  function role(node: Element): string {
    const explicit = (node.getAttribute('role') || '').split(/\s+/).find(value => roles.has(value));
    if (explicit) return explicit;
    if (editingHost(node)) return 'textbox';
    const elementTag = node.tagName;
    if (tag(node, 'input')) return ({ checkbox: 'checkbox', radio: 'radio', number: 'spinbutton', range: 'slider', button: 'button', submit: 'button', reset: 'button', image: 'button', search: node.hasAttribute('list') ? 'combobox' : 'searchbox', email: 'textbox', tel: 'textbox', url: 'textbox', text: node.hasAttribute('list') ? 'combobox' : 'textbox' } as Record<string, string>)[node.type] || '';
    if (elementTag === 'A' || elementTag === 'AREA') return node.hasAttribute('href') ? 'link' : '';
    if (tag(node, 'select')) return node.multiple || node.size > 1 ? 'listbox' : 'combobox';
    if (elementTag === 'TH') return node.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
    if (/^H[1-6]$/.test(elementTag)) return 'heading';
    if (elementTag === 'IMG' && node.getAttribute('alt') === '' && !node.hasAttribute('aria-label') && !node.hasAttribute('aria-labelledby')) return 'presentation';
    return ({ BUTTON: 'button', TEXTAREA: 'textbox', OPTION: 'option', OPTGROUP: 'group', IMG: 'img', UL: 'list', OL: 'list', LI: 'listitem', TABLE: 'table', TR: 'row', TD: 'cell', THEAD: 'rowgroup', TBODY: 'rowgroup', TFOOT: 'rowgroup', NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', ARTICLE: 'article', DIALOG: 'dialog', PROGRESS: 'progressbar', METER: 'meter', HR: 'separator', FIELDSET: 'group', DETAILS: 'group', SUMMARY: 'button' } as Record<string, string>)[elementTag] || '';
  }
  const contentNames = new Set('button cell checkbox columnheader gridcell heading link menuitem menuitemcheckbox menuitemradio option radio row rowheader switch tab tooltip treeitem'.split(' '));
  function name(node: Element, referenced = false, seen = new Set<Element>(), fromId = false): string {
    if (seen.has(node)) return '';
    seen = new Set(seen); seen.add(node);
    if (!referenced && hidden(node)) return '';
    const ids = normalize(node.getAttribute('aria-labelledby')).split(' ').filter(Boolean);
    const root = node.getRootNode();
    const refs = rootWithIds(root)
      ? ids.map(id => root.getElementById(id)).filter(ref => ref !== null) : [];
    if (!fromId && refs.length) return normalize(refs.map(ref => ref === node ? nameFrom(node, true, seen) : name(ref, true, seen, true)).join(' '));
    return nameFrom(node, referenced, seen);
  }
  function nameFrom(node: Element, referenced: boolean, seen: Set<Element>): string {
    const aria = normalize(node.getAttribute('aria-label'));
    if (aria) return aria;
    if ((tag(node, 'input') || tag(node, 'textarea') || tag(node, 'button') || tag(node, 'select')) && node.labels?.length)
      return normalize(Array.from(node.labels, label => text(label, true, new Set<Node>([node]))).join(' '));
    if (['IMG', 'AREA'].includes(node.tagName) || (tag(node, 'input') && node.type === 'image')) return normalize(node.getAttribute('alt') ?? node.getAttribute('title'));
    if (tag(node, 'input') && ['button', 'submit', 'reset'].includes(node.type))
      return normalize(node.value || ({ submit: 'Submit', reset: 'Reset' } as Record<string, string>)[node.type]);
    const nativeLabel = ({ FIELDSET: 'legend', TABLE: 'caption', FIGURE: 'figcaption' } as Record<string, string>)[node.tagName];
    if (nativeLabel) {
      const label = Array.from(node.children).find(child => child.localName === nativeLabel);
      if (label) return text(label, true);
    }
    if (referenced || contentNames.has(role(node))) {
      const content = normalize(children(node).map(child => {
        if (child.nodeType !== 1) return text(child, referenced);
        const element = child as Element;
        if (!referenced && hidden(element)) return '';
        if (element.tagName === 'IMG' || element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby')) return name(element, referenced, seen);
        return text(child, referenced);
      }).join(' '));
      if (content) return content;
    }
    return normalize(node.getAttribute('title') || (['INPUT', 'TEXTAREA'].includes(node.tagName) ? node.getAttribute('placeholder') : ''));
  }
  function label(node: Element) {
    const hasLabel = node.hasAttribute('aria-label') || node.hasAttribute('aria-labelledby') ||
      ((tag(node, 'input') || tag(node, 'textarea') || tag(node, 'button') || tag(node, 'select')) && !!node.labels?.length);
    return hasLabel ? name(node, true) : undefined;
  }
  return { normalize, parent, hidden, visible, text, role, name, label, tag, html, rootWithIds, editingHost };
}
