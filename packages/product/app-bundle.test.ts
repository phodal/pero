import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppBundle } from './app-bundle.ts';

test('AppBundle selects explicit portable artifact files', () => {
  const base = { schemaVersion: 1, name: 'sample', files: ['app.json', 'dist/index.html', 'backend/server.mjs'] };
  for (const [value, accepted] of [
    [base, true],
    [{ ...base, files: ['dist/index.html'] }, false],
    [{ ...base, files: ['app.json', '../engine.mjs'] }, false],
    [{ ...base, files: ['app.json', '/engine.mjs'] }, false],
    [{ ...base, files: ['app.json', 'C:\\engine.mjs'] }, false],
    [{ ...base, files: ['app.json', 'app.json'] }, false],
    [{ ...base, files: ['app.json', 'dist/'] }, false],
    [{ ...base, command: 'npm run build' }, false],
  ] as const) {
    if (accepted) assert.doesNotThrow(() => AppBundle.parse(value));
    else assert.throws(() => AppBundle.parse(value));
  }
});
