import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('file picker preserves selection on cancellation and supports repeated and multiple imports', async t => {
  const {React, dom, ui, render} = await createUiRuntime(t, 'input');
  const selected = [];
  const one = new dom.window.File(['x'], 'one.csv'), two = new dom.window.File(['y'], 'two.csv');
  const choose = async files => {
    const input = document.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', {configurable:true, value:files});
    await React.act(async () => input.dispatchEvent(new dom.window.Event('change', {bubbles:true})));
  };
  await render(React.createElement(ui.FilePicker, {label:'Import',emptyLabel:'No file',onFile:file=>selected.push(file)}));
  await choose([one]); await choose([]); await choose([one]);
  assert.deepEqual(selected, [one,one]);
  assert.equal(document.querySelector('[role=status]').textContent, 'one.csv');
  assert.equal(document.querySelector('input').value, '');
  await render(null);
  const batches = [];
  const props = {label:'Import files',emptyLabel:'No files',multiple:true,onFiles:files=>batches.push(files)};
  await render(React.createElement(ui.FilePicker, props));
  assert.equal(document.querySelector('input').multiple, true);
  await choose([one,two]);
  assert.deepEqual(batches, [[one,two]]);
  assert.equal(document.querySelector('[role=status]').textContent, 'one.csv, two.csv');
  await render(React.createElement(ui.FilePicker, {...props,busy:true}));
  assert.equal(document.querySelector('button').disabled, true);
  assert.equal(document.querySelector('input').disabled, true);
});

test('native selector retains required form validation and submitted value', async t => {
  const {React, dom, ui, render} = await createUiRuntime(t, 'input');
  await render(React.createElement('form', null, React.createElement(ui.NativeSelect, {name:'kind',required:true,defaultValue:'','aria-label':'Kind'},
    React.createElement('option',{value:''},'Choose'), React.createElement('option',{value:'csv'},'CSV'))));
  const form = document.querySelector('form'), select = form.querySelector('select');
  assert.equal(form.checkValidity(), false);
  select.value = 'csv';
  assert.equal(form.checkValidity(), true);
  assert.equal(new dom.window.FormData(form).get('kind'), 'csv');
});
