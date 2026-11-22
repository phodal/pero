// Adapted from Point browser/src/browser-dom-semantics.mjs at 2449d4b98.
// Serialized into the Pero browser isolated world. Keep the factory self-contained.
export function domSemantics() {
  const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const parent = (node: Element): Element | null => {
    const root = node.getRootNode();
    return node.assignedSlot || node.parentElement || (root instanceof ShadowRoot ? root.host : null);
  };
  function children(node: Node): Node[] {
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true });
      if (assigned.length) return assigned;
    }
    return Array.from(((node instanceof Element && node.shadowRoot) || node).childNodes);
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
    if (node instanceof Element && (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(node.tagName) || (!includeHidden && hidden(node)))) return '';
    return normalize(children(node).map(child => text(child, includeHidden, seen)).join(' '));
  }
  const roles = new Set(('alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem').split(' '));
  function role(node: Element): string {
    const explicit = (node.getAttribute('role') || '').split(/\s+/).find(value => roles.has(value));
    if (explicit) return explicit;
    const tag = node.tagName;
    if (node instanceof HTMLInputElement) return ({ checkbox: 'checkbox', radio: 'radio', number: 'spinbutton', range: 'slider', button: 'button', submit: 'button', reset: 'button', image: 'button', search: node.hasAttribute('list') ? 'combobox' : 'searchbox', email: 'textbox', tel: 'textbox', url: 'textbox', text: node.hasAttribute('list') ? 'combobox' : 'textbox' } as Record<string, string>)[node.type] || '';
    if (tag === 'A' || tag === 'AREA') return node.hasAttribute('href') ? 'link' : '';
    if (node instanceof HTMLSelectElement) return node.multiple || node.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'TH') return node.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'IMG' && node.getAttribute('alt') === '' && !node.hasAttribute('aria-label') && !node.hasAttribute('aria-labelledby')) return 'presentation';
    return ({ BUTTON: 'button', TEXTAREA: 'textbox', OPTION: 'option', OPTGROUP: 'group', IMG: 'img', UL: 'list', OL: 'list', LI: 'listitem', TABLE: 'table', TR: 'row', TD: 'cell', THEAD: 'rowgroup', TBODY: 'rowgroup', TFOOT: 'rowgroup', NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', ARTICLE: 'article', DIALOG: 'dialog', PROGRESS: 'progressbar', METER: 'meter', HR: 'separator', FIELDSET: 'group', DETAILS: 'group', SUMMARY: 'button' } as Record<string, string>)[tag] || '';
  }
  const contentNames = new Set('button cell checkbox columnheader gridcell heading link menuitem menuitemcheckbox menuitemradio option radio row rowheader switch tab tooltip treeitem'.split(' '));
  function name(node: Element, referenced = false, seen = new Set<Element>(), fromId = false): string {
    if (seen.has(node)) return '';
    seen = new Set(seen); seen.add(node);
    if (!referenced && hidden(node)) return '';
    const ids = normalize(node.getAttribute('aria-labelledby')).split(' ').filter(Boolean);
    const root = node.getRootNode();
    const refs = root instanceof Document || root instanceof ShadowRoot
      ? ids.map(id => root.getElementById(id)).filter(ref => ref !== null) : [];
    if (!fromId && refs.length) return normalize(refs.map(ref => ref === node ? nameFrom(node, true, seen) : name(ref, true, seen, true)).join(' '));
    return nameFrom(node, referenced, seen);
  }
  function nameFrom(node: Element, referenced: boolean, seen: Set<Element>): string {
    const aria = normalize(node.getAttribute('aria-label'));
    if (aria) return aria;
    if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLButtonElement || node instanceof HTMLSelectElement) && node.labels?.length) return normalize(Array.from(node.labels, label => text(label, true)).join(' '));
    if (['IMG', 'AREA'].includes(node.tagName) || (node instanceof HTMLInputElement && node.type === 'image')) return normalize(node.getAttribute('alt') ?? node.getAttribute('title'));
    if (node instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(node.type))
      return normalize(node.value || ({ submit: 'Submit', reset: 'Reset' } as Record<string, string>)[node.type]);
    const nativeLabel = ({ FIELDSET: 'legend', TABLE: 'caption', FIGURE: 'figcaption' } as Record<string, string>)[node.tagName];
    if (nativeLabel) {
      const label = Array.from(node.children).find(child => child.localName === nativeLabel);
      if (label) return text(label, true);
    }
    if (referenced || contentNames.has(role(node))) {
      const content = normalize(children(node).map(child => {
        if (!(child instanceof Element)) return text(child, referenced);
        if (!referenced && hidden(child)) return '';
        if (child.tagName === 'IMG' || child.hasAttribute('aria-label') || child.hasAttribute('aria-labelledby')) return name(child, referenced, seen);
        return text(child, referenced);
      }).join(' '));
      if (content) return content;
    }
    return normalize(node.getAttribute('title') || (['INPUT', 'TEXTAREA'].includes(node.tagName) ? node.getAttribute('placeholder') : ''));
  }
  return { normalize, parent, hidden, visible, role, name };
}
