import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIpynb, editIpynbCell } from '../src/ipynb.ts';
import { renderIpynbHtml } from '../src/ipynb-render.ts';
const source = readFileSync(new URL('./fixtures/ipynb-contract.json', import.meta.url), 'utf8');
test('notebook preview renders Markdown and recorded math without HTML/script execution', () => {
  const html = renderIpynbHtml(editIpynbCell(parseIpynb(source), 1, 'new code'));
  assert.match(html, /Content-Security-Policy/); assert.match(html, /<math/); assert.match(html, /Stale recorded outputs/);
  assert.doesNotMatch(html, /<script/); assert.match(html, /text\/html retained/); assert.match(html, /application\/javascript retained/);
});
test('static visibility and truncation are explicit while source stays exact', () => {
  const raw = JSON.parse(source); raw.cells[1].metadata.tags = ['remove-input']; raw.cells[1].source = 'INPUT_SECRET';
  raw.cells[1].outputs[1].data['text/latex'] = 'x'.repeat(16385); raw.cells[2].metadata.tags = ['hide-cell']; raw.cells[2].source = 'HIDDEN_SECRET';
  const exact = JSON.stringify(raw); const notebook = parseIpynb(exact); const html = renderIpynbHtml(notebook);
  assert.doesNotMatch(html, /INPUT_SECRET|HIDDEN_SECRET/); assert.match(html, /LaTeX preview truncated at 16384/); assert.equal(notebook.source, exact);
  assert.equal((notebook.cells[1].outputs[1].data as any)['text/latex'].length, 16385);
  raw.cells[1].metadata.tags = ['remove-output']; assert.doesNotMatch(renderIpynbHtml(parseIpynb(JSON.stringify(raw))), /LaTeX preview truncated/);
});
