import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { colorRoles, metrics, radii, space, typePx } from './tokens.generated.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const generated = readFileSync(resolve(dir, 'tokens.generated.css'), 'utf8');
const css = readFileSync(resolve(dir, 'tokens.css'), 'utf8');
const components = readFileSync(resolve(dir, 'components.css'), 'utf8');

test('generated geometry matches the TypeSpec contract', () => {
  for (const value of [...Object.values(space), ...Object.values(typePx), ...Object.values(radii), ...Object.values(metrics)]) {
    assert.match(generated, new RegExp(`${value}px`));
  }
  assert.match(generated, /--pero-icon-gap:\s*6px/);
  assert.match(generated, /--pero-row-nav:\s*32px/);
  assert.match(generated, /--pero-row-menu:\s*32px/);
  assert.equal(metrics.menuRow, 32);
  assert.match(generated, /--pero-reading-width:\s*720px/);
  assert.match(generated, /--pero-role-page:\s*var\(--pero-bg\)/);
  assert.match(generated, /--pero-role-sidebar:\s*var\(--pero-surface-muted\)/);
  assert.match(generated, /--pero-role-reading:\s*var\(--pero-surface\)/);
  assert.match(generated, /--pero-role-accent-soft:\s*var\(--pero-accent-soft\)/);
  assert.match(generated, new RegExp(`--pero-role-list:\\s*${colorRoles.list.light}`));
  assert.match(generated, new RegExp(`--pero-role-list:\\s*${colorRoles.list.dark}`));
  assert.equal(colorRoles.action.light, '#007F86');
  assert.equal(colorRoles.action.dark, '#55D5DD');
  assert.equal(metrics.sidebarNavRow, 32);
  assert.ok(css.includes(generated));
});

test('materials reference Pero roles and do not copy Wake colors', () => {
  const source = css + components;
  assert.match(css, /--pero-material-sidebar:\s*var\(--pero-role-sidebar\)/);
  assert.match(css, /--pero-material-chrome:\s*var\(--pero-role-page\)/);
  assert.match(css, /--pero-material-reading:\s*var\(--pero-role-reading\)/);
  assert.match(css, /--pero-fill-selected:\s*var\(--pero-role-accent-soft\)/);
  assert.doesNotMatch(source, /#(?:0A84FF|4C8DFF|EDEDEA|F7F7F5|1D1D1F|FDFDFC)/i);
  const allowed = new Set([colorRoles.list.light, colorRoles.list.dark]);
  for (const hex of source.match(/#[0-9a-fA-F]{3,8}/g) ?? []) assert.ok(allowed.has(hex), hex);
});
