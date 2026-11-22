/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Parser from 'web-tree-sitter';
import { carriedReferenceEdits, carriedVarEdits } from './cell-bindings.ts';
export type NodeReplBindingKind = 'const' | 'let' | 'var';
export interface NodeReplBindingDescriptor {
  name: string;
  kind: NodeReplBindingKind;
}

export interface PreparedNodeReplCell {
  source: string;
  bindings: readonly NodeReplBindingDescriptor[];
}

export interface PrepareNodeReplCellOptions {
  previousBindings: readonly NodeReplBindingDescriptor[];
  cellId: string;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

const MAX_CELL_SOURCE_CHARS = 4 * 1024 * 1024;
const MAX_CELL_BINDINGS = 10_000;
const MAX_BINDING_NAME_CHARS = 4 * 1024 * 1024;
const MAX_SNAPSHOT_ASSIGNMENTS = 200_000;
const MAX_TRANSFORMED_SOURCE_CHARS = 32 * 1024 * 1024;

const RESERVED_GLOBAL_NAMES = new Set(['nodeRepl', 'console', 'cua']);
let parserInstance: Promise<Parser> | undefined;

function getParser(): Promise<Parser> {
  return parserInstance ??= (async () => {
    const wasmBinary = await readFile(join(__dirname, 'repl-tree-sitter.wasm'));
    await Parser.init({ wasmBinary });
    const grammar = await Parser.Language.load(await readFile(join(__dirname, 'repl-javascript.wasm')));
    const parser = new Parser();
    parser.setLanguage(grammar);
    return parser;
  })();
}

function decodeIdentifierName(source: string): string {
  return source.replace(
    /\\u(?:\{([0-9A-Fa-f]+)\}|([0-9A-Fa-f]{4}))/g,
    (_match, braced: string | undefined, fixed: string | undefined) =>
      String.fromCodePoint(Number.parseInt(braced ?? fixed!, 16)),
  );
}

function collectPatternNames(
  node: Parser.SyntaxNode,
  names: Set<string>,
): void {
  switch (node.type) {
    case 'identifier':
    case 'shorthand_property_identifier_pattern':
      names.add(decodeIdentifierName(node.text));
      return;
    case 'assignment_pattern':
    case 'object_assignment_pattern': {
      const left = node.childForFieldName('left');
      if (left) collectPatternNames(left, names);
      return;
    }
    case 'pair_pattern': {
      const value = node.childForFieldName('value');
      if (value) collectPatternNames(value, names);
      return;
    }
    case 'array_pattern':
    case 'object_pattern':
    case 'rest_pattern':
      for (const child of node.namedChildren) {
        collectPatternNames(child, names);
      }
      return;
    default:
      return;
  }
}

function addPatternBindings(
  pattern: Parser.SyntaxNode,
  kind: NodeReplBindingKind,
  bindings: Map<string, NodeReplBindingKind>,
): void {
  const names = new Set<string>();
  collectPatternNames(pattern, names);
  for (const name of names) bindings.set(name, kind);
}

function collectDeclarationNames(
  node: Parser.SyntaxNode,
  bindings: Map<string, NodeReplBindingKind>,
): void {
  switch (node.type) {
    case 'lexical_declaration': {
      const kind = node.text.trimStart().startsWith('const') ? 'const' : 'let';
      for (const declarator of node.namedChildren) {
        if (declarator.type !== 'variable_declarator') continue;
        const name = declarator.childForFieldName('name');
        if (name) addPatternBindings(name, kind, bindings);
      }
      return;
    }
    case 'variable_declaration':
      for (const declarator of node.namedChildren) {
        if (declarator.type !== 'variable_declarator') continue;
        const name = declarator.childForFieldName('name');
        if (name) addPatternBindings(name, 'var', bindings);
      }
      return;
    case 'function_declaration':
    case 'generator_function_declaration': {
      const name = node.childForFieldName('name');
      if (name) bindings.set(decodeIdentifierName(name.text), 'let');
      return;
    }
    case 'class_declaration': {
      const name = node.childForFieldName('name');
      if (name) bindings.set(decodeIdentifierName(name.text), 'let');
      return;
    }
    default:
      return;
  }
}

/**
 * Node types that introduce a new function scope. `var` declarations inside
 * these belong to that inner scope, not to the module, so the hoisting walk
 * stops here.
 */
const FUNCTION_SCOPE_NODE_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'generator_function',
  'generator_function_declaration',
  'arrow_function',
  'method_definition',
  'class_static_block',
]);

