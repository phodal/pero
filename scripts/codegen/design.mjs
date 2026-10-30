import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compile as compileTypeSpec, NodeHost, logDiagnostics } from '@typespec/compiler';
import { scriptOptions } from '../lib/options.mjs';

const { root, check } = scriptOptions(null);
const banner = 'Generated from spec/pero-design/design.tsp. Do not edit.';

const components = {
  SidebarRow: ['label', 'active', 'level'],
  LibraryHeader: ['title', 'actions'],
  ListRow: ['title', 'active', 'actions'],
  ReaderFrame: ['title'],
  Badge: ['label'],
  OutlineBadge: ['label'],
  EmptyState: ['heading'],
  SettingsGroup: [],
  SettingsRow: ['label', 'actions'],
  ActionButton: ['label', 'kind'],
  SearchField: [],
};

const literal = schema => {
  if (!schema || typeof schema !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length === 1) return schema.enum[0];
  return undefined;
};

const props = schema => Object.fromEntries(Object.entries(schema?.properties ?? {}).flatMap(([name, value]) => {
  const valueLiteral = literal(value);
  return valueLiteral === undefined ? [] : [[name, valueLiteral]];
}));

async function compiledSchema() {
  const files = new Map();
  const host = {
    ...NodeHost,
    mkdirp: async () => {},
    writeFile: async (path, content) => { files.set(resolve(path), content); },
  };
  const program = await compileTypeSpec(host, resolve(root, 'spec/pero-design/design.tsp'), {
    emit: ['@typespec/json-schema'],
    outputDir: resolve(root, 'spec/pero-design/tsp-output'),
    warningAsError: true,
    options: { '@typespec/json-schema': { 'file-type': 'json', bundleId: 'design.schema.json' } },
  });
  if (program.hasError()) {
    logDiagnostics(program.diagnostics, NodeHost.logSink);
    throw new Error('TypeSpec compilation failed: spec/pero-design/design.tsp');
  }
  const path = [...files.keys()].find(file => file.endsWith(`${resolve('spec/pero-design/tsp-output', '@typespec/json-schema', 'design.schema.json')}`) || file.endsWith('design.schema.json'));
  const bundle = path ? files.get(path) : [...files.values()][0];
  if (!bundle) throw new Error('TypeSpec did not emit design.schema.json');
  return JSON.parse(bundle);
}

function contractOf(schema) {
  const defs = schema.$defs ?? {};
  for (const [name, required] of Object.entries(components)) {
    const model = defs[name];
    if (!model?.properties) throw new Error(`Design contract is missing ${name}`);
    for (const prop of required) {
      if (!model.properties[prop]) throw new Error(`${name} is missing ${prop}`);
    }
  }
  const space = props(defs.Space);
  const typePx = props(defs.TypePx);
  const typeWeight = props(defs.TypeWeight);
  const radii = props(defs.Radii);
  const metrics = props(defs.Metrics);
  const colors = Object.fromEntries([
    ['page', 'PageColor'],
    ['sidebar', 'SidebarColor'],
    ['list', 'ListColor'],
    ['reading', 'ReadingColor'],
    ['text', 'TextColor'],
    ['textMuted', 'TextMutedColor'],
    ['action', 'ActionColor'],
    ['actionHover', 'ActionHoverColor'],
    ['onAction', 'OnActionColor'],
    ['accentSoft', 'AccentSoftColor'],
    ['border', 'BorderColor'],
    ['danger', 'DangerColor'],
    ['focus', 'FocusColor'],
  ].map(([role, model]) => {
    const pair = props(defs[model]);
    if (!/^#[0-9A-F]{6}$/.test(pair.light) || !/^#[0-9A-F]{6}$/.test(pair.dark)) {
      throw new Error(`${model} needs light and dark hex strings`);
    }
    return [role, pair];
  }));
  for (const [name, value] of [...Object.entries(space), ...Object.entries(typePx), ...Object.entries(radii), ...Object.entries(metrics)]) {
    if (!Number.isFinite(value)) throw new Error(`${name} is not a number`);
  }
  return { space, typePx, typeWeight, radii, metrics, colors };
}

const px = value => `${value}px`;

