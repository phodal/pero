import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageWorkbenchWeb } from './workbench-payload.mjs';

test('Workbench payload drops standalone Chat while retaining its own runtime and shared assets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pero-workbench-web-'));
  try {
    const source = join(directory, 'source');
    const destination = join(directory, 'payload');
    mkdirSync(join(source, 'assets'), { recursive: true });
    const files = [
      ['index.html', 'workbench entry', true],
      ['chat.html', 'standalone Chat entry', false],
      ['assets/workbench-HASH.js', 'workbench code', true],
      ['assets/workbench-HASH.css', 'workbench styles', true],
      ['assets/pero_ui_bg-HASH.wasm', 'workbench runtime', true],
      ['assets/locales-HASH.js', 'shared locale and theme data', true],
      ['assets/chat-HASH.js', 'standalone Chat code', false],
      ['assets/chat-HASH.css', 'standalone Chat styles', false],
      ['assets/pero_chat_web_bg-HASH.wasm', 'standalone Chat runtime', false],
    ];
    for (const [name, content] of files) writeFileSync(join(source, name), content);
    stageWorkbenchWeb(source, destination);
    assert.deepEqual(readdirSync(destination).sort(), ['assets', 'index.html']);
    assert.deepEqual(readdirSync(join(destination, 'assets')).sort(), files.filter(([name, , included]) => included && name.startsWith('assets/')).map(([name]) => name.slice('assets/'.length)).sort());
    for (const [name, content, included] of files) {
      assert.equal(readFileSync(join(source, name), 'utf8'), content, `development output retains ${name}`);
      if (included) assert.equal(readFileSync(join(destination, name), 'utf8'), content);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
