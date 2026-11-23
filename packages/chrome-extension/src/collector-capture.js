// Ported from Point collector-capture.mjs. Runs in the approved main frame.
export function readVisiblePage(scope, maximumCharacters) {
  if (!['text/html', 'application/xhtml+xml'].includes(document.contentType) || !document.body)
    return { error: 'unsupported-document' };
  const excluded = 'script,style,noscript,template,iframe,frame,object,embed,form,input,textarea,select,option,button,[contenteditable],[role="textbox"],[hidden],[inert],[aria-hidden="true"]';
  const isVisible = element => {
    if (!element || element.closest(excluded)) return false;
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
    }
    return true;
  };
  const selection = scope === 'selection' ? getSelection() : null;
  if (scope === 'selection' && (!selection?.rangeCount || selection.isCollapsed)) return { error: 'empty-selection' };
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const main = range ? document.body : [...document.querySelectorAll('article,main,[role="main"]')].find(isVisible) ?? document.body;
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let node, content = '', previousBlock = null, visited = 0, truncated = false;
  while ((node = walker.nextNode())) {
    if (++visited > 50000) { truncated = true; break; }
    if (!isVisible(node.parentElement) || range && !range.intersectsNode(node)) continue;
    let text = node.textContent ?? '';
    if (range?.endContainer === node) text = text.slice(0, range.endOffset);
    if (range?.startContainer === node) text = text.slice(range.startOffset);
    text = text.replace(/\s+/g, ' ');
    if (!text.trim()) continue;
    const block = node.parentElement.closest('p,li,pre,blockquote,h1,h2,h3,h4,h5,h6,section,div,article,main,td,th,tr');
    const addition = `${content && previousBlock !== block ? '\n\n' : ''}${text}`;
    if (content.length + addition.length > maximumCharacters) {
      content += addition.slice(0, maximumCharacters - content.length); truncated = true; break;
    }
    content += addition; previousBlock = block;
  }
  content = content.trim();
  if (!content) return { error: scope === 'selection' ? 'empty-selection' : 'empty-page' };
  return { url: location.href, title: document.title.slice(0, 512), content, captureScope: scope, truncated };
}