function cssOf(contract) {
  const { space, typePx, radii, metrics, colors } = contract;
  const decl = (name, value) => `  --${name}: ${value};`;
  const lines = [
    decl('pero-space-1', px(space.space4)),
    decl('pero-space-2', px(space.space8)),
    decl('pero-space-3', px(space.space12)),
    decl('pero-space-4', px(space.space16)),
    decl('pero-space-5', px(space.space20)),
    decl('pero-space-6', px(space.space24)),
    decl('pero-icon-gap', px(space.iconGap)),
    decl('pero-font-title', `calc(${px(typePx.title)} * var(--pero-font-scale, 1))`),
    decl('pero-font-heading', `calc(${px(typePx.heading)} * var(--pero-font-scale, 1))`),
    decl('pero-font-body', `calc(${px(typePx.body)} * var(--pero-font-scale, 1))`),
    decl('pero-font-caption', `calc(${px(typePx.caption)} * var(--pero-font-scale, 1))`),
    decl('pero-font-label', `calc(${px(typePx.label)} * var(--pero-font-scale, 1))`),
    decl('pero-radius-panel', px(radii.panel)),
    decl('pero-radius-selection', px(radii.selection)),
    decl('pero-radius-button', px(radii.button)),
    decl('pero-radius-kbd', px(radii.kbd)),
    decl('pero-radius-badge', px(radii.badge)),
    decl('pero-radius-cell', px(radii.cell)),
    decl('pero-lead', px(metrics.leadBox)),
    decl('pero-row-nav', px(metrics.sidebarNavRow)),
    decl('pero-row-sub', px(metrics.subRow)),
    decl('pero-sub-indent', px(metrics.subIndent)),
    decl('pero-library-header', px(metrics.libraryHeader)),
    decl('pero-action-button-height', px(metrics.actionButtonHeight)),
    decl('pero-action-button-padding', px(metrics.actionButtonPadding)),
    decl('pero-ghost-icon-button', px(metrics.ghostIconButton)),
    decl('pero-search-height', px(metrics.searchFieldHeight)),
    decl('pero-reading-width', px(metrics.readerMaxWidth)),
    decl('pero-sidebar-width', px(metrics.sidebarWidth)),
    decl('pero-list-column', px(metrics.listColumn)),
    decl('pero-role-page', 'var(--pero-bg)'),
    decl('pero-role-sidebar', 'var(--pero-surface-muted)'),
    decl('pero-role-reading', 'var(--pero-surface)'),
    decl('pero-role-text', 'var(--pero-text)'),
    decl('pero-role-text-muted', 'var(--pero-text-muted)'),
    decl('pero-role-action', 'var(--pero-action)'),
    decl('pero-role-action-hover', 'var(--pero-action-hover)'),
    decl('pero-role-on-action', 'var(--pero-on-action)'),
    decl('pero-role-accent-soft', 'var(--pero-accent-soft)'),
    decl('pero-role-border', 'var(--pero-border)'),
    decl('pero-role-danger', 'var(--pero-error)'),
    decl('pero-role-focus', 'var(--pero-focus)'),
    decl('pero-role-list', colors.list.light),
  ];
  return `/* ${banner} */\n:root {\n${lines.join('\n')}\n}\n@media (prefers-color-scheme: dark) {\n  :root { --pero-role-list: ${colors.list.dark}; }\n}\n`;
}

function tsOf(contract) {
  const body = JSON.stringify(contract, null, 2);
  return `/** ${banner} */\nexport const designContract = ${body} as const;\nexport const { space, typePx, typeWeight, radii, metrics, colors: colorRoles } = designContract;\n`;
}

function rustOf(contract) {
  const { space, typePx, typeWeight, radii, metrics, colors } = contract;
  const num = (name, value) => `pub const ${name}: f32 = ${value}.;`;
  const text = (name, value) => `pub const ${name}: &str = ${JSON.stringify(value)};`;
  const lines = [
    num('SPACE_4', space.space4),
    num('SPACE_8', space.space8),
    num('SPACE_12', space.space12),
    num('SPACE_16', space.space16),
    num('SPACE_20', space.space20),
    num('SPACE_24', space.space24),
    num('ICON_GAP', space.iconGap),
    num('TYPE_TITLE', typePx.title),
    num('TYPE_HEADING', typePx.heading),
    num('TYPE_BODY', typePx.body),
    num('TYPE_CAPTION', typePx.caption),
    num('TYPE_LABEL', typePx.label),
    text('WEIGHT_TITLE', typeWeight.title),
    text('WEIGHT_HEADING', typeWeight.heading),
    text('WEIGHT_LIST_TITLE', typeWeight.listTitle),
    text('WEIGHT_BODY', typeWeight.body),
    num('RADIUS_PANEL', radii.panel),
    num('RADIUS_SELECTION', radii.selection),
    num('RADIUS_BUTTON', radii.button),
    num('RADIUS_KBD', radii.kbd),
    num('RADIUS_BADGE', radii.badge),
    num('RADIUS_CELL', radii.cell),
    num('ROW_NAV', metrics.sidebarNavRow),
    num('ROW_SUB', metrics.subRow),
    num('LEAD_BOX', metrics.leadBox),
    num('SUB_INDENT', metrics.subIndent),
    num('LIBRARY_HEADER', metrics.libraryHeader),
    num('ACTION_BUTTON_HEIGHT', metrics.actionButtonHeight),
    num('ACTION_BUTTON_PADDING', metrics.actionButtonPadding),
    num('GHOST_ICON_BUTTON', metrics.ghostIconButton),
    num('SEARCH_FIELD_HEIGHT', metrics.searchFieldHeight),
    num('READER_MAX_WIDTH', metrics.readerMaxWidth),
    num('SIDEBAR_WIDTH', metrics.sidebarWidth),
    num('LIST_COLUMN', metrics.listColumn),
  ];
  for (const [role, pair] of Object.entries(colors)) {
    const ident = role.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase();
    lines.push(text(`${ident}_LIGHT`, pair.light), text(`${ident}_DARK`, pair.dark));
  }
  return `// ${banner}\n#![allow(dead_code)]\n${lines.join('\n')}\n`;
}

function write(path, output) {
  if (check) {
    let current = '';
    try { current = readFileSync(path, 'utf8'); } catch {}
    if (current.replaceAll('\r\n', '\n') !== output) throw new Error(`${path} is stale. Run npm run gen:design`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, output);
}

const contract = contractOf(await compiledSchema());
const generatedCss = cssOf(contract);
const materials = readFileSync(resolve(root, 'packages/pero-design/src/tokens.materials.css'), 'utf8').replaceAll('\r\n', '\n');
const tokensCss = `/* ${banner} Geometry is emitted from the TypeSpec contract; materials follow. */\n${generatedCss}${materials.endsWith('\n') ? materials : `${materials}\n`}`;
write(resolve(root, 'packages/pero-design/src/tokens.generated.css'), generatedCss);
write(resolve(root, 'packages/pero-design/src/tokens.css'), tokensCss);
write(resolve(root, 'packages/pero-design/src/tokens.generated.ts'), tsOf(contract));
write(resolve(root, 'crates/pero-theme/src/design_tokens.rs'), rustOf(contract));
