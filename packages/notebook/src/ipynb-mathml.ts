export interface IpynbMathml { readonly html: string }
const tags = new Set('math mi mn mo mrow mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mtd mtext mspace mstyle mpadded mphantom menclose mmultiscripts mprescripts none semantics'.split(' '));
const attrs = new Set('display mathvariant columnalign rowalign width height depth fence stretchy form separator accent largeop symmetric lspace rspace notation'.split(' '));
/** A bounded presentation-only grammar, never browser interpretation of arbitrary XML. */
export function parseIpynbMathml(source: string): IpynbMathml | undefined {
  if (!source || source.length > 65536) return;
  const tokens = source.match(/<[^>]*>|[^<]+/g) ?? []; if (tokens.join('') !== source || tokens.length > 8192) return;
  const stack: string[] = []; let roots = 0; let html = '';
  for (const token of tokens) {
    if (!token.startsWith('<')) { if (!stack.length && token.trim() || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(token)) return; html += token; continue; }
    const close = /^<\/([a-z]+)\s*>$/.exec(token);
    if (close) { if (stack.pop() !== close[1]) return; html += token; continue; }
    const open = /^<([a-z]+)((?:\s+[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>$/.exec(token);
    if (!open || !tags.has(open[1]) || stack.length > 64) return;
    if (!stack.length && (open[1] !== 'math' || ++roots > 1)) return;
    let attributes = ''; const seen = new Set<string>();
    for (const match of open[2].matchAll(/([a-z]+)\s*=\s*(["'])(.*?)\2/g)) {
      const [, name, , value] = match; if (seen.has(name)) return; seen.add(name);
      if (name === 'xmlns' && !stack.length && value === 'http://www.w3.org/1998/Math/MathML') continue;
      if (!attrs.has(name) || !/^[\w .%+\-]*$/.test(value)) return;
      attributes += ` ${name}="${value}"`;
    }
    html += `<${open[1]}${attributes}${open[3]}>`; if (!open[3]) stack.push(open[1]);
  }
  return roots === 1 && !stack.length ? Object.freeze({ html }) : undefined;
}
