import type { FormulaToken } from './formula-syntax.ts';

interface Span { start: number; end: number }
/** Original source-only tree. Never used to calculate, resolve names or rewrite
 * worksheets. Source spans retain quoting, absolute markers and parentheses. */
export type FormulaSourceNode = Span & (
  | { kind: 'literal'; literal: 'number' | 'string' | 'boolean' | 'error'; text: string }
  | { kind: 'reference'; text: string }
  | { kind: 'qualified'; sheet: string; reference: FormulaSourceNode }
  | { kind: 'unary' | 'postfix'; operator: string; operand: FormulaSourceNode }
  | { kind: 'binary' | 'range' | 'intersection'; operator: string; left: FormulaSourceNode; right: FormulaSourceNode }
  | { kind: 'group'; expression: FormulaSourceNode }
  | { kind: 'union'; items: FormulaSourceNode[] }
  | { kind: 'call'; name: string; arguments: (FormulaSourceNode | null)[] }
  | { kind: 'array'; rows: FormulaSourceNode[][] }
);
export type FormulaSourceAst =
  | { status: 'supported'; representation: 'pero-source-expression-v1'; root: FormulaSourceNode }
  | { status: 'unsupported' | 'invalid' | 'not-formula'; representation: 'pero-source-expression-v1'; detail: string };

// Excel-style precedence as implemented by the pinned engine: unary/percent bind
// before exponentiation, and exponentiation is left-associative. This source
// parser consumes engine tokens, not a copied lexer or an alternate evaluator.
const precedence: Record<string, number> = { '=': 10, '<>': 10, '<': 10, '>': 10, '<=': 10, '>=': 10, '&': 20, '+': 30, '-': 30, '*': 40, '/': 40, '^': 50, '%': 60, ':': 90 };
const literals: Record<string, 'number' | 'string' | 'boolean' | 'error'> = { Number: 'number', String: 'string', Boolean: 'boolean', FormulaErrorT: 'error', RefError: 'error' };
const operands = new Set(['Number', 'String', 'Boolean', 'FormulaErrorT', 'RefError', 'Cell', 'Column', 'Sheet', 'SheetQuoted', 'Function', 'OpenParen', 'OpenCurlyParen']);
class SyntaxIssue extends Error {
  readonly status: 'unsupported' | 'invalid';
  constructor(status: 'unsupported' | 'invalid', message: string) { super(message); this.status = status; }
}

/** Supports ordinary operators, calls/omitted arguments, references and sheet
 * qualifiers, range/intersection/union syntax, parentheses and constant arrays.
 * Names, special reference functions, external/structured references, unsupported
 * engine tokens and excessive nesting fail explicitly, without a guessed tree.
 * Engine evaluation remains the authority for arity, reference validity/errors. */
export function formulaSourceAst(tokens: readonly FormulaToken[]): FormulaSourceAst {
  let offset = 0, depth = 0;
  const issue = (detail: string): never => { throw new SyntaxIssue('invalid', `${detail} At source offset ${tokens[offset]?.start ?? tokens.at(-1)?.end ?? 1}.`); };
  const take = (text?: string): FormulaToken => {
    const token = tokens[offset];
    if (!token || text !== undefined && token.text !== text) return issue(`Expected ${text ?? 'an expression'}.`);
    offset++; return token;
  };
  const startsOperand = (token?: FormulaToken) => token && operands.has(token.kind);
  const expression = (minimum = 0): FormulaSourceNode => {
    if (++depth > 128) throw new SyntaxIssue('unsupported', 'Source tree nesting exceeds 128 levels.');
    let left = primary();
    while (offset < tokens.length) {
      const token = tokens[offset];
      const intersection = startsOperand(token) && token.start > left.end;
      const level = intersection ? 80 : precedence[token.text];
      if (level === undefined || level < minimum) break;
      if (token.text === '%') {
        if (left.kind === 'postfix') issue('Repeated percent operators are not supported by the engine.');
        take(); left = { kind: 'postfix', operator: '%', operand: left, start: left.start, end: token.end }; continue;
      }
      if (!intersection) take();
      const right = expression(level + 1);
      left = { kind: intersection ? 'intersection' : token.text === ':' ? 'range' : 'binary', operator: intersection ? ' ' : token.text,
        left, right, start: left.start, end: right.end };
    }
    depth--; return left;
  };
  const constant = (): FormulaSourceNode => {
    const token = take();
    if ((token.text === '+' || token.text === '-') && tokens[offset]?.kind === 'Number') {
      const number = take(), operand: FormulaSourceNode = { kind: 'literal', literal: 'number', text: number.text, start: number.start, end: number.end };
      return { kind: 'unary', operator: token.text, operand, start: token.start, end: number.end };
    }
    if (!literals[token.kind]) return issue('Arrays require literal constants.');
    return { kind: 'literal', literal: literals[token.kind], text: token.text, start: token.start, end: token.end };
  };
  const primary = (): FormulaSourceNode => {
    const token = take(), span = { start: token.start, end: token.end };
    if (token.text === '+' || token.text === '-') {
      const operand = expression(70);
      return { kind: 'unary', operator: token.text, operand, start: token.start, end: operand.end };
    }
    if (literals[token.kind]) return { kind: 'literal', literal: literals[token.kind], text: token.text, ...span };
    if (token.kind === 'Cell' || token.kind === 'Column') return { kind: 'reference', text: token.text, ...span };
    if (token.kind === 'Sheet' || token.kind === 'SheetQuoted') {
      const reference = expression(90);
      return { kind: 'qualified', sheet: token.text, reference, start: token.start, end: reference.end };
    }
    if (token.kind === 'Function') {
      const args: (FormulaSourceNode | null)[] = [];
      while (tokens[offset]?.text !== ')') {
        if (tokens[offset]?.text === ',') { take(); args.push(null); if (tokens[offset]?.text === ')') args.push(null); continue; }
        args.push(expression());
        if (tokens[offset]?.text !== ',') break;
        take(); if (tokens[offset]?.text === ')') args.push(null);
      }
      const end = take(')').end;
      return { kind: 'call', name: token.text.slice(0, -1), arguments: args, start: token.start, end };
    }
    if (token.text === '(') {
      const items = [expression()];
      while (tokens[offset]?.text === ',') { take(); items.push(expression()); }
      const end = take(')').end;
      return items.length === 1 ? { kind: 'group', expression: items[0], start: token.start, end } : { kind: 'union', items, start: token.start, end };
    }
    if (token.text === '{') {
      const rows: FormulaSourceNode[][] = [[constant()]];
      while ([',', ';'].includes(tokens[offset]?.text)) {
        if (take().text === ';') rows.push([]);
        rows[rows.length - 1].push(constant());
      }
      const end = take('}').end;
      return { kind: 'array', rows, start: token.start, end };
    }
    if (token.kind === 'Name' || !['CloseParen', 'CloseCurlyParen', 'Comma', 'Semicolon'].includes(token.kind)) {
      throw new SyntaxIssue('unsupported', `Source tree does not support engine token ${token.kind} (${token.text}).`);
    }
    return issue('Expected an expression.');
  };
  try {
    const root = expression();
    if (offset !== tokens.length) issue(`Unexpected token ${tokens[offset].text}.`);
    return { status: 'supported', representation: 'pero-source-expression-v1', root };
  } catch (cause) {
    if (!(cause instanceof SyntaxIssue)) throw cause;
    return { status: cause.status, representation: 'pero-source-expression-v1', detail: cause.message };
  }
}
