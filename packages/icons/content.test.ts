import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentIconRegistry } from './content.ts';

test('content associations retain explicit format and language authority', () => {
  const registry = new ContentIconRegistry();
  for (const [input, expected] of [
    [{ kind: 'code', language: 'Rust', path: 'script.py' }, 'file-cog'],
    [{ kind: 'json', path: 'misnamed.rs' }, 'file-braces'],
    [{ kind: 'json_lines' }, 'file-spreadsheet'],
    [{ kind: 'markdown', path: 'README' }, 'book-open-text'],
    [{ path: 'C:\\Work\\TYPES.D.TS' }, 'file-type'],
    [{ path: '/work/.gitignore' }, 'git-branch'],
    [{ kind: 'code', language: 'new-language' }, 'file-code'],
    [{ path: '/work/unknown.suffix' }, 'file'],
    [{ kind: 'app', app: 'paper-agent' }, 'book-open-text'],
    [{ kind: 'app', app: 'third-party' }, 'layout-grid'],
    [{ app: '' }, 'layout-grid'],
  ] as const) assert.equal(registry.resolve(input), expected);
});

test('theme associations select bundled glyphs and can be removed', () => {
  const registry = new ContentIconRegistry();
  registry.register({ type: 'extensions', value: ' .RESULT.JSON ' }, 'database', 'network');
  const input = { path: '/work/run.RESULT.JSON' };
  assert.equal(registry.resolve(input), 'database');
  assert.equal(registry.resolve({ ...input, dark: true }), 'network');
  registry.remove({ type: 'extensions', value: 'result.json' });
  assert.equal(registry.resolve(input), 'file-braces');
  assert.throws(() => registry.register({ type: 'languages', value: ' ' }, 'code'));
  assert.throws(() => registry.register({ type: 'apps', value: 'custom' }, 'https://example.test/icon.svg'));
});
