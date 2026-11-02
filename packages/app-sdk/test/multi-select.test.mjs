import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiRuntime } from './ui-test-runtime.mjs';

test('multi-selection keeps controlled values, selectedOptions, form data and disabled semantics', async t => {
  const env = await createUiRuntime(t, 'input'); if (!env) return;
  const { React, ui, render } = env;
  const ref = React.createRef(); let selected;
  function Form() {
    const [values, setValues] = React.useState(['a']);
    return React.createElement('form', null, React.createElement(ui.MultiSelect, {
      ref, name: 'tasks', 'aria-label': 'Tasks', value: values,
      onChange: event => { selected = Array.from(event.target.selectedOptions, option => option.value); setValues(selected); },
    }, ['a', 'b', 'c'].map(value => React.createElement('option', { key: value, value }, value))));
  }
  await render(React.createElement(Form));
  assert.equal(ref.current.multiple, true);
  await React.act(async () => { ref.current.options[1].selected = true; ref.current.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.deepEqual(selected, ['a', 'b']);
  assert.deepEqual(new window.FormData(document.querySelector('form')).getAll('tasks'), ['a', 'b']);
  await render(React.createElement(ui.MultiSelect, { disabled: true, value: ['b'], onChange() {}, 'aria-label': 'Tasks' }, React.createElement('option', { value: 'b' }, 'b')));
  assert.equal(document.querySelector('select').disabled, true);
});
