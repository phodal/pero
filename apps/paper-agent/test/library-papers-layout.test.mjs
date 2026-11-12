import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Layout acceptance is visual; this pins the structural rules that stopped
// selected library rows from painting over neighboring titles and authors.
test('library papers rows use stacked grids instead of nested subgrid', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../ui-src/library-papers.css'), 'utf8');
  assert.match(css, /\.pa-library-papers \.pa-library-table\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.pa-library-papers \.pa-library-list\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(css, /\.pa-library-papers \.pa-library-list\s*\{[^}]*display:\s*contents/s);
  assert.match(css, /--pa-library-columns:/);
  assert.match(css, /\.pero-list-open\.pero-ui-button\[aria-pressed=true\][^}]*background:\s*transparent/s);
});
