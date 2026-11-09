// The engine has no public tokenizer or AST API. This pinned dependency module is
// the lexer used by FormulaParser.parse, not a second formula grammar.
// @ts-expect-error fast-formula-parser publishes no TypeScript declarations.
import lexer from 'fast-formula-parser/grammar/lexing.js';

export interface FormulaToken { kind: string; text: string; start: number; end: number }
export interface FormulaSyntaxNode { token: FormulaToken; children?: FormulaSyntaxNode[] }
export interface FormulaSyntax {
  tokens: FormulaToken[];
  structure: FormulaSyntaxNode[];
  error: string | null;
  representation: 'engine-tokens-and-delimiter-groups';
}
/** Offsets are zero-based, half-open positions in the original source.
 * The evaluator uses embedded actions and does not produce an AST. Grouping
 * delimiters is a lexical view only: it does not assert operator precedence,
 * function arity, validity or evaluation order.
 */
export function inspectFormulaSyntax(source: string): FormulaSyntax {
  const result: FormulaSyntax = { tokens: [], structure: [], error: null, representation: 'engine-tokens-and-delimiter-groups' };
  if (!source.startsWith('=')) return result;
  const body = source.slice(1).trim(), offset = source.indexOf(body, 1);
  try {
    const lexed = lexer.lex(body) as { tokens: { image: string; startOffset: number; endOffset: number; tokenType: { name: string } }[] };
    result.tokens = lexed.tokens.map(token => ({ kind: token.tokenType.name, text: token.image, start: token.startOffset + offset, end: token.endOffset + offset + 1 }));
    const stack: { nodes: FormulaSyntaxNode[]; closing: string }[] = [{ nodes: result.structure, closing: '' }];
    for (const token of result.tokens) {
      const node: FormulaSyntaxNode = { token };
      stack[stack.length - 1].nodes.push(node);
      if (token.text === '(' || token.text.endsWith('(') && /Function/.test(token.kind) || token.text === '{') {
        node.children = [];
        stack.push({ nodes: node.children, closing: token.text === '{' ? '}' : ')' });
      } else if (token.text === ')' || token.text === '}') {
        if (stack.length === 1 || stack[stack.length - 1].closing !== token.text) result.error = 'Unmatched closing delimiter.';
        else stack.pop();
      }
    }
    if (stack.length > 1) result.error = 'Unclosed delimiter.';
  } catch (cause) {
    result.error = cause instanceof Error ? cause.message : String(cause);
  }
  return result;
}