/**
 * Collects every `var` binding that hoists to module scope from a top-level
 * statement, including ones nested in blocks, `if`/`try`/loop bodies and
 * labelled statements. Recursion stops at function boundaries.
 *
 * `const`/`let` (`lexical_declaration`) are intentionally NOT collected here:
 * they are block-scoped and only persist when declared at the top level, which
 * `collectDeclarationNames` already handles.
 */
function collectTopLevelLoopVarBindings(
  node: Parser.SyntaxNode,
  bindings: Map<string, NodeReplBindingKind>,
): void {
  if (FUNCTION_SCOPE_NODE_TYPES.has(node.type)) return;

  if (node.type === 'variable_declaration') {
    collectDeclarationNames(node, bindings);
    return;
  }

  if (node.type === 'for_statement') {
    const initializer = node.childForFieldName('initializer');
    if (initializer?.type === 'variable_declaration') {
      collectDeclarationNames(initializer, bindings);
    }
    // Fall through: the loop body may contain further hoisting `var`s.
  }

  if (node.type === 'for_in_statement') {
    const kind = node.childForFieldName('kind');
    const left = node.childForFieldName('left');
    if (kind?.text === 'var' && left) {
      addPatternBindings(left, 'var', bindings);
    }
  }

  for (const child of node.namedChildren) {
    collectTopLevelLoopVarBindings(child, bindings);
  }
}

function generatedPrefix(
  root: Parser.SyntaxNode,
  cellId: string,
  previousBindings: readonly NodeReplBindingDescriptor[],
): string {
  const suffix = cellId.replace(/[^A-Za-z0-9_$]/g, '').slice(-24) || 'cell';
  const stem = `__qwen_repl_${suffix}_`;
  const forbidden = new Set<string>();
  const maxDiscriminatorLength = (
    root.endIndex + previousBindings.length
  ).toString(36).length;

  const inspectName = (name: string) => {
    if (!name.startsWith(stem)) return;
    const end = name.indexOf('_', stem.length);
    if (end <= stem.length || end - stem.length > maxDiscriminatorLength) {
      return;
    }
    const discriminator = name.slice(stem.length, end);
    if (/^[0-9a-z]+$/.test(discriminator)) forbidden.add(discriminator);
  };
  for (const { name } of previousBindings) inspectName(name);

  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (
      node.type === 'identifier' ||
      node.type === 'shorthand_property_identifier' ||
      node.type === 'shorthand_property_identifier_pattern'
    ) {
      inspectName(decodeIdentifierName(node.text));
    }
    for (const child of node.namedChildren) pending.push(child);
  }
  for (let index = 0; index <= forbidden.size; index++) {
    const discriminator = index.toString(36);
    if (!forbidden.has(discriminator)) {
      return `${stem}${discriminator}_`;
    }
  }
  throw new Error('Unable to allocate collision-free REPL identifiers');
}

function snapshotAssignments(
  snapshotName: string,
  references: string,
  bindings: Iterable<NodeReplBindingDescriptor>,
  maxChars: number,
): string {
  const assignments: string[] = [];
  let length = 0;
  for (const { name } of bindings) {
    const key = JSON.stringify(name);
    const assignment = `${snapshotName}[${key}] = {binding:${references}[${key}],value:${references}[${key}].value};`;
    length += assignment.length + 1;
    if (length > maxChars) {
      throw new Error('Transformed JavaScript cell exceeds the sanity limit');
    }
    assignments.push(assignment);
  }
  // Joined without newlines: this text is injected between the user's
  // statements, so any newline here would shift every subsequent line number in
  // reported stack traces (and the shift would grow with the binding count).
  // Each assignment already ends in ';'.
  return assignments.length > 0 ? assignments.join('') : '';
}

function snapshotDeclarator(
  helperName: string,
  snapshotName: string,
  references: string,
  bindings: Iterable<NodeReplBindingDescriptor>,
  maxChars: number,
): string {
  const assignments = [...bindings].map(({ name }) => {
    const key = JSON.stringify(name);
    return `${snapshotName}[${key}] = {binding:${references}[${key}],value:${references}[${key}].value}`;
  });
  const expression =
    assignments.length > 0
      ? `${assignments.join(', ')}, undefined`
      : 'undefined';
  const text = `, ${helperName} = (${expression})`;
  if (text.length > maxChars) {
    throw new Error('Transformed JavaScript cell exceeds the sanity limit');
  }
  return text;
}

function topLevelVariableDeclaration(
  item: Parser.SyntaxNode,
): Parser.SyntaxNode | null {
  if (
    item.type === 'lexical_declaration' ||
    item.type === 'variable_declaration'
  ) {
    return item;
  }
  if (item.type === 'for_statement') {
    const initializer = item.childForFieldName('initializer');
    return initializer?.type === 'variable_declaration' ? initializer : null;
  }
  return null;
}

