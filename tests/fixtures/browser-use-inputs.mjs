import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const browserFiles = [{ name: 'alfa.txt', text: 'First file' }, { name: 'beta.txt', text: 'Second file' }];
export const browserFileRefs = browserFiles.map(({ text }) => 'sha256:' + createHash('sha256').update(text).digest('hex'));
export const browserInputFrame = '<label>Frame field <input placeholder="Frame draft"></label>';
export const browserInputPage = `<!doctype html><title>Browser input fixture</title>
<style>body{font:16px sans-serif;padding:8px}input{width:130px}button{padding:6px}</style>
<section data-testid="primary">
  <input placeholder="Draft" aria-label="Primary draft">
  <span data-testid="keys">Pending keys</span><span data-testid="modifiers">Pending modifiers</span>
</section>
<section data-testid="secondary"><input placeholder="Draft" aria-label="Secondary draft"></section>
<div id="shadow"><button slot="action" type="button">Assigned action</button></div>
<p data-testid="shadow-result">Before action</p>
<button type="button" id="details">Open details</button>
<span data-testid="pointer-result">Pending pointer</span>
<label>Files <input id="files" type="file" multiple></label>
<p data-testid="file-result">No files</p>
<iframe title="Embedded" src="/batch-frame" style="width:220px;height:36px"></iframe>
<div style="height:1000px"></div>
<button type="button" id="offscreen">Offscreen action</button>
<p data-testid="offscreen-result">Before offscreen click</p>
<script>
  const find = value => document.querySelector(value);
  const set = (id, value) => find('[data-testid="' + id + '"]').textContent = value;
  find('#shadow').attachShadow({mode:'open'}).innerHTML = '<slot name="action"></slot>';
  find('#shadow button').onclick = event => set('shadow-result', 'Assigned clicked ' + event.isTrusted);
  const keys = [];
  find('[aria-label="Primary draft"]').addEventListener('keydown', event => {
    if (event.altKey) {
      set('modifiers', 'Alt key ' + event.isTrusted);
      event.preventDefault();
    } else if (event.key.length === 1) {
      keys.push(event.key);
      set('keys', 'Keys: ' + keys.join(',') + ' ' + event.isTrusted);
    }
  });
  find('#details').addEventListener('mouseover', event => set('pointer-result', 'Hover ' + event.isTrusted));
  find('#details').addEventListener('dblclick', event => set('pointer-result', 'Double-click ' + event.isTrusted));
  find('#files').onchange = async event => {
    const files = await Promise.all([...event.target.files].map(async file => file.name + '=' + await file.text()));
    set('file-result', files.join('; '));
  };
  find('#offscreen').onclick = event => set('offscreen-result', 'Offscreen clicked ' + event.isTrusted);
</script>`;

const testId = value => ({ by: 'testId', value });
const byRole = name => ({ by: 'role', role: 'button', name });
const locate = (locator, scope = {}) => ({ action: 'locate', locator, ...scope });
const waitText = (id, value) => ({ action: 'wait', timeoutMs: 1800, locator: testId(id), condition: { kind: 'text', value } });

export const browserInputCommands = [
  { action: 'tabs' },
  locate({ by: 'placeholder', value: 'Draft' }),
  locate({ by: 'placeholder', value: 'Draft' }, { within: testId('primary') }),
  { action: 'typeSequentially', name: 'Primary draft', text: 'Ab 1' },
  waitText('keys', 'Keys: A,b, ,1 true'),
  { action: 'wait', locator: { by: 'placeholder', value: 'Draft' }, within: testId('primary'),
    condition: { kind: 'value', value: 'Ab 1' } },
  { action: 'press', name: 'Primary draft', key: 'b', modifiers: ['Alt'] },
  waitText('modifiers', 'Alt key true'),
  locate(byRole('Assigned action')),
  { action: 'click', name: 'Assigned action' },
  waitText('shadow-result', 'Assigned clicked true'),
  locate(byRole('Open details')),
  { action: 'hover', name: 'Open details' },
  waitText('pointer-result', 'Hover true'),
  locate(byRole('Open details')),
  { action: 'dblclick', name: 'Open details' },
  waitText('pointer-result', 'Double-click true'),
  { action: 'files' },
  locate({ by: 'label', value: 'Files' }),
  { action: 'upload', name: 'Files', fileRefs: browserFileRefs },
  waitText('file-result', 'alfa.txt=First file; beta.txt=Second file'),
  locate({ by: 'placeholder', value: 'Frame draft' }, { frame: [{ by:'title', value:'Embedded' }] }),
  { action: 'fill', name: 'Frame field', text: 'frame result' },
  { action: 'wait', locator: { by: 'placeholder', value: 'Frame draft' }, frame: [{ by:'title', value:'Embedded' }],
    condition: { kind: 'value', value: 'frame result' } },
  locate(byRole('Offscreen action')),
  { action: 'scrollIntoView', name: 'Offscreen action' },
  locate(byRole('Offscreen action')),
  { action: 'click', name: 'Offscreen action' },
  waitText('offscreen-result', 'Offscreen clicked true'),
];

export function verifyBrowserInputs(results) {
  assert(Array.isArray(results), JSON.stringify(results));
  assert.equal(results.length, browserInputCommands.length);
  assert.equal(results[0].tabs.length, 1);
  assert.equal(results[1].isError, true, 'Unscoped locator is ambiguous.');
  assert.match(results[1].error, /ambiguous|more than one/i);
  for (const [index, command] of browserInputCommands.entries()) {
    if (index === 1) continue;
    const result = results[index];
    assert.equal(result.isError, false, JSON.stringify({ command, result }));
    if (command.action === 'wait') assert.equal(result.matched, true, JSON.stringify({ command, result }));
    if (result.receiptId) {
      assert.equal(result.outcome, 'dispatched', JSON.stringify({ command, result }));
      assert.equal(result.verified, false);
    }
  }
  assert.deepEqual(results[17].files.map(({ ref }) => ref), browserFileRefs);
  assert.equal(results[23].nodes[0].state.value, 'frame result');
}