function declarationKind(declaration: Parser.SyntaxNode): NodeReplBindingKind {
  if (declaration.type === 'variable_declaration') return 'var';
  return declaration.text.trimStart().startsWith('const') ? 'const' : 'let';
}

function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.end - b.end;
  });
  const rewritten: string[] = [];
  let cursor = 0;
  for (const edit of ordered) {
    if (edit.start < cursor || edit.end < edit.start) {
      throw new Error('JavaScript cell transform produced overlapping edits');
    }
    rewritten.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  rewritten.push(source.slice(cursor));
  return rewritten.join('');
}

function isSourceItem(node: Parser.SyntaxNode): boolean {
  return node.type !== 'comment' && node.type !== 'hash_bang_line';
}

export async function prepareNodeReplCell(
  code: string,
  options: PrepareNodeReplCellOptions,
): Promise<PreparedNodeReplCell> {
  if (code.length > MAX_CELL_SOURCE_CHARS) {
    throw new Error(
      `JavaScript cell exceeds the source sanity limit (${MAX_CELL_SOURCE_CHARS} characters)`,
    );
  }
  if (code.startsWith('#!')) {
    throw new Error('node_repl cells do not support hashbang lines');
  }

  const parser = await getParser();
  let tree = parser.parse(code);
  if (!tree) throw new Error('JavaScript parser returned no syntax tree');

  try {
    if (tree.rootNode.hasError) {
      throw new Error('JavaScript syntax could not be parsed safely');
    }
    const carriedNames = new Set(
      options.previousBindings.map(({ name }) => name),
    );
    const carriedVars = carriedVarEdits(
      tree.rootNode,
      carriedNames,
      generatedPrefix(tree.rootNode, options.cellId, options.previousBindings),
    );
    if (carriedVars.edits.length > 0) {
      code = applyEdits(code, carriedVars.edits);
      tree.delete();
      tree = parser.parse(code);
      if (!tree) throw new Error('JavaScript parser returned no syntax tree');
    }
    const root = tree.rootNode;
    if (root.hasError) {
      throw new Error('JavaScript syntax could not be parsed safely');
    }

    const sourceItems = root.namedChildren.filter(isSourceItem);
    if (sourceItems.some(item => item.type === 'import_statement' || item.type === 'export_statement')) {
      throw new Error('REPL cells do not accept import or export declarations.');
    }
    const currentBindings = new Map<string, NodeReplBindingKind>();
    for (const item of sourceItems) {
      collectDeclarationNames(item, currentBindings);
      collectTopLevelLoopVarBindings(item, currentBindings);
    }
    for (const name of carriedVars.privateNames) currentBindings.delete(name);
    // A persisted top-level binding that shadows a host-injected global would
    // permanently break it for the rest of the session (e.g. declaring
    // `nodeRepl` silently disables nodeRepl.write with no way back except a
    // reset). Reject the cell with an actionable message instead.
    const shadowedGlobal = [...currentBindings.keys()].find((name) =>
      RESERVED_GLOBAL_NAMES.has(name),
    );
    if (shadowedGlobal) {
      throw new Error(
        `Cannot declare a top-level binding named '${shadowedGlobal}': it would shadow the node_repl runtime global for the rest of this session. Use a different name.`,
      );
    }

    const previousBindingsByName = new Map<string, NodeReplBindingKind>();
    for (const binding of options.previousBindings) {
      const existing = previousBindingsByName.get(binding.name);
      if (existing && existing !== binding.kind) {
        throw new Error(
          `Previous JavaScript binding '${binding.name}' has conflicting declaration kinds`,
        );
      }
      previousBindingsByName.set(binding.name, binding.kind);
    }
    const previousBindings = [...previousBindingsByName]
      .map(([name, kind]) => ({ name, kind }))
      .sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      );
    const allBindingsByName = new Map(previousBindingsByName);
    for (const [name, kind] of currentBindings) {
      if (!allBindingsByName.has(name)) allBindingsByName.set(name, kind);
    }
    const allBindings = [...allBindingsByName]
      .map(([name, kind]) => ({ name, kind }))
      .sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      );
    if (allBindings.length > MAX_CELL_BINDINGS) {
      throw new Error(
        `JavaScript cell exceeds the ${MAX_CELL_BINDINGS}-binding sanity limit`,
      );
    }
    if (
      allBindings.reduce((total, binding) => total + binding.name.length, 0) >
      MAX_BINDING_NAME_CHARS
    ) {
      throw new Error(
        'JavaScript cell exceeds the cumulative binding-name sanity limit',
      );
    }
    if (
      sourceItems.length * Math.max(1, allBindings.length) >
      MAX_SNAPSHOT_ASSIGNMENTS
    ) {
      throw new Error(
        'JavaScript cell has too many statement-boundary binding snapshots',
      );
    }
    const prefix = generatedPrefix(root, options.cellId, previousBindings);
    const previousNamespace = `${prefix}_previous`;
    const snapshotName = `${prefix}_snapshot`;
    const references = `${prefix}_references`;
    const commit = `${prefix}_finish`;
    const error = `${prefix}_error`;
    const prelude = [
      `(async (${previousNamespace}, ${commit}) => {const ${snapshotName} = { __proto__: null }; try {`,
      `const ${references} = {__proto__:null,${allBindings
        .map(({ name }) => {
          const key = JSON.stringify(name);
          return `[${key}]:${
            previousBindingsByName.has(name)
              ? `${previousNamespace}[${key}]`
              : `{get value(){return ${name};},set value(${prefix}value){${name}=${prefix}value;}}`
          }`;
        })
        .join(',')}};`,
      ...previousBindings.map(
        ({ name }) =>
          `${snapshotName}[${JSON.stringify(name)}] = {binding:${previousNamespace}[${JSON.stringify(name)}],value:${previousNamespace}[${JSON.stringify(name)}].value};`,
      ),
      ...previousBindings.map(
        ({ name, kind }) =>
          `${kind} ${name} = ${previousNamespace}[${JSON.stringify(name)}].value;`,
      ),
    ].join('');

    const edits = carriedReferenceEdits(root, carriedNames, previousNamespace);
    const activeBindings = new Map(previousBindingsByName);
    // `var` declarations hoist to the top of module scope and exist (as
    // undefined) before their declaring statement runs. Seed them up front so a
    // statement-boundary snapshot taken BEFORE the declaration still carries any
    // value already assigned to them — otherwise `y = 42; throw; var y;` loses
    // the 42 that plain Node keeps. `const`/`let` are deliberately NOT seeded:
    // they are in TDZ until their declaration executes.
    for (const [name, kind] of currentBindings) {
      if (kind === 'var' && !activeBindings.has(name)) {
        activeBindings.set(name, kind);
      }
    }
    let generatedCommitChars = 0;
    let commitCounter = 0;

    for (const item of sourceItems) {
      const declaration = topLevelVariableDeclaration(item);
      if (declaration) {
        const completedBindings = new Map(activeBindings);
        const kind = declarationKind(declaration);
        for (const declarator of declaration.namedChildren) {
          if (declarator.type !== 'variable_declarator') continue;
          const name = declarator.childForFieldName('name');
          if (name) addPatternBindings(name, kind, completedBindings);
          for (const name of carriedVars.privateNames)
            completedBindings.delete(name);
          const marker = snapshotDeclarator(
            `${prefix}commit_${commitCounter++}`,
            snapshotName,
            references,
            [...completedBindings]
              .map(([bindingName, bindingKind]) => ({
                name: bindingName,
                kind: bindingKind,
              }))
              .sort((left, right) =>
                left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
              ),
            MAX_TRANSFORMED_SOURCE_CHARS -
              code.length -
              prelude.length -
              generatedCommitChars,
          );
          generatedCommitChars += marker.length;
          edits.push({
            start: declarator.endIndex,
            end: declarator.endIndex,
            text: marker,
          });
        }
      }
      const declaredHere = new Map<string, NodeReplBindingKind>();
      collectDeclarationNames(item, declaredHere);
      collectTopLevelLoopVarBindings(item, declaredHere);
      for (const name of carriedVars.privateNames) declaredHere.delete(name);
      for (const [name, kind] of declaredHere) {
        if (!activeBindings.has(name)) {
          activeBindings.set(name, kind);
        }
      }
      const commit = snapshotAssignments(
        snapshotName,
        references,
        [...activeBindings]
          .map(([name, kind]) => ({ name, kind }))
          .sort((left, right) =>
            left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
          ),
        MAX_TRANSFORMED_SOURCE_CHARS -
          code.length -
          prelude.length -
          generatedCommitChars,
      );
      generatedCommitChars += commit.length;

      if (commit) {
        edits.push({
          start: item.endIndex,
          end: item.endIndex,
          text: `;${commit}`,
        });
      }
    }

    const rewritten = applyEdits(code, edits);
    const suffix = `\n${commit}(${references}, false);} catch (${error}) {${commit}(${snapshotName}, true);throw ${error};}})`;
    const source = `${prelude}\n${rewritten}${suffix}`;
    if (source.length > MAX_TRANSFORMED_SOURCE_CHARS) {
      throw new Error('Transformed JavaScript cell exceeds the sanity limit');
    }

    return {
      source,
      bindings: allBindings,
    };
  } finally {
    tree?.delete();
  }
}
